#!/usr/bin/env python3
"""Build a font-embedded PDF of the V1.0 user manual."""

from __future__ import annotations

import html
import re
from pathlib import Path

from PIL import Image as PILImage
from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import cm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    BaseDocTemplate,
    Frame,
    Image,
    KeepTogether,
    PageBreak,
    PageTemplate,
    Paragraph,
    Spacer,
    Table,
    TableStyle,
)


ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "docs/user-manual/HTML课件互动编辑系统-V1.0-用户手册.md"
OUTPUT = ROOT / "docs/user-manual/output/HTML课件互动编辑系统-V1.0-用户手册.pdf"
LOGO = ROOT / "design/brand/preview/logo-lockup-zh-browser.png"

FONT_CANDIDATES = [
    Path("/Library/Fonts/Arial Unicode.ttf"),
    Path("/System/Library/Fonts/STHeiti Medium.ttc"),
    Path("/System/Library/Fonts/PingFang.ttc"),
]

BLUE = colors.HexColor("#123B5D")
TEAL = colors.HexColor("#008B7A")
INK = colors.HexColor("#17211D")
MUTED = colors.HexColor("#5F6D68")
PALE = colors.HexColor("#E9F5F2")
WHITE = colors.white


def register_font() -> str:
    path = next((candidate for candidate in FONT_CANDIDATES if candidate.exists()), None)
    if path is None:
        raise FileNotFoundError("No supported CJK font was found")
    name = "ManualCJK"
    pdfmetrics.registerFont(TTFont(name, str(path)))
    return name


FONT = register_font()


class ManualDocTemplate(BaseDocTemplate):
    def __init__(self, filename: str):
        super().__init__(
            filename,
            pagesize=A4,
            leftMargin=2.0 * cm,
            rightMargin=2.0 * cm,
            topMargin=1.8 * cm,
            bottomMargin=1.8 * cm,
            title="HTML课件互动编辑系统 V1.0 用户手册",
            author="",
            subject="安装、课件编辑、互动制作、版本管理与导出说明",
        )
        frame = Frame(self.leftMargin, self.bottomMargin, self.width, self.height, id="content")
        self.addPageTemplates(PageTemplate(id="manual", frames=[frame], onPage=self.draw_page))

    def draw_page(self, canvas, doc) -> None:
        if doc.page == 1:
            return
        canvas.saveState()
        canvas.setFont(FONT, 8)
        canvas.setFillColor(BLUE)
        canvas.drawString(2.0 * cm, A4[1] - 1.05 * cm, "HTML课件互动编辑系统")
        canvas.setFillColor(TEAL)
        canvas.drawRightString(A4[0] - 2.0 * cm, A4[1] - 1.05 * cm, "V1.0 用户手册")
        canvas.setStrokeColor(colors.HexColor("#6BA7C8"))
        canvas.setLineWidth(0.4)
        canvas.line(2.0 * cm, A4[1] - 1.25 * cm, A4[0] - 2.0 * cm, A4[1] - 1.25 * cm)
        canvas.setFillColor(MUTED)
        canvas.drawCentredString(A4[0] / 2, 0.8 * cm, f"第 {doc.page} 页")
        canvas.restoreState()


def styles():
    sheet = getSampleStyleSheet()
    return {
        "body": ParagraphStyle(
            "ManualBody",
            parent=sheet["BodyText"],
            fontName=FONT,
            fontSize=10.2,
            leading=15.2,
            textColor=INK,
            spaceAfter=5,
            wordWrap="CJK",
        ),
        "h1": ParagraphStyle(
            "ManualH1",
            parent=sheet["Heading1"],
            fontName=FONT,
            fontSize=18,
            leading=24,
            textColor=BLUE,
            spaceBefore=8,
            spaceAfter=9,
            keepWithNext=True,
            wordWrap="CJK",
        ),
        "h2": ParagraphStyle(
            "ManualH2",
            parent=sheet["Heading2"],
            fontName=FONT,
            fontSize=13,
            leading=18,
            textColor=TEAL,
            spaceBefore=8,
            spaceAfter=5,
            keepWithNext=True,
            wordWrap="CJK",
        ),
        "caption": ParagraphStyle(
            "ManualCaption",
            parent=sheet["BodyText"],
            fontName=FONT,
            fontSize=8.5,
            leading=12,
            textColor=MUTED,
            alignment=TA_CENTER,
            spaceAfter=8,
            wordWrap="CJK",
        ),
        "bullet": ParagraphStyle(
            "ManualBullet",
            parent=sheet["BodyText"],
            fontName=FONT,
            fontSize=10.2,
            leading=15,
            leftIndent=0.6 * cm,
            firstLineIndent=-0.35 * cm,
            bulletIndent=0.15 * cm,
            spaceAfter=3,
            wordWrap="CJK",
        ),
        "toc": ParagraphStyle(
            "ManualToc",
            parent=sheet["BodyText"],
            fontName=FONT,
            fontSize=11,
            leading=19,
            leftIndent=0.4 * cm,
            textColor=INK,
            wordWrap="CJK",
        ),
    }


