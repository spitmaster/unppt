"""自动换行专项测试：表格。用 PowerPoint 按随机种子造表格（行列数、列宽、字体、字号、对齐、单元格边距、中英数标点混排），
读出每个单元格里 PowerPoint 实际排出的每一行当标准答案。内容都是合成的中性文字。

用法：python tools/wraptest/gen_table.py <种子> [页数，默认 20]
输出：.cache/wraptest/<种子>.pptx 和 <种子>.json（{"cells": [{slide, id, r, c, ..., lines}]}，check.mjs 按单元格比）
"""
from __future__ import annotations

import json
import random
import sys
from pathlib import Path

import pythoncom
import win32com.client

sys.path.insert(0, str(Path(__file__).resolve().parent))
from gen import ALIGN, FONTS, paragraph  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / ".cache" / "wraptest"


def main():
    seed = int(sys.argv[1])
    pages = int(sys.argv[2]) if len(sys.argv) > 2 else 20
    rnd = random.Random(seed)
    OUT.mkdir(parents=True, exist_ok=True)
    pythoncom.CoInitialize()
    app = win32com.client.DispatchEx("PowerPoint.Application")
    cells = []
    try:
        p = app.Presentations.Add(0)
        p.PageSetup.SlideWidth, p.PageSetup.SlideHeight = 960, 540
        for k in range(pages):
            slide = p.Slides.Add(k + 1, 12)
            rows, cols = rnd.randint(2, 5), rnd.randint(2, 5)
            width = rnd.choice([400, 600, 900])
            sh = slide.Shapes.AddTable(rows, cols, 20, 20, width, 300)
            t = sh.Table
            # 列宽随机分配
            ws = [rnd.uniform(0.5, 2) for _ in range(cols)]
            for c in range(cols):
                t.Columns(c + 1).Width = width * ws[c] / sum(ws)
            latin, ea = rnd.choice(FONTS)
            size = rnd.choice([10, 12, 14, 16, 18, 20, 24])
            for r in range(1, rows + 1):
                for c in range(1, cols + 1):
                    cell = t.Cell(r, c)
                    tf = cell.Shape.TextFrame
                    paras = [paragraph(rnd) for _ in range(rnd.randint(1, 2))]
                    tr = tf.TextRange
                    tr.Text = "\r".join(x[1] for x in paras)
                    tr.Font.Name = latin
                    tr.Font.NameFarEast = ea
                    tr.Font.Size = size
                    tr.LanguageID = 2052 if any(x[0] != "en" for x in paras) else 1033
                    algn = rnd.choice(["l", "l", "ctr", "r", "just", "dist"])
                    tr.ParagraphFormat.Alignment = ALIGN[algn]
                    if rnd.random() < 0.3:
                        m = rnd.choice([0, 3.6, 10.8, 14.4])
                        tf.MarginLeft, tf.MarginRight = m, rnd.choice([0, 3.6, 7.2, 14.4])
            for r in range(1, rows + 1):
                for c in range(1, cols + 1):
                    tr = t.Cell(r, c).Shape.TextFrame.TextRange
                    lines = []
                    i = 1
                    while i < 500:
                        ln = tr.Lines(i, 1)
                        if ln.Length == 0:
                            break
                        lines.append(ln.Text)
                        i += 1
                    cells.append({"slide": k + 1, "id": sh.Id, "r": r, "c": c, "font": [latin, ea], "size": size,
                                  "width": round(t.Columns(c).Width, 2), "text": tr.Text, "lines": lines})
        p.SaveAs(str(OUT / f"{seed}.pptx"))
        p.Close()
    finally:
        try:
            app.Quit()
        except Exception:
            pass
    (OUT / f"{seed}.json").write_text(json.dumps({"seed": seed, "cells": cells}, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"{len(cells)} 个单元格")


if __name__ == "__main__":
    main()
