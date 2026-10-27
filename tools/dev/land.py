"""把一个修复分支并进 dev：变基、自动解决 make.py 的用例冲突、构建、单元测试、合成用例全集和基线比，干净才合并。
只输出几行结论；有问题就停下并列出原因（不合并）。

  python tools/dev/land.py <worktree 目录> --baseline <基线 results.json> [--merge] [--allow 用例名,...]

- 分支在 worktree 里（git worktree，分支已检出）。先 git rebase dev：只有 tools/make-case/make.py 冲突时自动解决
  （两边的用例函数都留、CASES 取并集），别的文件冲突就中止变基、报告
- npm run build、npm test；tools/compare/run.py --set testcases --no-build（在 worktree 里跑，结果在它的 .cache/report）
- 和基线逐页比：任何一页下降超过 0.005 就不合并（--allow 列出的用例除外，例如改了规则、预期会变的）；列出变化超过 0.002 的页
- --merge：全部通过时在主仓库 git merge --ff-only 这个分支（不推送）
"""
from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from pathlib import Path

MAIN = Path(__file__).resolve().parents[2]
PY = sys.executable


def sh(cmd: list[str], cwd: Path, check: bool = False) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, encoding="utf-8", errors="replace", check=check, shell=cmd[0] == "npm")


def merge_cases(p: Path) -> int:
    """make.py 的冲突：两边的非 CASES 行都留，CASES 取并集（按出现顺序）"""
    s = p.read_text(encoding="utf-8")

    def one(m: re.Match) -> str:
        res, names = [], []
        for side in (m.group(1), m.group(2)):
            for line in side.splitlines(keepends=True):
                if line.startswith("CASES = ["):
                    for n in re.findall(r"[A-Za-z_]\w*", line[len("CASES = ["):]):
                        if n not in names:
                            names.append(n)
                else:
                    res.append(line)
        return "".join(res) + ("CASES = [" + ", ".join(names) + "]\n" if names else "")
    s2, n = re.subn(r"<<<<<<< [^\n]*\n(.*?)=======\n(.*?)>>>>>>> [^\n]*\n", one, s, flags=re.S)
    p.write_text(s2, encoding="utf-8", newline="\n")
    return n


def rebase(w: Path) -> str | None:
    """变基到 dev；返回 None 表示成功，否则是原因"""
    if sh(["git", "status", "--porcelain", "--untracked-files=no"], w).stdout.strip():
        return "worktree 有没提交的改动"
    r = sh(["git", "rebase", "dev"], w)
    for _ in range(50):
        if r.returncode == 0:
            return None
        bad = [f for f in sh(["git", "diff", "--name-only", "--diff-filter=U"], w).stdout.split() if f]
        if bad != ["tools/make-case/make.py"]:
            sh(["git", "rebase", "--abort"], w)
            return f"变基冲突：{' '.join(bad) or r.stderr.strip()[-200:]}"
        merge_cases(w / bad[0])
        sh(["git", "add", bad[0]], w)
        r = subprocess.run(["git", "-c", "core.editor=true", "rebase", "--continue"], cwd=w, capture_output=True, text=True, encoding="utf-8", errors="replace")
    sh(["git", "rebase", "--abort"], w)
    return "变基没完成"


def tc_diff(base: Path, new: Path, allow: set[str]) -> tuple[list, list, int]:
    def load(p: Path) -> dict:
        return {(c["key"], pg["img"]): pg["ssim"] for c in json.loads(p.read_text(encoding="utf-8")) for pg in c["pages"]}
    a, b = load(base), load(new)
    common = a.keys() & b.keys()
    drops = sorted((b[k] - a[k], k[1]) for k in common if b[k] - a[k] < -0.005 and k[0].removeprefix("tc-") not in allow)
    moved = sorted((b[k] - a[k], k[1]) for k in common if abs(b[k] - a[k]) > 0.002)
    return drops, moved, len(b.keys() - a.keys())


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("worktree")
    ap.add_argument("--baseline", required=True, help="合成用例基线（run.py 的 .cache/report/results.json 的副本）")
    ap.add_argument("--merge", action="store_true")
    ap.add_argument("--allow", default="", help="允许下降的用例名（逗号分隔，不带 tc- 前缀）")
    a = ap.parse_args()
    sys.stdout.reconfigure(encoding="utf-8")
    w = Path(a.worktree).resolve()
    branch = sh(["git", "rev-parse", "--abbrev-ref", "HEAD"], w).stdout.strip()

    def stop(msg: str) -> None:
        print(f"{branch}：不合并——{msg}")
        sys.exit(1)

    if (err := rebase(w)):
        stop(err)
    commits = sh(["git", "log", "--oneline", "dev..HEAD"], w).stdout.strip().splitlines()
    if not commits:
        stop("没有新提交")
    if sh(["npm", "run", "build"], w).returncode:
        stop("构建失败")
    t = sh(["npm", "test"], w)
    m = re.search(r"ℹ fail (\d+)", t.stdout)
    if t.returncode or not m or m.group(1) != "0":
        stop(f"单元测试失败（{m.group(1) if m else '?'} 个）")
    sh([PY, "tools/compare/run.py", "--set", "testcases", "--no-build"], w)
    res = w / ".cache" / "report" / "results.json"
    if not res.exists():
        stop("合成用例比对没有结果")
    drops, moved, added = tc_diff(Path(a.baseline), res, {x for x in a.allow.split(",") if x})
    sh(["git", "checkout", "--", "scores"], w)  # run.py 改写的分数文件不跟着分支走
    print(f"{branch}：{len(commits)} 个提交；构建、单元测试通过；合成用例新增 {added} 页，变化 > 0.002 的 {len(moved)} 页，下降 > 0.005 的 {len(drops)} 页")
    for d, k in moved[:15]:
        print(f"  {d:+.4f} {k}")
    if drops:
        stop("有合成用例页下降超过 0.005")
    if a.merge:
        r = sh(["git", "merge", "--ff-only", branch], MAIN)
        print("已合并进 dev（未推送）" if r.returncode == 0 else f"合并失败：{r.stderr.strip()[-200:]}")


if __name__ == "__main__":
    main()