STYLES = styles()


def inline(text: str) -> str:
    escaped = html.escape(text.strip())
    escaped = re.sub(r"\*\*(.*?)\*\*", r"<b>\1</b>", escaped)
    escaped = re.sub(r"`([^`]+)`", r"<font color='#123B5D'>\1</font>", escaped)
    escaped = re.sub(r"\[(.*?)\]\((.*?)\)", r"\1（\2）", escaped)
    return escaped.replace("  ", " ")


def image_flowable(alt: str, relative_path: str):
    path = SOURCE.parent / relative_path
    with PILImage.open(path) as src:
        width, height = src.size
    target_width = 16.4 * cm
    target_height = target_width * height / width
    return KeepTogether(
        [
            Image(str(path), width=target_width, height=target_height),
            Spacer(1, 0.1 * cm),
            Paragraph(html.escape(alt), STYLES["caption"]),
        ]
    )


def markdown_table(rows: list[list[str]]):
    data = [[Paragraph(inline(cell), STYLES["body"]) for cell in row] for row in rows]
    col_width = 17.0 * cm / len(rows[0])
    table = Table(data, colWidths=[col_width] * len(rows[0]), repeatRows=1, hAlign="CENTER")
    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), BLUE),
                ("TEXTCOLOR", (0, 0), (-1, 0), WHITE),
                ("FONTNAME", (0, 0), (-1, -1), FONT),
                ("FONTSIZE", (0, 0), (-1, -1), 8.5),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("GRID", (0, 0), (-1, -1), 0.35, colors.HexColor("#A9C9C1")),
                ("LEFTPADDING", (0, 0), (-1, -1), 6),
                ("RIGHTPADDING", (0, 0), (-1, -1), 6),
                ("TOPPADDING", (0, 0), (-1, -1), 5),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
            ]
        )
    )
    return table


def parse_table(lines: list[str], start: int):
    block = []
    idx = start
    while idx < len(lines) and lines[idx].strip().startswith("|"):
        block.append([part.strip() for part in lines[idx].strip().strip("|").split("|")])
        idx += 1
    if len(block) >= 2 and all(re.fullmatch(r":?-{3,}:?", cell) for cell in block[1]):
        block.pop(1)
    return block, idx


def cover_story():
    logo = Image(str(LOGO), width=10.8 * cm, height=3.9 * cm)
    title = Paragraph(
        "HTML课件互动编辑系统",
        ParagraphStyle(
            "CoverTitle",
            fontName=FONT,
            fontSize=27,
            leading=34,
            textColor=BLUE,
            alignment=TA_CENTER,
            spaceAfter=10,
            wordWrap="CJK",
        ),
    )
    subtitle = Paragraph(
        "V1.0 用户手册",
        ParagraphStyle(
            "CoverSubtitle", fontName=FONT, fontSize=16, leading=22, textColor=TEAL, alignment=TA_CENTER
        ),
    )
    tagline = Paragraph(
        "面向教师的本地 HTML 课件可视化编辑与互动制作工具",
        ParagraphStyle(
            "CoverTagline", fontName=FONT, fontSize=10.5, leading=15, textColor=MUTED, alignment=TA_CENTER
        ),
    )
    info = [
        ["软件版本", "V1.0"],
        ["文档版本", "1.0"],
        ["发布日期", "2026年8月"],
        ["适用平台", "macOS / Windows"],
        ["著作权人", "____________________"],
    ]
    table = Table(info, colWidths=[4.2 * cm, 7.5 * cm], rowHeights=[0.75 * cm] * 5, hAlign="CENTER")
    table.setStyle(
        TableStyle(
            [
                ("FONTNAME", (0, 0), (-1, -1), FONT),
                ("FONTSIZE", (0, 0), (-1, -1), 10),
                ("BACKGROUND", (0, 0), (0, -1), PALE),
                ("TEXTCOLOR", (0, 0), (0, -1), BLUE),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("LEFTPADDING", (0, 0), (-1, -1), 10),
                ("GRID", (0, 0), (-1, -1), 0.3, colors.HexColor("#C5DDD7")),
            ]
        )
    )
    note = Paragraph("本手册界面截图均来自 V1.0 实际运行环境", STYLES["caption"])
    return [
        Spacer(1, 0.7 * cm),
        logo,
        Spacer(1, 1.8 * cm),
        title,
        subtitle,
        Spacer(1, 0.8 * cm),
        tagline,
        Spacer(1, 1.0 * cm),
        table,
        Spacer(1, 1.6 * cm),
        note,
        PageBreak(),
    ]


