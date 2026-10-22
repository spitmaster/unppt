"""自动换行专项测试：生成用例和 PowerPoint 的标准答案。

用 PowerPoint 按随机种子批量造文本框（字体、字号、框宽、对齐、缩进、项目符号、中英数标点混排），
生成后立刻读出 PowerPoint 实际排出的每一行文字（TextRange.Lines），存成标准答案。内容都是合成的中性文字。

用法：python tools/wraptest/gen.py <种子> [页数，默认 40] [--rich]
  --rich：再随机加上形状（矩形、圆角矩形、椭圆）里的文字、粗体、字间距、同一段里混合字号、"溢出时缩小文字"
输出：.cache/wraptest/<种子>.pptx 和 <种子>.json（每个文本框的参数和 PowerPoint 的每一行）
"""
from __future__ import annotations

import json
import random
import sys
import time
from pathlib import Path

import pythoncom
import win32com.client

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / ".cache" / "wraptest"

ALIGN = {"l": 1, "ctr": 2, "r": 3, "just": 4, "dist": 5}
# (西文字体, 东亚字体)：中文课件常见的搭配
FONTS = [
    ("Microsoft YaHei", "Microsoft YaHei"), ("DengXian", "DengXian"), ("SimSun", "SimSun"), ("SimHei", "SimHei"),
    ("KaiTi", "KaiTi"), ("FangSong", "FangSong"), ("Calibri", "Microsoft YaHei"), ("Arial", "Microsoft YaHei"),
    ("Times New Roman", "SimSun"), ("Calibri", "DengXian"), ("Segoe UI", "Microsoft YaHei"), ("Arial", "SimHei"),
]
CN = [
    "本季度营收同比增长", "其中线上渠道贡献最大", "用户规模持续扩大", "客户满意度显著提升", "我们需要进一步优化流程",
    "学而时习之，不亦说乎？", "有朋自远方来，不亦乐乎！", "数据驱动决策是核心能力", "请各部门在周五前提交总结",
    "课程目标：掌握基本概念并能够独立完成练习", "第一章 绪论", "（详见附录二）", "“以客户为中心”是我们的价值观",
    "注意：本节内容为重点、难点，需要反复练习。", "综上所述，方案可行；但仍需关注风险……", "一、二、三、四、五、六、七、八、九、十",
    "《三国演义》和《红楼梦》", "实验结果表明——该方法有效", "其次，", "最后。", "因此",
]
EN = [
    "The quick brown fox jumps over the lazy dog.", "Revenue grew year over year.", "Machine learning",
    "internationalization and localization", "Please submit your report by Friday.", "AI Assistant", "Python + SQL",
    "Key Performance Indicators (KPI)", "e.g.", "Q3 2024", "OKR", "customer-centric", "well-known", "state-of-the-art",
    "https://www.example.com/docs/index.html", "A/B testing", "Section 3.2.1", "CEO, CFO, CTO",
]
NUM = ["18.6%", "1,250", "¥36.8", "$12.58M", "2024", "08:30", "3.14159", "+21.3%", "-3.2%", "No.1", "100万", "45分钟", "2024-10-22"]
PUNCT_CN = ["，", "。", "、", "；", "：", "？", "！", "（", "）", "“", "”", "《", "》", "——", "……"]


def fragment(rnd: random.Random, kind: str) -> str:
    if kind == "cn":
        return rnd.choice(CN)
    if kind == "en":
        return rnd.choice(EN)
    return rnd.choice(CN + EN + NUM + PUNCT_CN)


def paragraph(rnd: random.Random) -> tuple[str, str]:
    kind = rnd.choice(["cn", "cn", "mix", "mix", "en"])
    n = rnd.randint(1, 6)
    parts = []
    for _ in range(n):
        f = fragment(rnd, kind)
        # 混排时中英文之间有时加空格，有时不加（真实课件两种都多）
        if parts and kind != "cn" and rnd.random() < 0.6:
            parts.append(" ")
        parts.append(f)
        if kind == "cn" and rnd.random() < 0.3:
            parts.append(rnd.choice(NUM))
    return kind, "".join(parts)


SHAPES = {"rect": 1, "roundRect": 5, "ellipse": 9}


