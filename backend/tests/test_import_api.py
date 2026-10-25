"""The sheet import API (M5 Task 3): preview as often as you like, commit once."""

from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.db import models

# Made-up, sheet-shaped. Today is pinned to 2026-10-15 in conftest.
SHEET = """Item,Net Cost,Number of Tickets,Date
January 2026 Movie Club Fee,5.99,,1/22/2026
Regal Gift Card Purchase,35.00,,1/1/2026
Project Hail Mary,26.00,4,2/15/2026
Mission Impossible,-7.17,1,2/20/2026
February 2026 Movie Club Fee,5.99,,2/22/2026
Mystery row,abc,1,13/40/2025
"""
FILES = [{"name": "2026.csv", "text": SHEET}]
RULE = [{"until": None, "chain_id": 1}]
READY_ROWS = [
    {"file": 0, "line": 7, "skip": True},
    {"file": 0, "line": 3, "face_value": 5000},
]


def _body(rows: list[dict] | None = None, **choices: object) -> dict:
    return {
        "files": FILES,
        "choices": {"cutoff": "2026-10-15", "chain_rule": RULE, "rows": rows or [], **choices},
    }


def _chain(client: TestClient) -> None:
    client.post("/api/v1/chains", json={"name": "Regal", "standard_ticket_price": 1500})


def _count(db: Session, model: type) -> int:
    db.expire_all()
    return db.scalar(select(func.count()).select_from(model)) or 0


def test_preview_proposes_without_writing(client: TestClient, db: Session) -> None:
    _chain(client)
    responses = [client.post("/api/v1/import/preview", json=_body()) for _ in range(2)]
    assert [r.status_code for r in responses] == [200, 200]
    proposal = responses[1].json()
    assert proposal["ready"] is False
    assert [(e["line"], e["column"]) for e in proposal["errors"]] == [(7, "Net Cost"), (7, "Date")]
    assert [b["key"] for b in proposal["blockers"]] == [{"file": 0, "line": 3}]
    assert proposal["cards"][0] | {"key": None} == {
        "key": None,
        "date": "2026-01-01",
        "chain_id": 1,
        "price_paid": 3500,
        "face_value": 3500,
        "confirmed": False,
    }
    phm = next(v for v in proposal["visits"] if v["title"] == "Project Hail Mary")
    assert (phm["my_cost"], phm["guest_cost"], phm["payment_source"]) == (650, 1950, "gift_card")
    assert proposal["periods"] == [
        {
            "chain_id": 1,
            "amount": 599,
            "billing_day": 22,
            "start_date": "2026-01-01",
            "end_date": None,
            "payment_source": "gift_card",
        }
    ]
    assert proposal["totals"] == [
        {
            "name": "2026.csv",
            "legacy_total": 599 + 3500 + 2600 - 717 + 599,
            "tickets": 5,
            "imported_total": 599 + 3500 + 2600 - 717 + 599,
            "imported_tickets": 5,
        }
    ]
    assert (
        sum(_count(db, m) for m in (models.Visit, models.GiftCardLoad, models.SubscriptionPlan))
        == 0
    )
    assert client.get("/api/v1/import").json() is None


def test_fixes_and_choices_flow_through(client: TestClient) -> None:
    _chain(client)
    fixes = [
        {"file": 0, "line": 7, "column": "Net Cost", "value": "0"},
        {"file": 0, "line": 7, "column": "Date", "value": "3/1/2026"},
    ]
    proposal = client.post(
        "/api/v1/import/preview", json=_body([READY_ROWS[1]], fixes=fixes)
    ).json()
    assert proposal["ready"] is True
    assert "Mystery row" in [v["title"] for v in proposal["visits"]]


def test_commit_writes_everything_once(client: TestClient, db: Session) -> None:
    _chain(client)
    response = client.post("/api/v1/import/commit", json=_body(READY_ROWS))
    assert response.status_code == 201, response.text
    result = response.json()
    assert result["cutoff"] == "2026-10-15"
    assert result["files"] == [
        {
            "name": "2026.csv",
            "legacy_total": 6581,
            "tickets": 5,
            "imported_total": 6581,
            "imported_tickets": 5,
        }
    ]
    assert client.get("/api/v1/import").json() == result

    assert (
        _count(db, models.Visit),
        _count(db, models.Credit),
        _count(db, models.GiftCardLoad),
    ) == (2, 1, 1)
    card = db.scalars(select(models.GiftCardLoad)).one()
    assert (card.price_paid, card.face_value) == (3500, 5000)
    refund = db.scalars(select(models.Credit)).one()
    assert (refund.amount, refund.note) == (717, "Refund: Mission Impossible")

    # Imported fees are edited charges at their real dates; the open period fills Mar–Sep.
    fees = {f["date"]: f for f in client.get("/api/v1/activity?kind=fee").json()}
    assert len(fees) == 9
    assert fees["2026-01-22"]["is_overridden"] is True
    assert fees["2026-03-22"]["is_overridden"] is False

    again = client.post("/api/v1/import/commit", json=_body(READY_ROWS))
    assert again.status_code == 409
    assert _count(db, models.Visit) == 2


def test_commit_is_refused_until_ready(client: TestClient, db: Session) -> None:
    _chain(client)
    unconfirmed = client.post("/api/v1/import/commit", json=_body([READY_ROWS[0]]))
    assert unconfirmed.status_code == 422
    assert "Confirm the value of the $35.00 Regal card" in unconfirmed.json()["detail"]
    unfixed = client.post("/api/v1/import/commit", json=_body([READY_ROWS[1]]))
    assert unfixed.status_code == 422
    assert "Line 7 of 2026.csv" in unfixed.json()["detail"]
    assert _count(db, models.Import) == 0


def test_a_period_overlapping_a_plan_already_in_the_app_blocks_commit(client: TestClient) -> None:
    _chain(client)
    plan = {
        "chain_id": 1,
        "amount": 1299,
        "billing_day": 22,
        "start_date": "2026-06-01",
        "end_date": None,
        "payment_source": "gift_card",
    }
    client.post("/api/v1/plans", json=plan)
    proposal = client.post("/api/v1/import/preview", json=_body(READY_ROWS)).json()
    assert any("already in the app" in b["message"] for b in proposal["blockers"])
    # Ending the imported period before the app's plan clears it.
    periods = [{**proposal["periods"][0], "end_date": "2026-05-31"}]
    assert (
        client.post("/api/v1/import/commit", json=_body(READY_ROWS, periods=periods)).status_code
        == 201
    )


def test_an_unknown_chain_in_the_rule_is_a_field_error(client: TestClient) -> None:
    body = _body(READY_ROWS)
    body["choices"]["chain_rule"] = [{"until": None, "chain_id": 9}]
    response = client.post("/api/v1/import/preview", json=body)
    assert response.status_code == 422
    assert "Unknown chain 9" in response.text


def test_files_are_required(client: TestClient) -> None:
    assert client.post("/api/v1/import/preview", json={**_body(), "files": []}).status_code == 422
