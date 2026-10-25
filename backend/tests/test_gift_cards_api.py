from fastapi.testclient import TestClient

CARD = {"chain_id": 1, "date": "2026-01-01", "price_paid": 3500, "face_value": 5000}


def _chain(client: TestClient, name: str = "Regal") -> None:
    client.post("/api/v1/chains", json={"name": name, "standard_ticket_price": 1500})


def test_create_and_list_gift_cards(client: TestClient) -> None:
    _chain(client)
    created = client.post("/api/v1/gift-cards", json={**CARD, "note": "Costco"})
    assert created.status_code == 201
    assert created.json() == {**CARD, "id": 1, "note": "Costco"}
    later = client.post("/api/v1/gift-cards", json={**CARD, "date": "2026-04-26"}).json()
    assert [c["id"] for c in client.get("/api/v1/gift-cards").json()] == [later["id"], 1]


def test_note_is_optional(client: TestClient) -> None:
    _chain(client)
    assert client.post("/api/v1/gift-cards", json=CARD).json()["note"] is None


def test_filter_by_chain(client: TestClient) -> None:
    _chain(client)
    _chain(client, "Cinemark")
    client.post("/api/v1/gift-cards", json=CARD)
    client.post("/api/v1/gift-cards", json={**CARD, "chain_id": 2})
    assert [c["chain_id"] for c in client.get("/api/v1/gift-cards?chain_id=2").json()] == [2]


def test_face_value_must_cover_price(client: TestClient) -> None:
    _chain(client)
    response = client.post("/api/v1/gift-cards", json={**CARD, "face_value": 3000})
    assert response.status_code == 422
    assert "face_value" in response.text


def test_face_value_equal_to_price_is_allowed(client: TestClient) -> None:
    _chain(client)
    no_discount = {**CARD, "face_value": 3500}
    assert client.post("/api/v1/gift-cards", json=no_discount).status_code == 201


def test_price_must_be_positive(client: TestClient) -> None:
    _chain(client)
    assert client.post("/api/v1/gift-cards", json={**CARD, "price_paid": 0}).status_code == 422


def test_unknown_chain_is_a_field_error(client: TestClient) -> None:
    response = client.post("/api/v1/gift-cards", json=CARD)
    assert response.status_code == 422
    assert response.json()["detail"][0]["loc"] == ["body", "chain_id"]


def test_future_date_is_rejected(client: TestClient) -> None:
    _chain(client)
    # Today is pinned to 2026-10-15 in conftest.
    assert client.post("/api/v1/gift-cards", json={**CARD, "date": "2026-10-15"}).status_code == 201
    response = client.post("/api/v1/gift-cards", json={**CARD, "date": "2026-10-16"})
    assert response.status_code == 422
    assert response.json()["detail"][0]["loc"] == ["body", "date"]


def test_update_and_delete(client: TestClient) -> None:
    _chain(client)
    client.post("/api/v1/gift-cards", json=CARD)
    updated = client.put("/api/v1/gift-cards/1", json={**CARD, "face_value": 5500})
    assert updated.status_code == 200
    assert updated.json()["face_value"] == 5500
    assert client.delete("/api/v1/gift-cards/1").status_code == 204
    assert client.get("/api/v1/gift-cards").json() == []


def test_missing_gift_card_is_404(client: TestClient) -> None:
    _chain(client)
    assert client.put("/api/v1/gift-cards/9", json=CARD).status_code == 404
    assert client.delete("/api/v1/gift-cards/9").status_code == 404


def test_get_one_gift_card(client: TestClient) -> None:
    _chain(client)
    created = client.post("/api/v1/gift-cards", json=CARD).json()
    assert client.get("/api/v1/gift-cards/1").json() == created
    assert client.get("/api/v1/gift-cards/9").status_code == 404
