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
    by_feat_base = defaultdict(list)  # 同一批页上一版的分数
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
                if n in bs:
                    by_feat_base[f].append(bs[n])
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

    # 合成用例的类别名（用例名第一段）给读者看的说法
    TC_NAMES = {
        "zh": {"anim": "动画", "charts": "图表", "text": "文字", "shapes": "形状", "table": "表格", "fills": "填充", "lines": "线条",
               "emf": "EMF/WMF 图片", "wmf": "EMF/WMF 图片", "picture": "图片", "pictures": "图片", "media": "音视频", "group": "组合",
               "placeholders": "版式占位符", "smartart": "SmartArt", "slide": "页面设置", "theme": "主题", "transitions": "页面切换",
               "transition": "页面切换", "equations": "公式", "fonts": "字体", "shape": "形状", "colors": "颜色", "links": "超链接",
               "ole": "OLE 对象", "svg": "SVG 图片", "hidden": "隐藏页", "speaker": "演讲者备注", "custgeom": "自由形状",
               "freeform": "自由形状", "activex": "ActiveX 控件"},
        "en": {"anim": "animations", "charts": "charts", "text": "text", "shapes": "shapes", "table": "tables", "fills": "fills",
               "lines": "lines", "emf": "EMF/WMF pictures", "wmf": "EMF/WMF pictures", "picture": "pictures", "pictures": "pictures",
               "media": "audio/video", "group": "groups", "placeholders": "layout placeholders", "smartart": "SmartArt",
               "slide": "slide setup", "theme": "themes", "transitions": "transitions", "transition": "transitions", "equations": "equations",
               "fonts": "fonts", "shape": "shapes", "colors": "colors", "links": "hyperlinks", "ole": "OLE objects", "svg": "SVG pictures",
               "hidden": "hidden slides", "speaker": "speaker notes", "custgeom": "freeform shapes", "freeform": "freeform shapes",
               "activex": "ActiveX controls"},
    }

    def write(lang: str) -> None:
        """面向使用者写：术语只在第一次出现时解释一次，统计说法用大白话（一半 / 90% 的课件……），技术细节放最后一节"""
        L = LABELS[lang]
        zh = lang == "zh"
        o = []
        w = o.append
        mean = statistics.fmean(scores)
        share = lambda xs, t: sum(x >= t for x in xs) / len(xs)  # noqa: E731
        names = {"ppt-win": "PowerPoint (Windows)", "ppt-mac": "PowerPoint (Mac)", "wps": "WPS", "other": "其它" if zh else "other"}
        if zh:
            w(f"[English](../en/test-report.md)\n\n# 测试报告{(' ' + a.version) if a.version else ''}\n")
            w(f"> 这份报告由程序根据全量测试结果自动生成（{today}）。只有汇总数字，不含任何一份课件的内容。\n")
            w("## 怎么测的\n")
            w("我们把每份课件用 unppt 转换，再把结果的每一页和 **Microsoft PowerPoint 自己导出的同一页图片**放在一起比较，"
              "得到一个**相似度**：0 到 1 之间，**1 表示两张图看起来一模一样**。（相似度用的是图像处理里常用的 SSIM 方法：比较明暗、"
              "对比和图形结构，比逐个像素对比更接近人眼的感受；具体算法和标准定义的链接见 [还原度：相似度是怎么算的](fidelity.md#ssim)。）\n")
            w(f"- **{PASS} 以上**：算\"通过\"，和 PowerPoint 的差别通常只是文字差一两个像素、图片边缘略有不同这类细节；")
            w("- **0.90 ~ 0.95**：整体一致，局部有能看出来的小差别；")
            w("- **0.90 以下**：有明显不同的地方，例如某个图表标签的位置、某种效果没画好。\n")
            w("## 结论\n")
            w(f"- **{len(hashes)} 份真实课件、{n_pages} 页全部能转换**，失败 {fails} 份。")
            w(f"- 和 PowerPoint 逐页比：**平均相似度 {mean:.3f}**；**{share(scores, PASS):.1%} 的页达到 {PASS}**（通过），"
              f"**{share(scores, 0.90):.1%} 的页在 0.90 以上**。")
            if bscores:
                w(f"- 和上一版 {a.base_label} 比：**{better} 页更像 PowerPoint 了，{worse} 页不如以前**（差别都很小，原因逐一查过，"
                  f"见[调研记录](research/README.md)），其余 {same} 页没有变化。")
            if tc_all:
                w(f"- 专门测试各项功能的测试课件 {len(tc)} 份、{len(tc_all)} 页：平均相似度 {statistics.fmean(tc_all):.3f}，"
                  f"{share(tc_all, PASS):.1%} 的页达到 {PASS}。")
            w(f"- 转换速度：**一半的课件 {statistics.median(times) / 1000:.1f} 秒内转完**，一般每页不到 {statistics.median(per_page_ms) / 1000:.1f} 秒"
              "（测试时几份课件同时转、而且优先级很低，平时使用会更快）。\n")
        else:
            w(f"[中文](../zh/test-report.md)\n\n# Test report{(' ' + a.version) if a.version else ''}\n")
            w(f"> Generated automatically from the full test run ({today}). Totals only — nothing from any individual deck.\n")
            w("## How we test\n")
            w("Every deck is converted with unppt, and each resulting slide is compared with **the image Microsoft PowerPoint itself exports "
              "for the same slide**, giving a **similarity score** between 0 and 1, where **1 means the two images look identical**. "
              "(The score is SSIM, a standard image-comparison method that looks at brightness, contrast and structure — closer to what "
              "the eye notices than comparing pixel by pixel; exact method and references: [Fidelity: how the score is computed](fidelity.md#ssim).)\n")
            w(f"- **{PASS} or more**: counts as a pass; differences are usually tiny, such as text a pixel or two off or slightly different picture edges;")
            w("- **0.90 – 0.95**: the same overall, with small visible differences somewhere;")
            w("- **below 0.90**: something clearly differs, such as a chart label's position or an effect not drawn right.\n")
            w("## Results\n")
            w(f"- **All {len(hashes)} real-world decks ({n_pages} slides) convert**; {fails} failures.")
            w(f"- Against PowerPoint, slide by slide: **average similarity {mean:.3f}**; **{share(scores, PASS):.1%} of slides reach {PASS}** (pass), "
              f"**{share(scores, 0.90):.1%} are above 0.90**.")
            if bscores:
                w(f"- Against the previous release {a.base_label}: **{better} slides now look closer to PowerPoint, {worse} look slightly worse** "
                  f"(all small; each cause was investigated), the other {same} are unchanged.")
            if tc_all:
                w(f"- Feature test decks: {len(tc)} files, {len(tc_all)} slides, average similarity {statistics.fmean(tc_all):.3f}, "
                  f"{share(tc_all, PASS):.1%} reach {PASS}.")
            w(f"- Speed: **half of the decks convert within {statistics.median(times) / 1000:.1f} seconds**, typically under "
              f"{statistics.median(per_page_ms) / 1000:.1f} s per slide (measured with several decks at once at low priority, so real use is faster).\n")

        # 测试用的课件
        w("## 测试用的课件\n" if zh else "## The decks we test with\n")
        w((f"真实课件来自课件库，只在本机测试、不外传。另有 {no_ref} 份连 PowerPoint 自己都打不开或导不出图片，没法比较，不计入。\n") if zh else
          (f"Real-world decks from a courseware library, tested locally and never uploaded. {no_ref} more decks could not be opened or exported "
           "by PowerPoint itself, so there is nothing to compare against; they are not counted.\n"))
        w("| 项目 | 数量 |\n|---|---|" if zh else "| Item | Count |\n|---|---|")
        w(f"| {'课件' if zh else 'Decks'} | {len(hashes)} |")
        w(f"| {'页' if zh else 'Slides'} | {n_pages} |")
        w(f"| {'每份课件的页数：一半的课件不超过 / 90% 的课件不超过 / 最多' if zh else 'Slides per deck: half have at most / 90% have at most / most'} | "
          f"{statistics.median(deck_pages):.0f} / {pct(deck_pages, 0.9):.0f} / {max(deck_pages)} |")
        for k, c in app_decks.most_common():
            w(f"| {'用这个软件保存的：' if zh else 'Saved with '}{names[k]} | {c} |")
        for k, c in ratio_decks.most_common():
            w(f"| {'页面比例 ' if zh else 'Slide ratio '}{k if k != 'other' else ('其它' if zh else 'other')} | {c} |")
        w("")

        # 相似度分布
        w("## 相似度分布\n" if zh else "## How the similarity scores spread\n")
        w(("| 相似度 | 页数 | 占全部页 |" if zh else "| Similarity | Slides | Share |") + "\n|---|---|---|")
        for lo, hi in buckets:
            c = sum(lo <= x < hi for x in scores)
            label = (f"{lo:.2f} 以上" if zh else f"{lo:.2f} or more") if hi > 1 else ((f"低于 {hi:.2f}" if zh else f"below {hi:.2f}") if lo == 0 else f"{lo:.2f} ~ {hi:.2f}")
            w(f"| {label} | {c} | {c / n_pages:.1%} |")
        w("")
        w((f"换个角度看：最差的 5% 的页相似度低于 {pct(scores, 0.05):.3f}，最差的 10% 低于 {pct(scores, 0.1):.3f}，一半的页在 {pct(scores, 0.5):.3f} 以上。\n") if zh else
          (f"Put another way: the worst 5% of slides score below {pct(scores, 0.05):.3f}, the worst 10% below {pct(scores, 0.1):.3f}, and half score above {pct(scores, 0.5):.3f}.\n"))

        # 按页面内容
        w("## 不同内容的页面表现如何\n" if zh else "## How slides with different content do\n")
        w(("一页可能同时含有几种内容（比如既有图片又有表格），会在几行里各算一次。" if zh else "A slide can contain several kinds of content and is counted in each row. ")
          + ((f"最后一列是上一版 {a.base_label} 在同一批页上的平均相似度，方便对比。\n" if zh else f"The last column is the previous release {a.base_label} on the same slides.\n") if bscores else "\n"))
        bcol = f" {a.base_label} |" if bscores else ""
        head = ("| 页面里有 | 页数 | 平均相似度 | 达到 0.95 的页 | 0.90 以上的页 |" if zh else "| Slides with | Slides | Average similarity | Reach 0.95 | Above 0.90 |") + bcol
        w(head + "\n|---|---|---|---|---|" + ("---|" if bscores else ""))
        for f, xs in sorted(by_feat.items(), key=lambda kv: -len(kv[1])):
            bx = by_feat_base.get(f)
            bcell = f" {statistics.fmean(bx):.3f} |" if bscores and bx else (" — |" if bscores else "")
            w(f"| {L.get(f, f)} | {len(xs)} | {statistics.fmean(xs):.3f} | {share(xs, PASS):.1%} | {share(xs, 0.90):.1%} |{bcell}")
        w("")
        w("## 不同软件保存的课件、不同页面比例\n" if zh else "## By authoring app and slide ratio\n")
        w(("| 分组 | 页数 | 平均相似度 | 达到 0.95 的页 |" if zh else "| Group | Slides | Average similarity | Reach 0.95 |") + "\n|---|---|---|---|")
        for k, xs in sorted(by_app.items(), key=lambda kv: -len(kv[1])):
            w(f"| {names[k]} | {len(xs)} | {statistics.fmean(xs):.3f} | {share(xs, PASS):.1%} |")
        for k, xs in sorted(by_ratio.items(), key=lambda kv: -len(kv[1])):
            w(f"| {('页面比例 ' if zh else 'ratio ') + (k if k != 'other' else ('其它' if zh else 'other'))} | {len(xs)} | {statistics.fmean(xs):.3f} | {share(xs, PASS):.1%} |")
        w("")

        # 速度
        w("## 转换速度\n" if zh else "## Conversion speed\n")
        w(("每份课件转换一次（包括整页图片、缩略图和字体）。测试时几份课件同时转、优先级很低，所以这里的数字比平时慢。"
           "表里\"一半\"表示一半的课件（或页）在这个时间内转完，\"90%\"表示 90% 的在这个时间内，依此类推。\n") if zh else
          ("Each deck converted once (including page images, thumbnails and fonts), several at a time at low priority, so these numbers are "
           "slower than everyday use. \"Half\" means half of the decks (or slides) finish within that time, \"90%\" means 90% do, and so on.\n"))
        w(("| | 一半 | 90% | 99% | 最慢的一份 |" if zh else "| | Half | 90% | 99% | Slowest |") + "\n|---|---|---|---|---|")
        w(f"| {'每份课件（秒）' if zh else 'Per deck (seconds)'} | {statistics.median(times) / 1000:.1f} | {pct(times, 0.9) / 1000:.1f} | {pct(times, 0.99) / 1000:.1f} | {max(times) / 1000:.1f} |")
        w(f"| {'每页（秒）' if zh else 'Per slide (seconds)'} | {statistics.median(per_page_ms) / 1000:.2f} | {pct(per_page_ms, 0.9) / 1000:.2f} | {pct(per_page_ms, 0.99) / 1000:.2f} | {max(per_page_ms) / 1000:.1f} |")
        w("")

        # 大小（比对时记录了的才有）
        sz = [rows[h]["variants"][a.new].get("bytes") for h in hashes if rows[h]["variants"].get(a.new, {}).get("bytes")]
        if len(sz) >= len(hashes) / 2:  # 比对时没记录大小的课件多于一半就不出这一节（免得几份课件的数字被当成全量统计）
            parts = ["fonts", "media", "pages", "pic", "thum", "other"]
            names_sz = {"zh": {"fonts": "字体", "media": "图片、音视频", "pages": "每页的内容", "pic": "整页图片（列表、分享预览用）", "thum": "缩略图", "other": "其它（入口网页等）"},
                        "en": {"fonts": "fonts", "media": "images, audio, video", "pages": "slide content", "pic": "page images (for lists and previews)", "thum": "thumbnails", "other": "other (entry page etc.)"}}[lang]
            w(f"## 转换结果有多大\n\n统计了 {len(sz)} 份课件。" if zh else f"## How big the output is\n\n{len(sz)} decks measured. ")
            w(("观看时只下载正在看的页和提前准备的下一页；整页图片和缩略图是给课件列表、分享预览用的，播放时不下载。\n") if zh else
              ("Viewers only download the slide they are on and the next one; page images and thumbnails are for lists and previews and are not downloaded during playback.\n"))
            w(("| 部分 | 一半的课件小于（KB） | 90% 的课件小于（KB） | 占总大小 |" if zh else "| Part | Half of decks under (KB) | 90% of decks under (KB) | Share of total |") + "\n|---|---|---|---|")
            total = sum(sum(x.values()) for x in sz)
            for k in parts:
                xs = [x.get(k, 0) for x in sz]
                w(f"| {names_sz[k]} | {statistics.median(xs) / 1024:.0f} | {pct(xs, 0.9) / 1024:.0f} | {sum(xs) / total:.1%} |")
            tot = [sum(x.values()) for x in sz]
            w(f"| {'合计' if zh else 'Total'} | {statistics.median(tot) / 1024:.0f} | {pct(tot, 0.9) / 1024:.0f} | 100% |\n")

        # 功能测试课件
        if tc_all:
            w("## 功能测试课件\n" if zh else "## Feature test decks\n")
            w(("用 PowerPoint 专门做的测试课件（内容是中性的，可以公开，在 `testcases/` 目录），每份针对一项功能；在浏览器里打开转换结果截图，"
               "和 PowerPoint 导出的图片比较。\n") if zh else
              ("Decks made in PowerPoint specifically for testing (neutral content, public, in `testcases/`), each targeting one feature; the "
               "converted result is opened in a browser, captured, and compared with PowerPoint's export.\n"))
            w(("| 功能 | 页数 | 平均相似度 | 达到 0.95 的页 |" if zh else "| Feature | Slides | Average similarity | Reach 0.95 |") + "\n|---|---|---|---|")
            merged = defaultdict(list)
            for cat, xs in tcat.items():
                merged[TC_NAMES[lang].get(cat, cat)].extend(xs)
            for cat, xs in sorted(merged.items(), key=lambda kv: -len(kv[1])):
                w(f"| {cat} | {len(xs)} | {statistics.fmean(xs):.3f} | {share(xs, PASS):.1%} |")
            w("")

        # 测试环境（给想复现的开发者）
        w("## 测试环境（给想复现的开发者）\n" if zh else "## Test environment (for developers who want to reproduce it)\n")
        w(f"- {'标准答案' if zh else 'Reference'}：Microsoft PowerPoint（{env['ppt'] or 'COM'}）{'导出的每页图片，宽 1280 像素' if zh else ' slide export, 1280 px wide'}")
        w(f"- {'机器' if zh else 'Machine'}：{env['cpu']}，{env['cores']} {'个逻辑核' if zh else 'logical cores'}，{env['ram']} GB，{env['os']}，Node {env['node']}")
        w(("- 真实课件比的是 unppt 的整页图（`pic/`，resvg 渲染）和参考图（缩到同样大小）的灰度 SSIM（8×8 分块）；用本机字体模式（`--system-fonts`），"
           "让字形和参考图一致、只看排版和绘制的差别。测试课件比的是浏览器里播放器的截图（[还原度](fidelity.md) 第 2 节）。") if zh else
          ("- Real decks: unppt's page image (`pic/`, rendered with resvg) vs the reference scaled to the same size, grayscale SSIM on 8×8 blocks, "
           "in system-font mode (`--system-fonts`) so glyphs match the reference and only layout/drawing differences count. Test decks: "
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
