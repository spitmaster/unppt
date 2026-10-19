/**
 * 数据标签：系列 / 整个图的（c:dLbls 的显示项），和单个数据点的（c:dLbls 里的 c:dLbl）——覆盖系列的显示项、位置、文字样式，
 * 可以删掉这一个，可以手动拖开（manualLayout 的 x / y 是相对默认位置的偏移，按图表宽高的比例），可以写自定义文字
 * （c:tx/c:rich，里面的字段换成这个点的值、分类名等）。样本里一半带图表的课件有单点标签，多数是拖动过位置的。
 */
import type { ColorContext } from '../model/color';
import { attr, child, children, findAll, numAttr, path, type XEl } from '../io/xml';
import { hasCjk, textStyle } from './draw';
import type { Labels, PointLabel, Series, TextStyle } from './model';

export type { PointLabel };

type RichPart = NonNullable<PointLabel['rich']>[number];

/** 标签自己设的数字格式；链接到源（sourceLinked="1"）的不算，按源数据的格式 */
const ownFmt = (d: XEl | undefined) => (attr(child(d, 'c:numFmt'), 'sourceLinked') === '1' ? undefined : attr(child(d, 'c:numFmt'), 'formatCode'));

/** 系列 / 整个图的数据标签设置（显示项都没开、或者删掉了时是 undefined） */
export function readLabels(d: XEl | undefined, base: Labels | undefined, colors: ColorContext, text: TextStyle): Labels | undefined {
  if (!d) return base;
  if (attr(child(d, 'c:delete'), 'val') === '1') return undefined;
  const flag = (n: string, def: boolean) => { const v = attr(child(d, `c:${n}`), 'val'); return v === undefined ? def : v === '1'; };
  const l: Labels = {
    val: flag('showVal', base?.val ?? false), pct: flag('showPercent', base?.pct ?? false),
    cat: flag('showCatName', base?.cat ?? false), ser: flag('showSerName', base?.ser ?? false),
    pos: attr(child(d, 'c:dLblPos'), 'val') ?? base?.pos,
    fmt: ownFmt(d) ?? base?.fmt,
    style: textStyle(child(d, 'c:txPr'), colors, base?.style ?? text),
    sep: child(d, 'c:separator')?.text ?? base?.sep,
  };
  return l.val || l.pct || l.cat || l.ser ? l : undefined;
}

/** 一个系列的单点标签；cells 是"单元格中的值"字段用的缓存（系列扩展里的 c15:dlblRangeCache） */
export function readPointLabels(dLbls: XEl | undefined, series: Labels | undefined, colors: ColorContext, text: TextStyle, ser: XEl): { points: Map<number, PointLabel>; cells?: Map<number, string> } | undefined {
  const list = children(dLbls, 'c:dLbl');
  if (!list.length) return undefined;
  const points = new Map<number, PointLabel>();
  // 系列的显示项全关时 series 是 undefined，但系列 dLbls 写的文字样式、位置、格式单点标签照样继承
  const base: Labels = series ?? {
    val: false, pct: false, cat: false, ser: false, style: textStyle(child(dLbls, 'c:txPr'), colors, text),
    ...(attr(child(dLbls, 'c:dLblPos'), 'val') ? { pos: attr(child(dLbls, 'c:dLblPos'), 'val') } : {}),
    ...(ownFmt(dLbls) ? { fmt: ownFmt(dLbls) } : {}),
  };
  for (const d of list) {
    const idx = numAttr(child(d, 'c:idx'), 'val');
    if (idx === undefined) continue;
    const ml = path(d, 'c:layout', 'c:manualLayout');
    // 只认相对默认位置的偏移（xMode / yMode 没写或写 factor）
    const off = (n: 'x' | 'y') => ((attr(child(ml, `c:${n}Mode`), 'val') ?? 'factor') === 'factor' ? numAttr(child(ml, `c:${n}`), 'val') ?? 0 : 0);
    const rich = path(d, 'c:tx', 'c:rich');
    const deleted = attr(child(d, 'c:delete'), 'val') === '1';
    let labels = deleted ? undefined : readLabels(d, base, colors, text);
    if (!deleted && rich && !labels) labels = { ...base, val: true, style: textStyle(child(d, 'c:txPr'), colors, base.style) };
    points.set(idx, { labels, dx: off('x'), dy: off('y'), ...(rich && labels ? { rich: richParts(rich) } : {}) });
  }
  const range = findAll(ser, 'c15:dlblRangeCache')[0];
  const cells = range ? new Map(children(range, 'c:pt').map((p) => [numAttr(p, 'idx') ?? -1, child(p, 'c:v')?.text ?? ''] as [number, string])) : undefined;
  return { points, ...(cells ? { cells } : {}) };
}

