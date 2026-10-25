from pathlib import Path

from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app


def _settings(db_file: Path) -> Settings:
    return Settings(
        database_url=f"sqlite:///{db_file.as_posix()}",
        frontend_dist=None,
        migrate_on_startup=True,
    )


def test_fresh_database_is_migrated_on_startup(tmp_path: Path) -> None:
    db_file = tmp_path / "nested" / "fresh.db"  # neither the folder nor the file exists yet
    app = create_app(_settings(db_file))
    with TestClient(app) as client:
        response = client.get("/api/v1/chains")
    app.state.engine.dispose()
    assert response.status_code == 200
    assert response.json() == []


def test_starting_twice_keeps_existing_data(tmp_path: Path) -> None:
    db_file = tmp_path / "app.db"
    first = create_app(_settings(db_file))
    with TestClient(first) as client:
        client.post("/api/v1/chains", json={"name": "Regal", "standard_ticket_price": 1500})
    first.state.engine.dispose()

    second = create_app(_settings(db_file))
    with TestClient(second) as client:
        names = [c["name"] for c in client.get("/api/v1/chains").json()]
    second.state.engine.dispose()
    assert names == ["Regal"]


def test_migration_uses_the_given_database_not_the_default(tmp_path: Path) -> None:
    db_file = tmp_path / "explicit.db"
    app = create_app(_settings(db_file))
    app.state.engine.dispose()
    assert db_file.is_file()
