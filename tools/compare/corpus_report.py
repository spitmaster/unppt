"""全量课件测试报告：从 sweep_ab.py 的全量比对结果生成 docs/zh/test-report.md 和 docs/en/test-report.md（只有汇总数字）。

  python tools/compare/corpus_report.py --results .cache/sweep-rc-1026 [--base-dir .cache/sweep-ab-031 --base old] [--version 0.3.1]

- 测试语料：课件数、页数、保存软件、页面比例、每份页数；PowerPoint 自己打不开、导不出参考图的课件单独列出
- 还原度：逐页 SSIM 的分布、分位数、通过率，按页面特征（表格、图表、SmartArt……）、保存软件分开统计；和上一版逐页对比
- 稳定性：转码失败；速度：每份、每页转码耗时
- 合成用例：最近一次 run.py --set testcases 的结果（.cache/report/results.json），按类别统计
样本安全：报告里只有汇总统计，不出现任何单份课件的信息（文件名、哈希、内容都没有），可以提交。
每页特征从课件 XML 里提取，缓存在 .cache/corpus-features.json（本机，不提交）。
"""
from __future__ import annotations

import argparse
import json
import platform
import re
import statistics
import subprocess
import sys
import zipfile
from collections import Counter, defaultdict
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from common import REF, ROOT, read_json  # noqa: E402

PASS = 0.95
FEATURES = {
    "table": r"<a:tbl>",
    "chart": r"drawingml/2006/chart",
    "smartart": r"drawingml/2006/diagram",
    "group": r"<p:grpSp>",
    "picture": r"<p:pic>",
    "ole": r"<p:oleObj\b",
    "math": r"<m:oMath|a14:m>",
    "wordart": r"<a:prstTxWarp prst=\"(?!textNoShape)",
    "3d": r"<a:sp3d\b|<a:scene3d>",
    "shadow": r"<a:outerShdw\b",
    "glow": r"<a:glow\b",
    "vert-text": r"vert=\"(eaVert|vert|vert270|wordArtVert|mongolianVert|wordArtVertRtl)\"",
    "custgeom": r"<a:custGeom>",
    "autofit": r"<a:normAutofit\b",
    "gradient": r"<a:gradFill\b",
    "pattern": r"<a:pattFill\b",
    "media": r"<p14:media\b|<a:videoFile\b|<a:audioFile\b",
    "animation": r"<p:timing\b[^>]*>.*?<p:par\b",
    "transition": r"<p:transition\b",
}
LABELS = {
    "zh": {
        "table": "表格", "chart": "图表", "smartart": "SmartArt", "group": "组合", "picture": "图片", "ole": "OLE 对象",
        "math": "公式", "wordart": "艺术字变形", "3d": "三维效果", "shadow": "阴影", "glow": "发光", "vert-text": "竖排文字",
        "custgeom": "自由形状", "autofit": "文字自动缩放", "gradient": "渐变填充", "pattern": "图案填充", "media": "音视频",
        "animation": "有动画", "transition": "有切换效果", "emf/wmf": "EMF/WMF 图片", "svg-image": "SVG 图片", "(plain)": "以上都没有",
    },
    "en": {
        "table": "tables", "chart": "charts", "smartart": "SmartArt", "group": "groups", "picture": "pictures", "ole": "OLE objects",
        "math": "equations", "wordart": "WordArt warps", "3d": "3-D effects", "shadow": "shadows", "glow": "glow", "vert-text": "vertical text",
        "custgeom": "freeform shapes", "autofit": "text autofit", "gradient": "gradient fills", "pattern": "pattern fills", "media": "audio/video",
        "animation": "animations", "transition": "transitions", "emf/wmf": "EMF/WMF pictures", "svg-image": "SVG pictures", "(plain)": "none of these",
    },
}


def source(h: str, index: dict) -> Path:
    ref = read_json(REF / h / "ref.json", {}) or {}
    return REF / h / "converted.pptx" if ref.get("converted") else ROOT / index[h]["paths"][0]


