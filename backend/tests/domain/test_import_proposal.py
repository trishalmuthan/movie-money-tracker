"""Turning parsed sheet files plus review choices into what the import writes (M5 Task 2)."""

import datetime as dt

from app.domain.import_proposal import (
    ChainSpan,
    Choices,
    Existing,
    ExistingPlan,
    PlanPeriod,
    Proposal,
    RowChoice,
    SheetFile,
    build_proposal,
)
from app.domain.types import Chain, CreditDestination, PaymentSource

D = dt.date
GIFT, BANK, FREE = PaymentSource.GIFT_CARD, PaymentSource.BANK, PaymentSource.FREE
CINEMARK, REGAL = 1, 2
CHAINS = Existing(chains=(Chain(CINEMARK, "Cinemark", 1400), Chain(REGAL, "Regal", 1500)))
# The plan's default chain rule: up to 2025-10-31 Cinemark, otherwise Regal.
TODAY = D(2026, 10, 25)
RULE = (ChainSpan(D(2025, 10, 31), CINEMARK), ChainSpan(None, REGAL))

# The plan's made-up reference files (Task 1's 2025.csv plus a 2026.csv).
FILE_2025 = SheetFile(
    "2025.csv",
    """Item,Net Cost,Number of Tickets,Date
May 2025 Movie Club Fee,11.99,,5/22/2025
Mission Impossible,-7.17,1,5/27/2025
The Life of Chuck,5.00,1,6/2/2025
Superman,0.00,4,7/15/2025
Cinemark Gift Card,40.00,,7/6/2025
Bugonia,1.75,2,11/4/2025
Mystery row,abc,1,13/40/2025
""",
)
FILE_2026 = SheetFile(
    "2026.csv",
    """Item,Net Cost,Number of Tickets,Date
Regal Gift Card Purchase,35.00,,11/27/2025
Project Hail Mary,26.00,4,2/15/2026
""",
)

# Fee history: $11.99 May–Sep 2025 at Cinemark, then $5.99 at Regal (one fee on the 23rd).
FEES = SheetFile(
    "fees.csv",
    "Item,Net Cost,Number of Tickets,Date\n"
    + "".join(
        f"{m} Movie Club Fee,11.99,,{n}/22/2025\n"
        for n, m in enumerate(["May", "Jun", "Jul", "Aug", "Sep"], 5)
    )
    + "Nov Movie Club Fee,5.99,,11/22/2025\nDec Movie Club Fee,5.99,,12/23/2025\n",
)


def _propose(
    *files: SheetFile, cutoff: dt.date = TODAY, existing: Existing = CHAINS, **choices
) -> Proposal:
    rows = choices.pop("rows", {})
    return build_proposal(
        list(files) or [FILE_2025, FILE_2026],
        Choices(cutoff=cutoff, chain_rule=RULE, rows=rows, **choices),
        existing,
    )


def _visit(p: Proposal, title: str):
    return next(v for v in p.visits if v.title == title)


# --- defaults --------------------------------------------------------------------------------


def test_spending_before_any_card_defaults_to_bank() -> None:
    p = _propose()
    may_fee = next(f for f in p.fees if f.date == D(2025, 5, 22))
    assert (may_fee.chain_id, may_fee.amount, may_fee.payment_source) == (CINEMARK, 1199, BANK)
    assert _visit(p, "The Life of Chuck").payment_source is BANK


def test_spending_after_a_card_for_that_chain_defaults_to_gift_card() -> None:
    p = _propose()
    phm = _visit(p, "Project Hail Mary")
    assert (phm.chain_id, phm.my_cost, phm.guest_count, phm.guest_cost) == (REGAL, 650, 3, 1950)
    assert phm.payment_source is GIFT
    # Bugonia (Nov 4) is a Regal visit before the Regal card (Nov 27).
    assert _visit(p, "Bugonia").payment_source is BANK
    assert _visit(p, "Superman").payment_source is FREE


def test_a_negative_row_is_a_free_visit_plus_a_bank_refund() -> None:
    p = _propose()
    mission = _visit(p, "Mission Impossible")
    assert (mission.my_cost, mission.payment_source) == (0, FREE)
    [refund] = p.credits
    assert (refund.key, refund.date, refund.chain_id, refund.amount, refund.destination) == (
        (0, 3),
        D(2025, 5, 27),
        CINEMARK,
        717,
        CreditDestination.BANK,
    )