def toc_story(markdown: str):
    chapter_titles = []
    for line in markdown.splitlines():
        if line.startswith("## "):
            title = line[3:].strip()
            if title == "文档说明" or re.match(r"^(\d+\.|附录 )", title):
                chapter_titles.append(title)
    story = [Paragraph("目录", STYLES["h1"]), Spacer(1, 0.25 * cm)]
    for title in chapter_titles:
        story.append(Paragraph(html.escape(title), STYLES["toc"]))
    story.extend([Spacer(1, 0.4 * cm), Paragraph("目录页码以最终 PDF 页面为准。", STYLES["caption"]), PageBreak()])
    return story


def body_story(markdown: str):
    lines = markdown.splitlines()
    idx = next(i for i, line in enumerate(lines) if line.strip() == "## 文档说明")
    story = []
    step_number = 1
    while idx < len(lines):
        stripped = lines[idx].strip()
        if not stripped or stripped == "---":
            idx += 1
            continue
        if stripped.startswith("|"):
            rows, idx = parse_table(lines, idx)
            story.extend([markdown_table(rows), Spacer(1, 0.25 * cm)])
            continue
        match = re.fullmatch(r"!\[(.+?)\]\((.+?)\)", stripped)
        if match:
            story.append(image_flowable(match.group(1), match.group(2)))
            idx += 1
            continue
        if stripped.startswith("## "):
            title = stripped[3:]
            story.append(Paragraph(html.escape(title), STYLES["h1"]))
            step_number = 1
            idx += 1
            continue
        if stripped.startswith("### "):
            story.append(Paragraph(html.escape(stripped[4:]), STYLES["h2"]))
            step_number = 1
            idx += 1
            continue
        if stripped.startswith("> "):
            callout = Table([[Paragraph(inline(stripped[2:]), STYLES["body"])]], colWidths=[16.5 * cm])
            callout.setStyle(
                TableStyle(
                    [
                        ("BACKGROUND", (0, 0), (-1, -1), PALE),
                        ("BOX", (0, 0), (-1, -1), 0.5, colors.HexColor("#91C7BA")),
                        ("LEFTPADDING", (0, 0), (-1, -1), 9),
                        ("RIGHTPADDING", (0, 0), (-1, -1), 9),
                        ("TOPPADDING", (0, 0), (-1, -1), 7),
                        ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
                    ]
                )
            )
            story.extend([callout, Spacer(1, 0.15 * cm)])
            idx += 1
            continue
        ordered = re.match(r"^(\d+)\.\s+(.+)$", stripped)
        if ordered:
            story.append(Paragraph(inline(ordered.group(2)), STYLES["bullet"], bulletText=f"{step_number}."))
            step_number += 1
            idx += 1
            continue
        bullet = re.match(r"^-\s+(.+)$", stripped)
        if bullet:
            value = bullet.group(1)
            marker = "□" if value.startswith("[ ] ") else "•"
            value = value[4:] if value.startswith("[ ] ") else value
            story.append(Paragraph(inline(value), STYLES["bullet"], bulletText=marker))
            idx += 1
            continue
        parts = [stripped]
        idx += 1
        while idx < len(lines):
            nxt = lines[idx].strip()
            if not nxt or re.match(r"^(#{2,4}\s|[-|>]\s?|\d+\.\s|!\[)", nxt):
                break
            parts.append(nxt)
            idx += 1
        story.append(Paragraph(inline(" ".join(parts)), STYLES["body"]))
    return story


def main() -> None:
    markdown = SOURCE.read_text(encoding="utf-8")
    story = cover_story() + toc_story(markdown) + body_story(markdown)
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    doc = ManualDocTemplate(str(OUTPUT))
    doc.build(story)
    print(OUTPUT)


if __name__ == "__main__":
    main()
