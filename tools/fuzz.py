"""健壮性测试：随机破坏测试用例（删部件、截断 XML、改坏关系、乱改属性），检查转码器不会崩溃。

用法：python tools/fuzz.py [轮数=200]
只用 testcases/，不碰样本。
"""
from __future__ import annotations

import random
import re
import subprocess
import sys
import zipfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import CACHE, ROOT, TESTCASES  # noqa: E402

OUT = CACHE / "fuzz"


def mutate(src: Path, dst: Path, rnd: random.Random) -> str:
    z = zipfile.ZipFile(src)
    names = z.namelist()
    xmls = [n for n in names if n.endswith(".xml") or n.endswith(".rels")]
    kind = rnd.choice(["drop", "truncate", "badrel", "attr", "garbage", "dup"])
    target = rnd.choice([n for n in xmls if n != "[Content_Types].xml"] or xmls)
    with zipfile.ZipFile(dst, "w", zipfile.ZIP_DEFLATED) as out:
        for n in names:
            data = z.read(n)
            if n == target:
                if kind == "drop":
                    continue
                if kind == "truncate":
                    data = data[: rnd.randint(0, max(1, len(data) - 1))]
                elif kind == "badrel" and n.endswith(".rels"):
                    data = re.sub(rb'Target="[^"]*"', b'Target="../nothing/here.xml"', data, count=1)
                elif kind == "attr":
                    data = re.sub(rb'="(\d+)"', lambda m: b'="' + rnd.choice([b"-1", b"99999999999", b"abc", b"", b"0"]) + b'"', data, count=rnd.randint(1, 20))
                elif kind == "garbage":
                    data = bytes(rnd.getrandbits(8) for _ in range(rnd.randint(1, 200)))
                elif kind == "dup":
                    data = data + data
            out.writestr(n, data)
    return f"{kind}:{target}"


def main():
    rounds = int(sys.argv[1]) if len(sys.argv) > 1 else 200
    rnd = random.Random(int(sys.argv[2]) if len(sys.argv) > 2 else 42)
    subprocess.run(["node", "scripts/build.mjs"], cwd=ROOT, check=True, capture_output=True)
    cases = sorted(TESTCASES.glob("*.pptx"))
    OUT.mkdir(parents=True, exist_ok=True)
    crashes = []
    for i in range(rounds):
        src = rnd.choice(cases)
        dst = OUT / f"f{i:03d}.pptx"
        what = mutate(src, dst, rnd)
        r = subprocess.run(["node", "packages/transcoder/dist/cli.js", "convert", str(dst), "-o", str(OUT / f"f{i:03d}.html"), "-q"],
                           cwd=ROOT, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=120)
        if r.returncode != 0:
            msg = (r.stderr or "").strip().splitlines()[-1:] or ["?"]
            # 明确的错误提示（文件无效）是允许的；其它异常算崩溃
            if not any(k in msg[0] for k in ("不是有效的 pptx", "找不到演示文稿主部件", "演示文稿主部件为空", "zip")):
                crashes.append((src.name, what, msg[0][:200]))
    print(f"{rounds} 轮，崩溃 {len(crashes)} 次")
    for c in crashes[:30]:
        print("  ", c)
    sys.exit(1 if crashes else 0)


if __name__ == "__main__":
    main()
