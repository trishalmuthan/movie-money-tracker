import datetime as dt
from dataclasses import asdict
from typing import Annotated, Any, Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field, StringConstraints
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import SessionDep, TodayDep, field_error
from app.db import models
from app.domain import import_proposal as ip
from app.domain.types import CreditDestination, PaymentSource
from app.services import importer

router = APIRouter(prefix="/import", tags=["import"])

FileName = Annotated[str, StringConstraints(min_length=1, max_length=200)]
Column = Literal["Item", "Net Cost", "Number of Tickets", "Date"]  # app.domain.importing.COLUMNS


# --- request --------------------------------------------------------------------------------


class ImportSheetFile(BaseModel):
    name: FileName
    text: str = Field(max_length=2_000_000)


class ImportChainSpan(BaseModel):
    until: dt.date | None  # inclusive; null covers every later date
    chain_id: int


class ImportRowChoice(BaseModel):
    file: int
    line: int
    skip: bool = False
    chain_id: int | None = None
    face_value: int | None = Field(default=None, ge=0)  # giving a value confirms the card
    my_cost: int | None = Field(default=None, ge=0)
    guest_cost: int | None = Field(default=None, ge=0)
    payment_source: PaymentSource | None = None
    refund_destination: CreditDestination | None = None


class ImportFix(BaseModel):
    file: int
    line: int
    column: Column
    value: str


class ImportPeriod(BaseModel):
    chain_id: int
    amount: int
    billing_day: int
    start_date: dt.date
    end_date: dt.date | None
    payment_source: PaymentSource


class ImportChoices(BaseModel):
    cutoff: dt.date  # rows on or after it stay the app's
    chain_rule: list[ImportChainSpan]
    rows: list[ImportRowChoice] = []
    fixes: list[ImportFix] = []
    periods: list[ImportPeriod] | None = None  # null: use the proposed periods


class ImportIn(BaseModel):
    files: list[ImportSheetFile] = Field(min_length=1)
    choices: ImportChoices


# --- response -------------------------------------------------------------------------------


class ImportRowKey(BaseModel):
    file: int
    line: int


class ImportVisit(BaseModel):
    key: ImportRowKey
    date: dt.date
    chain_id: int | None
    title: str
    my_cost: int
    guest_count: int
    guest_cost: int
    payment_source: PaymentSource


class ImportCredit(BaseModel):
    key: ImportRowKey
    date: dt.date
    chain_id: int | None
    amount: int
    destination: CreditDestination


class ImportCard(BaseModel):
    key: ImportRowKey
    date: dt.date
    chain_id: int | None
    price_paid: int
    face_value: int
    confirmed: bool


class ImportFee(BaseModel):
    key: ImportRowKey
    date: dt.date
    chain_id: int | None
    amount: int
    payment_source: PaymentSource
    period_index: int | None  # into `periods`


class ImportLeftOut(BaseModel):
    key: ImportRowKey
    item: str
    date: dt.date | None
    reason: Literal["after_cutoff", "skipped"]


class ImportRowError(BaseModel):
    file: int
    line: int
    item: str
    column: str
    value: str
    message: str


class ImportBlocker(BaseModel):
    key: ImportRowKey | None
    message: str


class ImportFileTotals(BaseModel):
    name: str
    rows: int
    legacy_total: int  # every readable row, cutoff or not: compare with the sheet's own total
    tickets: int
    imported_total: int
    imported_tickets: int


class ImportProposal(BaseModel):
    visits: list[ImportVisit]
    credits: list[ImportCredit]
    cards: list[ImportCard]
    fees: list[ImportFee]
    periods: list[ImportPeriod]
    left_out: list[ImportLeftOut]
    errors: list[ImportRowError]
    blockers: list[ImportBlocker]
    totals: list[ImportFileTotals]
    ready: bool


class ImportOut(BaseModel):
    committed_at: dt.datetime
    cutoff: dt.date
    files: list[ImportFileTotals]


