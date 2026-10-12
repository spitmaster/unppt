"""校准用：对每一行文字，找出我们的渲染相对 PowerPoint 需要上下/左右移动多少像素才能对齐。
只输出数字（行号、偏移），不输出内容。用法：python tools/compare/offsets.py 编号
"""
import json, sys
from pathlib import Path
import numpy as np
from PIL import Image
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from common import CACHE  # noqa

key = sys.argv[1]
res = next(r for r in json.load(open(CACHE / 'report/results.json', encoding='utf-8')) if r['key'] == key)
img = CACHE / 'report/img'
for p in res['pages']:
    ref = np.asarray(Image.open(img / f"{p['img']}-ref.png").convert('L'), dtype=float)
    ours = np.asarray(Image.open(img / f"{p['img']}-ours.png").convert('L'), dtype=float)
    k = ref.shape[1] / 960 if ref.shape[1] == 1280 else 1280 / 960
    for s in p['shapes']:
        for li, b in enumerate(s.get('refBoxes') or []):
            x, y, w, h = [v * k for v in b]
            x0, y0, x1, y1 = int(x), int(y), int(x + w), int(y + h)
            a = ref[y0:y1, x0:x1]
            if a.size == 0 or (255 - a).sum() < 100:
                continue
            best = None
            for dy in range(-12, 13):
                for dx in range(-6, 7):
                    bb = ours[y0 + dy:y1 + dy, x0 + dx:x1 + dx]
                    if bb.shape != a.shape:
                        continue
                    e = np.abs(a - bb).mean()
                    if best is None or e < best[0]:
                        best = (e, dx, dy)
            print(f"page {p['slide']} shape {s['id']} line {li} size~{b[3] / 1.2:.1f}pt  dx {best[1]:+d}px dy {best[2]:+d}px  err {best[0]:.1f}")
