"""自动换行专项测试：框宽扫描。同一段文字放进一组宽度逐步增加的文本框，读出 PowerPoint 每个宽度下的每一行，
用来精确看断行规则（破折号、省略号、数字、网址……）。check.mjs 照常比对。

用法：python tools/wraptest/sweep.py <名字> <字体> <字号> <语言 2052|1033> <起始宽度> <结束宽度> <步长> <文字> [<文字>…]
（给多段文字时每段各扫一遍，放在同一个文件里）
输出：.cache/wraptest/<名字>.pptx / .json（和 gen.py 相同的格式）
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import pythoncom
import win32com.client

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / ".cache" / "wraptest"


def main():
    name, font, size, lang, w0, w1, step = sys.argv[1], sys.argv[2], float(sys.argv[3]), int(sys.argv[4]), float(sys.argv[5]), float(sys.argv[6]), float(sys.argv[7])
    texts = sys.argv[8:]
    OUT.mkdir(parents=True, exist_ok=True)
    pythoncom.CoInitialize()
    app = win32com.client.DispatchEx("PowerPoint.Application")
    boxes = []
    try:
        p = app.Presentations.Add(0)
        p.PageSetup.SlideWidth, p.PageSetup.SlideHeight = 960, 540
        slide = None
        k = 0
        for text in texts:
            w = w0
            while w <= w1 + 1e-6:
                if k % 8 == 0:
                    slide = p.Slides.Add(p.Slides.Count + 1, 12)
                s = slide.Shapes.AddTextbox(1, 10, 8 + (k % 8) * 66, w, 60)
                tf = s.TextFrame
                tf.WordWrap = -1
                tf.AutoSize = 0
                tr = tf.TextRange
                tr.Text = text
                tr.Font.Name = font
                tr.Font.NameFarEast = font
                tr.Font.Size = size
                tr.LanguageID = lang
                lines = []
                i = 1
                while i < 200:
                    ln = tr.Lines(i, 1)
                    if ln.Length == 0:
                        break
                    lines.append(ln.Text)
                    i += 1
                boxes.append({"id": s.Id, "slide": p.Slides.Count, "font": [font, font], "size": size, "width": w, "algn": "l", "indent": "none", "text": text, "lines": lines})
                w += step
                k += 1
        p.SaveAs(str(OUT / f"{name}.pptx"))
        p.Close()
    finally:
        try:
            app.Quit()
        except Exception:
            pass
    (OUT / f"{name}.json").write_text(json.dumps({"seed": name, "boxes": boxes}, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"{len(boxes)} 个宽度")


if __name__ == "__main__":
    main()
