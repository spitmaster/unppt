"""发版前的文档检查（只查能机械判断的部分，内容是否过时还要人看）：

  python tools/dev/doc_check.py [--since v0.2.6]

1. 文档里提到的源码文件（xxx.ts / .py / .mjs）还在不在（按文件名找，找不到就列出来）
2. 文档之间的相对链接（含 #锚点）指向的文件和标题还在不在
3. 给了 --since 时：列出这个版本以来改动过的源码目录，和提到这些目录的文档最后一次修改的时间，方便判断哪些文档该重看
"""
from __future__ import annotations

import argparse
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DOCS = sorted([*ROOT.glob("docs/*.md"), *ROOT.glob("docs/zh/**/*.md"), *ROOT.glob("docs/en/**/*.md"), ROOT / "README.md", ROOT / "README.en.md",
               *ROOT.glob("packages/*/README.md"), ROOT / "SPEC.md", ROOT / "CHANGELOG.md", ROOT / "CONTRIBUTING.md"])
SRC_EXT = (".ts", ".py", ".mjs")


def anchors(md: Path) -> set[str]:
    """GitHub 生成的标题锚点（小写、去掉标点、空格换成 -），加上手写的 <a id=...>"""
    out = set()
    for line in md.read_text(encoding="utf-8").splitlines():
        m = re.match(r"#+\s+(.*)", line)
        if m:
            t = re.sub(r"[^\w\- 一-鿿]", "", m.group(1).strip().lower())
            out.add(t.replace(" ", "-"))
        out.update(re.findall(r'<a\s+(?:id|name)="([^"]+)"', line))
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--since", default=None)
    a = ap.parse_args()
    sys.stdout.reconfigure(encoding="utf-8")
    files = {p.name for p in ROOT.glob("packages/**/*") if p.suffix in SRC_EXT and "node_modules" not in p.parts}
    files |= {p.name for p in ROOT.glob("tools/**/*") if p.suffix in SRC_EXT}
    files |= {p.name for p in ROOT.glob("scripts/*") if p.suffix in SRC_EXT}
    problems = 0
    for md in DOCS:
        if not md.exists():
            continue
        text = md.read_text(encoding="utf-8")
        rel = md.relative_to(ROOT).as_posix()
        # 不算的：举例用的占位名（xxx.ts）、以点开头的扩展名本身（.test.mjs）、.cache 里的临时脚本、示例代码里自己起的脚本名（不带目录的 .mjs / .py）
        missing = sorted({m for m in re.findall(r"[\w./-]+\.(?:ts|py|mjs)\b", text)
                          if m.split("/")[-1] not in files and not m.startswith(("http", ".")) and "xxx" not in m and ".cache/" not in m
                          and not ("/" not in m and m.endswith((".mjs", ".py")))})
        broken = []
        for target in re.findall(r"\]\(([^)\s]+)\)", text):
            if re.match(r"[a-z]+:", target):
                continue
            path, _, frag = target.partition("#")
            dest = (md.parent / path).resolve() if path else md
            if path and not dest.exists():
                broken.append(target)
            elif frag and dest.suffix == ".md" and dest.exists() and frag.lower() not in anchors(dest):
                broken.append(target)
        if missing or broken:
            problems += len(missing) + len(broken)
            print(f"{rel}")
            if missing:
                print(f"  提到但找不到的源码文件：{' '.join(missing[:15])}{' …' if len(missing) > 15 else ''}")
            if broken:
                print(f"  失效的链接：{' '.join(broken[:15])}{' …' if len(broken) > 15 else ''}")
    if a.since:
        changed = subprocess.run(["git", "diff", "--name-only", f"{a.since}..HEAD", "--", "packages"], cwd=ROOT, capture_output=True, text=True).stdout.split()
        dirs = sorted({"/".join(p.split("/")[:4]) for p in changed if p.endswith(".ts")})
        print(f"\n{a.since} 以来改过的源码目录（{len(changed)} 个文件）：")
        for d in dirs:
            n = sum(1 for p in changed if p.startswith(d + "/") or p == d)
            print(f"  {d}  {n} 个文件")
        print("对应的设计文档（改完代码要重看）：")
        for md in ("docs/architecture.md", "docs/zh/transcoding.md", "docs/zh/player.md", "docs/zh/output-format.md", "docs/zh/embedding.md"):
            last = subprocess.run(["git", "log", "-1", "--format=%ad %h", "--date=short", "--", md], cwd=ROOT, capture_output=True, text=True).stdout.strip()
            print(f"  {md}  最后修改 {last}")
    print(f"\n机械检查发现 {problems} 处问题" if problems else "\n机械检查没发现问题（内容是否过时还要人看）")


if __name__ == "__main__":
    main()
