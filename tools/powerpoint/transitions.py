"""
页面切换、动画对照：用 PowerPoint 真正放映、带时间戳连续截图，和我们的播放器在同样时刻的画面比较。

    python tools/powerpoint/transitions.py capture FadeSmoothly,PushLeft,CircleOut [--dur 2]
    python tools/powerpoint/transitions.py capture-anim Fly:Left,Wipe:Bottom,Exit:Fade [--dur 2]
    python tools/powerpoint/transitions.py compare [--browser firefox] [--save 名字,...]

capture：生成中性用例（白/蓝两种背景交替，左上角一个色块标记），每页一种切换（名字是 PowerPoint 的
ppEffect 常量去掉前缀），放映时逐个调用"下一页"并以约 60 帧/秒截图，存到 .cache/transitions/。
capture-anim：每页白底上一个蓝色矩形（左上角带黄色标记，组合在一起），单击时播一种动画（名字是
msoAnimEffect 常量去掉前缀，冒号后是方向 msoAnimDirection，前面加 Exit: 是退出动画）。
compare：用我们的转码器转换同一个用例，把每个切换/动画停在 10%~90% 的时刻截图，按"蓝色所占比例"（alpha）
逐像素比较，打印平均误差和露出比例；--save 时把对照图存下来看。

只用合成的中性内容，不碰样本。只关闭这个脚本自己打开的演示文稿。
"""
import argparse
import subprocess
import sys
import time
from io import BytesIO
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / ".cache" / "transitions"
DECK = OUT / "deck.pptx"
US = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9]
WHITE, BLUE = (255, 255, 255), (0, 0, 255)


def rgb(c):
    return c[0] + c[1] * 256 + c[2] * 65536


def make_deck(app, names, dur):
    from win32com.client import gencache
    C = gencache.EnsureModule('{91493440-5A91-11CF-8700-00AA0060263B}', 0, 2, 12).constants
    p = app.Presentations.Add(0)
    p.PageSetup.SlideWidth, p.PageSetup.SlideHeight = 960, 540
    for i in range(len(names) + 1):
        s = p.Slides.Add(i + 1, 12)
        s.FollowMasterBackground = 0
        s.Background.Fill.Solid()
        s.Background.Fill.ForeColor.RGB = rgb(WHITE if i % 2 == 0 else BLUE)
        m = s.Shapes.AddShape(1, 40, 40, 160, 60)   # 标记：看位移和旋转
        m.Line.Visible = 0
        m.Fill.ForeColor.RGB = rgb((255, 0, 0) if i % 2 == 0 else (255, 255, 0))
        if i:
            s.SlideShowTransition.EntryEffect = getattr(C, "ppEffect" + names[i - 1])
            s.SlideShowTransition.Duration = dur
    return p


def make_anim_deck(app, specs, dur):
    from win32com.client import gencache
    C = gencache.EnsureModule('{91493440-5A91-11CF-8700-00AA0060263B}', 0, 2, 12).constants
    p = app.Presentations.Add(0)
    p.PageSetup.SlideWidth, p.PageSetup.SlideHeight = 960, 540
    for i, spec in enumerate(specs):
        parts = spec.split(":")
        exit_ = parts[0] == "Exit"
        if exit_:
            parts = parts[1:]
        s = p.Slides.Add(i + 1, 12)
        s.FollowMasterBackground = 0
        s.Background.Fill.Solid()
        s.Background.Fill.ForeColor.RGB = rgb(WHITE)
        a = s.Shapes.AddShape(1, 288, 162, 384, 216)
        a.Line.Visible = 0
        a.Fill.ForeColor.RGB = rgb(BLUE)
        b = s.Shapes.AddShape(1, 308, 182, 96, 40)
        b.Line.Visible = 0
        b.Fill.ForeColor.RGB = rgb((255, 255, 0))
        g = s.Shapes.Range([a.Name, b.Name]).Group()
        e = s.TimeLine.MainSequence.AddEffect(g, getattr(C, "msoAnimEffect" + parts[0]), 0, 1)
        if len(parts) > 1:
            e.EffectParameters.Direction = getattr(C, "msoAnimDirection" + parts[1])
        if exit_:
            e.Exit = -1
        e.Timing.Duration = dur
    return p


