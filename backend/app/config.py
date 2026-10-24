from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

REPO_ROOT = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=REPO_ROOT / ".env", extra="ignore")

    database_url: str = f"sqlite:///{(REPO_ROOT / 'data' / 'app.db').as_posix()}"
    frontend_dist: Path | None = REPO_ROOT / "frontend" / "dist"
    tmdb_api_key: str | None = None


@lru_cache
def get_settings() -> Settings:
    return Settings()