def app_of(z: zipfile.ZipFile) -> str:
    """保存这份课件的软件：PowerPoint（Windows / Mac）、WPS、其它"""
    try:
        x = z.read("docProps/app.xml").decode("utf-8", "replace")
    except KeyError:
        return "other"
    m = re.search(r"<Application>([^<]*)</Application>", x)
    a = (m.group(1) if m else "").lower()
    if "wps" in a or "kingsoft" in a:
        return "wps"
    if "macintosh" in a:
        return "ppt-mac"
    if "powerpoint" in a:
        return "ppt-win"
    return "other"


def deck_info(src: Path) -> dict:
    """一份课件的元数据和每页特征（按 presentation.xml 的页序）"""
    z = zipfile.ZipFile(src)
    pres = z.read("ppt/presentation.xml").decode("utf-8", "replace")
    rels = z.read("ppt/_rels/presentation.xml.rels").decode("utf-8", "replace")
    m = re.search(r"<p:sldSz\b[^>]*cx=\"(\d+)\"[^>]*cy=\"(\d+)\"", pres)
    ratio = round(int(m.group(1)) / int(m.group(2)), 2) if m else 0
    targets = dict(re.findall(r"<Relationship\b[^>]*Id=\"(rId\d+)\"[^>]*Target=\"([^\"]+)\"", rels))
    targets.update({k: v for v, k in re.findall(r"<Relationship\b[^>]*Target=\"([^\"]+)\"[^>]*Id=\"(rId\d+)\"", rels)})
    pages = []
    for rid in re.findall(r"<p:sldId\b[^>]*r:id=\"(rId\d+)\"", pres):
        path = "ppt/" + targets.get(rid, "").lstrip("/").replace("ppt/", "")
        feats = []
        try:
            s = z.read(path).decode("utf-8", "replace")
            feats = [k for k, rx in FEATURES.items() if re.search(rx, s, re.S)]
            relp = path.replace("slides/", "slides/_rels/") + ".rels"
            if relp in z.namelist():
                r = z.read(relp).decode("utf-8", "replace").lower()
                if ".emf" in r or ".wmf" in r:
                    feats.append("emf/wmf")
                if ".svg" in r:
                    feats.append("svg-image")
        except KeyError:
            pass
        pages.append(feats)
    return {"app": app_of(z), "ratio": ratio, "pages": pages}


def features(hashes: list, index: dict) -> dict:
    cache_p = ROOT / ".cache" / "corpus-features.json"
    cache = read_json(cache_p, {}) or {}
    todo = [h for h in hashes if h not in cache]
    for k, h in enumerate(todo, 1):
        try:
            cache[h] = deck_info(source(h, index))
        except Exception:
            cache[h] = {"app": "other", "ratio": 0, "pages": []}
        if k % 500 == 0:
            print(f"  特征 {k}/{len(todo)}", flush=True)
    if todo:
        cache_p.write_text(json.dumps(cache), encoding="utf-8")
    return cache


def load(d: str) -> dict:
    out = {}
    for line in (Path(d) / "results.jsonl").read_text(encoding="utf-8").splitlines():
        if line.strip():
            r = json.loads(line)
            out[r["h"]] = r
    return out


def pct(xs: list, q: float) -> float:
    xs = sorted(xs)
    return xs[min(len(xs) - 1, max(0, round(q * (len(xs) - 1))))] if xs else 0.0


