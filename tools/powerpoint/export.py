"""调本机 PowerPoint，为每个样本导出参考结果（标准答案）。

用法：
  python tools/powerpoint/export.py scan                 # 登记 samples/ 里的样本，报告新增/重复/删除
  python tools/powerpoint/export.py run [--set all|testcases] [--force] [--only 哈希]
  python tools/powerpoint/export.py one <pptx> <输出目录>  # 内部用：处理单个文件（子进程）

每个样本的输出（.cache/ref/<哈希>/，测试用例则在 testcases/<名字>/）：
  ref.json                 幻灯片尺寸、每页形状位置、每行文字位置、动画时间线、每页步数
  slide-001.png            每页静态图（宽 1280）
  slide-001-step-00.png    有点击动画的页：每个步骤结束时的画面
  converted.pptx           老格式 .ppt 另存成的 pptx（只有 .ppt 才有）

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
VERSION = 2  # 输出格式变化时加 1，会触发重新导出

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


def export_one(src: Path, out: Path) -> dict:
    import pythoncom
    import win32com.client

    pythoncom.CoInitialize()
    out.mkdir(parents=True, exist_ok=True)
    app = win32com.client.DispatchEx("PowerPoint.Application")
    try:
        app.DisplayAlerts = 1  # ppAlertsNone
    except Exception:
        pass
    pres = app.Presentations.Open(str(src.resolve()), True, False, False)  # ReadOnly, Untitled=False, WithWindow=False
    result = {"version": VERSION}
    try:
        if src.suffix.lower() != ".pptx":
            conv = out / "converted.pptx"
            pres.SaveCopyAs(str(conv.resolve()), PP_SAVE_AS_PPTX)
            result["converted"] = conv.name
        w_pt = pres.PageSetup.SlideWidth
        h_pt = pres.PageSetup.SlideHeight
        width = EXPORT_WIDTH
        height = round(EXPORT_WIDTH * h_pt / w_pt)
        result.update({"slideWidthPt": _num(w_pt), "slideHeightPt": _num(h_pt),
                       "imageWidth": width, "imageHeight": height, "slides": []})
        for idx in range(1, pres.Slides.Count + 1):
            slide = pres.Slides(idx)
            name = f"slide-{idx:03d}"
            slide.Export(str((out / f"{name}.png").resolve()), "PNG", width, height)
            info = {"index": idx - 1, "hidden": slide.SlideShowTransition.Hidden == MSO_TRUE,
                    "shapes": [_shape_info(s) for s in slide.Shapes]}
            effects = _timeline(slide)
            info["effects"] = effects
            groups = _click_groups(effects)
            info["steps"] = len(groups) - 1
            if effects:
                states = _step_visibility(effects)
                info["approxSteps"] = any(e.get("paragraph") for e in effects)
                saved = {}
                for k, state in enumerate(states):
                    for sid, vis in state.items():
                        shp = _find_shape(slide, sid)
                        if shp is None:
                            continue
                        saved.setdefault(sid, shp.Visible)
                        shp.Visible = MSO_TRUE if vis else MSO_FALSE
                    slide.Export(str((out / f"{name}-step-{k:02d}.png").resolve()), "PNG", width, height)
                for sid, v in saved.items():
                    shp = _find_shape(slide, sid)
                    if shp is not None:
                        shp.Visible = v
            result["slides"].append(info)
        result["ok"] = True
    finally:
        pres.Close()
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


def run(items: dict, ref_dir_of, force: bool) -> None:
    before = powerpoint_pids()
    if before:
        print("PowerPoint 正在运行。为避免动到你打开的文档，请先关闭 PowerPoint 再运行。")
        sys.exit(2)
    todo = []
    for key, item in items.items():
        out = ref_dir_of(key)
        ref = read_json(out / "ref.json")
        if not force and ref and ref.get("version") == VERSION and ref.get("ok"):
            continue
        todo.append((key, item, out))
    print(f"需要导出 {len(todo)} 个（共 {len(items)} 个）")
    for n, (key, item, out) in enumerate(todo, 1):
        src = ROOT / item["paths"][0]
        t0 = time.time()
        if out.exists() and out.parent == REF:
            shutil.rmtree(out)
        cmd = [sys.executable, __file__, "one", str(src), str(out)]
        status = "ok"
        try:
            r = subprocess.run(cmd, capture_output=True, text=True, timeout=TIMEOUT_SEC,
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
        item["status"] = status
        print(f"[{n}/{len(todo)}] {key} {status} {time.time() - t0:.1f}s")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("cmd", choices=["scan", "run", "one"])
    ap.add_argument("args", nargs="*")
    ap.add_argument("--set", default="all", choices=["all", "testcases"])
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--only", default=None)
    a = ap.parse_args()

    if a.cmd == "one":
        src, out = Path(a.args[0]), Path(a.args[1])
        try:
            r = export_one(src, out)
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
        run(items, lambda h: REF / h, a.force)
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
        run(items, lambda k: ROOT / items[k]["ref"], a.force)


if __name__ == "__main__":
    os.chdir(ROOT)
    main()