def grab(hwnd):
    import win32gui
    import win32ui
    from ctypes import windll
    l, t, r, b = win32gui.GetClientRect(hwnd)
    w, h = r - l, b - t
    hdc = win32gui.GetWindowDC(hwnd)
    mdc = win32ui.CreateDCFromHandle(hdc)
    sdc = mdc.CreateCompatibleDC()
    bmp = win32ui.CreateBitmap()
    bmp.CreateCompatibleBitmap(mdc, w, h)
    sdc.SelectObject(bmp)
    windll.user32.PrintWindow(hwnd, sdc.GetSafeHdc(), 3)
    a = np.frombuffer(bmp.GetBitmapBits(True), np.uint8).reshape(h, w, 4)[..., 2::-1].copy()
    win32gui.DeleteObject(bmp.GetHandle())
    sdc.DeleteDC()
    mdc.DeleteDC()
    win32gui.ReleaseDC(hwnd, hdc)
    return a


def capture(names, dur, anim=False):
    import pythoncom
    import win32com.client
    sys.path.insert(0, str(Path(__file__).parent))
    from export import _show_window
    OUT.mkdir(parents=True, exist_ok=True)
    pythoncom.CoInitialize()
    app = win32com.client.DispatchEx("PowerPoint.Application")
    before = {app.Presentations(i).FullName for i in range(1, app.Presentations.Count + 1)}
    try:
        p = make_anim_deck(app, names, dur) if anim else make_deck(app, names, dur)
        if DECK.exists():
            DECK.unlink()
        p.SaveAs(str(DECK))
        (OUT / "names.txt").write_text(",".join(names) + f"\n{dur}\n{'anim' if anim else 'trans'}\n", encoding="utf-8")
        ss = p.SlideShowSettings
        ss.ShowType = 2  # 窗口放映
        win = ss.Run()
        try:
            win.Width, win.Height = 500, 300
        except Exception:
            pass
        time.sleep(1.5)
        hwnd = _show_window()
        view = win.View
        for k, name in enumerate(names, start=2):
            # 切换：停在前一页，下一页时播第 k 页的切换；动画：停在第 k-1 页，下一步播它的单击动画
            view.GotoSlide(k - 1)
            time.sleep(dur + 0.8)
            frames, ts = [], []
            t0 = time.perf_counter()
            view.Next()
            while time.perf_counter() - t0 < dur + 0.6:
                frames.append(grab(hwnd))
                ts.append(time.perf_counter() - t0)
            np.savez_compressed(OUT / f"{safe(name)}.npz", f=np.stack(frames), t=np.array(ts))
            print(f"{name}: {len(frames)} 帧")
        view.Exit()
    finally:
        for i in range(app.Presentations.Count, 0, -1):
            pr = app.Presentations(i)
            if pr.FullName not in before:
                pr.Saved = True
                pr.Close()
        if app.Presentations.Count == 0:
            app.Quit()


def safe(name):
    return name.replace(":", "-")


def blueness(img):
    """蓝色所占比例：白 (255,255,255) 为 0，蓝 (0,0,255) 为 1（红、绿两个通道都降下去才算蓝）"""
    return np.clip((510 - img[..., 0] - img[..., 1]) / 510, 0, 1)


def alpha_frames(path, anim):
    """截图 -> 每帧的 alpha（切换按首尾两帧的颜色投影，动画按蓝色比例），去掉窗口黑边"""
    z = np.load(path)
    f, t = z["f"].astype(np.float32), z["t"]
    a = f[0].max(axis=2) if not anim else f[-1].max(axis=2)
    ys, xs = np.nonzero(a > 30)
    f = f[:, ys.min() + 3:ys.max() - 2, xs.min() + 3:xs.max() - 2]
    if anim:
        return np.stack([blueness(x) for x in f]), t
    old, new = f[0], f[-1]
    diff = new - old
    den = np.maximum((diff * diff).sum(axis=2), 1)
    return np.stack([np.clip(((x - old) * diff).sum(axis=2) / den, 0, 1) for x in f]), t


