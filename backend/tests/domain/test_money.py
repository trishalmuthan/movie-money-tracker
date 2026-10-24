import pytest

from app.domain.money import div_round_half_up, format_cents, parse_dollars


@pytest.mark.parametrize(
    ("text", "cents"),
    [
        ("5.99", 599),
        ("$5.99", 599),
        (" 0.50 ", 50),
        ("0.5", 50),
        ("35", 3500),
        ("0.00", 0),
        ("-7.17", -717),
        ("-$7.17", -717),
        ("$1,234.56", 123456),
    ],
)
def test_parse_dollars(text: str, cents: int) -> None:
    assert parse_dollars(text) == cents


@pytest.mark.parametrize("text", ["", "   ", "abc", "1.234", "5.99.1", "$", "1,23.00", "--5"])
def test_parse_dollars_rejects_non_amounts(text: str) -> None:
    with pytest.raises(ValueError):
        parse_dollars(text)


@pytest.mark.parametrize(
    ("cents", "text"),
    [(599, "$5.99"), (0, "$0.00"), (-717, "-$7.17"), (123456, "$1,234.56"), (5, "$0.05")],
)
def test_format_cents(cents: int, text: str) -> None:
    assert format_cents(cents) == text


@pytest.mark.parametrize(
    ("num", "den", "expected"),
    [(4193, 10, 419), (5, 10, 1), (4, 10, 0), (15, 10, 2), (2213, 3, 738), (0, 7, 0)],
)
def test_div_round_half_up(num: int, den: int, expected: int) -> None:
    assert div_round_half_up(num, den) == expected


def test_div_round_half_up_rejects_bad_input() -> None:
    with pytest.raises(ValueError):
        div_round_half_up(-1, 3)
    with pytest.raises(ValueError):
        div_round_half_up(1, 0)
