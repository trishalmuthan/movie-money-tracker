import datetime as dt

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.deps import get_today

VISIT = {
    "date": "2026-02-15",
    "chain_id": 1,
    "title": "Project Hail Mary",
    "my_cost": 650,
    "guest_count": 3,
    "guest_cost": 1950,
    "payment_source": "gift_card",
}


def _chain(client: TestClient) -> None:
    client.post("/api/v1/chains", json={"name": "Regal", "standard_ticket_price": 1500})


def test_create_and_list_visits(client: TestClient) -> None:
    _chain(client)
    created = client.post("/api/v1/visits", json=VISIT)
    assert created.status_code == 201
    assert created.json() == {**VISIT, "id": 1, "note": None}
    assert client.get("/api/v1/visits").json() == [created.json()]


def test_free_visit_needs_only_the_basics(client: TestClient) -> None:
    _chain(client)
    body = {
        "date": "2026-02-01",
        "chain_id": 1,
        "title": "No Other Choice",
        "payment_source": "free",
    }
    created = client.post("/api/v1/visits", json=body).json()
    assert (created["my_cost"], created["guest_count"], created["guest_cost"]) == (0, 0, 0)


def test_visits_are_newest_first_and_filterable_by_chain(client: TestClient) -> None:
    _chain(client)
    client.post("/api/v1/chains", json={"name": "Cinemark", "standard_ticket_price": 1400})
    client.post("/api/v1/visits", json=VISIT)
    client.post("/api/v1/visits", json={**VISIT, "date": "2026-03-01", "chain_id": 2})
    assert [v["date"] for v in client.get("/api/v1/visits").json()] == ["2026-03-01", "2026-02-15"]
    assert [v["chain_id"] for v in client.get("/api/v1/visits?chain_id=2").json()] == [2]


def test_payment_source_must_match_costs(client: TestClient) -> None:
    _chain(client)
    paid_but_free = {**VISIT, "payment_source": "free"}
    free_but_paid = {**VISIT, "my_cost": 0, "guest_count": 0, "guest_cost": 0}
    assert client.post("/api/v1/visits", json=paid_but_free).status_code == 422
    assert client.post("/api/v1/visits", json=free_but_paid).status_code == 422


def test_guest_cost_needs_guests(client: TestClient) -> None:
    _chain(client)
    assert client.post("/api/v1/visits", json={**VISIT, "guest_count": 0}).status_code == 422


def test_negative_costs_and_blank_title_are_rejected(client: TestClient) -> None:
    _chain(client)
    assert client.post("/api/v1/visits", json={**VISIT, "my_cost": -50}).status_code == 422
    assert client.post("/api/v1/visits", json={**VISIT, "title": "  "}).status_code == 422


def test_visit_dated_today_ok_tomorrow_rejected(app: FastAPI, client: TestClient) -> None:
    app.dependency_overrides[get_today] = lambda: dt.date(2026, 10, 15)
    _chain(client)
    assert client.post("/api/v1/visits", json={**VISIT, "date": "2026-10-15"}).status_code == 201
    tomorrow = client.post("/api/v1/visits", json={**VISIT, "date": "2026-10-16"})
    assert tomorrow.status_code == 422
    assert tomorrow.json()["detail"][0]["loc"] == ["body", "date"]


def test_unknown_chain_rejected(client: TestClient) -> None:
    response = client.post("/api/v1/visits", json=VISIT)
    assert response.status_code == 422
    assert response.json()["detail"][0]["loc"] == ["body", "chain_id"]


def test_update_and_delete(client: TestClient) -> None:
    _chain(client)
    client.post("/api/v1/visits", json=VISIT)
    updated = client.put("/api/v1/visits/1", json={**VISIT, "title": "Project Hail Mary (IMAX)"})
    assert updated.json()["title"] == "Project Hail Mary (IMAX)"
    assert client.delete("/api/v1/visits/1").status_code == 204
    assert client.put("/api/v1/visits/1", json=VISIT).status_code == 404
    assert client.delete("/api/v1/visits/1").status_code == 404
