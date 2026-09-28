"""Generate synthetic pages with exact PII ground truth for VEIL-Bench.

Every sensitive value is wrapped in data-gt="CLASS" by the generator, so ground truth needs no hand
labelling. Phase 4's Playwright runner turns these marks into pixel boxes with getClientRects().

    python generate.py --count 150 --out ../pages
"""
import argparse
import html
import json
import random
import string
from pathlib import Path

from faker import Faker

D = [[0,1,2,3,4,5,6,7,8,9],[1,2,3,4,0,6,7,8,9,5],[2,3,4,0,1,7,8,9,5,6],[3,4,0,1,2,8,9,5,6,7],[4,0,1,2,3,9,5,6,7,8],
     [5,9,8,7,6,0,4,3,2,1],[6,5,9,8,7,1,0,4,3,2],[7,6,5,9,8,2,1,0,4,3],[8,7,6,5,9,3,2,1,0,4],[9,8,7,6,5,4,3,2,1,0]]
P = [[0,1,2,3,4,5,6,7,8,9],[1,5,7,6,2,8,3,0,9,4],[5,8,0,3,7,9,6,1,4,2],[8,9,1,6,0,4,3,5,2,7],
     [9,4,5,3,1,2,0,7,6,8],[4,2,8,6,5,7,3,9,0,1],[2,7,9,3,8,0,6,4,1,5],[7,0,4,6,9,1,3,2,5,8]]
INV = [0,4,3,2,1,5,6,7,8,9]
BANKS = ["HDFC", "ICIC", "SBIN", "UTIB", "KKBK", "PUNB"]
UPI_HANDLES = ["okaxis", "okhdfcbank", "ybl", "paytm", "oksbi", "ibl"]


def verhoeff_digit(num: str) -> int:
    c = 0
    for i, ch in enumerate(reversed(num + "0")):
        c = D[c][P[i % 8][int(ch)]]
    return INV[c]


def luhn_digit(num: str) -> int:
    total = 0
    for i, ch in enumerate(reversed(num + "0")):
        n = int(ch)
        if i % 2:
            n = n * 2 - 9 if n > 4 else n * 2
        total += n
    return (10 - total % 10) % 10


class Person:
    def __init__(self, fake: Faker, rng: random.Random):
        self.name = fake.name()
        first = self.name.split()[0].lower()
        self.email = f"{first}.{rng.randint(10, 999)}@{rng.choice(['mail.in', 'example.in', 'inbox.co.in'])}"
        base = str(rng.randint(2, 9)) + "".join(rng.choice(string.digits) for _ in range(10))
        a = base + str(verhoeff_digit(base))
        self.aadhaar = f"{a[:4]} {a[4:8]} {a[8:]}"
        self.pan = "".join(rng.choice(string.ascii_uppercase) for _ in range(3)) + "P" + self.name.split()[-1][0].upper() + \
            "".join(rng.choice(string.digits) for _ in range(4)) + rng.choice(string.ascii_uppercase)
        m = str(rng.choice([6, 7, 8, 9])) + "".join(rng.choice(string.digits) for _ in range(9))
        self.phone = f"+91 {m[:5]} {m[5:]}"
        self.dob = fake.date_of_birth(minimum_age=19, maximum_age=70).strftime("%d-%m-%Y")
        self.address = fake.address().replace("\n", ", ")
        self.ifsc = rng.choice(BANKS) + "0" + "".join(rng.choice(string.digits + string.ascii_uppercase) for _ in range(6))
        self.account = "".join(rng.choice(string.digits) for _ in range(rng.choice([11, 12, 14])))
        c = "4" + "".join(rng.choice(string.digits) for _ in range(14))
        c += str(luhn_digit(c))
        self.card = " ".join(c[i:i + 4] for i in range(0, 16, 4))
        self.upi = f"{first}{rng.randint(1, 99)}@{rng.choice(UPI_HANDLES)}"


def gt(cls: str, value: str, truth: list) -> str:
    truth.append({"class": cls, "value": value})
    return f'<span data-gt="{cls}">{html.escape(value)}</span>'


def field(label: str, cls: str | None, value: str, truth: list, kind: str = "text") -> str:
    fid = f"f{len(truth)}_{random.randint(1000, 9999)}"
    if cls and value:
        truth.append({"class": cls, "value": value, "field": fid})
    gt_attr = f' data-gt="{cls}"' if cls else ""
    v = "" if kind == "password" else html.escape(value)
    return (f'<div class="field"><label for="{fid}">{html.escape(label)}</label>'
            f'<input id="{fid}" type="{kind}" value="{v}"{gt_attr}></div>')


def kyc_form(p: Person, rng: random.Random, truth: list) -> str:
    prefilled = rng.random() < 0.6
    val = (lambda v: v) if prefilled else (lambda v: "")
    return (f"<h1>Update your KYC</h1><form class='card grid'>"
            + field("Full name", "NAME", val(p.name), truth)
            + field("Date of birth", "DOB", val(p.dob), truth)
            + field("Mobile number", "PHONE", val(p.phone), truth)
            + field("Email address", "EMAIL", val(p.email), truth)
            + field("Aadhaar number", "AADHAAR", val(p.aadhaar), truth)
            + field("PAN", "PAN", val(p.pan), truth)
            + field("Password", "SECRET", "x" if prefilled else "", truth, "password")
            + field("Referral code", None, "SPRING26", truth)
            + "<button type='button'>Continue</button></form>")


