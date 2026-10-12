"""生成演示画廊：把 testcases/（以及可选的 samples/）全部转码，生成一个总入口页面。

用法：
  python tools/demo.py              # 只用测试用例
  python tools/demo.py --samples    # 也包含 samples/ 里的样本（只在本机，不要外传）
输出：.cache/demo/index.html，直接双击打开（file:// 也能用）
"""
from __future__ import annotations

import html
import json
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import CACHE, ROOT, TESTCASES, update_index  # noqa: E402

OUT = CACHE / "demo"

PAGE = """<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>unppt 演示</title>
<style>
body{margin:0;font:14px system-ui,sans-serif;display:flex;height:100vh;color:#222}
nav{width:240px;flex:none;overflow:auto;border-right:1px solid #ddd;background:#fafafa}
nav h3{margin:12px;font-size:15px}
nav a{display:block;padding:6px 12px;color:#333;text-decoration:none;font-size:13px;word-break:break-all}
nav a.on{background:#2b6cb0;color:#fff}
main{flex:1;display:flex;flex-direction:column;min-width:0}
.frame{flex:1;background:#111}
iframe{width:100%;height:100%;border:0}
.bar{padding:8px;display:flex;gap:8px;align-items:center;flex-wrap:wrap;border-top:1px solid #ddd}
.bar button{padding:4px 12px}
#log{font:12px monospace;color:#666}
</style></head><body>
<nav><h3>unppt 演示（%COUNT% 个文件）</h3>%LINKS%</nav>
<main>
<div class="frame"><iframe id="f"></iframe></div>
<div class="bar">
<button id="prev">上一步</button><button id="next">下一步</button>
第 <input id="s" type="number" min="1" value="1" style="width:56px"> 页 第 <input id="t" type="number" min="0" value="0" style="width:56px"> 步 <button id="go">跳转</button>
<span id="state"></span><span id="log"></span>
</div></main>
<script>
// 宿主页面通过 postMessage 控制 iframe 里的播放器（file:// 和跨域都可以）
var f = document.getElementById('f'), seq = 0;
function send(cmd, args) { f.contentWindow.postMessage({ unppt: 1, id: ++seq, cmd: cmd, args: args }, '*'); }
window.addEventListener('message', function (e) {
  var d = e.data; if (!d || d.unppt !== 1) return;
  var s = d.data || d.result; if (!s) return;
  document.getElementById('state').textContent = '第 ' + (s.slide + 1) + '/' + s.slideCount + ' 页，第 ' + s.step + '/' + s.stepCount + ' 步';
  document.getElementById('log').textContent = d.event ? '事件：' + d.event : '';
});
function open(a) {
  document.querySelectorAll('nav a').forEach(function (x) { x.className = ''; });
  a.className = 'on'; f.src = a.getAttribute('data-src') + '?ui=0';
}
document.querySelectorAll('nav a').forEach(function (a) { a.onclick = function (ev) { ev.preventDefault(); open(a); }; });
document.getElementById('prev').onclick = function () { send('prev'); };
document.getElementById('next').onclick = function () { send('next'); };
document.getElementById('go').onclick = function () { send('goto', { slide: +document.getElementById('s').value - 1, step: +document.getElementById('t').value }); };
var first = document.querySelector('nav a'); if (first) open(first);
</script></body></html>"""


def main():
    with_samples = "--samples" in sys.argv
    subprocess.run(["node", "scripts/build.mjs"], cwd=ROOT, check=True, capture_output=True)
    items = [(p.stem, p) for p in sorted(TESTCASES.glob("*.pptx"))]
    if with_samples:
        index, _ = update_index()
        for h, v in sorted(index.items()):
            if v.get("present"):
                items.append((f"样本 {h}", ROOT / v["paths"][0]))
    links = []
    for name, src in items:
        key = name.replace(" ", "-")
        out = OUT / key / "index.html"
        r = subprocess.run(["node", "packages/transcoder/dist/cli.js", "convert", str(src), "-o", str(out), "--system-fonts", "-q"],
                           cwd=ROOT, capture_output=True, text=True, encoding="utf-8", errors="replace")
        if r.returncode != 0:
            print("失败", name, (r.stderr or "").strip()[-200:])
            continue
        links.append(f'<a href="#" data-src="{html.escape(key)}/index.html">{html.escape(name)}</a>')
    page = PAGE.replace("%COUNT%", str(len(links))).replace("%LINKS%", "\n".join(links))
    (OUT / "index.html").write_text(page, encoding="utf-8")
    print(f"完成：{len(links)} 个文件 -> {(OUT / 'index.html').resolve()}")


if __name__ == "__main__":
    main()
