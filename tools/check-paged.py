"""按需加载形式的端到端检查：同一个 pptx 转成 single 和 pages 两种形式，
① 逐页截图必须逐像素一致；② 一路按键往下翻，每一步的（页, 步）必须一致；③ 打开时只加载要看的页（加预加载的下一页）；
④ 每页单独的 HTML 能打开、只有一页；⑤ 缩略图文件夹：每页一个，用 <img> 显示和正式画面缩小后接近。

用法：.venv/Scripts/python tools/check-paged.py [用例名 ...]（默认几个有图片、字体、动画、隐藏页的用例）
"""
import json
import shutil
import subprocess
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageChops
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / ".cache" / "check-paged"
CASES = sys.argv[1:] or ["charts-basic", "pictures", "text-embedded-fonts", "hidden-slides", "emf-images", "anim-basic", "transitions", "picture-recolor", "fills-texture", "media-video", "shapes-styles"]
# 缩略图和缩小后的正式画面的平均像素差（0~255）上限：字体回退、缩小算法不同会有少量差别
THUMB_ERR = 6
READY = 'window.unppt !== undefined && document.querySelector(".unppt-slide") && !document.querySelector(".unppt-loading")'
STATE = 'async () => { const s = await window.unppt.getState(); return [s.slide, s.step, s.slideCount] }'


def convert(src: Path, out: Path):
    cli = ["node", "packages/transcoder/dist/cli.js", "convert", str(src), "--system-fonts", "-q"]
    subprocess.run(cli + ["-o", str(out / "single.html")], check=True, cwd=ROOT)
    subprocess.run(cli + ["--output", "pages", "-o", str(out / "paged")], check=True, cwd=ROOT)


def open_at(page, url: str):
    page.goto(url)
    page.wait_for_function(READY, timeout=20000)
    page.evaluate("document.fonts.ready")
    page.wait_for_timeout(150)


def walk(page, url: str, n: int):
    open_at(page, url + "?timings=0&ui=0")
    seq = []
    for _ in range(n):
        page.keyboard.press("ArrowRight")
        page.wait_for_timeout(60)
        page.wait_for_function(READY, timeout=20000)
        seq.append(tuple(page.evaluate(STATE)[:2]))
    return seq


def check(page, name: str) -> list[str]:
    out = OUT / name
    shutil.rmtree(out, ignore_errors=True)
    out.mkdir(parents=True)
    convert(ROOT / "testcases" / f"{name}.pptx", out)
    single = (out / "single.html").resolve().as_uri()
    paged = (out / "paged" / "index.html").resolve().as_uri()
    errors = []
    # ③ 只加载要看的页
    reqs: list[str] = []
    page.on("request", lambda r: reqs.append(r.url))
    open_at(page, paged)
    page.wait_for_timeout(300)
    n = page.evaluate(STATE)[2]
    loaded = [u for u in reqs if "/pages/" in u]
    if len(loaded) > 2:
        errors.append(f"打开时加载了 {len(loaded)} 页")
    # ① 逐页截图
    for i in range(n):
        shots = []
        for url, tag in ((single, "s"), (paged, "p")):
            open_at(page, url + f"?slide={i}&step=0&ui=0")
            p = out / f"{tag}-{i}.png"
            page.screenshot(path=str(p))
            shots.append(Image.open(p).convert("RGB"))
        if ImageChops.difference(*shots).getbbox():
            errors.append(f"第 {i + 1} 页画面不同")
    # ② 翻页过程
    steps = min(30, n * 4 + 3)
    if walk(page, single, steps) != walk(page, paged, steps):
        errors.append("翻页过程不同")
    # ⑤ 缩略图：<img> 显示（不加载别的文件），和正式画面缩小到同样大小比较
    idx = json.loads((out / "paged" / "thumbs" / "index.json").read_text(encoding="utf-8"))
    if len(idx["pages"]) != n:
        errors.append(f"缩略图 {len(idx['pages'])} 张，应为 {n}")
    tw, th = idx["width"], idx["height"]
    for i, pg in enumerate(idx["pages"]):
        (out / "paged" / f"thumb-{i}.html").write_text(f'<html><body style="margin:0"><img src="thumbs/{pg["file"]}"></body></html>', encoding="utf-8")
        page.set_viewport_size({"width": tw, "height": th})
        page.goto((out / "paged" / f"thumb-{i}.html").resolve().as_uri())
        page.wait_for_timeout(300)
        t = out / f"t-{i}.png"
        page.screenshot(path=str(t))
        # 对照画面：这一页所有对象都显示（缩略图不管动画，和 PowerPoint 左侧缩略图一样）
        page.set_viewport_size({"width": 1280, "height": 720})
        open_at(page, paged + f"?slide={i}&step=0&ui=0&timings=0")
        page.evaluate("document.querySelectorAll('.unppt-hide').forEach((e) => e.classList.remove('unppt-hide'))")
        full = out / f"f-{i}.png"
        page.screenshot(path=str(full))
        a = np.asarray(Image.open(t).convert("RGB"), dtype=float)
        bimg = np.asarray(Image.open(full).convert("RGB").resize((tw, th), Image.LANCZOS), dtype=float)
        err = float(np.abs(a - bimg).mean())
        if err > THUMB_ERR:
            errors.append(f"第 {i + 1} 页缩略图和画面差别大（平均 {err:.1f}）")
    page.set_viewport_size({"width": 1280, "height": 720})
    # ④ 单页 HTML
    open_at(page, (out / "paged" / "page-001.html").resolve().as_uri() + "?ui=0")
    if page.evaluate(STATE)[2] != 1:
        errors.append("page-001.html 不是一页")
    return errors


def main():
    subprocess.run(["npm", "run", "build"], check=True, cwd=ROOT, shell=True, capture_output=True)
    bad = 0
    with sync_playwright() as pw:
        b = pw.chromium.launch()
        for name in CASES:
            page = b.new_page(viewport={"width": 1280, "height": 720})
            errs = check(page, name)
            page.close()
            print(f"{name}: {'通过' if not errs else '；'.join(errs)}")
            bad += bool(errs)
        b.close()
    sys.exit(1 if bad else 0)


if __name__ == "__main__":
    main()
