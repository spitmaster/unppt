/**
 * 折线图、股价图的附加线：垂直线（c:dropLines，每个分类从最高点画到绘图区底边）、
 * 高低点连线（c:hiLowLines，每个分类从最高到最低）画在系列下面；
 * 涨跌柱（c:upDownBars，第一个系列到最后一个系列，涨白跌黑，可以自定义）盖在系列上面（实测：柱子挡住折线）
 */
import { css } from '../../model/color';
import { n2 } from '../../common/svg';
import { cpart } from '../draw';
import type { CategoryFrame } from '../chart-type';
import type { AxisInfo, Plot } from '../model';

/** 垂直线、高低点连线（画在系列下面） */
export function renderLineExtras(p: Plot, f: CategoryFrame, A: AxisInfo, out: string[]): void {
  const st = p.stock;
  if (!st) return;
  const { nCat, catCenter } = f;
  const values = (i: number) => p.series.map((s) => s.vals[i]).filter((v): v is number => v !== null && v !== undefined);
  const lines = (line: { color?: { r: number; g: number; b: number; a: number }; width: number } | undefined, seg: (i: number, vs: number[]) => string) => {
    if (!line?.color) return;
    const d: string[] = [];
    for (let i = 0; i < nCat; i++) {
      const vs = values(i);
      if (vs.length) d.push(seg(i, vs));
    }
    if (d.length) out.push(`<path d="${d.join('')}" fill="none" stroke="${css(line.color)}" stroke-width="${n2(line.width)}"/>`);
  };
  const x = (i: number) => n2(f.catPx(catCenter(i)));
  const y = (v: number) => n2(f.valPx(A.pos(v)));
  lines(st.drop, (i, vs) => `M${x(i)} ${y(Math.max(...vs))}V${y(A.lo)}`);
  lines(st.hiLow, (i, vs) => `M${x(i)} ${y(Math.max(...vs))}V${y(Math.min(...vs))}`);
}

/** 涨跌柱：第一个系列（开盘）-> 最后一个系列（收盘），盖在系列上面 */
export function renderUpDownBars(p: Plot, f: CategoryFrame, A: AxisInfo, out: string[]): void {
  const ud = p.stock?.upDown;
  const { nCat, catCenter } = f;
  if (!ud || p.series.length < 2) return;
  for (let i = 0; i < nCat; i++) {
    const open = p.series[0].vals[i], close = p.series[p.series.length - 1].vals[i];
    if (open === null || open === undefined || close === null || close === undefined) continue;
    const w = f.band / (1 + ud.gap / 100);
    const cx = f.catPx(catCenter(i));
    const y1 = f.valPx(A.pos(Math.max(open, close))), y2 = f.valPx(A.pos(Math.min(open, close)));
    const up = close >= open;
    const fill = up ? ud.up : ud.down;
    out.push(cpart(`${p.series[0].index}x${i}`, `<rect x="${n2(cx - w / 2)}" y="${n2(y1)}" width="${n2(w)}" height="${n2(Math.max(0.5, y2 - y1))}" fill="${fill ? css(fill) : up ? '#fff' : '#000'}" stroke="${css(ud.line ?? { r: 64, g: 64, b: 64, a: 1 })}" stroke-width="0.75"/>`));
  }
}