def test_cards_take_their_chain_from_the_item_text() -> None:
    p = _propose()
    assert [(c.chain_id, c.price_paid, c.face_value, c.confirmed) for c in p.cards] == [
        (CINEMARK, 4000, 4000, False),
        (REGAL, 3500, 3500, False),
    ]


# --- cutoff and totals (review focus 1, 2) ----------------------------------------------------


def test_rows_on_or_after_the_cutoff_are_listed_not_imported() -> None:
    p = _propose(cutoff=D(2025, 11, 1), rows={(0, 8): RowChoice(skip=True)})
    assert {(o.key, o.reason) for o in p.left_out} == {
        ((0, 7), "after_cutoff"),  # Bugonia
        ((1, 2), "after_cutoff"),  # Regal card
        ((1, 3), "after_cutoff"),  # Project Hail Mary
        ((0, 8), "skipped"),  # the mystery row
    }
    assert "Bugonia" not in [v.title for v in p.visits]
    assert [c.chain_id for c in p.cards] == [CINEMARK]
    t2025, t2026 = p.totals
    # The legacy total is the whole file, cutoff or not, so it still matches the sheet.
    assert (t2025.legacy_total, t2025.tickets) == (1199 - 717 + 500 + 0 + 4000 + 175, 8)
    assert (t2025.imported_total, t2025.imported_tickets) == (1199 - 717 + 500 + 0 + 4000, 6)
    assert (t2026.legacy_total, t2026.imported_total, t2026.imported_tickets) == (6100, 0, 0)


# --- row errors (review focus 4) --------------------------------------------------------------


def test_an_unresolved_row_error_blocks_commit() -> None:
    p = _propose()
    assert [(f, e.line, e.column) for f, e in p.errors] == [(0, 8, "Net Cost"), (0, 8, "Date")]
    assert not p.ready


def test_fixing_a_row_imports_it() -> None:
    p = _propose(fixes={(0, 8, "Net Cost"): "0", (0, 8, "Date"): "8/1/2025"})
    assert p.errors == ()
    assert _visit(p, "Mystery row").date == D(2025, 8, 1)


def test_skipping_a_row_clears_its_error() -> None:
    p = _propose(rows={(0, 8): RowChoice(skip=True)})
    assert p.errors == ()


# --- cards ------------------------------------------------------------------------------------


def _ready_choices() -> dict[tuple[int, int], RowChoice]:
    return {
        (0, 8): RowChoice(skip=True),
        (0, 6): RowChoice(face_value=5000),
        (1, 2): RowChoice(face_value=5000),
    }


def test_card_values_must_be_confirmed() -> None:
    p = _propose(rows={(0, 8): RowChoice(skip=True)})
    assert [b.key for b in p.blockers] == [(0, 6), (1, 2)]
    assert "Confirm the value of the $40.00 Cinemark card from Jul 6, 2025" in p.blockers[0].message
    ready = _propose(rows=_ready_choices())
    assert ready.blockers == () and ready.errors == () and ready.ready
    assert [(c.face_value, c.confirmed) for c in ready.cards] == [(5000, True), (5000, True)]


def test_a_card_worth_less_than_its_price_is_blocked() -> None:
    p = _propose(rows={**_ready_choices(), (0, 6): RowChoice(face_value=3000)})
    assert [b.key for b in p.blockers] == [(0, 6)]


def test_a_card_naming_an_unknown_chain_is_blocked_until_one_is_picked() -> None:
    file = SheetFile(
        "x.csv", "Item,Net Cost,Number of Tickets,Date\nAMC Gift Card,25.00,,7/1/2025\n"
    )
    p = _propose(file, rows={(0, 2): RowChoice(face_value=2500)})
    assert p.cards[0].chain_id is None
    assert "No chain named 'AMC'" in p.blockers[0].message
    picked = _propose(file, rows={(0, 2): RowChoice(face_value=2500, chain_id=REGAL)})
    assert picked.ready


# --- choices ----------------------------------------------------------------------------------


def test_moving_the_chain_boundary_moves_rows() -> None:
    early = (ChainSpan(D(2025, 5, 31), CINEMARK), ChainSpan(None, REGAL))
    p = build_proposal(
        [FILE_2025, FILE_2026], Choices(cutoff=D(2026, 10, 25), chain_rule=early), CHAINS
    )
    assert _visit(p, "The Life of Chuck").chain_id == REGAL


