from fastapi import FastAPI
from sqlalchemy.orm import sessionmaker
from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.responses import Response
from starlette.staticfiles import StaticFiles
from starlette.types import Scope

from app.api.v1 import api_router
from app.config import Settings, get_settings
from app.db.session import make_engine


class SPAStaticFiles(StaticFiles):
    """Serve the built frontend; unknown non-API paths fall back to index.html."""

    async def get_response(self, path: str, scope: Scope) -> Response:
        try:
            return await super().get_response(path, scope)
        except StarletteHTTPException as exc:
            if exc.status_code == 404 and not path.startswith("api"):
                return await super().get_response("index.html", scope)
            raise


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()
    app = FastAPI(title="Movie Money Tracker")

    engine = make_engine(settings.database_url)
    app.state.engine = engine
    app.state.session_factory = sessionmaker(engine, expire_on_commit=False)

    app.include_router(api_router, prefix="/api/v1")

    dist = settings.frontend_dist
    if dist is not None and (dist / "index.html").is_file():
        app.mount("/", SPAStaticFiles(directory=dist, html=True), name="frontend")
    return app