def profile(p: Person, rng: random.Random, truth: list) -> str:
    rows = [("Name", "NAME", p.name), ("Date of birth", "DOB", p.dob), ("Aadhaar", "AADHAAR", p.aadhaar),
            ("PAN", "PAN", p.pan), ("Mobile", "PHONE", p.phone), ("Email", "EMAIL", p.email), ("Address", "ADDRESS", p.address)]
    rng.shuffle(rows)
    dl = "".join(f"<dt>{k}</dt><dd>{gt(c, v, truth)}</dd>" for k, c, v in rows)
    return (f"<h1>My profile</h1><section class='card'><img src='data:image/svg+xml;utf8,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 120%22%3E%3Crect width=%22100%22 height=%22120%22 fill=%22%23ccd%22/%3E%3Ccircle cx=%2250%22 cy=%2248%22 r=%2224%22 fill=%22%23a76%22/%3E%3C/svg%3E' "
            f"width='100' height='120' alt='Profile photo' data-gt='FACE'><dl>{dl}</dl></section>"
            f"<p>Welcome back, {gt('NAME', p.name.split()[0], truth)}. Last login from Bengaluru.</p>")


def statement(p: Person, rng: random.Random, truth: list) -> str:
    rows = []
    for _ in range(rng.randint(4, 8)):
        amt = f"{rng.randint(100, 50000):,}.00"
        options = [
            lambda: f"UPI to {gt('UPI', f'shop{rng.randint(1, 99)}@ybl', truth)}",
            lambda: "ATM withdrawal",
            lambda: "Salary credit",
            lambda: f"Card {gt('CARD', p.card, truth)}",
            lambda: "Electricity bill",
            lambda: f"Order #{rng.randint(10**11, 10**12 - 1)}",
        ]
        desc = rng.choice(options)()
        rows.append(f"<tr><td>{rng.randint(1, 28):02d}-09-2026</td><td>{desc}</td><td>₹{amt}</td></tr>")
    return (f"<h1>Account statement</h1><section class='card'>"
            f"<p>Account holder: {gt('NAME', p.name, truth)}</p>"
            f"<p>Account number: {gt('ACCOUNT', p.account, truth)}. IFSC: {gt('IFSC', p.ifsc, truth)}</p>"
            f"<p>Registered UPI: {gt('UPI', p.upi, truth)}. Registered mobile: {gt('PHONE', p.phone, truth)}</p>"
            f"<table><thead><tr><th>Date</th><th>Description</th><th>Amount</th></tr></thead><tbody>{''.join(rows)}</tbody></table>"
            f"</section>")


TEMPLATES = {"kyc_form": kyc_form, "profile": profile, "statement": statement}
CSS = ("body{font:16px/1.5 system-ui,sans-serif;margin:0;padding:32px;background:#eef2f5;color:#18212b}"
       ".card{background:#fff;border:1px solid #d6dde4;border-radius:10px;padding:20px;margin:12px 0}"
       ".grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}.field label{display:block;font-weight:600}"
       ".field input{width:100%;padding:8px}dl{display:grid;grid-template-columns:140px 1fr;gap:6px}"
       "table{border-collapse:collapse;width:100%}td,th{padding:6px;border-bottom:1px solid #d6dde4;text-align:left}")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--count", type=int, default=150)
    ap.add_argument("--out", type=Path, default=Path(__file__).resolve().parents[1] / "pages")
    ap.add_argument("--seed", type=int, default=2026)
    args = ap.parse_args()

    rng = random.Random(args.seed)
    random.seed(args.seed)
    fake = Faker("en_IN")
    Faker.seed(args.seed)
    args.out.mkdir(parents=True, exist_ok=True)
    manifest = []
    names = list(TEMPLATES)
    for i in range(args.count):
        kind = names[i % len(names)]
        truth: list = []
        body = TEMPLATES[kind](Person(fake, rng), rng, truth)
        name = f"{kind}_{i:03d}"
        (args.out / f"{name}.html").write_text(
            f"<!doctype html><html lang='en'><head><meta charset='utf-8'><title>{kind.replace('_', ' ').title()}</title>"
            f"<style>{CSS}</style></head><body>{body}</body></html>", encoding="utf-8")
        (args.out / f"{name}.json").write_text(json.dumps({"page": f"{name}.html", "template": kind, "truth": truth}, indent=1), encoding="utf-8")
        manifest.append({"page": f"{name}.html", "template": kind, "entities": len(truth)})
    (args.out / "manifest.json").write_text(json.dumps(manifest, indent=1), encoding="utf-8")
    print(f"Wrote {args.count} pages and ground truth to {args.out}")


if __name__ == "__main__":
    main()
