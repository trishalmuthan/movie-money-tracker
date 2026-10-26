"""Fee charges in the ledger: Activity, wallets, runway, and editing one month (M3 Task 3)."""

import datetime as dt

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.deps import get_today

PLAN = {
    "chain_id": 1,
    "amount": 599,
    "billing_day": 22,
    "start_date": "2026-01-01",
    "payment_source": "gift_card",
}
CARD = {"chain_id": 1, "date": "2026-01-01", "price_paid": 3500, "face_value": 5000}


def _post(client: TestClient, path: str, body: dict[str, object]) -> dict:
    response = client.post(f"/api/v1/{path}", json=body)
    assert response.status_code == 201, response.text
    return response.json()


def _reference(client: TestClient, *, card: bool = True) -> None:
    """Regal $5.99 from Jan, $12.99 from June, paid from gift card (+ the M1 $35 → $50 card)."""
    _post(client, "chains", {"name": "Regal", "standard_ticket_price": 1500})
    if card:
        _post(client, "gift-cards", CARD)
    _post(client, "plans", PLAN)
    _post(client, "plans/1/change-price", {"amount": 1299, "from_month": "2026-06"})


def _fees(client: TestClient) -> dict[str, dict]:
    return {e["date"][:7]: e for e in client.get("/api/v1/activity?kind=fee").json()}


def _wallet(client: TestClient) -> dict:
    return client.get("/api/v1/wallets").json()[0]


def test_fees_show_in_activity_with_fifo_effective_costs(client: TestClient) -> None:
    _reference(client)
    fees = _fees(client)
    assert list(fees) == [f"2026-{m:02d}" for m in range(9, 0, -1)]  # newest first
    assert fees["2026-01"] == {
        "kind": "fee",
        "id": fees["2026-01"]["id"],
        "date": "2026-01-22",
        "chain_id": 1,
        "description": "Regal subscription",
        "amount": 599,
        "payment_source": "gift_card",
        "effective_cost": 419,  # 599 × 3500 / 5000
        "is_overridden": False,
        "from_sheet": False,
    }
    assert fees["2026-06"]["amount"] == 1299


def test_fee_follows_the_card_bought_the_same_day(client: TestClient) -> None:
    """Within a day, money arrives before it's spent, so a card bought on a billing day pays it."""
    _post(client, "chains", {"name": "Regal", "standard_ticket_price": 1500})
    _post(client, "gift-cards", {**CARD, "date": "2026-01-22"})
    _post(client, "plans", {**PLAN, "end_date": "2026-01-31"})
    rows = client.get("/api/v1/activity").json()
    assert [r["kind"] for r in rows] == ["fee", "gift_card"]
    assert rows[0]["effective_cost"] == 419


def test_uncovered_fees_show_on_the_wallet(client: TestClient) -> None:
    _reference(client)
    march = _fees(client)["2026-03"]["id"]
    assert (
        client.put(
            f"/api/v1/fees/{march}", json={"amount": 0, "payment_source": "gift_card"}
        ).status_code
        == 200
    )
    # 4 × 599 + 4 × 1299 = 7592 of fees against a $50 card.
    assert _wallet(client) == {
        "chain_id": 1,
        "chain_name": "Regal",
        "balance": -2592,
        "uncovered": 2592,
        "runway_months": 0,
    }
    fees = _fees(client)
    assert (fees["2026-03"]["amount"], fees["2026-03"]["is_overridden"]) == (0, True)
    assert fees["2026-09"]["effective_cost"] == 1299  # uncovered → counted at face


