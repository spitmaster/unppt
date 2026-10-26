"""实测 PowerPoint 怎么显示没嵌入 ICC 配置文件的 CMYK JPEG，生成 packages/transcoder/src/media/cmyk-default-data.ts。

做法：9^4 个油墨组合（每个通道 0、32、64 … 255）做成色块，每块 8×8 像素、和 JPEG 的 8×8 块对齐（质量 100，块里只有直流分量，
颜色不受压缩影响），1:1 放进 13.33 英寸宽的页面，导出 1280 宽的 BMP，取每块中间 4×4 像素的平均颜色。
表的顺序：C 变化最慢、K 最快，每格 3 个字节（sRGB），base64 存进 TS。

用法（会启动 PowerPoint，几个人同时用时先拿锁）：python tools/powerpoint/cmyk_lut.py
"""
from __future__ import annotations

import base64
import sys
import tempfile
from pathlib import Path

import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from common import ROOT  # noqa: E402

G = 9
COLS = 81
OUT = ROOT / "packages/transcoder/src/media/cmyk-default-data.ts"


def patches() -> np.ndarray:
    pts = np.round(np.arange(G) * 255 / (G - 1)).astype(np.uint8)
    img = np.zeros((G ** 4 // COLS * 8, COLS * 8, 4), np.uint8)
    for i in range(G ** 4):
        c, m, y, k = (i // G ** 3) % G, (i // G ** 2) % G, (i // G) % G, i % G
        r, q = divmod(i, COLS)
        img[r * 8:(r + 1) * 8, q * 8:(q + 1) * 8] = [pts[c], pts[m], pts[y], pts[k]]
    return img


def measure(work: Path) -> np.ndarray:
    import pythoncom
    import win32com.client
    jpg = work / "patches.jpg"
    # Pillow 存 CMYK 时按 Adobe 的习惯取反（文件里 255 = 没有油墨），交给它的是油墨量；不嵌入 ICC 配置文件
    Image.fromarray(patches(), "CMYK").save(jpg, "JPEG", quality=100, subsampling=0)
    bmp = work / "out.bmp"
    pythoncom.CoInitialize()
    app = win32com.client.DispatchEx("PowerPoint.Application")
    try:
        p = app.Presentations.Add(0)
        p.PageSetup.SlideWidth = 960
        p.PageSetup.SlideHeight = 540
        s = p.Slides.Add(1, 12)
        side = COLS * 8 * 0.75
        s.Shapes.AddPicture(str(jpg), 0, -1, 24, 12, side, side)
        s.Export(str(bmp), "BMP", 1280, 720)
        p.Saved = True
        p.Close()
    finally:
        if app.Presentations.Count == 0:
            app.Quit()
    out = np.asarray(Image.open(bmp).convert("RGB")).astype(np.float64)
    lut = np.zeros((G ** 4, 3), np.uint8)
    worst = 0.0
    for i in range(G ** 4):
        r, q = divmod(i, COLS)
        # 图片左上角在 (32, 16) 像素
        cell = out[16 + r * 8 + 2:16 + r * 8 + 6, 32 + q * 8 + 2:32 + q * 8 + 6].reshape(-1, 3)
        worst = max(worst, float(cell.std(0).max()))
        lut[i] = np.round(cell.mean(0))
    print(f"色块内最大标准差 {worst:.2f}（应接近 0）")
    return lut


def main():
    with tempfile.TemporaryDirectory() as d:
        lut = measure(Path(d))
    b64 = base64.b64encode(lut.tobytes()).decode()
    lines = [b64[i:i + 120] for i in range(0, len(b64), 120)]
    OUT.write_text(
        "// 由 tools/powerpoint/cmyk_lut.py 生成（PowerPoint 实测），不要手改。\n"
        "// 没嵌入 ICC 配置文件的 CMYK 油墨量（9 档，C 变化最慢、K 最快）-> PowerPoint 显示的 sRGB，每格 3 字节\n"
        "export const CMYK_DEFAULT =\n" + "\n".join(f"  '{x}'" + (" +" if i < len(lines) - 1 else ";") for i, x in enumerate(lines)) + "\n",
        encoding="utf-8", newline="\n")
    print("写好", OUT.relative_to(ROOT), "白", lut[0].tolist(), "黑（K 满）", lut[G - 1].tolist(), "青", lut[(G - 1) * G ** 3].tolist())


if __name__ == "__main__":
    main()
