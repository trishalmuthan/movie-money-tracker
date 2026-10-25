"""Preview and commit the one-time sheet import (spec §5.8). The rules live in app.domain."""

import datetime as dt
from collections.abc import Sequence

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import models
from app.domain import types as domain
from app.domain.fees import month_key
from app.domain.import_proposal import (
    Choices,
    Existing,
    ExistingPlan,
    Proposal,
    SheetFile,
    build_proposal,
)
from app.services.fees import ensure_fee_charges


class AlreadyImported(Exception):
    pass


class NotReady(Exception):
    def __init__(self, problems: Sequence[str]) -> None:
        super().__init__(problems[0])
        self.problems = problems


def preview(session: Session, files: Sequence[SheetFile], choices: Choices) -> Proposal:
    return build_proposal(files, choices, _existing(session))


def commit(
    session: Session,
    files: Sequence[SheetFile],
    choices: Choices,
    today: dt.date,
    now: dt.datetime,
) -> models.Import:
    """Write the whole proposal in one transaction, then fill the months the sheet never logged."""
    if session.scalar(select(models.Import.id)) is not None:
        raise AlreadyImported
    proposal = preview(session, files, choices)
    if not proposal.ready:
        raise NotReady(problems(proposal, files))

    plans = [
        models.SubscriptionPlan(
            chain_id=p.chain_id,
            amount=p.amount,
            billing_day=p.billing_day,
            start_date=p.start_date,
            end_date=p.end_date,
            payment_source=p.payment_source,
        )
        for p in proposal.periods
    ]
    session.add_all(plans)
    session.flush()
    session.add_all(
        models.FeeCharge(
            plan_id=plans[_known(fee.period_index)].id,
            month=month_key(fee.date),
            date=fee.date,
            amount=fee.amount,
            payment_source=fee.payment_source,
            is_overridden=True,  # the sheet's real amount and date; the plan never rewrites it
        )
        for fee in proposal.fees
    )
    session.add_all(
        models.GiftCardLoad(
            chain_id=_known(card.chain_id),
            date=card.date,
            price_paid=card.price_paid,
            face_value=card.face_value,
        )
        for card in proposal.cards
    )
    session.add_all(
        models.Visit(
            date=visit.date,
            chain_id=_known(visit.chain_id),
            title=visit.title[:200],
            my_cost=visit.my_cost,
            guest_count=visit.guest_count,
            guest_cost=visit.guest_cost,
            payment_source=visit.payment_source,
        )
        for visit in proposal.visits
    )
    titles = {visit.key: visit.title for visit in proposal.visits}
    session.add_all(
        models.Credit(
            date=credit.date,
            chain_id=credit.chain_id,
            amount=credit.amount,
            destination=credit.destination,
            note=f"Refund: {titles[credit.key]}"[:200],
        )
        for credit in proposal.credits
    )
    record = models.Import(committed_at=now, cutoff=choices.cutoff)
    session.add(record)
    session.flush()
    session.add_all(
        models.ImportFile(
            import_id=record.id,
            name=t.name,
            legacy_total=t.legacy_total,
            ticket_total=t.tickets,
            imported_total=t.imported_total,
            imported_tickets=t.imported_tickets,
        )
        for t in proposal.totals
    )
    ensure_fee_charges(session, today)
    session.commit()
    return record


def problems(proposal: Proposal, files: Sequence[SheetFile]) -> list[str]:
    """Everything still in the way, as sentences: row errors first, then blockers."""
    found = [
        f"Line {error.line} of {files[index].name}: {error.message}"
        for index, error in proposal.errors
    ]
    return found + [blocker.message for blocker in proposal.blockers]


def _existing(session: Session) -> Existing:
    return Existing(
        chains=tuple(
            domain.Chain(c.id, c.name, c.standard_ticket_price)
            for c in session.scalars(select(models.Chain))
        ),
        plans=tuple(
            ExistingPlan(p.chain_id, p.start_date, p.end_date)
            for p in session.scalars(select(models.SubscriptionPlan))
        ),
    )


def _known[T](value: T | None) -> T:
    """A value a ready proposal always has (no chain or period left unresolved)."""
    if value is None:
        raise ValueError("A ready proposal has no unresolved chains or periods")
    return value
