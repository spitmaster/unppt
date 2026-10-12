"""比对：转码 -> 截图 -> 和 PowerPoint 参考图比对 -> 打分 -> 出报告。

用法：
  python tools/compare/run.py [--set testcases|daily|all] [--only 编号] [--no-build]

输出：
  .cache/report/index.html     可视化报告（参考图 / 我们的结果 / 差异图），只在本机
  .cache/report/results.json   每页每步的分数
  scores/summary.json          按类别汇总的分数（不含任何样本信息，可以提交）

样本安全：报告只在 .cache/ 里；样本一律用哈希编号。
"""
from __future__ import annotations

import argparse
import html
import json
import subprocess
import sys
import time
from pathlib import Path

import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from common import CACHE, REF, ROOT, read_json, testcase_index, update_index, write_json  # noqa: E402

OUT = CACHE / "out"
REPORT = CACHE / "report"
PASS_SSIM = 0.95          # 暂定的通过线（SPEC 待定事项）
DAILY_SIZE = 100          # 日常集的文件数上限


# ---------------------------------------------------------------- 打分

def _gray(img: Image.Image) -> np.ndarray:
    return np.asarray(img.convert("L"), dtype=np.float64)


def ssim(a: np.ndarray, b: np.ndarray) -> float:
    """8x8 分块的 SSIM 平均值（够用、快）。"""
    h, w = min(a.shape[0], b.shape[0]) // 8 * 8, min(a.shape[1], b.shape[1]) // 8 * 8
    a = a[:h, :w].reshape(h // 8, 8, w // 8, 8).swapaxes(1, 2).reshape(-1, 64)
    b = b[:h, :w].reshape(h // 8, 8, w // 8, 8).swapaxes(1, 2).reshape(-1, 64)
    ma, mb = a.mean(1), b.mean(1)
    va, vb = a.var(1), b.var(1)
    cov = ((a - ma[:, None]) * (b - mb[:, None])).mean(1)
    c1, c2 = (0.01 * 255) ** 2, (0.03 * 255) ** 2
    s = ((2 * ma * mb + c1) * (2 * cov + c2)) / ((ma ** 2 + mb ** 2 + c1) * (va + vb + c2))
    return float(s.mean())


def compare_images(ref_path: Path, ours_path: Path, diff_path: Path) -> dict:
    ref = Image.open(ref_path).convert("RGB")
    ours = Image.open(ours_path).convert("RGB")
    if ours.size != ref.size:
        ours = ours.resize(ref.size)
    ra = np.asarray(ref, dtype=np.int16)
    oa = np.asarray(ours, dtype=np.int16)
    d = np.abs(ra - oa).max(axis=2)
    diff_ratio = float((d > 40).mean())
    # 差异图：参考图变淡，差异处标红
    base = (np.asarray(ref.convert("L"), dtype=np.float64) * 0.35 + 165).astype(np.uint8)
    heat = np.stack([base, base, base], axis=2)
    mask = d > 40
    heat[mask] = [230, 30, 30]
    Image.fromarray(heat).save(diff_path)
    return {"ssim": round(ssim(_gray(ref), _gray(ours)), 4), "diff": round(diff_ratio, 4)}


# ---------------------------------------------------------------- 按形状诊断（只产出数字，不含文字内容）

OUR_SHAPES_JS = """() => {
  const out = {};
  for (const el of document.querySelectorAll('.unppt-slide [data-uid]')) {
    const uid = el.getAttribute('data-uid');
    if (!/^s\\d+$/.test(uid)) continue;
    const r = el.getBoundingClientRect();
    const lines = new Map();
    for (const t of el.querySelectorAll('text')) {
      if (t.getAttribute('data-bu')) continue;
      const y = Math.round(parseFloat(t.getAttribute('y')) * 10) / 10;
      const b = t.getBoundingClientRect();
      const l = lines.get(y) || { n: 0, x0: 1e9, y0: 1e9, x1: -1e9, y1: -1e9 };
      l.n += [...(t.textContent || '')].length;
      l.x0 = Math.min(l.x0, b.left); l.y0 = Math.min(l.y0, b.top);
      l.x1 = Math.max(l.x1, b.right); l.y1 = Math.max(l.y1, b.bottom);
      lines.set(y, l);
    }
    const ys = [...lines.keys()].sort((a, b) => a - b);
    out[uid] = { x: r.x, y: r.y, w: r.width, h: r.height, lineChars: ys.map((y) => lines.get(y).n),
      lineBoxes: ys.map((y) => { const l = lines.get(y); return [l.x0, l.y0, l.x1 - l.x0, l.y1 - l.y0]; }) };
  }
  return out;
}"""


def _flatten(shapes, out=None):
    out = [] if out is None else out
    for s in shapes:
        out.append(s)
        if s.get("children"):
            _flatten(s["children"], out)
    return out


def _ref_line_chars(lines) -> list[int]:
    """参考结果每行的字符数（去掉行尾换行符；用码点计数和我们这边一致）。"""
    out = []
    for ln in lines or []:
        if "error" in ln:
            return []
        t = ln.get("text", "").replace("\r", "").replace("\x0b", "").rstrip("\n")
        out.append(len(t))
    return out


def diagnose_shapes(page, ref, ref_slide, ref_png: Path, ours_png: Path) -> list[dict]:
    try:
        ours = page.evaluate(OUR_SHAPES_JS)
    except Exception:
        ours = {}
    k = ref["imageWidth"] / ref["slideWidthPt"]
    ra = _gray(Image.open(ref_png))
    oa = _gray(Image.open(ours_png).resize((ra.shape[1], ra.shape[0])))
    out = []
    for s in _flatten(ref_slide["shapes"]):
        if s.get("children") or not s.get("visible", True):
            continue
        x0, y0 = max(0, int(s["x"] * k)), max(0, int(s["y"] * k))
        x1, y1 = min(ra.shape[1], int((s["x"] + s["w"]) * k) + 1), min(ra.shape[0], int((s["y"] + s["h"]) * k) + 1)
        # 太小的区域（< 32 像素）按 8x8 块算相似度会被抗锯齿噪声主导，不计算，避免误导诊断
        if x1 - x0 < 32 or y1 - y0 < 32:
            region = None
        else:
            region = round(ssim(ra[y0:y1, x0:x1], oa[y0:y1, x0:x1]), 4)
        mine = ours.get(f"s{s['id']}")
        ref_lines = _ref_line_chars(s.get("lines"))
        item = {"id": s["id"], "type": s["type"], "auto": s.get("autoShapeType"), "region": region,
                "box": [round(s["x"], 1), round(s["y"], 1), round(s["w"], 1), round(s["h"], 1)],
                "found": mine is not None}
        if ref_lines or (mine and mine["lineChars"]):
            item["refLines"] = ref_lines
            item["ourLines"] = mine["lineChars"] if mine else []
            # 每行外框（单位：磅），只有数字
            item["refBoxes"] = [[ln.get("x"), ln.get("y"), ln.get("w"), ln.get("h")] for ln in s.get("lines") or [] if "error" not in ln]
            item["ourBoxes"] = [[round(v / k, 1) for v in b] for b in mine.get("lineBoxes", [])] if mine else []
        out.append(item)
    out.sort(key=lambda d: (d["region"] if d["region"] is not None else 1))
    return out


# ---------------------------------------------------------------- 流程

def build():
    r = subprocess.run(["node", "scripts/build.mjs"], cwd=ROOT, capture_output=True, text=True, encoding="utf-8")
    if r.returncode != 0:
        print(r.stdout, r.stderr)
        sys.exit(1)


EXTRA_ARGS: list[str] = []


def convert(src: Path, out: Path) -> dict:
    out.parent.mkdir(parents=True, exist_ok=True)
    t0 = time.time()
    r = subprocess.run(["node", "packages/transcoder/dist/cli.js", "convert", str(src), "-o", str(out), "--system-fonts", *EXTRA_ARGS],
                       cwd=ROOT, capture_output=True, text=True, encoding="utf-8", errors="replace")
    lines = [l.strip() for l in (r.stdout or "").splitlines()]
    return {
        "ok": r.returncode == 0,
        "error": (r.stderr or "").strip().splitlines()[-1:] if r.returncode else [],
        "warnings": [l[3:] for l in lines if l.startswith("提示：")],
        "missingFonts": next((l[5:].split("、") for l in lines if l.startswith("缺少字体：")), []),
        "seconds": round(time.time() - t0, 2),
    }


def targets(ref: dict) -> list[tuple[int, int, str]]:
    """要比对的 (我们的页号, 步骤, 参考图文件名)。隐藏页跳过。"""
    out = []
    ours = 0
    for s in ref["slides"]:
        if s.get("hidden"):
            continue
        n = s["index"] + 1
        if s.get("effects"):
            for k in range(s["steps"] + 1):
                out.append((ours, k, f"slide-{n:03d}-step-{k:02d}.png"))
        else:
            out.append((ours, 0, f"slide-{n:03d}.png"))
        ours += 1
    return out


def pick_items(set_name: str, only: str | None) -> list[dict]:
    items = []
    if set_name == "testcases":
        for name, v in testcase_index().items():
            items.append({"key": f"tc-{name}", "src": ROOT / v["paths"][0], "ref": ROOT / v["ref"]})
    else:
        index, _ = update_index()
        present = sorted(h for h, v in index.items() if v.get("present"))
        if set_name == "daily" and len(present) > DAILY_SIZE:
            # 先简单按哈希均匀取样；样本多了以后改成按特征分层（SPEC 待定事项）
            step = len(present) / DAILY_SIZE
            present = [present[int(i * step)] for i in range(DAILY_SIZE)]
        for h in present:
            ref = read_json(REF / h / "ref.json")
            if not ref or not ref.get("ok"):
                continue
            src = REF / h / "converted.pptx" if ref.get("converted") else ROOT / index[h]["paths"][0]
            items.append({"key": h, "src": src, "ref": REF / h})
    if only:
        items = [i for i in items if i["key"].startswith(only) or i["key"] == f"tc-{only}"]
    return items


def run(set_name: str, only: str | None, do_build: bool):
    from playwright.sync_api import sync_playwright

    if do_build:
        build()
    items = pick_items(set_name, only)
    if not items:
        print("没有可比对的文件（先运行 tools/powerpoint/export.py run）")
        return
    REPORT.mkdir(parents=True, exist_ok=True)
    shots = REPORT / "img"
    shots.mkdir(exist_ok=True)
    results = []
    with sync_playwright() as p:
        browser = p.chromium.launch()
        for it in items:
            ref = read_json(it["ref"] / "ref.json")
            out_html = OUT / it["key"] / "index.html"
            conv = convert(it["src"], out_html)
            entry = {"key": it["key"], "convert": conv, "pages": []}
            results.append(entry)
            if not conv["ok"]:
                print(f"{it['key']} 转码失败：{conv['error']}")
                continue
            w, h = ref["imageWidth"], ref["imageHeight"]
            page = browser.new_page(viewport={"width": w, "height": h})
            for slide, step, ref_name in targets(ref):
                ref_png = it["ref"] / ref_name
                if not ref_png.exists():
                    continue
                url = out_html.resolve().as_uri() + f"?slide={slide}&step={step}&ui=0"
                page.goto(url)
                page.wait_for_function("window.unppt !== undefined", timeout=20000)
                page.evaluate("document.fonts.ready")
                page.wait_for_timeout(50)
                stem = f"{it['key']}-{slide:03d}-{step:02d}"
                ours_png = shots / f"{stem}-ours.png"
                page.screenshot(path=str(ours_png))
                ref_copy = shots / f"{stem}-ref.png"
                if not ref_copy.exists() or ref_copy.stat().st_mtime < ref_png.stat().st_mtime:
                    Image.open(ref_png).save(ref_copy)
                score = compare_images(ref_png, ours_png, shots / f"{stem}-diff.png")
                ref_slide = next(s for s in ref["slides"] if f"slide-{s['index'] + 1:03d}" in ref_name)
                shapes = diagnose_shapes(page, ref, ref_slide, ref_png, ours_png)
                entry["pages"].append({"slide": slide, "step": step, "img": stem, **score, "shapes": shapes})
            page.close()
            pages = entry["pages"]
            avg = sum(p["ssim"] for p in pages) / len(pages) if pages else 0
            print(f"{it['key']}  {len(pages)} 张  平均相似度 {avg:.3f}  用时 {conv['seconds']}s")
        browser.close()
    write_json(REPORT / "results.json", results)
    summary = summarize(results, set_name)
    write_report(results, summary)
    if set_name in ("daily", "all", "testcases"):
        write_json(ROOT / "scores" / f"summary-{set_name}.json", summary)
    print(f"\n页面 {summary['pages']} 张，通过 {summary['passed']}（{summary['passRate']:.0%}），平均相似度 {summary['meanSsim']:.3f}")
    print(f"报告：{(REPORT / 'index.html').resolve()}")


def summarize(results: list[dict], set_name: str) -> dict:
    pages = [p for r in results for p in r["pages"]]
    warn_files: dict[str, int] = {}
    for r in results:
        for w in r["convert"]["warnings"]:
            k = w.split("（")[0]
            warn_files[k] = warn_files.get(k, 0) + 1
    fonts: dict[str, int] = {}
    for r in results:
        for f in r["convert"]["missingFonts"]:
            fonts[f] = fonts.get(f, 0) + 1
    passed = sum(1 for p in pages if p["ssim"] >= PASS_SSIM)
    return {
        "date": time.strftime("%Y-%m-%d %H:%M"),
        "set": set_name,
        "files": len(results),
        "failedToConvert": sum(1 for r in results if not r["convert"]["ok"]),
        "pages": len(pages),
        "passed": passed,
        "passRate": round(passed / len(pages), 4) if pages else 0,
        "meanSsim": round(sum(p["ssim"] for p in pages) / len(pages), 4) if pages else 0,
        "passLine": PASS_SSIM,
        # 只记录问题类别和出现的文件数，不含样本信息
        "issues": dict(sorted(warn_files.items(), key=lambda x: -x[1])),
        "missingFontCount": len(fonts),
    }


def write_report(results: list[dict], summary: dict):
    rows = []
    pages = sorted(((r["key"], p) for r in results for p in r["pages"]), key=lambda x: x[1]["ssim"])
    for key, p in pages:
        ok = "pass" if p["ssim"] >= PASS_SSIM else "fail"
        rows.append(f"""<div class="row {ok}"><div class="meta"><b>{html.escape(key)}</b> 第 {p['slide'] + 1} 页 第 {p['step']} 步
<br>相似度 <b>{p['ssim']:.3f}</b>　差异像素 {p['diff']:.1%}</div>
<figure><img loading="lazy" src="img/{p['img']}-ref.png"><figcaption>PowerPoint</figcaption></figure>
<figure><img loading="lazy" src="img/{p['img']}-ours.png"><figcaption>unppt</figcaption></figure>
<figure><img loading="lazy" src="img/{p['img']}-diff.png"><figcaption>差异</figcaption></figure></div>""")
    issues = "".join(f"<li>{html.escape(k)}：{v} 个文件</li>" for k, v in summary["issues"].items()) or "<li>无</li>"
    fonts: dict[str, int] = {}
    for r in results:
        for f in r["convert"]["missingFonts"]:
            fonts[f] = fonts.get(f, 0) + 1
    font_list = "".join(f"<li>{html.escape(k)}：{v} 个文件</li>" for k, v in sorted(fonts.items(), key=lambda x: -x[1])) or "<li>无</li>"
    doc = f"""<!doctype html><meta charset="utf-8"><title>unppt 比对报告</title>
<style>
body{{font:14px system-ui,sans-serif;margin:16px;background:#f5f5f5;color:#222}}
.sum{{background:#fff;padding:12px 16px;border-radius:6px;margin-bottom:12px}}
.row{{display:flex;gap:8px;align-items:flex-start;background:#fff;margin:8px 0;padding:8px;border-radius:6px;border-left:4px solid #c33}}
.row.pass{{border-left-color:#3a3}}
.meta{{width:180px;flex:none}}
figure{{margin:0;flex:1;min-width:0}} figure img{{width:100%;border:1px solid #ddd;display:block}}
figcaption{{font-size:12px;color:#666;text-align:center}}
</style>
<div class="sum"><h2>比对报告（{summary['set']}，{summary['date']}）</h2>
文件 {summary['files']} 个（转码失败 {summary['failedToConvert']}），页面 {summary['pages']} 张，
通过 {summary['passed']}（{summary['passRate']:.0%}，通过线相似度 ≥ {PASS_SSIM}），平均相似度 {summary['meanSsim']:.3f}
<h3>转码提示（按出现文件数）</h3><ul>{issues}</ul>
<h3>缺少的字体</h3><ul>{font_list}</ul></div>
{''.join(rows)}"""
    (REPORT / "index.html").write_text(doc, encoding="utf-8")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--set", default="daily", choices=["testcases", "daily", "all"])
    ap.add_argument("--only", default=None)
    ap.add_argument("--no-build", action="store_true")
    ap.add_argument("--embed-fonts", action="store_true", help="转码时嵌入字体子集")
    a = ap.parse_args()
    if a.embed_fonts:
        EXTRA_ARGS.append("--embed-fonts")
    run(a.set, a.only, not a.no_build)


if __name__ == "__main__":
    main()
