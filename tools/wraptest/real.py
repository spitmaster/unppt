"""自动换行专项测试：真实课件的标准答案。用本机 PowerPoint 只读打开样本（禁用宏、不显示窗口），读出每个文本框里
实际排出的每一行，存到 .cache/wraptest/real/<编号>.json（只在本机，gitignore）。比对用 real.mjs。

用法：python tools/wraptest/real.py [份数，默认 100] [--from N]
"""
from __future__ import annotations

import json
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "tools" / "powerpoint"))
sys.path.insert(0, str(ROOT / "tools"))

import pythoncom  # noqa: E402
import win32com.client  # noqa: E402
from common import read_json  # noqa: E402
from export import _shape_info  # noqa: E402

OUT = ROOT / ".cache" / "wraptest" / "real"


def pick(count: int, start: int) -> list[str]:
    index = read_json(ROOT / ".cache" / "samples.json", {}) or {}
    hs = sorted(h for h, v in index.items() if v.get("present") and (ROOT / ".cache" / "ref" / h / "ref.json").exists())
    return hs[start:start + count]


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    count = int(args[0]) if args else 100
    start = int(sys.argv[sys.argv.index("--from") + 1]) if "--from" in sys.argv else 0
    index = read_json(ROOT / ".cache" / "samples.json", {})
    OUT.mkdir(parents=True, exist_ok=True)
    pythoncom.CoInitialize()
    app = win32com.client.DispatchEx("PowerPoint.Application")
    try:
        app.DisplayAlerts = 1
        app.AutomationSecurity = 3  # 强制禁用宏
    except Exception:
        pass
    done = 0
    t0 = time.time()
    try:
        for h in pick(count, start):
            out = OUT / f"{h}.json"
            if out.exists():
                continue
            ref = read_json(ROOT / ".cache" / "ref" / h / "ref.json", {}) or {}
            if not ref.get("ok"):
                continue
            src = ROOT / ".cache" / "ref" / h / "converted.pptx" if ref.get("converted") else ROOT / index[h]["paths"][0]
            try:
                pres = app.Presentations.Open(str(src.resolve()), True, False, False)
            except Exception:
                continue
            try:
                slides = [{"index": i, "shapes": [_shape_info(s) for s in sl.Shapes]} for i, sl in enumerate(pres.Slides)]
            except Exception:
                slides = None
            finally:
                pres.Close()
            if slides is not None:
                out.write_text(json.dumps({"slides": slides}, ensure_ascii=False), encoding="utf-8")
                done += 1
    finally:
        try:
            app.Quit()
        except Exception:
            pass
    print(f"{done} 份，用时 {time.time() - t0:.0f} 秒")


if __name__ == "__main__":
    main()
