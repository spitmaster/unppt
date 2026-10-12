"""开发工具共用：路径、样本登记（按内容哈希）、JSON 读写。

样本安全：这里产生的所有东西都只写进 .cache/，样本在日志和报告里只用哈希编号表示。
"""
from __future__ import annotations

import hashlib
import json
import sys
import time
from pathlib import Path

# Windows 控制台默认 GBK，统一输出 UTF-8
for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8")
    except Exception:
        pass

ROOT = Path(__file__).resolve().parent.parent
SAMPLES = ROOT / "samples"
TESTCASES = ROOT / "testcases"
CACHE = ROOT / ".cache"
REF = CACHE / "ref"              # PowerPoint 导出的参考结果，按哈希分目录
INDEX = CACHE / "samples.json"   # 样本清单：哈希 -> 路径等信息（只在本机）

PPT_EXTS = {".pptx", ".ppt", ".pptm", ".ppsx", ".pps"}


def file_hash(path: Path) -> str:
    h = hashlib.sha1()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()[:12]


def read_json(path: Path, default=None):
    if not path.exists():
        return default
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, data) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8", newline=chr(10))
    tmp.replace(path)


def scan_dir(root: Path) -> dict[str, dict]:
    """递归找出目录下所有 PPT 文件，按内容哈希归并（重复文件只算一个）。"""
    found: dict[str, dict] = {}
    if not root.exists():
        return found
    for p in sorted(root.rglob("*")):
        if not p.is_file() or p.suffix.lower() not in PPT_EXTS or p.name.startswith("~$"):
            continue
        h = file_hash(p)
        item = found.setdefault(h, {"paths": [], "ext": p.suffix.lower(), "size": p.stat().st_size})
        item["paths"].append(str(p.relative_to(ROOT)))
    return found


def update_index() -> tuple[dict, dict]:
    """扫描 samples/，更新样本清单。返回 (清单, 本次统计)。"""
    index = read_json(INDEX, {}) or {}
    found = scan_dir(SAMPLES)
    now = time.strftime("%Y-%m-%d %H:%M:%S")
    stats = {"total": len(found), "new": 0, "duplicates": 0, "removed": 0}
    for h, item in found.items():
        stats["duplicates"] += len(item["paths"]) - 1
        if h not in index:
            stats["new"] += 1
            index[h] = {"added": now, "status": "pending"}
        index[h].update(item)
        index[h]["present"] = True
    for h, item in index.items():
        if h not in found:
            if item.get("present", True):
                stats["removed"] += 1
            item["present"] = False
    write_json(INDEX, index)
    return index, stats


def testcase_index() -> dict[str, dict]:
    """testcases/ 下的用例，按文件名（不含扩展名）作为编号，参考结果放在 testcases/<名字>/ 下。"""
    out = {}
    for p in sorted(TESTCASES.glob("*.pptx")):
        out[p.stem] = {"paths": [str(p.relative_to(ROOT))], "ext": ".pptx", "ref": str((TESTCASES / p.stem).relative_to(ROOT))}
    return out
