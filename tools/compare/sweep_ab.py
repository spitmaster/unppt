"""全量课件逐页效果比对（发版前用）：每份课件用几个版本的转码器出整页图（pic/，resvg 画的），和 PowerPoint 的参考图逐页算 SSIM。

  python tools/compare/sweep_ab.py run <结果目录> --cli 名字=cli.js[,参数...] [--cli ...] [--workers N] [--only 哈希,...] [--limit N]
  python tools/compare/sweep_ab.py report <结果目录> --base 名字 --new 名字 [--top N] [--base-dir 另一个结果目录]

例：--cli new=packages/transcoder/dist/cli.js,--system-fonts --cli old=<0.2.6 的 dist/cli.js>,--system-fonts

- 只记数字（样本用哈希），产物转完就删，不占磁盘；结果是 <结果目录>/results.jsonl，一份课件一行，中断后再跑会跳过已有的
- 所有进程默认用最低优先级（Windows 上是"空闲"），不和用户的程序抢 CPU（转码每份只用一个出图线程）；机器被别的普通优先级任务占满、
  比对几乎不动时用 --priority below
- 修了代码再比时只需转新版：run 只给 --cli new=...，report 用 --base-dir 指向上一次的结果目录取旧版的分数
- 和 run.py 的区别：run.py 用浏览器截播放器的图、存图出报告，适合看细节；这里比整页图、不存图，适合几千份课件找"哪一类变差了"
样本安全：结果只在 .cache/ 下（gitignore），不出本机。
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
from multiprocessing import Pool
from pathlib import Path

import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from common import REF, ROOT, read_json  # noqa: E402
from run import _gray, ssim  # noqa: E402

PRIORITY = {"idle": 0x40, "below": 0x4000}  # Windows 进程优先级：空闲 / 低于正常
PRIO = PRIORITY["idle"]
TIMEOUT = 20 * 60


def low_priority() -> None:
    if os.name == "nt":
        import ctypes
        ctypes.windll.kernel32.SetPriorityClass(ctypes.windll.kernel32.GetCurrentProcess(), PRIO)
    else:
        os.nice(19 if PRIO == PRIORITY["idle"] else 10)


def worker_init(prio: int) -> None:
    """进程池里的子进程：用和主进程一样的优先级"""
    global PRIO
    PRIO = prio
    low_priority()


def source(h: str, index: dict) -> Path:
    ref = read_json(REF / h / "ref.json", {}) or {}
    return REF / h / "converted.pptx" if ref.get("converted") else ROOT / index[h]["paths"][0]


def deck(task: tuple) -> dict:
    """一份课件：每个版本转一遍、逐页和参考图比"""
    h, src, clis, work, prio = task
    global PRIO
    PRIO = prio
    ref = read_json(REF / h / "ref.json", {}) or {}
    out = {"h": h, "slides": len(ref.get("slides", [])), "variants": {}}
    refs: dict[int, np.ndarray] = {}
    for name, (cli, args) in clis.items():
        d = Path(tempfile.mkdtemp(prefix=f"ab-{name}-", dir=work))
        t0 = time.time()
        v: dict = {}
        try:
            r = subprocess.run(["node", cli, str(src), "-o", str(d / "out"), "-q", "--jobs", "1", *args],
                               capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=TIMEOUT,
                               creationflags=PRIO if os.name == "nt" else 0)
            v["ok"] = r.returncode == 0
            if not v["ok"]:
                v["err"] = (r.stderr or r.stdout)[-300:]
        except subprocess.TimeoutExpired:
            v["ok"] = False
            v["err"] = "timeout"
        v["ms"] = int((time.time() - t0) * 1000)
        scores = {}
        if v["ok"]:
            # 产物大小（字节）：合计和各部分（fonts 字体子集、media 图片音视频、pages 每页数据、pic 整页图、thum 缩略图、其它）
            sizes: dict = {}
            for f in (d / "out").rglob("*"):
                if f.is_file():
                    rel = f.relative_to(d / "out").parts
                    k = rel[0] if len(rel) > 1 and rel[0] in ("fonts", "media", "pages", "pic", "thum") else "other"
                    sizes[k] = sizes.get(k, 0) + f.stat().st_size
            v["bytes"] = sizes
            for s in ref.get("slides", []):
                n = s["index"] + 1
                pic = d / "out" / "pic" / f"{n}.jpg"
                png = REF / h / f"slide-{n:03d}.png"
                if not pic.exists() or not png.exists():
                    continue
                ours = Image.open(pic)
                if n not in refs:
                    refs[n] = _gray(Image.open(png).resize(ours.size, Image.BILINEAR))
                scores[str(n)] = round(ssim(refs[n], _gray(ours)), 4)
        v["ssim"] = scores
        out["variants"][name] = v
        shutil.rmtree(d, ignore_errors=True)
    return out


def run(args) -> None:
    global PRIO
    PRIO = PRIORITY[args.priority]
    low_priority()
    res_dir = Path(args.dir)
    res_dir.mkdir(parents=True, exist_ok=True)
    results = res_dir / "results.jsonl"
    done = set()
    if results.exists():
        for line in results.read_text(encoding="utf-8").splitlines():
            if line.strip():
                done.add(json.loads(line)["h"])
    clis = {}
    for spec in args.cli:
        name, rest = spec.split("=", 1)
        parts = rest.split(",")
        clis[name] = (str(Path(parts[0]).resolve()), parts[1:])
    index = read_json(ROOT / ".cache" / "samples.json", {}) or {}
    hashes = sorted(h for h, v in index.items() if v.get("status") == "ok" and (REF / h / "ref.json").exists())
    if args.only:
        keep = set(args.only.split(","))
        hashes = [h for h in hashes if h in keep]
    if args.limit:
        hashes = hashes[: args.limit]
    todo = [h for h in hashes if h not in done]
    work = Path(args.work or tempfile.gettempdir()) / "unppt-sweep-ab"
    work.mkdir(parents=True, exist_ok=True)
    print(f"课件 {len(hashes)} 份，已有 {len(hashes) - len(todo)}，这次 {len(todo)}；版本 {', '.join(clis)}；{args.workers} 个进程", flush=True)
    t0 = time.time()
    with Pool(args.workers, initializer=worker_init, initargs=(PRIO,)) as pool, results.open("a", encoding="utf-8") as f:
        for k, r in enumerate(pool.imap_unordered(deck, [(h, source(h, index), clis, str(work), PRIO) for h in todo]), 1):
            f.write(json.dumps(r, ensure_ascii=False) + "\n")
            f.flush()
            if k % 50 == 0 or k == len(todo):
                print(f"{k}/{len(todo)}  {(time.time() - t0) / 60:.0f} 分钟", flush=True)


def report(args) -> None:
    rows = [json.loads(line) for line in (Path(args.dir) / "results.jsonl").read_text(encoding="utf-8").splitlines() if line.strip()]
    base, new = args.base, args.new
    if args.base_dir:  # 旧版的分数取另一次比对的结果（只比两边都有的课件）
        old = {}
        for line in (Path(args.base_dir) / "results.jsonl").read_text(encoding="utf-8").splitlines():
            if line.strip():
                r = json.loads(line)
                if base in r["variants"]:
                    old[r["h"]] = r["variants"][base]
        rows = [{**r, "variants": {**r["variants"], "(base)": old[r["h"]]}} for r in rows if r["h"] in old]
        base = "(base)"  # 两边版本名相同（例如都叫 new）时也不会互相覆盖
    fails = {name: [r["h"] for r in rows if not r["variants"].get(name, {}).get("ok")] for name in (base, new)}
    pairs = []
    for r in rows:
        a = r["variants"].get(base, {}).get("ssim", {})
        b = r["variants"].get(new, {}).get("ssim", {})
        for n in a.keys() & b.keys():
            pairs.append((b[n] - a[n], r["h"], int(n), a[n], b[n]))
    if not pairs:
        print("没有可比的页")
        return
    m = len(pairs)
    print(f"课件 {len(rows)} 份，两边都有的页 {m}；转码失败：{base} {len(fails[base])} 份，{new} {len(fails[new])} 份")
    for label, k in ((base, 3), (new, 4)):
        vals = [p[k] for p in pairs]
        print(f"  {label}：平均 {sum(vals) / m:.4f}，SSIM ≥ 0.95 的页 {sum(v >= 0.95 for v in vals) / m:.1%}")
    worse = sorted(p for p in pairs if p[0] < -0.005)
    better = [p for p in pairs if p[0] > 0.005]
    print(f"  变好（>0.005）{len(better)} 页，变差（<-0.005）{len(worse)} 页；合计 {sum(p[0] for p in pairs):+.3f}")
    by_deck: dict[str, list] = {}
    for p in worse:
        by_deck.setdefault(p[1], []).append(p)
    print(f"  变差的页分布在 {len(by_deck)} 份课件；变差最多的课件：")
    for h, ps in sorted(by_deck.items(), key=lambda kv: (-len(kv[1]), kv[1][0][0]))[: args.top]:
        print(f"    {h}  {len(ps)} 页，最差 {ps[0][0]:+.4f}（第 {ps[0][2]} 页 {ps[0][3]:.4f} -> {ps[0][4]:.4f}）")
    print("  变差最多的页：")
    for p in worse[: args.top]:
        print(f"    {p[0]:+.4f}  {p[1]} 第 {p[2]} 页  {p[3]:.4f} -> {p[4]:.4f}")
    if fails[new]:
        print(f"  {new} 转码失败：{' '.join(fails[new][: args.top])}")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("cmd", choices=["run", "report"])
    ap.add_argument("dir")
    ap.add_argument("--cli", action="append", default=[])
    ap.add_argument("--workers", type=int, default=max(1, (os.cpu_count() or 2) // 2))
    ap.add_argument("--only", default=None)
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--priority", default="idle", choices=list(PRIORITY), help="idle：空闲（默认，不和别的程序抢）；below：低于正常（机器被别的普通优先级任务占满时用）")
    ap.add_argument("--work", default=None, help="临时产物放哪（默认系统临时目录；转完就删）")
    ap.add_argument("--base", default="old")
    ap.add_argument("--new", default="new")
    ap.add_argument("--top", type=int, default=30)
    ap.add_argument("--base-dir", default=None, help="report：旧版的分数从这个结果目录取")
    a = ap.parse_args()
    run(a) if a.cmd == "run" else report(a)


if __name__ == "__main__":
    main()