# --- routes ---------------------------------------------------------------------------------


@router.get("", response_model=ImportOut | None)
def get_import(session: SessionDep) -> ImportOut | None:
    """The committed import, or null if the sheet hasn't been imported yet."""
    record = session.scalars(select(models.Import)).first()
    return None if record is None else _import_out(session, record)


@router.post("/preview", response_model=ImportProposal)
def preview_import(body: ImportIn, session: SessionDep) -> ImportProposal:
    files, choices = _domain(session, body)
    return _proposal_out(importer.preview(session, files, choices))


@router.post("/commit", response_model=ImportOut, status_code=201)
def commit_import(body: ImportIn, session: SessionDep, today: TodayDep) -> ImportOut:
    files, choices = _domain(session, body)
    try:
        record = importer.commit(session, files, choices, today, dt.datetime.now())
    except importer.AlreadyImported:
        raise HTTPException(
            status_code=409, detail="Your sheet has already been imported."
        ) from None
    except importer.NotReady as not_ready:
        more = len(not_ready.problems) - 1
        detail = not_ready.problems[0] + (f" (and {more} more)" if more else "")
        raise HTTPException(status_code=422, detail=detail) from None
    return _import_out(session, record)


def _domain(session: Session, body: ImportIn) -> tuple[list[ip.SheetFile], ip.Choices]:
    c = body.choices
    chain_ids = {s.chain_id for s in c.chain_rule} | {p.chain_id for p in c.periods or []}
    chain_ids |= {r.chain_id for r in c.rows if r.chain_id is not None}
    known = set(session.scalars(select(models.Chain.id)))
    if unknown := sorted(chain_ids - known):
        raise field_error("choices", f"Unknown chain {unknown[0]}", unknown[0])
    files = [ip.SheetFile(f.name, f.text) for f in body.files]
    choices = ip.Choices(
        cutoff=c.cutoff,
        chain_rule=tuple(ip.ChainSpan(s.until, s.chain_id) for s in c.chain_rule),
        rows={
            (r.file, r.line): ip.RowChoice(**r.model_dump(exclude={"file", "line"})) for r in c.rows
        },
        fixes={(f.file, f.line, f.column): f.value for f in c.fixes},
        periods=None
        if c.periods is None
        else tuple(ip.PlanPeriod(**p.model_dump()) for p in c.periods),
    )
    return files, choices


def _keyed(entry: Any) -> dict[str, Any]:
    data = asdict(entry)
    key = data.get("key")
    data["key"] = None if key is None else {"file": key[0], "line": key[1]}
    return data


def _proposal_out(p: ip.Proposal) -> ImportProposal:
    return ImportProposal.model_validate(
        {
            "visits": [_keyed(v) for v in p.visits],
            "credits": [_keyed(c) for c in p.credits],
            "cards": [_keyed(c) for c in p.cards],
            "fees": [_keyed(f) for f in p.fees],
            "periods": [asdict(period) for period in p.periods],
            "left_out": [_keyed(o) for o in p.left_out],
            "errors": [{"file": f, **asdict(e)} for f, e in p.errors],
            "blockers": [_keyed(b) for b in p.blockers],
            "totals": [asdict(t) for t in p.totals],
            "ready": p.ready,
        }
    )


def _import_out(session: Session, record: models.Import) -> ImportOut:
    files = session.scalars(
        select(models.ImportFile)
        .where(models.ImportFile.import_id == record.id)
        .order_by(models.ImportFile.id)
    )
    return ImportOut(
        committed_at=record.committed_at,
        cutoff=record.cutoff,
        files=[
            ImportFileTotals(
                name=f.name,
                rows=f.rows,
                legacy_total=f.legacy_total,
                tickets=f.ticket_total,
                imported_total=f.imported_total,
                imported_tickets=f.imported_tickets,
            )
            for f in files
        ],
    )
