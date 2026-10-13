"""用本机 PowerPoint 测出 54 种预设图案填充（a:pattFill prst）的 8×8 点阵，生成 packages/transcoder/src/style/patterns-data.ts。

实测结论（2026-10-13）：
- 图案的一个点 = 0.75 磅 = 1 个 96 DPI 像素，随缩放一起缩放；
- 图案从幻灯片左上角开始平铺（不是从形状左上角）。

用法：python tools/gen-patterns.py（运行前关闭自己打开的 PowerPoint）
"""
from __future__ import annotations

import re
import sys
import zipfile
from pathlib import Path

import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import CACHE, ROOT  # noqa: E402

import pythoncom  # noqa: E402
import win32com.client  # noqa: E402

OUT = ROOT / "packages/transcoder/src/style/patterns-data.ts"
WORK = CACHE / "patterns"
COLS = 8
W, H = 2560, 1440          # 960×540 磅的幻灯片导出成 2560 宽：一个图案点正好 2×2 像素


def make() -> tuple[Path, Path]:
    WORK.mkdir(parents=True, exist_ok=True)
    pptx, png = WORK / "patterns.pptx", WORK / "patterns.png"
    pythoncom.CoInitialize()
    app = win32com.client.DispatchEx("PowerPoint.Application")
    try:
        p = app.Presentations.Add(0)
        p.PageSetup.SlideWidth = 960
        p.PageSetup.SlideHeight = 540
        s = p.Slides.Add(1, 12)
        for i in range(1, 55):     # MsoPatternType 1~54
            k = i - 1
            sh = s.Shapes.AddShape(1, 20 + (k % COLS) * 115, 20 + (k // COLS) * 75, 100, 62)
            sh.Line.Visible = 0
            sh.Fill.Patterned(i)
            sh.Fill.ForeColor.RGB = 0
            sh.Fill.BackColor.RGB = 0xFFFFFF
        if pptx.exists():
            pptx.unlink()
        p.SaveAs(str(pptx))
        s.Export(str(png), "PNG", W, H)
        p.Close()
    finally:
        app.Quit()
    return pptx, png


def extract(pptx: Path, png: Path) -> dict[str, str]:
    names = re.findall(r'<a:pattFill prst="(\w+)"', zipfile.ZipFile(pptx).read("ppt/slides/slide1.xml").decode())
    im = np.asarray(Image.open(png).convert("L")).astype(int)
    scale = W / 960                           # 图像像素 / 磅
    out: dict[str, str] = {}
    for k, name in enumerate(names):
        x, y = 20 + (k % COLS) * 115, 20 + (k // COLS) * 75
        best = None
        for ox in (0, 1):
            for oy in (0, 1):
                x0 = int((x + 8) * scale) // 2 * 2 + ox
                y0 = int((y + 8) * scale) // 2 * 2 + oy
                cells = im[y0:y0 + 2 * 40:2, x0:x0 + 2 * 96:2] < 128
                gi, gj = (y0 - oy) // 2, (x0 - ox) // 2     # 相对幻灯片原点的网格坐标
                acc = np.zeros((8, 8)); cnt = np.zeros((8, 8))
                for a in range(cells.shape[0]):
                    for b in range(cells.shape[1]):
                        acc[(gi + a) % 8, (gj + b) % 8] += cells[a, b]
                        cnt[(gi + a) % 8, (gj + b) % 8] += 1
                f = acc / cnt
                err = np.minimum(f, 1 - f).sum()
                if best is None or err < best[0]:
                    best = (err, f > 0.5)
        if best[0] > 0.5:
            raise SystemExit(f"{name}：点阵不一致（{best[0]:.2f}），检查导出图")
        out[name] = "".join(f"{int(''.join('1' if c else '0' for c in row), 2):02x}" for row in best[1])
    return out


def main():
    tiles = extract(*make())
    lines = [f"  {k}: '{v}'," for k, v in sorted(tiles.items())]
    OUT.write_text(
        "// 由 tools/gen-patterns.py 用本机 PowerPoint 实测生成，不要手改。\n"
        "// 每种图案 8 行，每行一个字节（高位在左），1 = 前景色；图案从幻灯片左上角开始平铺，一个点 = 1 像素（96 DPI）。\n"
        "export const PATTERNS: Record<string, string> = {\n" + "\n".join(lines) + "\n};\n",
        encoding="utf-8", newline="\n")
    print(f"生成 {OUT.relative_to(ROOT)}：{len(tiles)} 种图案")


if __name__ == "__main__":
    main()
