"""Calendar-month helpers (months are 'YYYY-MM' strings)."""
from __future__ import annotations


def to_ord(m: str) -> int:
    y, mo = m.split("-")
    return int(y) * 12 + int(mo) - 1


def from_ord(o: int) -> str:
    return f"{o // 12:04d}-{o % 12 + 1:02d}"


def add(m: str, n: int) -> str:
    return from_ord(to_ord(m) + n)


def index(m: str, start: str) -> int:
    """Number of months from ``start`` to ``m`` (0 when equal)."""
    return to_ord(m) - to_ord(start)


def label(m: str) -> str:
    names = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
    y, mo = m.split("-")
    return f"{names[int(mo) - 1]} {y}"