def environment() -> dict:
    def ps(cmd: str) -> str:
        try:
            return subprocess.run(["powershell", "-NoProfile", "-c", cmd], capture_output=True, text=True, errors="replace").stdout.strip()
        except Exception:
            return ""
    cpu = ps("(Get-CimInstance Win32_Processor | Select -First 1).Name")
    cores = ps("(Get-CimInstance Win32_Processor | Measure-Object -Property NumberOfLogicalProcessors -Sum).Sum")
    ram = ps("[math]::Round((Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory / 1GB)")
    ppt = ps("(Get-ItemProperty 'Registry::HKEY_CLASSES_ROOT\\PowerPoint.Application\\CurVer').'(default)'")
    node = subprocess.run(["node", "-v"], capture_output=True, text=True).stdout.strip()
    return {"cpu": cpu, "cores": cores, "ram": ram, "os": platform.platform(), "node": node, "ppt": ppt}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--results", required=True, help="sweep_ab.py run 的结果目录（新版）")
    ap.add_argument("--new", default="new")
    ap.add_argument("--base-dir", default=None, help="上一版的结果目录（可选）")
    ap.add_argument("--base", default="old")
    ap.add_argument("--base-label", default="0.2.6")
    ap.add_argument("--version", default="")
    a = ap.parse_args()

    index = read_json(ROOT / ".cache" / "samples.json", {}) or {}
    rows = load(a.results)
    base = load(a.base_dir) if a.base_dir else {}
    hashes = sorted(rows)
    feats = features(hashes, index)
    no_ref = sum(1 for v in index.values() if v.get("status") != "ok")

    # 逐页汇总
    scores, times, per_page_ms = [], [], []
    by_feat, by_app, by_ratio = defaultdict(list), defaultdict(list), defaultdict(list)
    deck_pages, app_decks, ratio_decks = [], Counter(), Counter()
    better = worse = same = 0
    bscores, fails = [], 0
    for h in hashes:
        v = rows[h]["variants"].get(a.new, {})
        if not v.get("ok"):
            fails += 1
            continue
        s = v.get("ssim", {})
        info = feats.get(h, {"app": "other", "ratio": 0, "pages": []})
        app_decks[info["app"]] += 1
        rk = "16:9" if abs(info["ratio"] - 1.78) < 0.03 else "4:3" if abs(info["ratio"] - 1.33) < 0.03 else "16:10" if abs(info["ratio"] - 1.6) < 0.03 else "other"
        ratio_decks[rk] += 1
        deck_pages.append(rows[h].get("slides") or len(s))
        if s:
            times.append(v["ms"])
            per_page_ms.append(v["ms"] / max(1, len(s)))
        bs = base.get(h, {}).get("variants", {}).get(a.base, {}).get("ssim", {}) if base else {}
        for n, x in s.items():
            scores.append(x)
            pf = info["pages"][int(n) - 1] if int(n) - 1 < len(info["pages"]) else []
            for f in (pf or ["(plain)"]):
                by_feat[f].append(x)
            by_app[info["app"]].append(x)
            by_ratio[rk].append(x)
            if n in bs:
                bscores.append(bs[n])
                d = x - bs[n]
                better += d > 0.005
                worse += d < -0.005
                same += abs(d) <= 0.005
    n_pages = len(scores)
    env = environment()
    today = date.today().isoformat()
    buckets = [(0, 0.80), (0.80, 0.85), (0.85, 0.90), (0.90, 0.95), (0.95, 0.98), (0.98, 1.01)]
    tc = read_json(ROOT / ".cache" / "report" / "results.json", []) or []
    tcat = defaultdict(list)
    for c in tc:
        cat = re.sub(r"^tc-", "", c["key"]).split("-")[0]
        for p in c["pages"]:
            tcat[cat].append(p["ssim"])
    tc_all = [x for xs in tcat.values() for x in xs]

    def write(lang: str) -> None:
        L = LABELS[lang]
        zh = lang == "zh"
        o = []
        w = o.append
        mean = statistics.fmean(scores)
        if zh:
            w(f"[English](../en/test-report.md)\n\n# 测试报告{(' ' + a.version) if a.version else ''}\n")
            w(f"> 由 `tools/compare/corpus_report.py` 根据全量比对结果自动生成（{today}）。只含汇总统计，不含任何单份课件的信息。"
              f"测量方法见 [还原度](fidelity.md)。\n")
            w("## 一句话结论\n")
            w(f"- **{len(hashes)} 份真实课件、{n_pages} 页**全部转码，**转码失败 {fails} 份**。")
            w(f"- 逐页和 Microsoft PowerPoint 导出的图片比较：**平均 SSIM {mean:.4f}**，**{sum(x >= PASS for x in scores) / n_pages:.1%} 的页 SSIM ≥ {PASS}**，"
              f"{sum(x >= 0.90 for x in scores) / n_pages:.1%} 的页 ≥ 0.90。")
            if bscores:
                w(f"- 和上一版 {a.base_label} 逐页比：变好 {better} 页、变差 {worse} 页、持平 {same} 页（差别 ≤ 0.005 算持平）；"
                  f"同一批页 {a.base_label} 平均 {statistics.fmean(bscores):.4f}。")
            if tc_all:
                w(f"- 合成测试用例 {len(tc)} 份 / {len(tc_all)} 页：平均 SSIM {statistics.fmean(tc_all):.4f}，"
                  f"{sum(x >= PASS for x in tc_all) / len(tc_all):.1%} 的页 ≥ {PASS}。")
            w(f"- 转码耗时（单线程出整页图、和其它任务同时运行，偏保守）：每份中位数 {statistics.median(times) / 1000:.1f} 秒，"
              f"每页中位数 {statistics.median(per_page_ms):.0f} 毫秒。\n")
        else:
            w(f"[中文](../zh/test-report.md)\n\n# Test report{(' ' + a.version) if a.version else ''}\n")
            w(f"> Generated by `tools/compare/corpus_report.py` from the full-corpus comparison ({today}). Aggregate statistics only; "
              f"nothing identifies an individual deck. Method: see [Fidelity](fidelity.md).\n")
            w("## Summary\n")
            w(f"- **{len(hashes)} real-world decks, {n_pages} slides** converted; **{fails} conversion failures**.")
            w(f"- Compared slide by slide with images exported by Microsoft PowerPoint: **mean SSIM {mean:.4f}**, "
              f"**{sum(x >= PASS for x in scores) / n_pages:.1%} of slides at SSIM ≥ {PASS}**, {sum(x >= 0.90 for x in scores) / n_pages:.1%} ≥ 0.90.")
            if bscores:
                w(f"- Against the previous release {a.base_label}, slide by slide: {better} better, {worse} worse, {same} unchanged (|Δ| ≤ 0.005); "
                  f"{a.base_label} mean on the same slides {statistics.fmean(bscores):.4f}.")
            if tc_all:
                w(f"- Synthetic test cases: {len(tc)} files / {len(tc_all)} slides, mean SSIM {statistics.fmean(tc_all):.4f}, "
                  f"{sum(x >= PASS for x in tc_all) / len(tc_all):.1%} ≥ {PASS}.")
            w(f"- Conversion time (single render thread, run alongside other jobs, so conservative): median {statistics.median(times) / 1000:.1f} s per deck, "
              f"{statistics.median(per_page_ms):.0f} ms per slide.\n")

        # 测试语料
        w("## 测试语料\n" if zh else "## Test corpus\n")
        w(("真实课件来自用户的课件库（只在本机，不外传）。" if zh else "Real-world decks from the owner's courseware library (kept locally, never uploaded). ")
          + (f"另有 {no_ref} 份连 PowerPoint 自己都打不开或导不出图片，没有参考答案，不计入。\n" if zh else
             f"{no_ref} more decks could not be opened or exported by PowerPoint itself and have no reference; they are excluded.\n"))
        w("| 项目 | 数量 |\n|---|---|" if zh else "| Item | Count |\n|---|---|")
        w(f"| {'课件' if zh else 'Decks'} | {len(hashes)} |")
        w(f"| {'页' if zh else 'Slides'} | {n_pages} |")
        w(f"| {'每份页数（中位数 / 90% / 最多）' if zh else 'Slides per deck (median / p90 / max)'} | {statistics.median(deck_pages):.0f} / {pct(deck_pages, 0.9):.0f} / {max(deck_pages)} |")
        names = {"ppt-win": "PowerPoint (Windows)", "ppt-mac": "PowerPoint (Mac)", "wps": "WPS", "other": "其它" if zh else "other"}
        for k, c in app_decks.most_common():
            w(f"| {'保存软件：' if zh else 'Saved by: '}{names[k]} | {c} |")
        for k, c in ratio_decks.most_common():
            w(f"| {'页面比例：' if zh else 'Slide ratio: '}{k} | {c} |")
        w("")

        # 还原度分布
        w("## 还原度：逐页 SSIM 分布\n" if zh else "## Fidelity: per-slide SSIM distribution\n")
        w("| SSIM | " + ("页数 | 占比 |" if zh else "Slides | Share |") + "\n|---|---|---|")
        for lo, hi in buckets:
            c = sum(lo <= x < hi for x in scores)
            label = f"≥ {lo:.2f}" if hi > 1 else (f"< {hi:.2f}" if lo == 0 else f"{lo:.2f} – {hi:.2f}")
            w(f"| {label} | {c} | {c / n_pages:.1%} |")
        w("")
        w(("分位数：" if zh else "Percentiles: ") + "，".join(f"P{int(q * 100)} {pct(scores, q):.4f}" for q in (0.05, 0.1, 0.25, 0.5, 0.75)) + "\n")

        # 按页面特征
        w("## 按页面内容分开统计\n" if zh else "## By slide content\n")
        w(("一页可能同时属于多类。" if zh else "A slide can be in several rows. ")
          + (f"\"比 {a.base_label}\" 是同一批页上一版的平均分。\n" if zh and bscores else f"\"vs {a.base_label}\" is the previous release's mean on the same slides.\n" if bscores else "\n"))
        head = ("| 页面内容 | 页数 | 平均 SSIM | ≥ 0.95 | ≥ 0.90 |" if zh else "| Slide content | Slides | Mean SSIM | ≥ 0.95 | ≥ 0.90 |")
        w(head + "\n|---|---|---|---|---|")
        for f, xs in sorted(by_feat.items(), key=lambda kv: -len(kv[1])):
            w(f"| {L.get(f, f)} | {len(xs)} | {statistics.fmean(xs):.4f} | {sum(x >= PASS for x in xs) / len(xs):.1%} | {sum(x >= 0.90 for x in xs) / len(xs):.1%} |")
        w("")
        w("## 按保存软件、页面比例\n" if zh else "## By authoring app and slide ratio\n")
        w(("| 分组 | 页数 | 平均 SSIM | ≥ 0.95 |" if zh else "| Group | Slides | Mean SSIM | ≥ 0.95 |") + "\n|---|---|---|---|")
        for k, xs in sorted(by_app.items(), key=lambda kv: -len(kv[1])):
            w(f"| {names[k]} | {len(xs)} | {statistics.fmean(xs):.4f} | {sum(x >= PASS for x in xs) / len(xs):.1%} |")
        for k, xs in sorted(by_ratio.items(), key=lambda kv: -len(kv[1])):
            w(f"| {k} | {len(xs)} | {statistics.fmean(xs):.4f} | {sum(x >= PASS for x in xs) / len(xs):.1%} |")
        w("")

        # 速度
        w("## 转码速度\n" if zh else "## Conversion speed\n")
        w(("每份课件用命令行转码一次（`--jobs 1`：整页图单线程渲染；含整页图、缩略图、字体子集），测量时 6 个转码同时进行、进程优先级最低，"
           "所以是偏保守的数字。\n") if zh else
          ("Each deck converted once with the CLI (`--jobs 1`: single-threaded page-image rendering; includes page images, thumbnails, font "
           "subsets), six conversions at a time at idle priority, so the numbers are conservative.\n"))
        w(("| 指标 | 中位数 | 90% | 99% | 最大 |" if zh else "| Metric | Median | p90 | p99 | Max |") + "\n|---|---|---|---|---|")
        w(f"| {'每份（秒）' if zh else 'Per deck (s)'} | {statistics.median(times) / 1000:.1f} | {pct(times, 0.9) / 1000:.1f} | {pct(times, 0.99) / 1000:.1f} | {max(times) / 1000:.1f} |")
        w(f"| {'每页（毫秒）' if zh else 'Per slide (ms)'} | {statistics.median(per_page_ms):.0f} | {pct(per_page_ms, 0.9):.0f} | {pct(per_page_ms, 0.99):.0f} | {max(per_page_ms):.0f} |")
        w("")

        # 产物大小（比对时记录了的才有）
        sz = [rows[h]["variants"][a.new].get("bytes") for h in hashes if rows[h]["variants"].get(a.new, {}).get("bytes")]
        if sz:
            parts = ["fonts", "media", "pages", "pic", "thum", "other"]
            names_sz = {"zh": {"fonts": "字体子集", "media": "图片、音视频", "pages": "每页数据", "pic": "整页图", "thum": "缩略图", "other": "其它（入口 HTML 等）"},
                        "en": {"fonts": "font subsets", "media": "images, audio, video", "pages": "per-slide data", "pic": "page images", "thum": "thumbnails", "other": "other (entry HTML etc.)"}}[lang]
            w("## 产物大小\n" if zh else "## Output size\n")
            w(("命令行默认的按需加载形式；观看时只下载看到的那几页（和预加载的下一页），整页图、缩略图是给列表、分享预览用的，播放时不下载。\n") if zh else
              ("Default on-demand form; viewers download only the slides they see (plus the next one preloaded); page images and thumbnails are for lists and previews and are not downloaded during playback.\n"))
            w(("| 部分 | 每份中位数（KB） | 90%（KB） | 占全部 |" if zh else "| Part | Median per deck (KB) | p90 (KB) | Share of total |") + "\n|---|---|---|---|")
            total = sum(sum(x.values()) for x in sz)
            for k in parts:
                xs = [x.get(k, 0) for x in sz]
                w(f"| {names_sz[k]} | {statistics.median(xs) / 1024:.0f} | {pct(xs, 0.9) / 1024:.0f} | {sum(xs) / total:.1%} |")
            tot = [sum(x.values()) for x in sz]
            w(f"| {'合计' if zh else 'Total'} | {statistics.median(tot) / 1024:.0f} | {pct(tot, 0.9) / 1024:.0f} | 100% |\n")

        # 合成用例
        if tc_all:
            w("## 合成测试用例\n" if zh else "## Synthetic test cases\n")
            w(("用 PowerPoint 合成的中性内容用例（`testcases/`，可公开），每个用例针对一项功能或一条实测规则；用浏览器截播放器的图和 PowerPoint 导出的图比。\n") if zh else
              ("Neutral cases built with PowerPoint (`testcases/`, public), each targeting one feature or measured rule; the player is screenshot in a browser and compared with PowerPoint's export.\n"))
            w(("| 类别 | 页数 | 平均 SSIM | ≥ 0.95 |" if zh else "| Category | Slides | Mean SSIM | ≥ 0.95 |") + "\n|---|---|---|---|")
            for cat, xs in sorted(tcat.items(), key=lambda kv: -len(kv[1])):
                w(f"| {cat} | {len(xs)} | {statistics.fmean(xs):.4f} | {sum(x >= PASS for x in xs) / len(xs):.1%} |")
            w("")

        # 环境与方法
        w("## 测试环境和方法\n" if zh else "## Environment and method\n")
        w(f"- {'参考答案' if zh else 'Reference'}：Microsoft PowerPoint（{env['ppt'] or 'COM'}）{'导出的每页图片，宽 1280 像素' if zh else ' slide export, 1280 px wide'}")
        w(f"- {'机器' if zh else 'Machine'}：{env['cpu']}，{env['cores']} {'个逻辑核' if zh else 'logical cores'}，{env['ram']} GB，{env['os']}，Node {env['node']}")
        w(("- 真实课件比的是 unppt 的整页图（`pic/`，resvg 渲染）和参考图（缩到同样大小）的灰度 SSIM（8×8 分块）；本机字体模式（`--system-fonts`），"
           "让字形和参考图一致、只看排版和绘制的差别。合成用例比的是浏览器里播放器的截图（[还原度](fidelity.md) 第 2 节）。") if zh else
          ("- Real decks: unppt's page image (`pic/`, rendered with resvg) vs the reference scaled to the same size, grayscale SSIM on 8×8 blocks, "
           "in system-font mode (`--system-fonts`) so glyphs match the reference and only layout/drawing differences count. Synthetic cases: "
           "browser screenshots of the player ([Fidelity](fidelity.md), section 2)."))
        w(("- 复现：`python tools/compare/sweep_ab.py run <目录> --cli new=packages/transcoder/dist/cli.js,--system-fonts`，"
           "再 `python tools/compare/corpus_report.py --results <目录>`。") if zh else
          ("- Reproduce: `python tools/compare/sweep_ab.py run <dir> --cli new=packages/transcoder/dist/cli.js,--system-fonts`, "
           "then `python tools/compare/corpus_report.py --results <dir>`."))
        w("")
        out = ROOT / "docs" / lang / "test-report.md"
        out.write_text("\n".join(o) + "\n", encoding="utf-8", newline="\n")
        print("写入", out)

    write("zh")
    write("en")


if __name__ == "__main__":
    main()
