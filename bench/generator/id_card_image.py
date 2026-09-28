"""Render the synthetic ID card as a raster image for the Phase 2 demo (demo-sites/id-card-scan.png).

The holder is the same synthetic Ananya Rao as demo-sites/id-card.html. The portrait is drawn, not a
photo of a real person, and the QR code encodes the same fake details, like a real Aadhaar QR would.

    python id_card_image.py
"""
from pathlib import Path

import qrcode
from PIL import Image, ImageDraw, ImageFont

OUT = Path(__file__).resolve().parents[2] / "demo-sites" / "id-card-scan.png"
ROWS = [
    ("Name", "Ananya Rao"),
    ("Date of birth", "12-08-1999"),
    ("Aadhaar", "4821 6630 1979"),
    ("PAN", "ABCPR1234K"),
    ("Mobile", "+91 98450 12345"),
    ("Email", "ananya.rao@mail.in"),
    ("Address", "14, 3rd Cross, Jayanagar, Bengaluru 560041"),
]


def font(size: int) -> ImageFont.FreeTypeFont:
    return ImageFont.load_default(size=size)


def portrait(d: ImageDraw.ImageDraw, x: int, y: int) -> None:
    d.rectangle([x, y, x + 170, y + 210], fill="#DCE6EF")
    d.ellipse([x + 45, y + 40, x + 125, y + 140], fill="#C98E6B")
    d.chord([x + 40, y + 30, x + 130, y + 100], 180, 360, fill="#2B1D16")
    for ex in (62, 96):
        d.ellipse([x + ex, y + 80, x + ex + 12, y + 88], fill="white")
        d.ellipse([x + ex + 3, y + 81, x + ex + 9, y + 87], fill="#2B1D16")
    d.line([x + 85, y + 90, x + 82, y + 110, x + 88, y + 110], fill="#8A5A40", width=2)
    d.arc([x + 70, y + 108, x + 100, y + 126], 20, 160, fill="#7A2E2E", width=3)
    d.pieslice([x + 10, y + 150, x + 160, y + 300], 180, 360, fill="#0B4F8A")


def main() -> None:
    im = Image.new("RGB", (940, 440), "#F4F7FA")
    d = ImageDraw.Draw(im)
    d.rectangle([0, 0, im.width, 58], fill="#0B4F8A")
    d.text((24, 16), "GOVERNMENT OF DEMOLAND  IDENTITY CARD", font=font(22), fill="white")
    portrait(d, 28, 86)
    y = 92
    for label, value in ROWS:
        d.text((230, y), label, font=font(16), fill="#5B6773")
        d.text((370, y), value, font=font(18), fill="#18212B")
        y += 38
    payload = ";".join(v for _, v in ROWS)
    qr = qrcode.make(payload, box_size=3, border=2).convert("RGB")
    im.paste(qr, (im.width - qr.width - 24, 86))
    d.text((230, 400), "Synthetic test document. Not a real person.", font=font(14), fill="#5B6773")
    im.save(OUT, optimize=True)
    print(f"Wrote {OUT} ({OUT.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main()
