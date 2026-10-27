"""发版闸门：全量比对（sweep_ab.py run）跑完后一条命令做完收尾，只输出十几行结论。

  python tools/compare/release_gate.py --results <目录> --cli <cli.js> [--base-dir <上一版的目录> --base old --base-label 0.2.6]
                                       [--prev-dir <上一轮候选的目录>] [--version 0.3.1] [--no-report]

1. 失败的、耗时异常的课件（超过 max(120 秒, 上一版的 5 倍)，多半是机器那段时间卡住）用同一构建、同一参数重测，
   原记录存进 <目录>/reruns.json；重测后仍失败、仍慢的照实保留
2. 和上一版逐页比：变好 / 变差页数，变差的页按"同一模板"（页号、两边分数都一样）合并后列出最差的
3. 给了 --prev-dir 时再和上一轮候选比：确认只有预期的页变了
4. 生成测试报告（corpus_report.py）
5. 结论写到 <目录>/gate.txt：转码失败 > 0 判"不通过"；变差页只列出来，要不要挡发版由人看（见 docs/release.md）
样本安全：输出里只有哈希和数字。
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
from collections import defaultdict
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
PY = sys.executable


def load(d: Path) -> dict:
    out = {}
    for line in (d / "results.jsonl").read_text(encoding="utf-8").splitlines():
        if line.strip():
            r = json.loads(line)
            out[r["h"]] = r
    return out


def rerun(d: Path, cli: str, hashes: list[str], new: str) -> None:
    """把这些课件的记录挪到 reruns.json，再用同一构建重测（sweep_ab 会补上缺的课件）"""
    rows = load(d)
    saved = read(d / "reruns.json", {})
    for h in hashes:
        saved[h] = rows[h]["variants"].get(new)
    (d / "reruns.json").write_text(json.dumps(saved), encoding="utf-8")
    keep = [json.dumps(r, ensure_ascii=False) for h, r in rows.items() if h not in set(hashes)]
    (d / "results.jsonl").write_text("\n".join(keep) + "\n", encoding="utf-8")
    subprocess.run([PY, str(HERE / "sweep_ab.py"), "run", str(d), "--cli", f"{new}={cli},--system-fonts", "--only", ",".join(hashes),
                    "--workers", "3", "--priority", "below"], capture_output=True)


def read(p: Path, default):
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except Exception:
        return default


def compare(rows: dict, base: dict, new: str, base_name: str) -> tuple[list, int, int]:
    """逐页比：返回变差的页（差值，哈希，页号，旧分，新分）、变好页数、比了的页数"""
    worse, better, n = [], 0, 0
    for h, r in rows.items():
        a = base.get(h, {}).get("variants", {}).get(base_name, {}).get("ssim", {})
        b = r["variants"].get(new, {}).get("ssim", {})
        for p in a.keys() & b.keys():
            n += 1
            d = b[p] - a[p]
            better += d > 0.005
            if d < -0.005:
                worse.append((d, h, int(p), a[p], b[p]))
    return sorted(worse), better, n


def groups(worse: list) -> list:
    """同一模板复制出来的课件：页号和两边分数都一样的算一组"""
    g = defaultdict(list)
    for d, h, p, a, b in worse:
        g[(p, round(a, 4), round(b, 4))].append(h)
    return sorted(((b - a, p, a, b, hs) for (p, a, b), hs in g.items()))


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--results", required=True)
    ap.add_argument("--cli", required=True, help="比对用的 cli.js（重测用同一个）")
    ap.add_argument("--new", default="new")
    ap.add_argument("--base-dir", default=None)
    ap.add_argument("--base", default="old")
    ap.add_argument("--base-label", default="上一版")
    ap.add_argument("--prev-dir", default=None, help="上一轮候选的结果目录（版本名同 --new）")
    ap.add_argument("--version", default="")
    ap.add_argument("--top", type=int, default=12)
    ap.add_argument("--no-report", action="store_true")
    a = ap.parse_args()
    sys.stdout.reconfigure(encoding="utf-8")
    d = Path(a.results)
    rows = load(d)
    base = load(Path(a.base_dir)) if a.base_dir else {}
    out: list[str] = []

    # 1. 失败、耗时异常的重测
    def suspicious(rows: dict) -> list[str]:
        bad = []
        for h, r in rows.items():
            v = r["variants"].get(a.new, {})
            old_ms = base.get(h, {}).get("variants", {}).get(a.base, {}).get("ms", 0)
            if not v.get("ok") or v.get("ms", 0) > max(120_000, 5 * old_ms):
                bad.append(h)
        return bad
    sus = suspicious(rows)
    if sus:
        rerun(d, a.cli, sus, a.new)
        rows = load(d)
        still = suspicious(rows)
        out.append(f"重测 {len(sus)} 份（失败或耗时异常）：重测后仍有问题 {len(still)} 份 {' '.join(still[:10])}")
    fails = [h for h, r in rows.items() if not r["variants"].get(a.new, {}).get("ok")]
    pages = sum(len(r["variants"].get(a.new, {}).get("ssim", {})) for r in rows.values())
    out.append(f"课件 {len(rows)} 份、{pages} 页；转码失败 {len(fails)} 份 {' '.join(fails[:10])}")

    # 2. 和上一版比
    if base:
        worse, better, n = compare(rows, base, a.new, a.base)
        out.append(f"和 {a.base_label} 逐页比（{n} 页）：变好 {better}，变差 {len(worse)}（{len({w[1] for w in worse})} 份课件）")
        for dd, p, x, y, hs in groups(worse)[: a.top]:
            out.append(f"  {dd:+.4f}  第 {p} 页 {x:.4f}->{y:.4f}  {len(hs)} 份：{' '.join(hs[:4])}{' …' if len(hs) > 4 else ''}")
    # 3. 和上一轮候选比
    if a.prev_dir:
        prev = load(Path(a.prev_dir))
        worse, better, n = compare(rows, prev, a.new, a.new)
        out.append(f"和上一轮候选逐页比（{n} 页）：变好 {better}，变差 {len(worse)}")
        for dd, p, x, y, hs in groups(worse)[: a.top]:
            out.append(f"  {dd:+.4f}  第 {p} 页 {x:.4f}->{y:.4f}  {len(hs)} 份：{' '.join(hs[:4])}{' …' if len(hs) > 4 else ''}")
    # 4. 测试报告
    if not a.no_report:
        cmd = [PY, str(HERE / "corpus_report.py"), "--results", str(d), "--new", a.new]
        if a.base_dir:
            cmd += ["--base-dir", a.base_dir, "--base", a.base, "--base-label", a.base_label]
        if a.version:
            cmd += ["--version", a.version]
        r = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace")
        out.append("测试报告：已生成 docs/zh|en/test-report.md" if r.returncode == 0 else f"测试报告生成失败：{r.stderr[-300:]}")
    out.insert(0, "结论：" + ("不通过（有转码失败）" if fails else "转码全部成功；变差的页见下面，确认后再发版"))
    text = "\n".join(out)
    (d / "gate.txt").write_text(text + "\n", encoding="utf-8")
    print(text)


if __name__ == "__main__":
    main()
