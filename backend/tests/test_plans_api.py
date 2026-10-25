import datetime as dt

from fastapi.testclient import TestClient
from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.db import models
from app.services.fees import ensure_fee_charges
from tests.conftest import TODAY

# The M3 reference plan: Regal $5.99 on the 22nd from 2026-01-01, paid from gift card.
PLAN = {
    "chain_id": 1,
    "amount": 599,
    "billing_day": 22,
    "start_date": "2026-01-01",
    "end_date": None,
    "payment_source": "gift_card",
}


def _chain(client: TestClient, name: str = "Regal") -> None:
    client.post("/api/v1/chains", json={"name": name, "standard_ticket_price": 1500})


def _reference(client: TestClient) -> dict:
    _chain(client)
    response = client.post("/api/v1/plans", json=PLAN)
    assert response.status_code == 201
    return response.json()


def _charges(db: Session) -> dict[str, models.FeeCharge]:
    db.expire_all()
    return {
        c.month: c for c in db.scalars(select(models.FeeCharge).order_by(models.FeeCharge.month))
    }


def _override(db: Session, month: str, amount: int = 0) -> None:
    db.execute(
        update(models.FeeCharge)
        .where(models.FeeCharge.month == month)
        .values(amount=amount, is_overridden=True)
    )
    db.commit()


def test_creating_a_plan_generates_its_due_charges(client: TestClient, db: Session) -> None:
    plan = _reference(client)
    assert plan == {**PLAN, "id": 1}
    charges = _charges(db)
    assert list(charges) == [f"2026-{m:02d}" for m in range(1, 10)]  # Oct 22 not due yet
    assert charges["2026-01"].date == dt.date(2026, 1, 22)
    assert {(c.amount, c.payment_source, c.is_overridden) for c in charges.values()} == {
        (599, models.PaymentSource.GIFT_CARD, False)
    }
    assert client.get("/api/v1/plans").json() == [plan]
    assert client.get("/api/v1/plans/1").json() == plan


def test_generating_again_never_duplicates_a_month(client: TestClient, db: Session) -> None:
    _reference(client)
    ids = {m: c.id for m, c in _charges(db).items()}
    ensure_fee_charges(db, TODAY)
    db.commit()
    assert {m: c.id for m, c in _charges(db).items()} == ids
    client.put("/api/v1/plans/1", json=PLAN)  # a no-op edit also regenerates
    assert {m: c.id for m, c in _charges(db).items()} == ids


def test_generation_picks_up_newly_due_months(client: TestClient, db: Session) -> None:
    _reference(client)
    ensure_fee_charges(db, dt.date(2026, 10, 22))
    db.commit()
    assert len(_charges(db)) == 10


def test_change_price_starts_a_new_period(client: TestClient, db: Session) -> None:
    _reference(client)
    _override(db, "2026-04", amount=0)
    response = client.post(
        "/api/v1/plans/1/change-price", json={"amount": 1299, "from_month": "2026-06"}
    )
    assert response.status_code == 201
    assert response.json() == {**PLAN, "id": 2, "amount": 1299, "start_date": "2026-06-01"}
    periods = client.get("/api/v1/plans").json()
    assert [(p["start_date"], p["end_date"], p["amount"]) for p in periods] == [
        ("2026-01-01", "2026-05-31", 599),
        ("2026-06-01", None, 1299),
    ]
    charges = _charges(db)
    assert len(charges) == 9
    assert (charges["2026-05"].amount, charges["2026-05"].plan_id) == (599, 1)
    assert (charges["2026-06"].amount, charges["2026-06"].plan_id) == (1299, 2)
    assert (charges["2026-04"].amount, charges["2026-04"].is_overridden) == (0, True)


def test_change_price_keeps_overridden_months_after_the_change(
    client: TestClient, db: Session
) -> None:
    _reference(client)
    _override(db, "2026-07", amount=500)
    client.post("/api/v1/plans/1/change-price", json={"amount": 1299, "from_month": "2026-06"})
    july = _charges(db)["2026-07"]
    assert (july.amount, july.is_overridden, july.plan_id) == (500, True, 2)


def test_change_price_month_must_fall_inside_the_period(client: TestClient) -> None:
    _reference(client)
    for month in ("2026-01", "2025-12"):  # the new period would swallow the old one
        response = client.post(
            "/api/v1/plans/1/change-price", json={"amount": 1299, "from_month": month}
        )
        assert response.status_code == 422
        assert response.json()["detail"][0]["loc"] == ["body", "from_month"]
    client.put("/api/v1/plans/1", json={**PLAN, "end_date": "2026-07-31"})
    response = client.post(
        "/api/v1/plans/1/change-price", json={"amount": 1299, "from_month": "2026-08"}
    )
    assert response.status_code == 422
    assert (
        client.post(
            "/api/v1/plans/1/change-price", json={"amount": 1299, "from_month": "2026-6"}
        ).status_code
        == 422
    )


