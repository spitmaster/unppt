"""自动换行专项测试：各种预设形状里的文字。每种自选图形（msoAutoShapeType 1~183）放一段长文字，读出 PowerPoint
排出的每一行，量形状的文字区域（预设几何的文字矩形）和我们是否一致。check.mjs 照常比对。

用法：python tools/wraptest/shapes.py [名字，默认 sw-shapes] [宽 磅，默认 300] [高 磅，默认 150]
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import pythoncom
import win32com.client

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / ".cache" / "wraptest"
TEXT = "形状里的文字按文字区域换行，区域由预设几何定义。The quick brown fox jumps over the lazy dog. 第二句话继续测试换行的位置是否一致。"


def main():
    name = sys.argv[1] if len(sys.argv) > 1 else "sw-shapes"
    w = float(sys.argv[2]) if len(sys.argv) > 2 else 300
    h = float(sys.argv[3]) if len(sys.argv) > 3 else 150
    OUT.mkdir(parents=True, exist_ok=True)
    pythoncom.CoInitialize()
    app = win32com.client.DispatchEx("PowerPoint.Application")
    boxes = []
    try:
        p = app.Presentations.Add(0)
        p.PageSetup.SlideWidth, p.PageSetup.SlideHeight = 960, 540
        slide = None
        k = 0
        for t in range(1, 184):
            if k % 6 == 0:
                slide = p.Slides.Add(p.Slides.Count + 1, 12)
            try:
                s = slide.Shapes.AddShape(t, 10 + (k % 3) * 315, 10 + (k % 6 // 3) * 265, w, h)
            except Exception:
                continue
            try:
                if not s.HasTextFrame:
                    s.Delete()
                    continue
                tf = s.TextFrame
                tf.WordWrap = -1
                tf.AutoSize = 0
                tr = tf.TextRange
                tr.Text = TEXT
                tr.Font.Name = "Microsoft YaHei"
                tr.Font.NameFarEast = "Microsoft YaHei"
                tr.Font.Size = 14
                tr.LanguageID = 2052
                tr.ParagraphFormat.Alignment = 1
                s.Fill.Visible = 0
                s.Line.ForeColor.RGB = 0x999999
                tr.Font.Color.RGB = 0
            except Exception:
                s.Delete()
                continue
            lines = []
            i = 1
            while i < 200:
                ln = tr.Lines(i, 1)
                if ln.Length == 0:
                    break
                lines.append(ln.Text)
                i += 1
            boxes.append({"id": s.Id, "slide": p.Slides.Count, "font": ["Microsoft YaHei"] * 2, "size": 14, "width": w,
                          "algn": "l", "indent": f"type{t} {s.AutoShapeType}", "text": TEXT, "lines": lines})
            k += 1
        p.SaveAs(str(OUT / f"{name}.pptx"))
        p.Close()
    finally:
        try:
            app.Quit()
        except Exception:
            pass
    (OUT / f"{name}.json").write_text(json.dumps({"seed": name, "boxes": boxes}, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"{len(boxes)} 个形状")


if __name__ == "__main__":
    main()
