from pathlib import Path
from typing import Any

from sqlalchemy import Engine, create_engine, event
from sqlalchemy.engine import make_url


def make_engine(database_url: str) -> Engine:
    """Create the engine; for SQLite, make the file's folder and enforce foreign keys."""
    url = make_url(database_url)
    is_sqlite = url.get_backend_name() == "sqlite"
    if is_sqlite and url.database not in (None, "", ":memory:"):
        Path(url.database).parent.mkdir(parents=True, exist_ok=True)

    engine = create_engine(database_url)
    if is_sqlite:

        @event.listens_for(engine, "connect")
        def _enable_foreign_keys(dbapi_connection: Any, _record: Any) -> None:
            cursor = dbapi_connection.cursor()
            cursor.execute("PRAGMA foreign_keys=ON")
            cursor.close()

    return engine
