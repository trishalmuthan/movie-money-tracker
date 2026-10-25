from fastapi.testclient import TestClient

CREDIT = {
    "date": "2025-05-27",
    "chain_id": 1,
    "amount": 717,
    "destination": "bank",
    "note": "Refund",
}


def _chain(client: TestClient) -> None:
    client.post("/api/v1/chains", json={"name": "Cinemark", "standard_ticket_price": 1400})


def test_create_and_list_credits(client: TestClient) -> None:
    _chain(client)
    created = client.post("/api/v1/credits", json=CREDIT)
    assert created.status_code == 201
    assert created.json() == {**CREDIT, "id": 1}
    assert client.get("/api/v1/credits").json() == [created.json()]


def test_credits_are_newest_first(client: TestClient) -> None:
    _chain(client)
    client.post("/api/v1/credits", json=CREDIT)
    client.post("/api/v1/credits", json={**CREDIT, "date": "2025-08-01"})
    assert [c["date"] for c in client.get("/api/v1/credits").json()] == ["2025-08-01", "2025-05-27"]


def test_bank_credit_may_have_no_chain(client: TestClient) -> None:
    created = client.post("/api/v1/credits", json={**CREDIT, "chain_id": None})
    assert created.status_code == 201
    assert created.json()["chain_id"] is None


def test_gift_card_credit_needs_a_chain(client: TestClient) -> None:
    body = {**CREDIT, "chain_id": None, "destination": "gift_card"}
    assert client.post("/api/v1/credits", json=body).status_code == 422


def test_unknown_chain_rejected(client: TestClient) -> None:
    response = client.post("/api/v1/credits", json={**CREDIT, "chain_id": 9})
    assert response.status_code == 422
    assert response.json()["detail"][0]["loc"] == ["body", "chain_id"]


def test_amount_must_be_positive(client: TestClient) -> None:
    _chain(client)
    assert client.post("/api/v1/credits", json={**CREDIT, "amount": -717}).status_code == 422
    assert client.post("/api/v1/credits", json={**CREDIT, "amount": 0}).status_code == 422


def test_future_date_rejected(client: TestClient) -> None:
    _chain(client)
    assert client.post("/api/v1/credits", json={**CREDIT, "date": "2026-10-16"}).status_code == 422


def test_update_and_delete(client: TestClient) -> None:
    _chain(client)
    client.post("/api/v1/credits", json=CREDIT)
    assert client.put("/api/v1/credits/1", json={**CREDIT, "amount": 700}).json()["amount"] == 700
    assert client.delete("/api/v1/credits/1").status_code == 204
    assert client.get("/api/v1/credits").json() == []
    assert client.delete("/api/v1/credits/1").status_code == 404
