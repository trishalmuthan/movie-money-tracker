import datetime as dt
from collections.abc import Iterator
from typing import Annotated

from fastapi import Depends, Request
from sqlalchemy.orm import Session, sessionmaker


def get_session(request: Request) -> Iterator[Session]:
    factory: sessionmaker[Session] = request.app.state.session_factory
    with factory() as session:
        yield session


def get_today() -> dt.date:
    return dt.date.today()


SessionDep = Annotated[Session, Depends(get_session)]
TodayDep = Annotated[dt.date, Depends(get_today)]
