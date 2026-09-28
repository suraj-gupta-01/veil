"""Server-side leak guard. Defence in depth: the client should never send raw identifiers,
so any hit here means the client pipeline missed something and the payload is refused."""
import re
from dataclasses import dataclass
from typing import Any, Iterator

from .vrs import TOKEN_RE

_D = [
    [0,1,2,3,4,5,6,7,8,9],[1,2,3,4,0,6,7,8,9,5],[2,3,4,0,1,7,8,9,5,6],[3,4,0,1,2,8,9,5,6,7],
    [4,0,1,2,3,9,5,6,7,8],[5,9,8,7,6,0,4,3,2,1],[6,5,9,8,7,1,0,4,3,2],[7,6,5,9,8,2,1,0,4,3],
    [8,7,6,5,9,3,2,1,0,4],[9,8,7,6,5,4,3,2,1,0],
]
_P = [
    [0,1,2,3,4,5,6,7,8,9],[1,5,7,6,2,8,3,0,9,4],[5,8,0,3,7,9,6,1,4,2],[8,9,1,6,0,4,3,5,2,7],
    [9,4,5,3,1,2,0,7,6,8],[4,2,8,6,5,7,3,9,0,1],[2,7,9,3,8,0,6,4,1,5],[7,0,4,6,9,1,3,2,5,8],
]


def digits(s: str) -> str:
    return re.sub(r"\D", "", s)


def verhoeff(s: str) -> bool:
    d, c = digits(s), 0
    for i, ch in enumerate(reversed(d)):
        c = _D[c][_P[i % 8][int(ch)]]
    return bool(d) and c == 0


def luhn(s: str) -> bool:
    d, total = digits(s), 0
    for i, ch in enumerate(reversed(d)):
        n = int(ch)
        if i % 2:
            n = n * 2 - 9 if n > 4 else n * 2
        total += n
    return len(d) >= 12 and total % 10 == 0


RECOGNIZERS: list[tuple[str, re.Pattern, Any]] = [
    ("EMAIL", re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}"), None),
    ("CARD", re.compile(r"(?<!\d)(?:\d[ -]?){12,18}\d(?!\d)"), lambda m: 13 <= len(digits(m)) <= 19 and luhn(m)),
    ("AADHAAR", re.compile(r"(?<!\d)[2-9]\d{3}[ -]?\d{4}[ -]?\d{4}(?!\d)"), lambda m: verhoeff(m) or bool(re.search(r"[ -]", m))),
    ("PAN", re.compile(r"\b[A-Z]{3}[ABCFGHLJPT][A-Z]\d{4}[A-Z]\b"), None),
    ("IFSC", re.compile(r"\b[A-Z]{4}0[A-Z0-9]{6}\b"), None),
    ("UPI", re.compile(r"\b[A-Za-z0-9._-]{2,64}@[A-Za-z]{2,32}\b(?![.@\w])"), None),
    ("PHONE", re.compile(r"(?<![\d+])(?:\+?91[ -]?|0)?[6-9]\d{4}[ -]?\d{5}(?!\d)"), None),
]

SKIP_KEYS = {"image"}


@dataclass
class Leak:
    path: str
    cls: str


def walk(obj: Any, path: str = "") -> Iterator[tuple[str, str]]:
    if isinstance(obj, str):
        yield path, obj
    elif isinstance(obj, dict):
        for k, v in obj.items():
            if k not in SKIP_KEYS:
                yield from walk(v, f"{path}.{k}" if path else k)
    elif isinstance(obj, (list, tuple)):
        for i, v in enumerate(obj):
            yield from walk(v, f"{path}[{i}]")


def scan(payload: dict) -> list[Leak]:
    leaks: list[Leak] = []
    for path, s in walk(payload):
        text = TOKEN_RE.sub(" ", s)
        for cls, rx, check in RECOGNIZERS:
            if any(check is None or check(m.group(0)) for m in rx.finditer(text)):
                leaks.append(Leak(path, cls))
                break
    return leaks
