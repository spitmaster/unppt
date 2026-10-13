"""播放器端到端测试（只用合成测试用例）：
1. 跨域 iframe：宿主页面和播放器分别在两个端口，用 postMessage 控制；
2. 同页 JS：window.unppt；
3. 原生 App WebView：模拟 Android 注入的 window.UnpptNative。

用法：python tools/check-player.py [chromium|firefox|webkit]
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
BROWSER = sys.argv[1] if len(sys.argv) > 1 else "chromium"


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
    subprocess.run(["node", "packages/transcoder/dist/cli.js", "convert", "testcases/anim-iterate.pptx", "-o", str(player_dir / "iterate.html"), "-q"], cwd=ROOT, check=True)
    subprocess.run(["node", "packages/transcoder/dist/cli.js", "convert", "testcases/anim-path.pptx", "-o", str(player_dir / "path.html"), "-q"], cwd=ROOT, check=True)
    subprocess.run(["node", "packages/transcoder/dist/cli.js", "convert", "testcases/anim-emphasis.pptx", "-o", str(player_dir / "emph.html"), "-q"], cwd=ROOT, check=True)
    subprocess.run(["node", "packages/transcoder/dist/cli.js", "convert", "testcases/transitions.pptx", "-o", str(player_dir / "trans.html"), "-q"], cwd=ROOT, check=True)
    subprocess.run(["node", "packages/transcoder/dist/cli.js", "convert", "testcases/anim-entrance.pptx", "-o", str(player_dir / "entr.html"), "-q"], cwd=ROOT, check=True)
    subprocess.run(["node", "packages/transcoder/dist/cli.js", "convert", "testcases/hidden-slides.pptx", "-o", str(player_dir / "hidden.html"), "-q"], cwd=ROOT, check=True)
    subprocess.run(["node", "packages/transcoder/dist/cli.js", "convert", "testcases/media-background.pptx", "-o", str(player_dir / "bgm.html"), "-q"], cwd=ROOT, check=True)
    subprocess.run(["node", "packages/transcoder/dist/cli.js", "convert", "testcases/transition-morph.pptx", "-o", str(player_dir / "morph.html"), "-q"], cwd=ROOT, check=True)
    subprocess.run(["node", "packages/transcoder/dist/cli.js", "convert", "testcases/text-embedded-fonts.pptx", "-o", str(player_dir / "embfont.html"), "-q"], cwd=ROOT, check=True)
    subprocess.run(["node", "packages/transcoder/dist/cli.js", "convert", "testcases/anim-repeat.pptx", "-o", str(player_dir / "repeat.html"), "-q"], cwd=ROOT, check=True)
    s1, player_url = serve(player_dir)
    s2, host_url = serve(host_dir)

    with sync_playwright() as p:
        b = getattr(p, BROWSER).launch()
        print(f"浏览器：{BROWSER}")
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

        # ---------------- 4. 文字逐字动画
        page4 = b.new_page()
        page4.goto(f"{player_url}/iterate.html")
        page4.wait_for_function("window.unppt !== undefined")
        page4.evaluate("window.unppt.next()")
        page4.wait_for_timeout(200)
        js = """(() => { const el = document.querySelector('.unppt-slide [data-uid]:not(.unppt-hide) text')?.closest('[data-uid]');
          const ts = Array.from(el ? el.querySelectorAll('tspan') : []).filter(t => t.textContent.trim());
          const op = ts.map(t => Number(getComputedStyle(t).fillOpacity));
          return [ts.length, op.filter(o => o > 0.01).length, op.filter(o => o < 0.01).length]; })()"""
        n, shown, hidden_ = page4.evaluate(js)
        check(n > 10 and shown > 0 and hidden_ > 0, f"逐字淡入播到一半：{n} 个字，已开始出现 {shown}，未出现 {hidden_}")
        page4.wait_for_timeout(3000)
        n, shown, hidden_ = page4.evaluate(js)
        check(n > 10 and shown == n, f"逐字淡入播完全部出现：{n} 个字，已出现 {shown}")
        # 逐字飞入：每个字拆成单独的 text，中途有的在路上，播完全部落回原位
        page4.evaluate("window.unppt.goto(0, 2)")
        page4.evaluate("window.unppt.next()")
        page4.wait_for_timeout(250)
        js4 = """(() => { const us = Array.from(document.querySelectorAll('div.unppt-slide .unppt-unit'));
          return [us.length, us.filter(u => getComputedStyle(u).transform !== 'none' && !/^matrix\(1, 0, 0, 1, 0, 0\)$/.test(getComputedStyle(u).transform)).length]; })()"""
        mid4 = page4.evaluate(js4)
        page4.wait_for_timeout(2500)
        end4 = page4.evaluate(js4)
        check(mid4[0] > 10 and mid4[1] > 0 and end4[1] == 0, f"逐字飞入中途有字在路上、播完落回原位：{mid4} -> {end4}")
        page4.evaluate("window.unppt.goto(0, 3)")
        page4.evaluate("window.unppt.next()")
        page4.wait_for_timeout(4000)
        hidden = page4.locator("[data-uid].unppt-hide").count()
        check(hidden == 1, f"逐字退出播完后整个形状隐藏：{hidden}")
        st = page4.evaluate("window.unppt.prev()")
        page4.wait_for_timeout(100)
        hidden = page4.locator("[data-uid].unppt-hide").count()
        check(hidden == 0, f"退回上一步后全部可见：{hidden}")

        # ---------------- 5. 路径动画沿路径移动（第一个是闭合的圆形路径，终点回到原处）
        page5 = b.new_page()
        page5.goto(f"{player_url}/path.html")
        page5.wait_for_function("window.unppt !== undefined")
        page5.evaluate("window.unppt.next()")
        page5.wait_for_timeout(700)
        mid = page5.evaluate("""(() => { const el = document.querySelector('.unppt-slide [data-uid]');
          const m = new DOMMatrix(getComputedStyle(el).transform); return [m.e, m.f]; })()""")
        page5.wait_for_timeout(2500)
        end = page5.evaluate("""(() => { const el = document.querySelector('.unppt-slide [data-uid]');
          const m = new DOMMatrix(getComputedStyle(el).transform); return [m.e, m.f]; })()""")
        check(abs(mid[0]) + abs(mid[1]) > 20, f"圆形路径播放中途离开了原位：{[round(v) for v in mid]}")
        check(abs(end[0]) + abs(end[1]) < 2, f"圆形路径播完回到原位：{[round(v) for v in end]}")

        # ---------------- 6. 脉冲（放大再复原）：中途放大，播完复原
        page6 = b.new_page()
        page6.goto(f"{player_url}/emph.html?slide=0&step=1")
        page6.wait_for_function("window.unppt !== undefined")
        page6.evaluate("window.unppt.next()")
        page6.wait_for_timeout(250)
        js6 = """(() => { const el = Array.from(document.querySelectorAll('.unppt-slide [data-uid]')).filter(e => /^s[0-9]+$/.test(e.getAttribute('data-uid')))[1];
          const m = new DOMMatrix(getComputedStyle(el).transform); return m.a; })()"""
        mid = page6.evaluate(js6)
        page6.wait_for_timeout(1000)
        end = page6.evaluate(js6)
        check(mid > 1.01 and abs(end - 1) < 0.001, f"脉冲中途放大、播完复原：{mid:.3f} -> {end:.3f}")

        # ---------------- 7. 各种页面切换：翻页播完后只剩新的一页，没有脚本错误
        page7 = b.new_page()
        errors = []
        page7.on("pageerror", lambda e: errors.append(str(e)))
        page7.goto(f"{player_url}/trans.html")
        page7.wait_for_function("window.unppt !== undefined && !!document.querySelector('div.unppt-slide')")
        n = page7.evaluate("window.unppt.getState()")["slideCount"]
        bad = []
        for k in range(1, n):
            page7.evaluate("window.unppt.next()")
            page7.wait_for_timeout(2300)
            st = page7.evaluate("window.unppt.getState()")["slide"]
            left = page7.evaluate("document.querySelectorAll('div.unppt-slide').length")
            if st != k or left != 1:
                bad.append((k, st, left))
        check(n > 10 and not bad and not errors, f"{n - 1} 种切换都正常结束：{bad} {errors[:2]}")

        # ---------------- 8. 进入效果（形状、轮子、百叶窗……）：播放中途有裁剪，播完完整显示
        page8 = b.new_page()
        errors8 = []
        page8.on("pageerror", lambda e: errors8.append(str(e)))
        page8.goto(f"{player_url}/entr.html")
        page8.wait_for_function("window.unppt !== undefined && !!document.querySelector('div.unppt-slide')")
        js8 = """(k) => { const el = Array.from(document.querySelectorAll('div.unppt-slide [data-uid]')).filter(e => /^s[0-9]+$/.test(e.getAttribute('data-uid')))[k];
          return getComputedStyle(el).clipPath; }"""
        bad8 = []
        for k in (0, 6, 7):   # 方框向内、轮子、百叶窗
            page8.evaluate(f"window.unppt.goto(0, {k})")
            page8.evaluate("window.unppt.next()")
            page8.wait_for_timeout(200)
            mid = page8.evaluate(js8, k)
            page8.wait_for_timeout(2200)
            end = page8.evaluate(js8, k)
            if mid in ("none", "") or end not in ("none", ""):
                bad8.append((k, mid[:30], end[:30]))
        check(not bad8 and not errors8, f"进入效果播放中途有裁剪、播完完整显示：{bad8} {errors8[:1]}")

        # ---------------- 9. 隐藏的幻灯片：顺序翻页跳过，超链接可以跳过去，从隐藏页继续往后
        page9 = b.new_page()
        page9.goto(f"{player_url}/hidden.html")
        page9.wait_for_function("window.unppt !== undefined && !!document.querySelector('div.unppt-slide')")
        seq = [page9.evaluate("window.unppt.getState()")["slide"]]
        seq.append(page9.evaluate("window.unppt.next()")["slide"])
        page9.evaluate("window.unppt.goto(0, 0)")
        page9.wait_for_timeout(100)
        page9.click("div.unppt-slide [data-link]")
        page9.wait_for_timeout(200)
        seq.append(page9.evaluate("window.unppt.getState()")["slide"])
        seq.append(page9.evaluate("window.unppt.next()")["slide"])
        check(seq == [0, 2, 1, 2], f"隐藏页：顺序翻页跳过、链接能跳过去、之后继续往后：{seq}")

        # ---------------- 10. 背景音乐跨 3 页播放：翻页不停，超出范围停止
        page10 = b.new_page()
        page10.goto(f"{player_url}/bgm.html")
        page10.wait_for_function("window.unppt !== undefined && !!document.querySelector('div.unppt-slide')")
        outside = """Array.from(document.querySelectorAll('audio')).filter(a => !a.closest('div.unppt-slide')).map(a => a.loop)"""
        page10.evaluate("window.unppt.next()")
        r10 = [page10.evaluate(outside)]
        for k in (1, 2, 3):
            page10.evaluate(f"window.unppt.goto({k}, 0)")
            r10.append(page10.evaluate(outside))
        check(r10 == [[True], [True], [True], []], f"背景音乐跨页、循环、超出范围停止：{r10}")
        page10.evaluate("window.unppt.goto(0, 0)")
        page10.evaluate("window.unppt.next()")
        t10 = page10.evaluate("(() => { const a = document.querySelector('audio'); return [a.dataset.trimStart, a.dataset.trimEnd, Math.round(a.currentTime * 100) / 100]; })()")
        check(t10 == ['0.3', '0.2', 0.3], f"剪裁过的音频从剪裁起点开始：{t10}")

        # ---------------- 11. 平滑切换：同名对象中途在旧位置和新位置之间（新旧两份交叉淡化），播完只剩新页
        page11 = b.new_page()
        errors11 = []
        page11.on("pageerror", lambda e: errors11.append(str(e)))
        page11.goto(f"{player_url}/morph.html")
        page11.wait_for_function("window.unppt !== undefined && !!document.querySelector('div.unppt-slide')")
        js11 = """(() => { const s = document.querySelectorAll('div.unppt-slide'); const cur = s[s.length - 1];
          const els = Array.from(cur.querySelectorAll('[data-name="圆"]'));
          return [s.length, els.length, els.every(e => getComputedStyle(e).transform !== 'none')]; })()"""
        page11.evaluate("window.unppt.next()")
        page11.wait_for_timeout(1000)
        mid11 = page11.evaluate(js11)
        page11.wait_for_timeout(1500)
        end11 = page11.evaluate(js11)
        check(mid11 == [2, 2, True] and end11 == [1, 1, False] and not errors11, f"平滑切换中途变形、播完复原：{mid11} -> {end11} {errors11[:1]}")

        # ---------------- 12. 演示文稿里嵌入的字体（MicroType Express 解压后再子集化）：浏览器能正常加载
        page12 = b.new_page()
        page12.goto(f"{player_url}/embfont.html")
        page12.wait_for_function("window.unppt !== undefined && !!document.querySelector('div.unppt-slide')")
        st12 = page12.evaluate("""(async () => { await document.fonts.ready; const fs = Array.from(document.fonts).filter(f => f.family.includes('unppt-f'));
          await Promise.all(fs.map(f => f.load().catch(() => null))); return fs.map(f => f.status); })()""")
        check(len(st12) == 2 and all(s == "loaded" for s in st12), f"嵌入字体加载成功：{st12}")

        # ---------------- 13. 动画重复和自动翻转：重复次数、播完翻回原样、"直到下一次单击"被点击打断
        page13 = b.new_page()
        errors13 = []
        page13.on("pageerror", lambda e: errors13.append(str(e)))
        page13.goto(f"{player_url}/repeat.html")
        page13.wait_for_function("window.unppt !== undefined && !!document.querySelector('div.unppt-slide')")
        iters = "(() => Array.from(document.getAnimations()).map(a => a.effect.getComputedTiming().iterations))()"
        page13.evaluate("window.unppt.next()")
        it1 = page13.evaluate(iters)
        page13.evaluate("window.unppt.next()")
        page13.wait_for_timeout(200)
        it2 = page13.evaluate(iters)
        page13.wait_for_timeout(4500)
        tf2 = page13.evaluate("(() => { const el = Array.from(document.querySelectorAll('div.unppt-slide [data-uid]')).filter(e => /^s[0-9]+$/.test(e.getAttribute('data-uid')))[1]; return getComputedStyle(el).transform; })()")
        page13.evaluate("window.unppt.goto(0, 3)")
        page13.evaluate("window.unppt.next()")
        page13.wait_for_timeout(300)
        it4 = page13.evaluate(iters)
        st13 = page13.evaluate("window.unppt.next()")
        page13.wait_for_timeout(100)
        left = page13.evaluate("document.getAnimations().length")
        check(2 in it1 and 2 in it2 and tf2 in ("none", "matrix(1, 0, 0, 1, 0, 0)") and None in [None if x != x or x == float("inf") else 0 for x in it4] and left == 0 and not errors13,
              f"重复 2 次 {it1}、自动翻转 {it2} 播完复原 {tf2}、一直重复 {it4} 点击后停止 {left} {errors13[:1]}")

        # ---------------- 移动端视口
        mobile = {"is_mobile": True} if BROWSER != "firefox" else {}
        page3 = b.new_page(viewport={"width": 390, "height": 844}, has_touch=True, **mobile)
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