def compare(browser, save):
    from PIL import Image
    from playwright.sync_api import sync_playwright
    lines = (OUT / "names.txt").read_text(encoding="utf-8").split("\n")
    names, dur, anim = lines[0].split(","), float(lines[1]), lines[2] == "anim"
    html = OUT / "deck.html"
    subprocess.run(["node", "packages/transcoder/dist/cli.js", "convert", str(DECK), "-o", str(html), "-q"], cwd=ROOT, check=True)
    W, H = 640, 360
    mask = np.ones((H, W), bool)
    mask[: H // 4, : W // 3] = False   # 标记所在的角不算
    with sync_playwright() as pw:
        mute = {"args": ["--mute-audio"]} if browser == "chromium" else {"firefox_user_prefs": {"media.volume_scale": "0.0"}}
        b = getattr(pw, browser).launch(**mute)
        pg = b.new_page(viewport={"width": W, "height": H})
        pg.goto(html.resolve().as_uri() + "?timings=0")
        pg.wait_for_function("window.unppt !== undefined && !!document.querySelector('div.unppt-slide')")
        pg.add_style_tag(content=".unppt-ui{display:none!important}")
        for k, name in enumerate(names, start=2):
            new, old = (np.array(BLUE), np.array(WHITE)) if k % 2 == 0 else (np.array(WHITE), np.array(BLUE))
            diff = (new - old).astype(np.float32)
            ref_al, ref_t = alpha_frames(OUT / f"{safe(name)}.npz", anim)
            errs, covs = [], []
            for u in US:
                pg.evaluate(f"window.unppt.goto({k - 2})")
                pg.wait_for_timeout(60)
                pg.evaluate("""async (t) => {
                    window.unppt.next();
                    await new Promise(r => requestAnimationFrame(r));
                    for (const a of document.getAnimations()) { a.pause(); a.currentTime = t; }
                    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
                }""", u * dur * 1000)
                shot = np.asarray(Image.open(BytesIO(pg.screenshot())).convert("RGB")).astype(np.float32)
                pg.evaluate("for (const a of document.getAnimations()) a.finish()")
                ours = blueness(shot) if anim else np.clip(((shot - old) * diff).sum(axis=2) / (diff * diff).sum(), 0, 1)
                # PowerPoint 放映的画面比调用"下一页"晚约 20 毫秒
                i = int(np.argmin(np.abs(ref_t - (u * dur + 0.02))))
                ref = np.asarray(Image.fromarray((ref_al[i] * 255).astype(np.uint8)).resize((W, H))).astype(np.float32) / 255
                errs.append(float(np.abs(ours - ref)[mask].mean()))
                covs.append((float(ref[mask].mean()), float(ours[mask].mean())))
                if name in save:
                    Image.fromarray((np.concatenate([ref, ours], axis=1) * 255).astype(np.uint8)).save(OUT / f"cmp-{safe(name)}-{int(u * 100):02d}.png")
            print(f"{name:22s} 误差 {np.mean(errs):.3f} |", " ".join(f"{e:.2f}" for e in errs),
                  "| 露出比例 PowerPoint/我们", " ".join(f"{a:.2f}/{c:.2f}" for a, c in covs))
        b.close()


def main():
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    for cmd in ("capture", "capture-anim"):
        c = sub.add_parser(cmd)
        c.add_argument("names")
        c.add_argument("--dur", type=float, default=2.0)
    m = sub.add_parser("compare")
    m.add_argument("--browser", default="chromium")
    m.add_argument("--save", default="")
    a = ap.parse_args()
    if a.cmd in ("capture", "capture-anim"):
        capture(a.names.split(","), a.dur, a.cmd == "capture-anim")
    else:
        compare(a.browser, set(filter(None, a.save.split(","))))


if __name__ == "__main__":
    main()
