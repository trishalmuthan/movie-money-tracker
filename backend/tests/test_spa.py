from pathlib import Path

from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app


def _settings(tmp_path: Path, dist: Path | None) -> Settings:
    return Settings(
        database_url=f"sqlite:///{(tmp_path / 'test.db').as_posix()}", frontend_dist=dist
    )


def test_serves_index_for_root_and_deep_links(tmp_path: Path) -> None:
    dist = tmp_path / "dist"
    (dist / "assets").mkdir(parents=True)
    (dist / "index.html").write_text("<html>spa</html>")
    (dist / "assets" / "app.js").write_text("console.log(1)")

    with TestClient(create_app(_settings(tmp_path, dist))) as client:
        assert "spa" in client.get("/").text
        assert "spa" in client.get("/films/42").text
        assert client.get("/assets/app.js").text == "console.log(1)"
        assert client.get("/api/v1/health").json() == {"status": "ok"}
        assert client.get("/api/v1/does-not-exist").status_code == 404


def test_without_a_build_only_the_api_is_served(tmp_path: Path) -> None:
    with TestClient(create_app(_settings(tmp_path, None))) as client:
        assert client.get("/").status_code == 404
        assert client.get("/api/v1/health").status_code == 200
