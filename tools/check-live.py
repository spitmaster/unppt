"""直播课场景的端到端检查（只用合成测试用例）：演绎模式（老师）和观看模式（学生）两个页面，
测试脚本扮演外部程序，把老师端的事件转成学生端的指令，检查两边始终一致。

用法：python tools/check-live.py [chromium|firefox|webkit]
"""
from __future__ import annotations

import shutil
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import CACHE, ROOT  # noqa: E402

from playwright.sync_api import sync_playwright  # noqa: E402

OUT = CACHE / "live-test"
BROWSER = sys.argv[1] if len(sys.argv) > 1 else "chromium"
READY = 'window.unppt !== undefined && document.querySelector(".unppt-slide") && !document.querySelector(".unppt-loading")'
STATE = "async () => { const s = await window.unppt.getState(); return [s.slide, s.step] }"
failed = 0


def check(cond, msg):
    global failed
    print(("通过  " if cond else "失败  ") + msg)
    failed += not cond


def convert(case: str, name: str, form: str = "single"):
    out = OUT / name
    args = ["node", "packages/transcoder/dist/cli.js", "convert", f"testcases/{case}.pptx", "-q", "--system-fonts", "--output", form]
    subprocess.run(args + ["-o", str(out if form != "single" else out.with_suffix(".html"))], cwd=ROOT, check=True)
    return (out / "index.html" if form != "single" else out.with_suffix(".html")).resolve().as_uri()


def open_page(b, url: str):
    page = b.new_page(viewport={"width": 960, "height": 540})
    page.goto(url)
    page.wait_for_function(READY, timeout=20000)
    return page


def main():
    subprocess.run(["node", "scripts/build.mjs"], cwd=ROOT, check=True, capture_output=True)
    if OUT.exists():
        shutil.rmtree(OUT)
    OUT.mkdir(parents=True)
    hidden = convert("hidden-slides", "hidden")
    with sync_playwright() as p:
        mute = {"args": ["--mute-audio"]} if BROWSER == "chromium" else {"firefox_user_prefs": {"media.volume_scale": "0.0"}}
        b = getattr(p, BROWSER).launch(**mute)
        print(f"浏览器：{BROWSER}")

        # ---------------- 观看模式：没有按钮，点击、按键、滑动都不翻页，接口照常
        w = open_page(b, hidden + "?mode=watch")
        check(w.evaluate("!document.querySelector('.unppt-ui')"), "观看模式没有翻页按钮")
        s0 = w.evaluate(STATE)
        w.mouse.click(480, 270)
        w.keyboard.press("ArrowRight")
        w.keyboard.press("End")
        w.keyboard.press("b")
        w.wait_for_timeout(300)
        check(w.evaluate(STATE) == s0 and w.evaluate("!document.querySelector('.unppt-blank.unppt-show')"), f"观看模式点击、按键不翻页、不黑屏：{w.evaluate(STATE)}")
        w.evaluate("window.unppt.next()")
        w.wait_for_function(READY)
        check(w.evaluate(STATE) != s0, f"观看模式接口 next 能翻页：{w.evaluate(STATE)}")
        w.close()

        # ---------------- 演绎模式照旧：有按钮、按键翻页
        t = open_page(b, hidden + "?mode=present")
        check(t.evaluate("!!document.querySelector('.unppt-ui')"), "演绎模式有翻页按钮")
        s0 = t.evaluate(STATE)
        t.keyboard.press("ArrowRight")
        t.wait_for_function(READY)
        check(t.evaluate(STATE) != s0, "演绎模式按键翻页")
        t.close()
        b.close()
    print("\n全部通过" if not failed else f"\n{failed} 项失败")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
