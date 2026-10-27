"""符号字形审计：默认字体包用开源字体代替微软字体显示（思源黑体代替微软雅黑等），汉字两边设计很接近，但少数符号画法完全不同
（例如 U+221A：雅黑画成"对勾"，思源黑体画成带横线的数学根号）。这个脚本找出这些符号，并在字体包的开源字体里挑一个画法最接近的。

  python tools/fonts/glyph_audit.py [--min 50] [--top 60]

1. 统计全部课件（.cache/samples.json）里实际用到的非汉字字符和次数（只记字符和次数，存 .cache/glyph-chars.json，不出本机）
2. 对常用的中文字体（雅黑常规 / 粗 / 细、等线、黑体、宋体），把每个字符分别用原字体和开源字体画出来，
   按排版时的位置摆放、轻微模糊后算形状相关度（0~1，1 = 一样）
3. 现在用的开源字体重合度低的，在字体包的其它开源字体里挑重合度最高的
4. 结果写到 .cache/glyph-audit.json，打印最需要处理的字符；transcoder 的 font/glyph-overrides.ts 由人确认后照着改
说明见 docs/zh/research/glyph-overrides.md。
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import zipfile
from collections import Counter
from pathlib import Path

import numpy as np
from fontTools.ttLib import TTCollection, TTFont
from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "tools"))
from common import REF, read_json  # noqa: E402

WIN = Path("C:/Windows/Fonts")
FILES = ROOT / "packages" / "fonts" / "files"
# 原字体（Windows 上的文件，ttc 里第几个） -> 字体包现在用来显示它的开源字体
FONTS = {
    "微软雅黑": (("msyh.ttc", 0), "NotoSansSC-Regular.otf"),
    "微软雅黑 粗体": (("msyhbd.ttc", 0), "NotoSansSC-Bold.otf"),
    "微软雅黑 Light": (("msyhl.ttc", 0), "NotoSansSC-Light.otf"),
    "等线": (("Deng.ttf", 0), "NotoSansSC-Regular.otf"),
    "黑体": (("simhei.ttf", 0), "NotoSansSC-Regular.otf"),
    "宋体": (("simsun.ttc", 0), "NotoSerifSC-Regular.otf"),
}
# 可以换成的开源字体（字体包里已有的，常规体）：黑体类只在黑体类里挑、宋体类只在宋体类里挑（仿宋、楷体的标点放进黑体的句子里风格突兀）
SANS = ["NotoSansSC-Regular.otf", "LiberationSans-Regular.ttf", "Carlito-Regular.ttf"]
SERIF = ["NotoSerifSC-Regular.otf", "LiberationSerif-Regular.ttf", "Caladea-Regular.ttf"]
CANDIDATES = SANS + SERIF
# 字体包里这些文件的字体名（替代表里写字体名）
FAMILY = {"NotoSansSC-Regular.otf": "Noto Sans SC", "LiberationSans-Regular.ttf": "Liberation Sans", "Carlito-Regular.ttf": "Carlito",
          "NotoSerifSC-Regular.otf": "Noto Serif SC", "LiberationSerif-Regular.ttf": "Liberation Serif", "Caladea-Regular.ttf": "Caladea"}
# 原字体在课件里可能写的名字（小写）
NAMES = {"微软雅黑": ["微软雅黑", "microsoft yahei"], "微软雅黑 粗体": ["微软雅黑", "microsoft yahei"],
         "微软雅黑 Light": ["微软雅黑 light", "microsoft yahei light"], "等线": ["等线", "dengxian"], "黑体": ["黑体", "simhei"], "宋体": ["宋体", "simsun"]}
# 换不换：现在的相似度低于 BAD、换上的不低于 GOOD、而且至少提高 GAIN
BAD, GOOD, GAIN = 0.6, 0.85, 0.3
SIZE = 96


def ideograph(cp: int) -> bool:
    return 0x3400 <= cp <= 0x9FFF or 0xF900 <= cp <= 0xFAFF or 0x20000 <= cp <= 0x3FFFF


def char_counts() -> Counter:
    cache = ROOT / ".cache" / "glyph-chars.json"
    if cache.exists():
        return Counter({int(k): v for k, v in json.loads(cache.read_text()).items()})
    index = read_json(ROOT / ".cache" / "samples.json", {}) or {}
    c: Counter = Counter()
    for k, (h, v) in enumerate(index.items(), 1):
        if v.get("status") != "ok":
            continue
        ref = read_json(REF / h / "ref.json", {}) or {}
        src = REF / h / "converted.pptx" if ref.get("converted") else ROOT / v["paths"][0]
        try:
            z = zipfile.ZipFile(src)
            for n in z.namelist():
                if n.startswith("ppt/slides/slide") and n.endswith(".xml"):
                    for t in re.findall(r"<a:t>([^<]*)</a:t>", z.read(n).decode("utf-8", "replace")):
                        c.update(ord(ch) for ch in t if not ideograph(ord(ch)) and ord(ch) > 0x7F)
        except Exception:
            pass
        if k % 1000 == 0:
            print(f"  统计 {k}/{len(index)}", flush=True)
    cache.write_text(json.dumps(c))
    return c


def load(spec) -> tuple[ImageFont.FreeTypeFont, set]:
    if isinstance(spec, tuple):
        path, idx = WIN / spec[0], spec[1]
        tt = TTCollection(str(path)).fonts[idx] if path.suffix == ".ttc" else TTFont(str(path))
    else:
        path, idx = FILES / spec, 0
        tt = TTFont(str(path))
    return ImageFont.truetype(str(path), SIZE, index=idx), set(tt.getBestCmap())


def ink(font: ImageFont.FreeTypeFont, ch: str) -> np.ndarray:
    """排版时的样子：字宽框的中心放在画布中间（默认字体包显示时就是这样摆的），基线对齐；轻微模糊，容忍几个像素的差别"""
    im = Image.new("L", (SIZE * 3, SIZE * 2), 0)
    ImageDraw.Draw(im).text((SIZE * 1.5 - font.getlength(ch) / 2, SIZE * 1.4), ch, font=font, fill=255, anchor="ls")
    return np.asarray(im.filter(ImageFilter.GaussianBlur(SIZE / 24)), dtype=np.float32)


def similarity(a: np.ndarray, b: np.ndarray) -> float:
    """两张模糊后的笔画图的相关度（0~1，1 = 一样）：整体画法不同（带横线的根号 vs 对勾）才明显变低"""
    a, b = a - a.mean(), b - b.mean()
    d = float(np.sqrt((a * a).sum() * (b * b).sum()))
    return max(0.0, float((a * b).sum()) / d) if d else 1.0


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--min", type=int, default=50, help="至少在课件里出现这么多次的字符才看")
    ap.add_argument("--top", type=int, default=60)
    ap.add_argument("--bad", type=float, default=0.6, help="相似度低于它算画法不同")
    a = ap.parse_args()
    sys.stdout.reconfigure(encoding="utf-8")
    counts = char_counts()
    chars = [cp for cp, n in counts.most_common() if n >= a.min]
    print(f"非汉字字符 {len(counts)} 种，出现 ≥ {a.min} 次的 {len(chars)} 种")
    cands = {f: load(f) for f in CANDIDATES}
    out = []
    for name, (orig, shown) in FONTS.items():
        try:
            of, ocmap = load(orig)
        except Exception:
            print("跳过（本机没有）", name)
            continue
        for cp in chars:
            if cp not in ocmap:
                continue
            ch = chr(cp)
            ref = ink(of, ch)
            if not ref.max():
                continue
            pool = SERIF if shown in SERIF else SANS
            scores = {f: similarity(ref, ink(cands[f][0], ch)) for f in pool if cp in cands[f][1]}
            cur = scores.get(shown)
            best = max(scores, key=scores.get) if scores else None
            out.append({"font": name, "cp": f"U+{cp:04X}", "char": ch, "count": counts[cp], "shown": shown, "iou": cur,
                        "best": best, "best_iou": scores.get(best) if best else None})
    (ROOT / ".cache" / "glyph-audit.json").write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
    bad = sorted((r for r in out if r["iou"] is not None and r["iou"] < a.bad), key=lambda r: -r["count"])
    print(f"现用开源字体相似度 < {a.bad} 的：{len(bad)} 处（字体 × 字符）")
    emit(out, a.min)
    for r in bad[: a.top]:
        print(f"  {r['font']:<14} {r['cp']} {r['char']}  出现 {r['count']:>6}  现在 {r['shown']} {r['iou']:.2f}  最像 {r['best']} {r['best_iou']:.2f}")


def emit(rows: list, min_count: int) -> None:
    """满足条件的写成 packages/transcoder/src/font/glyph-overrides.ts（生成的文件，别手改）"""
    table: dict = {}
    for r in rows:
        if r["iou"] is None or r["best_iou"] is None or r["best"] == r["shown"]:
            continue
        if r["iou"] < BAD and r["best_iou"] >= GOOD and r["best_iou"] - r["iou"] >= GAIN:
            for n in NAMES[r["font"]]:
                table.setdefault(n, {})[r["cp"]] = (FAMILY[r["best"]], r["char"], round(r["iou"], 2), round(r["best_iou"], 2))
    lines = ["// 由 tools/fonts/glyph_audit.py 生成，别手改。说明见 docs/zh/research/glyph-overrides.md",
             "// 默认字体包显示时，这些原字体里的这些符号改用另一个开源字体画（字宽、排版不变，只换字形）：",
             f"// 课件里出现 ≥ {min_count} 次、思源黑体 / 宋体画法相似度 < {BAD}、换上的 ≥ {GOOD} 且提高 ≥ {GAIN}（括号里是相似度：现在 -> 换后）",
             "export const GLYPH_OVERRIDES: Record<string, Record<number, string>> = {"]
    for name, cps in sorted(table.items()):
        lines.append(f"  '{name}': {{")
        for cp, (fam, ch, a0, b0) in sorted(cps.items()):
            lines.append(f"    0x{cp[2:]}: '{fam}', // {ch} {a0} -> {b0}")
        lines.append("  },")
    lines.append("};")
    out = ROOT / "packages" / "transcoder" / "src" / "font" / "glyph-overrides.ts"
    out.write_text("\n".join(lines) + "\n", encoding="utf-8", newline="\n")
    print(f"写入 {out.relative_to(ROOT)}：{sum(len(v) for v in table.values())} 项")


if __name__ == "__main__":
    main()