def test_row_choices_override_chain_split_and_payment() -> None:
    p = _propose(
        rows={
            (1, 3): RowChoice(my_cost=2600, guest_cost=0, payment_source=BANK),
            (0, 3): RowChoice(refund_destination=CreditDestination.GIFT_CARD),
            (0, 4): RowChoice(chain_id=REGAL),
        }
    )
    phm = _visit(p, "Project Hail Mary")
    assert (phm.my_cost, phm.guest_cost, phm.payment_source) == (2600, 0, BANK)
    assert p.credits[0].destination is CreditDestination.GIFT_CARD
    assert _visit(p, "The Life of Chuck").chain_id == REGAL


def test_a_split_must_add_up_to_the_row() -> None:
    p = _propose(rows={**_ready_choices(), (1, 3): RowChoice(my_cost=600, guest_cost=1950)})
    assert [(b.key, b.message) for b in p.blockers] == [((1, 3), "The split must add up to $26.00")]


def test_paid_rows_cannot_be_free_and_free_rows_cannot_be_paid() -> None:
    p = _propose(
        rows={
            **_ready_choices(),
            (1, 3): RowChoice(payment_source=FREE),
            (0, 5): RowChoice(payment_source=BANK),
        }
    )
    assert [b.key for b in p.blockers] == [(0, 5), (1, 3)]


# --- plan periods (review focus 3) ------------------------------------------------------------


def test_fee_history_becomes_plan_periods() -> None:
    p = _propose(FEES)
    assert p.periods == (
        PlanPeriod(CINEMARK, 1199, 22, D(2025, 5, 1), D(2025, 9, 30), BANK),
        PlanPeriod(REGAL, 599, 22, D(2025, 11, 1), None, BANK),
    )
    # Imported fees keep their own dates and belong to the period covering them.
    dec = next(f for f in p.fees if f.date.month == 12)
    assert (dec.date, dec.period_index) == (D(2025, 12, 23), 1)
    assert {f.period_index for f in p.fees if f.chain_id == CINEMARK} == {0}
    assert p.ready


def test_billing_day_is_the_most_common_day() -> None:
    p = _propose(
        SheetFile(
            "f.csv",
            "Item,Net Cost,Number of Tickets,Date\nA Movie Club Fee,5.99,,1/3/2026\nB Movie Club Fee,5.99,,2/5/2026\nC Movie Club Fee,5.99,,3/5/2026\n",
        )
    )
    assert p.periods[0].billing_day == 5


def test_a_period_paid_from_a_card_uses_the_latest_fees_payment() -> None:
    p = _propose(FILE_2026, FEES)
    # The Regal card (Nov 27, 2025) predates the Dec fee, so the open period bills the card.
    assert p.periods[-1].payment_source is GIFT


def test_edited_periods_replace_the_proposal_and_must_cover_every_fee() -> None:
    one = (PlanPeriod(CINEMARK, 1199, 22, D(2025, 5, 1), D(2025, 9, 30), BANK),)
    p = _propose(FEES, periods=one)
    assert p.periods == one
    assert [b.message for b in p.blockers] == [
        "No subscription period covers the Regal fee in November 2025",
        "No subscription period covers the Regal fee in December 2025",
    ]


def test_edited_periods_cannot_overlap_each_other() -> None:
    clash = (
        PlanPeriod(CINEMARK, 1199, 22, D(2025, 5, 1), None, BANK),
        PlanPeriod(CINEMARK, 599, 22, D(2025, 9, 1), None, BANK),
    )
    p = _propose(FEES, periods=clash, cutoff=D(2025, 9, 1))
    assert any("overlap" in b.message for b in p.blockers)


def test_a_period_overlapping_a_plan_already_in_the_app_is_blocked() -> None:
    existing = Existing(chains=CHAINS.chains, plans=(ExistingPlan(REGAL, D(2025, 12, 1), None),))
    p = _propose(FEES, existing=existing)
    assert [b.message for b in p.blockers] == [
        "The Regal period from Nov 1, 2025 overlaps a Regal subscription already in the app (from Dec 1, 2025)"
    ]


def test_two_fees_in_one_month_are_blocked() -> None:
    twice = SheetFile(
        "f.csv",
        "Item,Net Cost,Number of Tickets,Date\nA Movie Club Fee,5.99,,1/3/2026\nB Movie Club Fee,5.99,,1/22/2026\n",
    )
    p = _propose(twice)
    assert [b.message for b in p.blockers] == ["Two Regal fees in January 2026: skip one"]


def test_no_files_gives_an_empty_proposal() -> None:
    p = build_proposal([], Choices(cutoff=D(2026, 10, 25), chain_rule=RULE), CHAINS)
    assert (p.visits, p.fees, p.periods, p.totals) == ((), (), (), ())
    assert p.ready
