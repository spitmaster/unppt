"""调本机 PowerPoint，为每个样本导出参考结果（标准答案）。

用法：
  python tools/powerpoint/export.py scan                 # 登记 samples/ 里的样本，报告新增/重复/删除
  python tools/powerpoint/export.py run [--set all|testcases] [--force] [--only 哈希] [--static] [--until HH:MM]
  python tools/powerpoint/export.py one <pptx> <输出目录>  # 内部用：处理单个文件（子进程）

每个样本的输出（.cache/ref/<哈希>/，测试用例则在 testcases/<名字>/）：
  ref.json                 幻灯片尺寸、每页形状位置、每行文字位置、动画时间线、每页步数
  slide-001.png            每页静态图（宽 1280）
  slide-001-step-00.png    有点击动画的页：每个步骤结束时的画面
  converted.pptx           老格式 .ppt 另存成的 pptx（只有 .ppt 才有）

静态图先导出 BMP 再无损转成 PNG：PowerPoint 直接导出的 PNG 是调色板图（灰度只剩 16 级、带抖动），
浅色底纹会变成网点，和放映时看到的不一样。
环境变量 UNPPT_KEEP_SLIDESHOW=1：已有放映截图的步骤图原样保留、不重新放映（重导参考图时不弹放映窗口）。

--static：只导每页静态图、页尺寸和隐藏页（不读形状和文字行、不做动画步骤，快很多），大批量样本用。
--until HH:MM：到点把当前这份导完就停，下次运行接着导（下班放一批，第二天上班前自己停）。
打开文件一律只读、强制禁用宏；不更新链接，不填密码。

注意：PowerPoint 只有一个实例。运行前如果你自己开着 PowerPoint，脚本会拒绝运行（避免动到你的文档）。
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import time
import traceback
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from common import REF, ROOT, read_json, testcase_index, update_index, write_json  # noqa: E402

EXPORT_WIDTH = 1280
TIMEOUT_SEC = 600
STATIC_TIMEOUT_SEC = 300
VERSION = 8  # 输出格式变化时加 1，会触发重新导出（5：只有段落/强调/路径动画才用放映截图；8：静态图先导 BMP 再转 PNG）

# PowerPoint / Office 常量
PP_SAVE_AS_PPTX = 24
MSO_TRUE = -1
MSO_FALSE = 0
MSO_GROUP = 6
TRIGGER_ON_CLICK = 1
TRIGGER_WITH_PREV = 2
TRIGGER_AFTER_PREV = 3


# ---------------------------------------------------------------- 单个文件（子进程里运行）

def _num(v):
    try:
        return round(float(v), 3)
    except Exception:
        return None


def _file_slide_size(src: Path) -> tuple[float, float] | tuple[None, None]:
    """pptx 文件里写的页面尺寸（磅）；读不到时 (None, None)"""
    import re
    import zipfile
    try:
        with zipfile.ZipFile(src) as z:
            m = re.search(rb'<p:sldSz cx="(\d+)" cy="(\d+)"', z.read("ppt/presentation.xml"))
        return (int(m.group(1)) / 12700, int(m.group(2)) / 12700) if m else (None, None)
    except Exception:
        return None, None


def _text_lines(shape):
    """读出文本框里每一行：起止字符、文字、外框（单位：磅）。"""
    lines = []
    try:
        if not shape.HasTextFrame or not shape.TextFrame.HasText:
            return lines
        tr = shape.TextFrame.TextRange
        i = 1
        while i < 2000:
            ln = tr.Lines(i, 1)
            if ln.Length == 0:
                break
            lines.append({
                "start": ln.Start - 1, "len": ln.Length, "text": ln.Text,
                "x": _num(ln.BoundLeft), "y": _num(ln.BoundTop),
                "w": _num(ln.BoundWidth), "h": _num(ln.BoundHeight),
            })
            i += 1
    except Exception as e:  # 有些形状（比如 SmartArt 内部）读不了行信息
        lines.append({"error": str(e)[:200]})
    return lines


def _shape_info(shape):
    info = {
        "id": shape.Id, "name": shape.Name, "type": shape.Type,
        "x": _num(shape.Left), "y": _num(shape.Top), "w": _num(shape.Width), "h": _num(shape.Height),
        "rot": _num(shape.Rotation), "visible": shape.Visible == MSO_TRUE,
    }
    try:
        info["autoShapeType"] = shape.AutoShapeType
    except Exception:
        pass
    if shape.Type == MSO_GROUP:
        info["children"] = [_shape_info(c) for c in shape.GroupItems]
    else:
        lines = _text_lines(shape)
        if lines:
            info["lines"] = lines
    return info


def _interactive_hidden(slide):
    """触发器动画里先出现的形状：放映开始时是隐藏的"""
    out = set()
    try:
        seqs = slide.TimeLine.InteractiveSequences
        for k in range(1, seqs.Count + 1):
            seq = seqs.Item(k)
            seen = set()
            for i in range(1, seq.Count + 1):
                e = seq.Item(i)
                sid = e.Shape.Id
                if sid in seen:
                    continue
                seen.add(sid)
                if not e.Exit:
                    out.add(sid)
    except Exception:
        pass
    return out


def _timeline(slide):
    effects = []
    seq = slide.TimeLine.MainSequence
    for i in range(1, seq.Count + 1):
        e = seq.Item(i)
        item = {"index": i, "type": e.EffectType, "exit": bool(e.Exit),
                "trigger": e.Timing.TriggerType, "dur": _num(e.Timing.Duration),
                "delay": _num(e.Timing.TriggerDelayTime)}
        try:
            item["shapeId"] = e.Shape.Id
        except Exception:
            item["shapeId"] = None
        try:
            item["paragraph"] = e.Paragraph
        except Exception:
            item["paragraph"] = 0
        effects.append(item)
    return effects


def _click_groups(effects):
    """按点击把效果分组。第 0 组是进入页面时自动播放的（第一次点击之前）。"""
    groups = [[]]
    for e in effects:
        if e["trigger"] == TRIGGER_ON_CLICK:
            groups.append([e])
        else:
            groups[-1].append(e)
    return groups


def _step_visibility(effects):
    """算出每个步骤结束时各形状是否可见。只处理整体出现/消失，段落级动画标记为近似。"""
    groups = _click_groups(effects)
    first = {}
    for e in effects:
        if e["shapeId"] is not None and e["shapeId"] not in first:
            first[e["shapeId"]] = e
    visible = {sid: e["exit"] for sid, e in first.items()}  # 先有进入动画的，开始时隐藏
    states = []
    for g in groups:
        for e in g:
            if e["shapeId"] is None or e.get("paragraph"):
                continue
            # 强调动画（type 在强调区间）不改变可见性；这里只看 exit 标志区分进入/退出
            if e["exit"]:
                visible[e["shapeId"]] = False
            elif _is_entrance(e):
                visible[e["shapeId"]] = True
        states.append(dict(visible))
    return states


def _is_entrance(e):
    # 强调效果的 EffectType 是 msoAnimEffectChangeFillColor 等（大致 54~ 区间且非 exit），
    # PowerPoint 没有直接区分进入/强调的属性，这里用"是否在该形状第一个效果里"兜底：
    # 首个效果非 exit 视为进入。精确分类交给转码器自己解析 XML 的 presetClass。
    return True


# ---------------------------------------------------------------- 放映截图（动画步骤的标准答案）

def _ppt_pids():
    r = subprocess.run(["tasklist", "/FI", "IMAGENAME eq POWERPNT.EXE", "/FO", "CSV", "/NH"], capture_output=True, text=True)
    out = set()
    for line in r.stdout.splitlines():
        parts = [x.strip('"') for x in line.split('","')]
        if len(parts) > 1 and parts[1].isdigit():
            out.add(int(parts[1]))
    return out


def _show_window():
    import win32gui
    import win32process
    pids = _ppt_pids()
    found = []

    def cb(h, _):
        _, pid = win32process.GetWindowThreadProcessId(h)
        if pid in pids and win32gui.IsWindowVisible(h) and win32gui.GetClassName(h) == "PPTFrameClass" and "放映" in win32gui.GetWindowText(h) + "Slide Show":
            found.append(h)
    win32gui.EnumWindows(cb, None)
    return found[0] if found else None


def _grab(hwnd, width: int, height: int):
    """截取放映窗口，裁掉四周黑边，缩放到参考图尺寸"""
    import numpy as np
    import win32gui
    import win32ui
    from ctypes import windll
    from PIL import Image
    l, t, r, b = win32gui.GetClientRect(hwnd)
    w, h = r - l, b - t
    hdc = win32gui.GetWindowDC(hwnd)
    mdc = win32ui.CreateDCFromHandle(hdc)
    sdc = mdc.CreateCompatibleDC()
    bmp = win32ui.CreateBitmap()
    bmp.CreateCompatibleBitmap(mdc, w, h)
    sdc.SelectObject(bmp)
    windll.user32.PrintWindow(hwnd, sdc.GetSafeHdc(), 3)
    info = bmp.GetInfo()
    im = Image.frombuffer("RGB", (info["bmWidth"], info["bmHeight"]), bmp.GetBitmapBits(True), "raw", "BGRX", 0, 1)
    win32gui.DeleteObject(bmp.GetHandle())
    sdc.DeleteDC()
    mdc.DeleteDC()
    win32gui.ReleaseDC(hwnd, hdc)
    # 幻灯片在放映窗口里居中显示、四周可能有黑边：先找出非黑色的画面范围
    ratio = width / height
    a = np.asarray(im.convert("L"))
    rows = np.where(a.max(axis=1) > 24)[0]
    cols = np.where(a.max(axis=0) > 24)[0]
    if len(rows) and len(cols):
        bx0, bx1, by0, by1 = cols[0], cols[-1] + 1, rows[0], rows[-1] + 1
        if abs((bx1 - bx0) / max(1, by1 - by0) - ratio) / ratio < 0.02:
            return im.crop((bx0, by0, bx1, by1)).resize((width, height), Image.LANCZOS)
    # 检测不出来（比如幻灯片本身是黑底）：按宽高比居中裁剪
    if w / h > ratio:
        sw, sh = round(h * ratio), h
    else:
        sw, sh = w, round(w / ratio)
    x0, y0 = (w - sw) // 2, (h - sh) // 2
    return im.crop((x0, y0, x0 + sw, y0 + sh)).resize((width, height), Image.LANCZOS)


def _group_wait(effects) -> float:
    """估算一组动画播完需要的秒数（偏保守）"""
    total = 0.0
    for e in effects:
        total += (e.get("dur") or 0.5) + (e.get("delay") or 0)
    return (min(total, 15) + 0.6) * float(os.environ.get("UNPPT_WAIT_SCALE", "1"))


def needs_slideshow(effects) -> bool:
    """只有"显示/隐藏"模拟不了的动画才用放映截图：段落动画、强调效果、路径动画。
    放映截图和静态导出之间有几个像素的错位，普通进入/退出动画用静态导出更准。"""
    # MsoAnimEffect：54 以后是强调效果和路径动画（进入/退出效果都在 54 以前）
    # 83~85 是媒体播放/暂停/停止，画面不变，不需要放映
    return any(e.get("paragraph") or ((e.get("type") or 0) >= 54 and (e.get("type") or 0) not in (83, 84, 85)) for e in effects)


def capture_steps(pres, slides_info, out: Path, width: int, height: int):
    """真正放映，逐步点击并截图：段落动画、强调效果、路径动画的最终状态都能准确记录"""
    ss = pres.SlideShowSettings
    ss.ShowType = 2  # 窗口模式
    win = ss.Run()
    try:
        win.Width, win.Height = 1000, 600
    except Exception:
        pass
    time.sleep(1.5)
    hwnd = _show_window()
    if not hwnd:
        raise RuntimeError("找不到放映窗口")
    view = win.View
    for info in slides_info:
        if not needs_slideshow(info["effects"]) or info.get("keptSlideshow"):
            continue
        n = info["index"] + 1
        groups = _click_groups(info["effects"])
        view.GotoSlide(n)
        # 等页面切换效果和进入页面时的自动动画播完
        time.sleep(1.2 * float(os.environ.get("UNPPT_WAIT_SCALE", "1")) + _group_wait(groups[0]))
        _grab(hwnd, width, height).save(out / f"slide-{n:03d}-step-00.png")
        for k in range(1, len(groups)):
            view.Next()
            time.sleep(_group_wait(groups[k]))
            _grab(hwnd, width, height).save(out / f"slide-{n:03d}-step-{k:02d}.png")
        info["stepSource"] = "slideshow"
    try:
        view.Exit()
    except Exception:
        pass


def _export_png(slide, path: Path, width: int, height: int) -> None:
    """导出一页：先存 BMP（真彩色），再无损转 PNG"""
    from PIL import Image
    bmp = path.with_suffix(".bmp")
    slide.Export(str(bmp.resolve()), "BMP", width, height)
    Image.open(bmp).convert("RGB").save(path)
    bmp.unlink()


def export_one(src: Path, out: Path, static: bool = False) -> dict:
    import pythoncom
    import win32com.client

    pythoncom.CoInitialize()
    out.mkdir(parents=True, exist_ok=True)
    app = win32com.client.DispatchEx("PowerPoint.Application")
    try:
        app.DisplayAlerts = 1  # ppAlertsNone
    except Exception:
        pass
    try:
        app.AutomationSecurity = 3  # msoAutomationSecurityForceDisable：强制禁用宏
    except Exception:
        pass
    repaired = False
    try:
        pres = app.Presentations.Open(str(src.resolve()), True, False, False)  # ReadOnly, Untitled=False, WithWindow=False
    except Exception:
        # PowerPoint 认为文件需要修复（交互打开时会问要不要修复，自动化下直接报"发生意外"）：按"打开并修复"重试，
        # 仍是只读、禁用宏；参考图是修复后的样子，ref.json 里记 repaired
        pres = app.Presentations.Open2007(str(src.resolve()), True, False, False, True)  # ..., OpenAndRepair
        repaired = True
    result = {"version": VERSION, "level": "static" if static else "full"}
    if repaired:
        result["repaired"] = True
    keep_shows = os.environ.get("UNPPT_KEEP_SLIDESHOW") == "1"
    try:
        if src.suffix.lower() != ".pptx":
            conv = out / "converted.pptx"
            pres.SaveCopyAs(str(conv.resolve()), PP_SAVE_AS_PPTX)
            result["converted"] = conv.name
        w_pt = pres.PageSetup.SlideWidth
        h_pt = pres.PageSetup.SlideHeight
        if repaired:
            # 修复改了页面尺寸（文件写的超出 PowerPoint 允许的范围，修复时被改小、内容被裁掉）：修复后的样子不作参考
            fw, fh = _file_slide_size(src)
            if fw and (abs(fw - w_pt) > 1 or abs(fh - h_pt) > 1):
                raise RuntimeError(f"修复后页面尺寸 {w_pt:.0f}×{h_pt:.0f} 磅和文件里的 {fw:.0f}×{fh:.0f} 磅不一致，不作参考")
        width = EXPORT_WIDTH
        height = round(EXPORT_WIDTH * h_pt / w_pt)
        result.update({"slideWidthPt": _num(w_pt), "slideHeightPt": _num(h_pt),
                       "imageWidth": width, "imageHeight": height, "slides": []})
        for idx in range(1, pres.Slides.Count + 1):
            slide = pres.Slides(idx)
            name = f"slide-{idx:03d}"
            _export_png(slide, out / f"{name}.png", width, height)
            if static:
                result["slides"].append({"index": idx - 1, "hidden": slide.SlideShowTransition.Hidden == MSO_TRUE, "shapes": [], "steps": 0})
                continue
            info = {"index": idx - 1, "hidden": slide.SlideShowTransition.Hidden == MSO_TRUE,
                    "shapes": [_shape_info(s) for s in slide.Shapes]}
            effects = _timeline(slide)
            info["effects"] = effects
            hidden_by_trigger = _interactive_hidden(slide)
            info["triggerHidden"] = sorted(hidden_by_trigger)
            if hidden_by_trigger and not effects:
                # 只有触发器动画的页：第 0 步是"触发器形状还没出现"的画面
                effects = [{"index": 0, "type": 0, "exit": False, "trigger": 2, "dur": 0, "delay": 0, "shapeId": None, "paragraph": 0}]
                info["effects"] = effects
            groups = _click_groups(effects)
            info["steps"] = len(groups) - 1
            # 已有放映截图时保留（UNPPT_KEEP_SLIDESHOW=1）
            info["keptSlideshow"] = keep_shows and needs_slideshow(effects) and all((out / f"{name}-step-{k:02d}.png").exists() for k in range(len(groups)))
            if effects and not info["keptSlideshow"]:
                states = _step_visibility(effects)
                info["approxSteps"] = any(e.get("paragraph") for e in effects)
                saved = {}
                for k, state in enumerate(states):
                    for sid in hidden_by_trigger:
                        state.setdefault(sid, False)
                    for sid, vis in state.items():
                        shp = _find_shape(slide, sid)
                        if shp is None:
                            continue
                        saved.setdefault(sid, shp.Visible)
                        shp.Visible = MSO_TRUE if vis else MSO_FALSE
                    _export_png(slide, out / f"{name}-step-{k:02d}.png", width, height)
                for sid, v in saved.items():
                    shp = _find_shape(slide, sid)
                    if shp is not None:
                        shp.Visible = v
            result["slides"].append(info)
        # 有动画的页：用放映截图覆盖上面"显示/隐藏"模拟出来的步骤图（更准确）
        if not static and any(needs_slideshow(si["effects"]) and not si["keptSlideshow"] for si in result["slides"]) and os.environ.get("UNPPT_NO_SLIDESHOW") != "1":
            try:
                capture_steps(pres, result["slides"], out, width, height)
            except Exception as e:  # 放映截图失败时保留模拟的步骤图
                result["slideshowError"] = str(e)[:200]
        result["ok"] = True
    finally:
        try:
            pres.Close()  # 退出放映时 PowerPoint 可能已经把它关掉了
        except Exception:
            pass
        try:
            if app.Presentations.Count == 0:
                app.Quit()
        except Exception:
            pass
    write_json(out / "ref.json", result)
    return result


def _find_shape(slide, sid):
    def walk(shapes):
        for s in shapes:
            if s.Id == sid:
                return s
            if s.Type == MSO_GROUP:
                r = walk(s.GroupItems)
                if r is not None:
                    return r
        return None
    return walk(slide.Shapes)


# ---------------------------------------------------------------- 批量（主进程）

def powerpoint_pids() -> set[int]:
    r = subprocess.run(["tasklist", "/FI", "IMAGENAME eq POWERPNT.EXE", "/FO", "CSV", "/NH"],
                       capture_output=True, text=True)
    pids = set()
    for line in r.stdout.splitlines():
        parts = [p.strip('"') for p in line.split('","')]
        if len(parts) > 1 and parts[1].isdigit():
            pids.add(int(parts[1]))
    return pids


def _past(until: str | None) -> bool:
    """到了 --until 的时间没有：当前时间在 HH:MM 之后的两小时内（夜里启动、早上到点停）"""
    if not until:
        return False
    now = time.localtime()
    h, m = (int(x) for x in until.split(":"))
    return (now.tm_hour, now.tm_min) >= (h, m) and (now.tm_hour, now.tm_min) < (h + 2, m)


def run(items: dict, ref_dir_of, force: bool, static: bool = False, until: str | None = None) -> None:
    before = powerpoint_pids()
    if before:
        print("PowerPoint 正在运行。为避免动到你打开的文档，请先关闭 PowerPoint 再运行。")
        sys.exit(2)
    todo = []
    for key, item in items.items():
        out = ref_dir_of(key)
        ref = read_json(out / "ref.json")
        # 已有完整导出、或者这次只要静态图而已有静态图，就跳过
        if not force and ref and ref.get("version") == VERSION and ref.get("ok") and (static or ref.get("level", "full") == "full"):
            continue
        todo.append((key, item, out))
    print(f"需要导出 {len(todo)} 个（共 {len(items)} 个）")
    for n, (key, item, out) in enumerate(todo, 1):
        if _past(until):
            print(f"到了 {until}，停止（还剩 {len(todo) - n + 1} 个，下次运行接着导）")
            break
        src = ROOT / item["paths"][0]
        t0 = time.time()
        if out.exists() and out.parent == REF:
            shutil.rmtree(out)
        cmd = [sys.executable, __file__, "one", str(src), str(out)] + (["--static"] if static else [])
        status = "ok"
        try:
            r = subprocess.run(cmd, capture_output=True, text=True, timeout=STATIC_TIMEOUT_SEC if static else TIMEOUT_SEC,
                               encoding="utf-8", errors="replace")
            if r.returncode != 0:
                status = "error"
                err = (r.stderr or r.stdout).strip().splitlines()[-1:] or ["?"]
                write_json(out / "error.json", {"error": err[0][:500]})
        except subprocess.TimeoutExpired:
            status = "timeout"
            for pid in powerpoint_pids() - before:
                subprocess.run(["taskkill", "/F", "/PID", str(pid)], capture_output=True)
            write_json(out / "error.json", {"error": "timeout"})
        # PowerPoint 的字体表是整个进程共用的（实测：同一进程里先打开的文件会改变后打开文件里缺失字体的替代），
        # 等这份的 PowerPoint 退出再导下一份，免得下一份连上还没退出的进程
        for _ in range(60):
            if not (powerpoint_pids() - before):
                break
            time.sleep(0.5)
        item["status"] = status
        print(f"[{n}/{len(todo)}] {key} {status} {time.time() - t0:.1f}s")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("cmd", choices=["scan", "run", "one"])
    ap.add_argument("args", nargs="*")
    ap.add_argument("--set", default="all", choices=["all", "testcases"])
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--only", default=None)
    ap.add_argument("--static", action="store_true", help="只导每页静态图（大批量样本用）")
    ap.add_argument("--until", default=None, help="HH:MM，到点导完当前这份就停")
    a = ap.parse_args()

    if a.cmd == "one":
        src, out = Path(a.args[0]), Path(a.args[1])
        try:
            r = export_one(src, out, a.static)
            print(json.dumps({"slides": len(r["slides"])}))
        except Exception:
            traceback.print_exc()
            sys.exit(1)
        return

    if a.cmd == "scan" or a.set == "all":
        index, stats = update_index()
        print(f"样本 {stats['total']} 个（新增 {stats['new']}，重复文件 {stats['duplicates']}，已移除 {stats['removed']}）")
        if a.cmd == "scan":
            return
        items = {h: v for h, v in index.items() if v.get("present")}
        if a.only:
            items = {h: v for h, v in items.items() if h.startswith(a.only)}
        run(items, lambda h: REF / h, a.force, a.static, a.until)
        for h, v in items.items():
            ref = read_json(REF / h / "ref.json")
            v["status"] = "ok" if ref and ref.get("ok") else (read_json(REF / h / "error.json", {}) or {}).get("error", "error")
            if ref:
                v["slides"] = len(ref["slides"])
        index.update(items)
        write_json(ROOT / ".cache" / "samples.json", index)
    else:
        items = testcase_index()
        if a.only:
            items = {k: v for k, v in items.items() if k == a.only}
        run(items, lambda k: ROOT / items[k]["ref"], a.force, a.static, a.until)


if __name__ == "__main__":
    os.chdir(ROOT)
    main()