def test_periods_for_one_chain_cannot_overlap(client: TestClient) -> None:
    _reference(client)
    response = client.post("/api/v1/plans", json={**PLAN, "start_date": "2027-01-01"})
    assert response.status_code == 409
    assert "Regal" in response.json()["detail"]
    _chain(client, "Cinemark")
    assert client.post("/api/v1/plans", json={**PLAN, "chain_id": 2}).status_code == 201
    client.put("/api/v1/plans/1", json={**PLAN, "end_date": "2026-05-31"})
    later = {**PLAN, "start_date": "2026-06-01"}
    assert client.post("/api/v1/plans", json=later).status_code == 201
    # Stretching the first period back over the second is an overlap too.
    assert client.put("/api/v1/plans/1", json=PLAN).status_code == 409


def test_ending_a_plan_removes_charges_after_the_end(client: TestClient, db: Session) -> None:
    _reference(client)
    response = client.put("/api/v1/plans/1", json={**PLAN, "end_date": "2026-07-31"})
    assert response.status_code == 200
    assert response.json()["end_date"] == "2026-07-31"
    assert list(_charges(db)) == [f"2026-{m:02d}" for m in range(1, 8)]


def test_ending_a_plan_before_an_overridden_month_is_refused(
    client: TestClient, db: Session
) -> None:
    _reference(client)
    _override(db, "2026-08")
    response = client.put("/api/v1/plans/1", json={**PLAN, "end_date": "2026-07-31"})
    assert response.status_code == 409
    assert "August 2026" in response.json()["detail"]
    assert client.get("/api/v1/plans/1").json()["end_date"] is None
    assert len(_charges(db)) == 9


def test_editing_a_plan_updates_its_generated_charges(client: TestClient, db: Session) -> None:
    _reference(client)
    _override(db, "2026-03")
    client.put(
        "/api/v1/plans/1", json={**PLAN, "amount": 699, "billing_day": 15, "payment_source": "bank"}
    )
    charges = _charges(db)
    assert (charges["2026-01"].amount, charges["2026-01"].date) == (699, dt.date(2026, 1, 15))
    assert charges["2026-01"].payment_source == models.PaymentSource.BANK
    assert (charges["2026-03"].amount, charges["2026-03"].payment_source) == (
        0,
        models.PaymentSource.GIFT_CARD,
    )
    assert "2026-10" in charges  # Oct 15 is due on the new billing day


def test_delete_removes_the_plan_and_its_charges(client: TestClient, db: Session) -> None:
    _reference(client)
    assert client.delete("/api/v1/plans/1").status_code == 204
    assert client.get("/api/v1/plans").json() == []
    assert _charges(db) == {}


def test_delete_with_overridden_charges_is_refused(client: TestClient, db: Session) -> None:
    _reference(client)
    _override(db, "2026-03")
    response = client.delete("/api/v1/plans/1")
    assert response.status_code == 409
    assert "March 2026" in response.json()["detail"]
    assert len(_charges(db)) == 9


def test_a_plan_in_use_keeps_its_chain(client: TestClient) -> None:
    _reference(client)
    assert client.delete("/api/v1/chains/1").status_code == 409


def test_validation(client: TestClient) -> None:
    _chain(client)
    for bad in (
        {"payment_source": "free"},
        {"billing_day": 29},
        {"billing_day": 0},
        {"amount": 0},
        {"end_date": "2025-12-31"},
    ):
        assert client.post("/api/v1/plans", json={**PLAN, **bad}).status_code == 422, bad
    response = client.post("/api/v1/plans", json={**PLAN, "chain_id": 9})
    assert response.status_code == 422
    assert response.json()["detail"][0]["loc"] == ["body", "chain_id"]


def test_a_future_plan_has_no_charges_yet(client: TestClient, db: Session) -> None:
    _chain(client)
    assert (
        client.post("/api/v1/plans", json={**PLAN, "start_date": "2026-11-01"}).status_code == 201
    )
    assert _charges(db) == {}


def test_unknown_plan_is_404(client: TestClient) -> None:
    assert client.get("/api/v1/plans/1").status_code == 404
    assert client.put("/api/v1/plans/1", json=PLAN).status_code == 404
    assert client.delete("/api/v1/plans/1").status_code == 404
    assert (
        client.post(
            "/api/v1/plans/1/change-price", json={"amount": 1, "from_month": "2026-06"}
        ).status_code
        == 404
    )
