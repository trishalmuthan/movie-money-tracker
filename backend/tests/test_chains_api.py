import datetime as dt

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.db import models

REGAL = {"name": "Regal", "standard_ticket_price": 1500}


def test_create_and_list_chains(client: TestClient) -> None:
    created = client.post("/api/v1/chains", json=REGAL)
    assert created.status_code == 201
    assert created.json() == {"id": 1, "name": "Regal", "standard_ticket_price": 1500}
    assert client.get("/api/v1/chains").json() == [created.json()]


def test_chains_are_listed_by_name(client: TestClient) -> None:
    client.post("/api/v1/chains", json=REGAL)
    client.post("/api/v1/chains", json={**REGAL, "name": "Cinemark"})
    assert [c["name"] for c in client.get("/api/v1/chains").json()] == ["Cinemark", "Regal"]


def test_chain_name_is_trimmed_and_unique_ignoring_case(client: TestClient) -> None:
    created = client.post("/api/v1/chains", json={**REGAL, "name": "  Regal "})
    assert created.json()["name"] == "Regal"
    duplicate = client.post("/api/v1/chains", json={**REGAL, "name": "regal"})
    assert duplicate.status_code == 409
    assert "already exists" in duplicate.json()["detail"]


def test_blank_name_and_negative_price_are_rejected(client: TestClient) -> None:
    assert client.post("/api/v1/chains", json={**REGAL, "name": "   "}).status_code == 422
    negative = {**REGAL, "standard_ticket_price": -1}
    assert client.post("/api/v1/chains", json=negative).status_code == 422


def test_update_chain(client: TestClient) -> None:
    client.post("/api/v1/chains", json=REGAL)
    updated = client.put("/api/v1/chains/1", json={**REGAL, "standard_ticket_price": 1650})
    assert updated.status_code == 200
    assert updated.json() == {"id": 1, "name": "Regal", "standard_ticket_price": 1650}


def test_rename_to_an_existing_name_conflicts(client: TestClient) -> None:
    client.post("/api/v1/chains", json=REGAL)
    client.post("/api/v1/chains", json={**REGAL, "name": "Cinemark"})
    assert client.put("/api/v1/chains/2", json={**REGAL, "name": "REGAL"}).status_code == 409
    # A chain may be renamed to a different case of its own name.
    assert client.put("/api/v1/chains/1", json={**REGAL, "name": "REGAL"}).status_code == 200


def test_missing_chain_is_404(client: TestClient) -> None:
    assert client.put("/api/v1/chains/9", json=REGAL).status_code == 404
    assert client.delete("/api/v1/chains/9").status_code == 404


def test_delete_unused_chain(client: TestClient) -> None:
    client.post("/api/v1/chains", json=REGAL)
    assert client.delete("/api/v1/chains/1").status_code == 204
    assert client.get("/api/v1/chains").json() == []


def test_delete_chain_with_entries_conflicts(client: TestClient, db: Session) -> None:
    client.post("/api/v1/chains", json=REGAL)
    db.add(
        models.GiftCardLoad(chain_id=1, date=dt.date(2026, 1, 1), price_paid=3500, face_value=5000)
    )
    db.commit()
    response = client.delete("/api/v1/chains/1")
    assert response.status_code == 409
    assert "still has entries" in response.json()["detail"]
    assert len(client.get("/api/v1/chains").json()) == 1