def test_editing_a_fee_overrides_it_and_reset_restores_the_plan(client: TestClient) -> None:
    _reference(client)
    march = _fees(client)["2026-03"]["id"]
    edited = client.put(f"/api/v1/fees/{march}", json={"amount": 0, "payment_source": "bank"})
    assert edited.status_code == 200
    assert edited.json() == {
        "id": march,
        "plan_id": 1,
        "chain_id": 1,
        "month": "2026-03",
        "date": "2026-03-22",
        "amount": 0,
        "payment_source": "bank",
        "is_overridden": True,
        "from_sheet": False,
    }
    # Generation (any ledger read, any plan edit) leaves it alone.
    client.put("/api/v1/plans/1", json={**PLAN, "amount": 699, "end_date": "2026-05-31"})
    assert client.get(f"/api/v1/fees/{march}").json()["amount"] == 0

    reset = client.post(f"/api/v1/fees/{march}/reset")
    assert reset.status_code == 200
    assert reset.json() | {"id": march} == {
        **edited.json(),
        "amount": 699,
        "payment_source": "gift_card",
        "is_overridden": False,
        "from_sheet": False,
    }


def test_bank_paid_fees_leave_the_wallet_alone(client: TestClient) -> None:
    _reference(client)
    for fee in _fees(client).values():
        client.put(
            f"/api/v1/fees/{fee['id']}", json={"amount": fee["amount"], "payment_source": "bank"}
        )
    assert (_wallet(client)["balance"], _wallet(client)["uncovered"]) == (5000, 0)
    assert {f["effective_cost"] for f in _fees(client).values()} == {599, 1299}


def test_fee_edit_validation(client: TestClient) -> None:
    _reference(client)
    fee = _fees(client)["2026-01"]["id"]
    for bad in (
        {"amount": -1, "payment_source": "bank"},
        {"amount": 599, "payment_source": "free"},
    ):
        assert client.put(f"/api/v1/fees/{fee}", json=bad).status_code == 422, bad
    assert client.get("/api/v1/fees/999").status_code == 404
    assert (
        client.put("/api/v1/fees/999", json={"amount": 0, "payment_source": "bank"}).status_code
        == 404
    )
    assert client.post("/api/v1/fees/999/reset").status_code == 404


def test_reading_the_ledger_generates_newly_due_fees(app: FastAPI, client: TestClient) -> None:
    _reference(client)
    assert len(_fees(client)) == 9
    app.dependency_overrides[get_today] = lambda: dt.date(2026, 10, 22)
    assert len(_fees(client)) == 10
    assert len(client.get("/api/v1/activity").json()) == 11  # still one Oct fee, plus the card


def test_runway_counts_months_the_balance_covers(client: TestClient) -> None:
    _post(client, "chains", {"name": "Regal", "standard_ticket_price": 1500})
    _post(client, "gift-cards", CARD)
    gift_visit = {"date": "2026-02-15", "chain_id": 1, "title": "Project Hail Mary"}
    _post(client, "visits", {**gift_visit, "my_cost": 2600, "payment_source": "gift_card"})
    assert _wallet(client)["runway_months"] is None  # no plan yet
    _post(client, "plans", {**PLAN, "amount": 1299, "start_date": "2026-10-01"})
    assert (_wallet(client)["balance"], _wallet(client)["runway_months"]) == (2400, 1)


def test_runway_is_null_for_bank_paid_or_ended_plans(client: TestClient) -> None:
    _post(client, "chains", {"name": "Regal", "standard_ticket_price": 1500})
    _post(client, "gift-cards", CARD)
    _post(client, "plans", {**PLAN, "payment_source": "bank"})
    assert _wallet(client)["runway_months"] is None
    client.put("/api/v1/plans/1", json={**PLAN, "end_date": "2026-09-30"})
    assert _wallet(client)["runway_months"] is None


def test_runway_uses_the_period_in_effect_today(client: TestClient) -> None:
    _reference(client, card=False)
    _post(client, "gift-cards", {**CARD, "price_paid": 10000, "face_value": 15000})
    # 15000 − (5 × 599 + 4 × 1299) = 6809 → ⌊6809 / 1299⌋ = 5
    assert (_wallet(client)["balance"], _wallet(client)["runway_months"]) == (6809, 5)
