"""Money primitives. Every amount in the app is an integer number of cents."""

import re

type Cents = int

_DOLLARS = re.compile(r"^(-)?\$?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?$")


def parse_dollars(text: str) -> Cents:
    """Parse "$1,234.56", "0.5", "-7.17" and the like into cents; raise ValueError otherwise."""
    match = _DOLLARS.match(text.strip())
    if match is None:
        raise ValueError(f"Not a dollar amount: {text!r}")
    sign, whole, fraction = match.groups()
    cents = int(whole.replace(",", "")) * 100 + int((fraction or "0").ljust(2, "0"))
    return -cents if sign else cents


def format_cents(amount: Cents) -> str:
    sign = "-" if amount < 0 else ""
    dollars, cents = divmod(abs(amount), 100)
    return f"{sign}${dollars:,}.{cents:02d}"


def div_round_half_up(numerator: int, denominator: int) -> int:
    """numerator / denominator rounded to the nearest integer, halves rounding up."""
    if denominator <= 0:
        raise ValueError("denominator must be positive")
    if numerator < 0:
        raise ValueError("numerator must be non-negative")
    return (2 * numerator + denominator) // (2 * denominator)
