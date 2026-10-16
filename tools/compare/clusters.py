"""失败原因聚类：从 .cache/report/results.json 统计"该先修什么"，只输出数字和类别，不含样本内容。

用法：python tools/compare/clusters.py
"""
from __future__ import annotations

import json
import sys
from collections import Counter, defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from common import CACHE, is_holdout  # noqa: E402
import os  # noqa: E402

# MsoShapeType
SHAPE_TYPES = {
    1: "自选图形", 2: "标注", 3: "图表", 4: "批注", 5: "自由曲线", 6: "组合", 7: "嵌入对象", 8: "表单控件",
    9: "线条", 10: "链接对象", 11: "链接图片", 12: "OLE 控件", 13: "图片", 14: "占位符", 15: "艺术字",
    16: "媒体", 17: "文本框", 19: "表格", 21: "墨迹", 24: "SmartArt", 28: "图形（SVG）", 29: "三维模型",
}
LOW = 0.8          # 形状区域相似度低于这个算"有问题"
PASS = 0.95


def main():
    report = Path(os.environ["UNPPT_REPORT"]) if os.environ.get("UNPPT_REPORT") else CACHE / "report"
    results = json.load(open(report / "results.json", encoding="utf-8"))
    pages = [(r["key"], p) for r in results for p in r["pages"]]
    failed = [(k, p) for k, p in pages if p["ssim"] < PASS]

    by_type: Counter = Counter()
    by_type_pages: dict[str, set] = defaultdict(set)
    line_mismatch = 0
    line_total = 0
    missing = 0
    for key, p in pages:
        for s in p.get("shapes", []):
            name = SHAPE_TYPES.get(s["type"], f"类型 {s['type']}")
            if s["type"] == 1 and s.get("auto"):
                name += f"（预设 {s['auto']}）"
            if not s.get("found", True):
                missing += 1
            if s.get("region") is not None and s["region"] < LOW:
                by_type[name] += 1
                by_type_pages[name].add((key, p["slide"], p["step"]))
            if s.get("refLines"):
                line_total += 1
                if s["refLines"] != s.get("ourLines"):
                    line_mismatch += 1

    warn: Counter = Counter()
    fonts: Counter = Counter()
    for r in results:
        for w in r["convert"]["warnings"]:
            warn[w.split("（")[0]] += 1
        for f in r["convert"]["missingFonts"]:
            fonts[f] += 1

    print(f"页面 {len(pages)} 张，未通过 {len(failed)} 张（通过线 {PASS}）")
    print(f"文本框换行不一致：{line_mismatch} / {line_total}")
    print(f"PowerPoint 有、我们没画出来的形状：{missing}")
    print("\n问题形状（区域相似度 < %.1f），按影响页数排序：" % LOW)
    for name, n in sorted(by_type.items(), key=lambda x: -len(by_type_pages[x[0]])):
        print(f"  {name}：{n} 个，涉及 {len(by_type_pages[name])} 页")
    print("\n转码提示（按文件数）：")
    for w, n in warn.most_common():
        print(f"  {w}：{n} 个文件")
    print("\n缺少的字体（按文件数）：")
    for f, n in fonts.most_common(20):
        print(f"  {f}：{n} 个文件")
    print("\n分数最低的页面（编号；不列期末卷）：")
    for k, p in sorted([f for f in failed if not is_holdout(f[0])], key=lambda x: x[1]["ssim"])[:10]:
        print(f"  {k} 第 {p['slide'] + 1} 页 第 {p['step']} 步：{p['ssim']:.3f}")


if __name__ == "__main__":
    main()
