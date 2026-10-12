"""播放器端到端测试（只用合成测试用例）：
1. 跨域 iframe：宿主页面和播放器分别在两个端口，用 postMessage 控制；
2. 同页 JS：window.unppt；
3. 原生 App WebView：模拟 Android 注入的 window.UnpptNative。

用法：python tools/check-player.py
"""
from __future__ import annotations

import functools
import http.server
import json
import shutil
import subprocess
import sys
import threading
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import CACHE, ROOT  # noqa: E402

from playwright.sync_api import sync_playwright  # noqa: E402

OUT = CACHE / "player-test"


def serve(directory: Path):
    class Quiet(http.server.SimpleHTTPRequestHandler):
        def log_message(self, *a):
            pass
    handler = functools.partial(Quiet, directory=str(directory))
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv, f"http://127.0.0.1:{srv.server_port}"


def check(cond, msg):
    print(("通过  " if cond else "失败  ") + msg)
    if not cond:
        check.failed += 1


check.failed = 0


def main():
    subprocess.run(["node", "scripts/build.mjs"], cwd=ROOT, check=True, capture_output=True)
    player_dir = OUT / "player"
    host_dir = OUT / "host"
    for d in (player_dir, host_dir):
        if d.exists():
            shutil.rmtree(d)
        d.mkdir(parents=True)
    subprocess.run(["node", "packages/transcoder/dist/cli.js", "convert", "testcases/anim-basic.pptx", "-o", str(player_dir / "index.html"), "-q", "--system-fonts"], cwd=ROOT, check=True)
    shutil.copy(ROOT / "examples/iframe-host.html", host_dir / "index.html")
    shutil.copy(ROOT / "packages/player/dist/host.js", host_dir / "host.js")
    s1, player_url = serve(player_dir)
    s2, host_url = serve(host_dir)

    with sync_playwright() as p:
        b = p.chromium.launch()
        # ---------------- 1. 跨域 iframe
        page = b.new_page()
        page.goto(f"{host_url}/index.html?src={player_url}/index.html")
        page.wait_for_function("window.deck !== undefined")
        st = page.evaluate("window.deck.ready")
        check(st["slideCount"] == 1 and st["stepCount"] == 5, f"跨域 iframe 收到 ready：{st}")
        st = page.evaluate("window.deck.next()")
        check(st["step"] == 1, f"next 之后到第 1 步：{st}")
        frame = page.frame_locator("iframe")
        hidden = frame.locator("[data-uid].unppt-hide").count()
        check(hidden == 3, f"第 1 步后还有 3 个形状处于隐藏：{hidden}")
        st = page.evaluate("window.deck.goto(0, 4)")
        check(st["step"] == 4, f"goto(0,4)：{st}")
        page.wait_for_timeout(100)
        hidden = frame.locator("[data-uid].unppt-hide").count()
        check(hidden == 0, f"第 4 步全部出现：{hidden}")
        st = page.evaluate("window.deck.next()")
        page.wait_for_timeout(1200)
        hidden = frame.locator("[data-uid].unppt-hide").count()
        check(st["step"] == 5 and hidden == 1, f"第 5 步是退出动画，结束后 1 个隐藏：{st} {hidden}")
        events = page.evaluate("document.getElementById('log').textContent")
        check("change" in events, "宿主收到了 change 事件")
        page.evaluate("window.deck.next()")
        page.wait_for_timeout(200)
        events = page.evaluate("document.getElementById('log').textContent")
        check("end" in events, "最后一步之后 next 收到 end 事件")

        # ---------------- 2. 同页 JS + 3. 原生 WebView
        page2 = b.new_page()
        page2.add_init_script("window.__native = []; window.UnpptNative = { postMessage: (m) => window.__native.push(m) };")
        page2.goto(f"{player_url}/index.html?slide=0&step=2")
        page2.wait_for_function("window.unppt !== undefined")
        st = page2.evaluate("window.unppt.getState()")
        check(st["step"] == 2, f"URL 参数打开到第 2 步：{st}")
        st = page2.evaluate("window.unppt.prev()")
        check(st["step"] == 1, f"同页 JS prev：{st}")
        reply = json.loads(page2.evaluate("""window.unppt.handle('{"cmd":"goto","args":{"slide":0,"step":3}}')"""))
        check(reply["ok"] and reply["result"]["step"] == 3, f"原生 handle 指令：{reply}")
        native = page2.evaluate("window.__native")
        kinds = [json.loads(m).get("event", "reply") for m in native]
        check("ready" in kinds and "change" in kinds and "reply" in kinds, f"原生端收到消息：{kinds}")
        bad = json.loads(page2.evaluate("window.unppt.handle('not json')"))
        check(not bad["ok"], "非法指令返回错误而不是崩溃")

        # ---------------- 移动端视口
        page3 = b.new_page(viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True)
        page3.goto(f"{player_url}/index.html")
        page3.wait_for_function("window.unppt !== undefined")
        box = page3.evaluate("(() => { const r = document.querySelector('.unppt-slide').getBoundingClientRect(); return [r.width, r.height]; })()")
        check(abs(box[0] - 390) < 1, f"手机竖屏宽度撑满、按比例缩放：{box}")
        b.close()
    s1.shutdown()
    s2.shutdown()
    print("\n全部通过" if not check.failed else f"\n{check.failed} 项失败")
    sys.exit(1 if check.failed else 0)


if __name__ == "__main__":
    main()
