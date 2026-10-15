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
        # 静音，并允许没有点击就自动播放（学生端由接口驱动音视频）
        mute = {"args": ["--mute-audio", "--autoplay-policy=no-user-gesture-required"]} if BROWSER == "chromium" else {"firefox_user_prefs": {"media.volume_scale": "0.0", "media.autoplay.default": 0}}
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
        t = open_page(b, hidden + "?mode=present&ui=0")
        s0 = t.evaluate(STATE)
        t.mouse.click(480, 270)
        t.wait_for_function(READY)
        check(t.evaluate("!document.querySelector('.unppt-ui')") and t.evaluate(STATE) != s0, "演绎模式 ui=0：没有按钮，点击照常翻页")
        t.close()

        # ---------------- 同步：老师端一路按键，外部程序把老师的状态用 sync 发给学生（单文件和按需加载两种学生端）
        for case in ("anim-entrance", "transitions"):
            lesson = convert(case, f"{case}-s")
            lesson_paged = convert(case, f"{case}-p", "paged")
            t = open_page(b, lesson + "?mode=present&timings=0")
            students = [open_page(b, lesson + "?mode=watch"), open_page(b, lesson_paged + "?mode=watch")]
            n = t.evaluate("async () => (await window.unppt.getState()).slideCount")
            same, animated, total = True, 0, 0
            for _ in range(min(40, n * 6)):
                t.keyboard.press("ArrowRight")
                ts = t.evaluate(STATE)
                for st in students:
                    st.evaluate("([s, k]) => window.unppt.sync({slide: s, step: k})", ts)
                    # 正好下一步时学生端也在播动画或切换（不是直接跳到结果）
                    animated += st.evaluate("document.getAnimations().length > 0 || document.querySelectorAll('.unppt-slide').length > 1 || !!document.querySelector('.unppt-loading')")
                    total += 1
                t.wait_for_timeout(50)
                for st in students:
                    st.wait_for_function(READY, timeout=20000)
                    same &= st.evaluate(STATE) == ts
            check(same, f"{case}：学生端（单文件、按需加载）每一步都和老师一致")
            check(animated > total * 0.6, f"{case}：大多数步骤学生端是播动画跟上的：{animated}/{total}")
        # 重复收到同一个状态什么都不做；中途进入直接对齐；跳着走（丢消息）也能对齐
        ts = t.evaluate(STATE)
        students[0].wait_for_function("document.getAnimations().length === 0", timeout=20000)
        r = students[0].evaluate("async ([s, k]) => { await window.unppt.sync({slide: s, step: k}); return document.getAnimations().length }", ts)
        check(r == 0, f"重复的同步消息不重播动画：{r}")
        late = open_page(b, lesson + "?mode=watch")
        late.evaluate("([s, k]) => window.unppt.sync({slide: s, step: k})", ts)
        late.wait_for_function(READY)
        check(late.evaluate(STATE) == ts, f"中途进入的学生直接对齐：{late.evaluate(STATE)} {ts}")
        late.evaluate("window.unppt.sync({slide: 0, step: 0})")
        late.evaluate("([s, k]) => window.unppt.sync({slide: s, step: k})", ts)
        late.wait_for_function(READY)
        check(late.evaluate(STATE) == ts, "丢了中间的消息也能对齐")

        # ---------------- 触发器、黑屏、音视频：老师端的 change 事件原样交给学生端的 sync
        # 注意要写成函数：evaluate 的结果是函数时 Playwright 会调用它（on 返回的是取消监听的函数）
        relay = "() => { window.__last = null; window.unppt.on('change', (s) => { window.__last = s; }); }"
        trig = convert("anim-trigger", "trigger")
        t = open_page(b, trig + "?mode=present&timings=0")
        t.evaluate(relay)
        st = open_page(b, trig + "?mode=watch")
        t.mouse.click(160, 235)
        t.wait_for_timeout(100)
        last = t.evaluate("window.__last")
        st.evaluate("(s) => window.unppt.sync(s)", last)
        st.wait_for_timeout(800)
        hidden_t = t.evaluate("document.querySelectorAll('.unppt-hide').length")
        hidden_s = st.evaluate("document.querySelectorAll('.unppt-hide').length")
        check(bool(last and last.get("triggers")) and hidden_t == hidden_s, f"触发器：老师点了按钮，学生端跟着播：{last and last.get('triggers')} 隐藏 {hidden_t}/{hidden_s}")
        t.keyboard.press("b")
        last = t.evaluate("window.__last")
        st.evaluate("(s) => window.unppt.sync(s)", last)
        check(last.get("blank") and st.evaluate("!!document.querySelector('.unppt-blank.unppt-show')"), f"黑屏同步：{last.get('blank')}")
        t.keyboard.press("Escape")
        last = t.evaluate("window.__last")
        st.evaluate("(s) => window.unppt.sync(s)", last)
        check(not last.get("blank") and st.evaluate("!document.querySelector('.unppt-blank.unppt-show')"), "回到幻灯片同步")
        t.close(); st.close()

        video = convert("media-video", "video")
        t = open_page(b, video + "?mode=present&timings=0")
        t.evaluate(relay)
        st = open_page(b, video + "?mode=watch")
        sv_js = "(() => { const v = document.querySelector('video'); return [!v.paused, v.currentTime]; })()"
        t.evaluate("document.querySelector('video').play()")
        t.wait_for_timeout(600)
        last = t.evaluate("window.__last")
        st.evaluate("(s) => window.unppt.sync(s)", last)
        st.wait_for_timeout(300)
        sv = st.evaluate(sv_js)
        check(bool(last and last.get("media")) and sv[0], f"视频播放同步：老师 {last and last.get('media')} 学生 {sv}")
        t.evaluate("(() => { const v = document.querySelector('video'); v.pause(); v.currentTime = 2.5; })()")
        t.wait_for_timeout(400)
        last = t.evaluate("window.__last")
        st.evaluate("(s) => window.unppt.sync(s)", last)
        st.wait_for_timeout(300)
        sv = st.evaluate(sv_js)
        check(not sv[0] and abs(sv[1] - 2.5) < 0.2, f"视频暂停、拖进度同步：老师 {last.get('media')} 学生 {sv}")

        # ---------------- 外部链接：新标签页打开，播放器页面不跳走；links=0 时只发事件
        links = convert("links", "links")
        ctx = b.new_context(viewport={"width": 960, "height": 540})
        lp = ctx.new_page()
        lp.goto(links + "?timings=0")
        lp.wait_for_function(READY)
        has = lp.evaluate("!!document.querySelector('[data-href]')")
        if not has:
            lp.evaluate("window.unppt.goto({slide: 1})")
            lp.wait_for_function(READY)
        box = lp.evaluate("(() => { const r = document.querySelector('[data-href]').getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; })()")
        before = lp.url
        with ctx.expect_page() as popup:
            lp.mouse.click(*box)
        popup.value.close()
        check(lp.url == before, "外部链接在新标签页打开，播放器页面没有跳走")
        lp.goto(links + "?timings=0&links=0")
        lp.wait_for_function(READY)
        if not has:
            lp.evaluate("window.unppt.goto({slide: 1})")
            lp.wait_for_function(READY)
        lp.evaluate("() => { window.__url = null; window.unppt.on('link', (s) => { window.__url = s.url; }); }")
        lp.mouse.click(*box)
        lp.wait_for_timeout(300)
        check(len(ctx.pages) == 1 and bool(lp.evaluate("window.__url")), f"links=0 不打开、只发 link 事件：{lp.evaluate('window.__url')}")
        ctx.close()
        b.close()
    print("\n全部通过" if not failed else f"\n{failed} 项失败")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
