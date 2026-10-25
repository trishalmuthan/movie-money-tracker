import datetime as dt
from collections.abc import Iterator
from typing import Annotated

from fastapi import Depends, HTTPException, Request
from sqlalchemy.orm import Session, sessionmaker

from app.db import models


def get_session(request: Request) -> Iterator[Session]:
    factory: sessionmaker[Session] = request.app.state.session_factory
    with factory() as session:
        yield session


def get_today() -> dt.date:
    return dt.date.today()


SessionDep = Annotated[Session, Depends(get_session)]
TodayDep = Annotated[dt.date, Depends(get_today)]


def get_or_404[M](session: Session, model: type[M], id_: int) -> M:
    instance = session.get(model, id_)
    if instance is None:
        raise HTTPException(status_code=404, detail=f"{model.__name__} {id_} not found")
    return instance


def field_error(field: str, msg: str, value: object) -> HTTPException:
    """A 422 shaped like FastAPI's own validation errors, so clients handle both alike."""
    return HTTPException(
        status_code=422,
        detail=[{"type": "value_error", "loc": ["body", field], "msg": msg, "input": value}],
    )


def require_chain(session: Session, chain_id: int) -> None:
    if session.get(models.Chain, chain_id) is None:
        raise field_error("chain_id", f"Unknown chain {chain_id}", chain_id)


def reject_future(day: dt.date, today: dt.date, field: str = "date") -> None:
    if day > today:
        raise field_error(field, "Date cannot be in the future", day.isoformat())
