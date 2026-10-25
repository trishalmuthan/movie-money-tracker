"""Run Alembic migrations from code (used at app startup)."""

from pathlib import Path

from alembic import command
from alembic.config import Config

BACKEND_DIR = Path(__file__).resolve().parents[2]


def upgrade_to_head(database_url: str) -> None:
    """Bring the database at `database_url` up to the latest migration. Safe to repeat."""
    config = Config(str(BACKEND_DIR / "alembic.ini"))
    config.set_main_option("script_location", str(BACKEND_DIR / "migrations"))
    # Read by migrations/env.py: migrate this database, and leave the app's logging alone.
    config.attributes["database_url"] = database_url
    config.attributes["configure_logging"] = False
    command.upgrade(config, "head")