function richParts(rich: XEl): RichPart[] {
  const parts: RichPart[] = [];
  children(rich, 'a:p').forEach((p, k) => {
    if (k > 0) parts.push({ text: '\n' });
    for (const r of p.children) {
      if (r.name === 'a:r') parts.push({ text: child(r, 'a:t')?.text ?? '' });
      else if (r.name === 'a:fld') parts.push({ field: attr(r, 'type') ?? '', text: child(r, 'a:t')?.text ?? '' });
      else if (r.name === 'a:br') parts.push({ text: '\n' });
    }
  });
  return parts;
}

/** 这个点用的标签：有单独设置时用它，否则用系列的 */
export function pointLabel(s: Series, i: number): PointLabel {
  return s.pointLabels?.get(i) ?? { labels: s.labels, dx: 0, dy: 0 };
}

/** 标签文字：自定义文字时把字段换成这个点的值（已经按格式写好）、分类名、系列名、百分比、单元格中的值；否则用 auto */
export function pointLabelText(s: Series, pl: PointLabel, i: number, auto: () => string, parts: () => { val: string; cat: string; pct: string }): string {
  if (!pl.rich) return auto();
  const p = parts();
  return pl.rich.map((r) => {
    if (!('field' in r)) return r.text;
    switch (r.field) {
      case 'VALUE': case 'YVALUE': return p.val;
      case 'CATEGORYNAME': case 'XVALUE': return p.cat;
      case 'SERIESNAME': return s.name;
      case 'PERCENTAGE': return p.pct;
      case 'CELLRANGE': return s.labelCells?.get(i) ?? r.text;
      default: return r.text;
    }
  }).join('');
}

/** 标签文字的大致外框（从 label() 输出的第一个 <text> 读位置、字号、对齐；宽按汉字 1、其它 0.55 个字号估） */
function textBox(svg: string): { x0: number; x1: number; y0: number; y1: number } | undefined {
  const m = /<text x="(-?[\d.]+)" y="(-?[\d.]+)" font-size="([\d.]+)"[^>]*?(?:text-anchor="(\w+)")?[^>]*>([^<]*)<\/text>/.exec(svg);
  if (!m || /<g transform/.test(svg.slice(0, m.index))) return undefined;
  const x = Number(m[1]), y = Number(m[2]), s = Number(m[3]);
  const w = [...m[5]].reduce((a, ch) => a + (hasCjk(ch) ? 1 : 0.55), 0) * s;
  const x0 = m[4] === 'end' ? x - w : m[4] === 'start' ? x : x - w / 2;
  return { x0, x1: x0 + w, y0: y - 0.6 * s, y1: y + 0.6 * s };
}

/**
 * 手动拖开的标签：整体平移（box 是图表的宽高）；拖到图表外面的夹回图表里（实测 charts-dlbl-clamp：往左、往右、往上拖出图表的
 * 标签都贴着图表边画）
 */
export function shiftLabel(svg: string, pl: PointLabel, box: { w: number; h: number }): string {
  if (!svg || (!pl.dx && !pl.dy)) return svg;
  let tx = pl.dx * box.w, ty = pl.dy * box.h;
  const b = box.w > 0 && box.h > 0 ? textBox(svg) : undefined;
  if (b) {
    tx = Math.min(Math.max(tx, -b.x0), box.w - b.x1);
    ty = Math.min(Math.max(ty, -b.y0), box.h - b.y1);
  }
  return `<g transform="translate(${tx.toFixed(2)} ${ty.toFixed(2)})">${svg}</g>`;
}
