from fastapi.testclient import TestClient


def _post(client: TestClient, path: str, body: dict[str, object]) -> None:
    response = client.post(f"/api/v1/{path}", json=body)
    assert response.status_code == 201, response.text


def _seed(client: TestClient) -> None:
    _post(client, "chains", {"name": "Regal", "standard_ticket_price": 1500})
    _post(
        client,
        "gift-cards",
        {"chain_id": 1, "date": "2026-01-01", "price_paid": 3500, "face_value": 5000},
    )
    _post(
        client,
        "visits",
        {
            "date": "2026-02-15",
            "chain_id": 1,
            "title": "Project Hail Mary",
            "my_cost": 650,
            "guest_count": 3,
            "guest_cost": 1950,
            "payment_source": "gift_card",
        },
    )
    _post(
        client,
        "visits",
        {
            "date": "2026-02-16",
            "chain_id": 1,
            "title": "How to Make a Killing",
            "my_cost": 500,
            "payment_source": "bank",
        },
    )
    _post(
        client,
        "credits",
        {
            "date": "2026-02-20",
            "chain_id": 1,
            "amount": 717,
            "destination": "bank",
            "note": "Refund",
        },
    )


def test_activity_lists_everything_newest_first_with_effective_costs(client: TestClient) -> None:
    _seed(client)
    assert client.get("/api/v1/activity").json() == [
        {
            "kind": "credit",
            "id": 1,
            "date": "2026-02-20",
            "chain_id": 1,
            "description": "Refund",
            "amount": -717,
            "payment_source": "bank",
            "effective_cost": None,
        },
        {
            "kind": "visit",
            "id": 2,
            "date": "2026-02-16",
            "chain_id": 1,
            "description": "How to Make a Killing",
            "amount": 500,
            "payment_source": "bank",
            "effective_cost": 500,
        },
        {
            "kind": "visit",
            "id": 1,
            "date": "2026-02-15",
            "chain_id": 1,
            "description": "Project Hail Mary (+3 guests)",
            "amount": 2600,
            "payment_source": "gift_card",
            "effective_cost": 1820,
        },
        {
            "kind": "gift_card",
            "id": 1,
            "date": "2026-01-01",
            "chain_id": 1,
            "description": "Regal gift card ($50.00 value)",
            "amount": 3500,
            "payment_source": None,
            "effective_cost": 3500,
        },
    ]


def test_one_guest_is_singular(client: TestClient) -> None:
    _post(client, "chains", {"name": "Regal", "standard_ticket_price": 1500})
    _post(
        client,
        "visits",
        {
            "date": "2026-04-07",
            "chain_id": 1,
            "title": "Dhurandar",
            "my_cost": 650,
            "guest_count": 1,
            "guest_cost": 650,
            "payment_source": "bank",
        },
    )
    assert client.get("/api/v1/activity").json()[0]["description"] == "Dhurandar (+1 guest)"


def test_activity_filters(client: TestClient) -> None:
    _seed(client)
    assert len(client.get("/api/v1/activity?month=2026-02").json()) == 3
    kinds = [e["kind"] for e in client.get("/api/v1/activity?kind=visit").json()]
    assert kinds == ["visit", "visit"]
    assert client.get("/api/v1/activity?chain_id=2").json() == []
    assert client.get("/api/v1/activity?month=2026-13").status_code == 422
    assert client.get("/api/v1/activity?kind=fee").status_code == 422


def test_wallets_show_balance_per_chain(client: TestClient) -> None:
    _seed(client)
    assert client.get("/api/v1/wallets").json() == [
        {"chain_id": 1, "chain_name": "Regal", "balance": 5000 - 2600, "uncovered": 0}
    ]


def test_spending_without_card_money_shows_as_uncovered(client: TestClient) -> None:
    _post(client, "chains", {"name": "Cinemark", "standard_ticket_price": 1400})
    _post(
        client,
        "visits",
        {
            "date": "2025-06-02",
            "chain_id": 1,
            "title": "The Life of Chuck",
            "my_cost": 500,
            "payment_source": "gift_card",
        },
    )
    assert client.get("/api/v1/wallets").json() == [
        {"chain_id": 1, "chain_name": "Cinemark", "balance": -500, "uncovered": 500}
    ]
    assert client.get("/api/v1/activity").json()[0]["effective_cost"] == 500


def test_empty_ledger(client: TestClient) -> None:
    assert client.get("/api/v1/activity").json() == []
    assert client.get("/api/v1/wallets").json() == []
