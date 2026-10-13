/**
 * 误差线：固定值、百分比、标准偏差、标准误差、自定义；正负偏差 / 正偏差 / 负偏差；末端有没有短横线。
 * 分类轴图的误差线沿数值方向；散点图可以有 X、Y 两个方向。
 */
import { attr, child, children, type XEl } from '../io/xml';
import { css, type ColorContext } from '../model/color';
import { parseLine } from '../style/line';
import { n2 } from '../common/svg';
import { cacheValues } from './format';
import type { ErrBars } from './model';

/** 末端短横线的长度（像素，实测 7 像素） */
const CAP = 7;

const numbers = (el: XEl | undefined): (number | null)[] => {
  const c = cacheValues(el);
  return Array.from({ length: c.count }, (_, i) => (c.pts.has(i) && isFinite(Number(c.pts.get(i))) ? Number(c.pts.get(i)) : null));
};

export function readErrBars(ser: XEl, colors: ColorContext, part: string): ErrBars[] {
  return children(ser, 'c:errBars').map((e) => ({
    dir: attr(child(e, 'c:errDir'), 'val') === 'x' ? 'x' : 'y',
    type: attr(child(e, 'c:errBarType'), 'val') ?? 'both',
    valType: attr(child(e, 'c:errValType'), 'val') ?? 'fixedVal',
    val: Number(attr(child(e, 'c:val'), 'val') ?? 1),
    noEndCap: attr(child(e, 'c:noEndCap'), 'val') === '1',
    // 没写线条时：深灰色细线（新版 Office 的默认样式）
    line: parseLine([child(child(e, 'c:spPr'), 'a:ln')], [colors], part) ?? { color: { r: 89, g: 89, b: 89, a: 1 }, width: 1, cap: 'butt', join: 'round' },
    plus: numbers(child(e, 'c:plus')), minus: numbers(child(e, 'c:minus')),
  }));
}

/** 每个点的误差范围 [下端, 上端]（数值）；vals 是这个方向上的数据 */
export function errRanges(e: ErrBars, vals: (number | null)[]): ([number, number] | undefined)[] {
  const ok = vals.filter((v): v is number => v !== null);
  const mean = ok.reduce((a, b) => a + b, 0) / Math.max(1, ok.length);
  const sd = Math.sqrt(ok.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, ok.length - 1));
  return vals.map((v, i) => {
    if (v === null) return undefined;
    let up: number, down: number, center = v;
    if (e.valType === 'percentage') up = down = Math.abs(v) * e.val / 100;
    else if (e.valType === 'stdDev') { up = down = sd * e.val; center = mean; } // 标准偏差：以平均值为中心（和 Excel 一样）
    else if (e.valType === 'stdErr') up = down = sd / Math.sqrt(Math.max(1, ok.length));
    else if (e.valType === 'cust') { up = e.plus[i] ?? 0; down = e.minus[i] ?? 0; }
    else up = down = e.val;
    return [e.type === 'plus' ? center : center - down, e.type === 'minus' ? center : center + up];
  });
}

/** 一个点的误差线：along 是线段方向上的两端坐标，at 是另一个方向上的位置；vertical 表示线段竖着 */
export function errSvg(e: ErrBars, at: number, a: number, b: number, vertical: boolean): string {
  if (!e.line.color) return '';
  const seg = (p: number, q: number, r: number) => (vertical ? `M${n2(r)} ${n2(p)}V${n2(q)}` : `M${n2(p)} ${n2(r)}H${n2(q)}`);
  const cap = (p: number) => (vertical ? `M${n2(at - CAP / 2)} ${n2(p)}H${n2(at + CAP / 2)}` : `M${n2(p)} ${n2(at - CAP / 2)}V${n2(at + CAP / 2)}`);
  let d = seg(a, b, at);
  // 只画偏差那一侧的末端（中心那一端没有）
  if (!e.noEndCap) {
    if (e.type !== 'plus') d += cap(a);
    if (e.type !== 'minus') d += cap(b);
  }
  return `<path d="${d}" fill="none" stroke="${css(e.line.color)}" stroke-width="${n2(e.line.width)}"/>`;
}
