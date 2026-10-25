"""Write the API's OpenAPI schema to a file: `python -m app.export_openapi <path>`.

The frontend generates its TypeScript API types from this file (`npm run gen:api`).
"""

import json
import sys
from pathlib import Path

from app.config import Settings
from app.main import create_app


def export(path: Path) -> None:
    settings = Settings(
        database_url="sqlite:///:memory:", frontend_dist=None, migrate_on_startup=False
    )
    schema = create_app(settings).openapi()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(schema, indent=2) + "\n", encoding="utf-8", newline="\n")


if __name__ == "__main__":
    export(Path(sys.argv[1]))
