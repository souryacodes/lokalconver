"""Builds the small sample files in samples/. Run: python tools/make_samples.py
Needs python-docx and Pillow (dev only, not shipped with the website)."""
from pathlib import Path
import io

from docx import Document          # python-docx: only dev tool that can write a real .docx
from PIL import Image              # Pillow: makes the tiny test picture
from openpyxl import Workbook      # openpyxl: writes the sample .xlsx
import datetime

OUT = Path(__file__).resolve().parent.parent / "samples"


def make_docx() -> None:
    doc = Document()
    doc.add_heading("Lab Report: Ohm's Law", level=1)
    p = doc.add_paragraph("This is a ")
    p.add_run("bold").bold = True
    p.add_run(" and an ")
    p.add_run("italic").italic = True
    p.add_run(" word, with a link-free sentence & a < sign.")
    doc.add_heading("Readings", level=2)
    table = doc.add_table(rows=3, cols=3)
    for r, row in enumerate([("Volts", "Amps", "Ohms"), ("2", "0.5", "4"), ("6", "1.5", "4")]):
        for c, text in enumerate(row):
            table.cell(r, c).text = text
    doc.add_paragraph("First point", style="List Bullet")
    doc.add_paragraph("Second point", style="List Bullet")
    img = io.BytesIO()
    Image.new("RGB", (40, 20), (124, 92, 255)).save(img, "PNG")
    img.seek(0)
    doc.add_picture(img)
    doc.save(OUT / "sample.docx")


def make_xlsx() -> None:
    wb = Workbook()
    ws = wb.active
    ws.title = "Marks"
    ws.append(["roll", "name", "maths", "date"])
    ws.append(["0042", "Rao, Sourya", 90.5, datetime.date(2026, 10, 26)])
    ws.append(["0043", "Anil", 85, None])
    ws2 = wb.create_sheet("Second")
    ws2.append(["x"])
    ws2.append([1])
    wb.save(OUT / "sample.xlsx")


def make_text_files() -> None:
    (OUT / "sample.md").write_text(
        "# Hello\n\nSome *emphasis*, a [link](https://example.com) and `code`.\n\n"
        "- one\n- two\n\n<script>alert(1)</script>\n\n[bad](javascript:alert(1))\n", encoding="utf-8")
    (OUT / "sample.txt").write_text(("Line of text for wrapping. " * 40 + "\n\n") * 3, encoding="utf-8")
    (OUT / "sample.csv").write_text(
        'roll,name,note\r\n0042,"Rao, Sourya","said ""hi""\r\nand left"\r\n0043,Anil,\r\n', encoding="utf-8")
    (OUT / "sample.json").write_text(
        '[{"roll":"0042","name":"Rao, Sourya","marks":{"maths":90}},{"roll":"0043","name":"Anil"}]\n', encoding="utf-8")


if __name__ == "__main__":
    OUT.mkdir(exist_ok=True)
    make_docx()
    make_xlsx()
    make_text_files()
    print("samples written to", OUT)