def enrich(s, tr, rnd: random.Random, size: float) -> dict:
    """--rich 的随机变化：返回记到答案里的参数"""
    extra = {}
    if rnd.random() < 0.25:
        tr.Font.Bold = -1
        extra["bold"] = True
    if rnd.random() < 0.2:
        spc = rnd.choice([-1, -0.5, 1, 2, 3])
        s.TextFrame2.TextRange.Font.Spacing = spc
        extra["spc"] = spc
    if rnd.random() < 0.25 and tr.Length > 4:
        # 同一段里一部分字换字号
        a = rnd.randint(1, tr.Length - 2)
        n = rnd.randint(1, min(12, tr.Length - a))
        sz = rnd.choice([size * 0.6, size * 1.5, size * 2])
        tr.Characters(a, n).Font.Size = round(sz)
        extra["mixSize"] = [a, n, round(sz)]
    if rnd.random() < 0.15:
        s.TextFrame2.AutoSize = 2  # 溢出时缩小文字
        extra["shrink"] = True
    return extra


def make_box(slide, rnd: random.Random, x: float, y: float, w: float, h: float, rich: bool = False) -> dict:
    latin, ea = rnd.choice(FONTS)
    size = rnd.choice([10, 12, 14, 16, 18, 20, 24, 28, 32, 40])
    width = rnd.choice([w * 0.35, w * 0.5, w * 0.7, w])
    algn = rnd.choice(["l", "l", "l", "ctr", "r", "just", "just", "dist"])
    paras = [paragraph(rnd) for _ in range(rnd.randint(1, 3))]
    text = "\r".join(p[1] for p in paras)
    shape = rnd.choice(["text", "text", "rect", "roundRect", "ellipse"]) if rich else "text"
    if shape == "text":
        s = slide.Shapes.AddTextbox(1, x, y, width, h)
    else:
        s = slide.Shapes.AddShape(SHAPES[shape], x, y, width, h)
        s.Fill.Visible = 0
        s.Line.ForeColor.RGB = 0x999999
        s.TextFrame.TextRange.Font.Color.RGB = 0
    tf = s.TextFrame
    tf.WordWrap = -1
    tf.AutoSize = 0
    tr = tf.TextRange
    tr.Text = text
    tr.Font.Name = latin
    tr.Font.NameFarEast = ea
    tr.Font.Size = size
    tr.LanguageID = 2052 if any(p[0] != "en" for p in paras) else 1033
    tr.ParagraphFormat.Alignment = ALIGN[algn]
    indent = rnd.choice(["none", "none", "first", "hanging", "bullet"])
    lv = tf.Ruler.Levels(1)
    if indent == "first":
        lv.FirstMargin, lv.LeftMargin = size * 2, 0
    elif indent == "hanging":
        lv.FirstMargin, lv.LeftMargin = 0, size * 2
    elif indent == "bullet":
        tr.ParagraphFormat.Bullet.Visible = -1
        tr.ParagraphFormat.Bullet.Character = 8226
        lv.FirstMargin, lv.LeftMargin = 0, size * 1.2
    if rnd.random() < 0.3:
        tr.ParagraphFormat.SpaceWithin = rnd.choice([0.9, 1.2, 1.5])
    extra = enrich(s, tr, rnd, size) if rich else {}
    s.Height = h
    lines = []
    i = 1
    while i < 500:
        ln = tr.Lines(i, 1)
        if ln.Length == 0:
            break
        lines.append(ln.Text)
        i += 1
    return {"id": s.Id, "font": [latin, ea], "size": size, "width": round(width, 2), "algn": algn, "indent": indent,
            "shape": shape, **extra, "text": text, "lines": lines}


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    rich = "--rich" in sys.argv
    seed = int(args[0])
    pages = int(args[1]) if len(args) > 1 else 40
    rnd = random.Random(seed)
    OUT.mkdir(parents=True, exist_ok=True)
    pythoncom.CoInitialize()
    app = win32com.client.DispatchEx("PowerPoint.Application")
    boxes = []
    try:
        p = app.Presentations.Add(0)
        p.PageSetup.SlideWidth, p.PageSetup.SlideHeight = 960, 540
        for k in range(pages):
            slide = p.Slides.Add(k + 1, 12)
            # 每页按格子放文本框：3 列（格宽 300 磅）、2 列（460 磅）或 1 列（940 磅），框宽在格宽的 35%~100% 里随机
            cols = rnd.choice([3, 3, 2, 1])
            cw = (940 - (cols - 1) * 10) / cols
            for r in range(4):
                for c in range(cols):
                    b = make_box(slide, rnd, 10 + c * (cw + 10), 8 + r * 133, cw, 125, rich)
                    b["slide"] = k + 1
                    boxes.append(b)
        path = OUT / f"{seed}.pptx"
        p.SaveAs(str(path))
        p.Close()
    finally:
        try:
            app.Quit()
        except Exception:
            pass
    (OUT / f"{seed}.json").write_text(json.dumps({"seed": seed, "boxes": boxes}, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"{len(boxes)} 个文本框 -> {path}")


if __name__ == "__main__":
    t0 = time.time()
    main()
    print(f"用时 {time.time() - t0:.0f} 秒")
