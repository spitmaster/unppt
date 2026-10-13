/**
 * 图表：用 chart XML 里缓存的数据（numCache / strCache）直接画成 SVG，不需要 Excel。
 * 支持柱形/条形（簇状、堆积、百分比堆积）、折线（含标记）、面积（含堆积）、饼图、圆环、散点、雷达，
 * 以及柱形+折线的组合图（含次坐标轴）。
 * 布局（标题、图例、坐标轴、绘图区）按 PowerPoint 默认的自动布局近似实现。
 */
import { colorIn, css, type ColorContext, type Rgba } from '../model/color';
import { fallbackAdvance } from '../font/font';
import { findFillEl, parseFill, parseLine, type Line } from '../style/fill';
import { EMU_PER_PX, type Theme } from '../model/model';
import { esc, n2 } from '../common/svg';
import { attr, child, children, findAll, numAttr, path, type XEl } from '../io/xml';

interface Labels { val: boolean; pct: boolean; cat: boolean; ser: boolean; pos?: string; fmt?: string; style: TextStyle; }

interface Series {
  labels?: Labels;
  name: string;
  cats: string[];
  vals: (number | null)[];
  /** 散点图的 X 值 */
  xs?: (number | null)[];
  fill?: Rgba;
  line?: Line;
  marker: boolean;
  /** 标记的直径（像素）和颜色 */
  markerSize: number;
  markerFill?: Rgba;
  markerLine?: Rgba;
  pointFills: Map<number, Rgba>;
}

interface Plot {
  kind: 'bar' | 'line' | 'area' | 'pie' | 'doughnut' | 'scatter' | 'radar';
  /** 这个图用的坐标轴编号（c:axId） */
  axIds: string[];
  radarStyle: string;
  horizontal: boolean;
  grouping: string;
  gapWidth: number;
  overlap: number;
  holeSize: number;
  firstSliceAng: number;
  varyColors: boolean;
  series: Series[];
}

interface TextStyle { size: number; color: Rgba; bold: boolean; font: string; }

/** 一根数值轴算好的刻度：pos 把数值换成 0~1 的位置 */
interface AxisInfo { lo: number; hi: number; ticks: number[]; labels: string[]; fmt: string; deleted: boolean; style: TextStyle; grid?: Line; axisLine?: Line; pos: (v: number) => number }

const ACCENTS = ['accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6'];

function readLabels(d: XEl | undefined, base: Labels | undefined, colors: ColorContext, theme: Theme, text: TextStyle): Labels | undefined {
  if (!d) return base;
  if (attr(child(d, 'c:delete'), 'val') === '1') return undefined;
  const flag = (n: string, def: boolean) => { const v = attr(child(d, `c:${n}`), 'val'); return v === undefined ? def : v === '1'; };
  const l: Labels = {
    val: flag('showVal', base?.val ?? false), pct: flag('showPercent', base?.pct ?? false),
    cat: flag('showCatName', base?.cat ?? false), ser: flag('showSerName', base?.ser ?? false),
    pos: attr(child(d, 'c:dLblPos'), 'val') ?? base?.pos,
    fmt: attr(child(d, 'c:numFmt'), 'formatCode') ?? base?.fmt,
    style: textStyle(child(d, 'c:txPr'), colors, theme, base?.style ?? text),
  };
  return l.val || l.pct || l.cat || l.ser ? l : undefined;
}

function labelText(l: Labels, v: number, total: number, cat: string, ser: string, valFmt: string): string {
  const parts: string[] = [];
  if (l.ser) parts.push(ser);
  if (l.cat) parts.push(cat);
  if (l.val) parts.push(formatNumber(v, l.fmt && l.fmt !== 'General' ? l.fmt : valFmt));
  if (l.pct) parts.push(`${Math.round((total ? v / total : 0) * 100)}%`);
  return parts.join(', ');
}

function cacheValues(ref: XEl | undefined): { pts: Map<number, string>; count: number; format: string } {
  const cache = findAll(ref, 'c:numCache')[0] ?? findAll(ref, 'c:strCache')[0] ?? findAll(ref, 'c:numLit')[0] ?? findAll(ref, 'c:strLit')[0];
  const pts = new Map<number, string>();
  for (const pt of children(cache, 'c:pt')) pts.set(numAttr(pt, 'idx') ?? 0, child(pt, 'c:v')?.text ?? '');
  // 多级分类：取最后一级
  const multi = findAll(ref, 'c:multiLvlStrCache')[0];
  if (multi) {
    const lvls = children(multi, 'c:lvl');
    for (const pt of children(lvls[0], 'c:pt')) pts.set(numAttr(pt, 'idx') ?? 0, child(pt, 'c:v')?.text ?? '');
  }
  return { pts, count: numAttr(child(cache ?? multi, 'c:ptCount'), 'val') ?? pts.size, format: child(cache, 'c:formatCode')?.text ?? 'General' };
}

/** Excel 日期序号 -> 年/月/日 */
function excelDate(serial: number): Date {
  return new Date(Date.UTC(1899, 11, 30) + serial * 86400000);
}

function formatNumber(v: number, fmt: string): string {
  const f = fmt.toLowerCase();
  if (/[ymd]/.test(f) && !/general/.test(f)) {
    const d = excelDate(v);
    const y = d.getUTCFullYear(), m = d.getUTCMonth() + 1, day = d.getUTCDate();
    if (f.includes('d') && f.includes('m') && f.includes('y')) return `${y}/${m}/${day}`;
    if (f.includes('m') && f.includes('d')) return `${m}/${day}`;
    if (f.includes('y') && f.includes('m')) return `${y}/${m}`;
    return `${y}/${m}/${day}`;
  }
  if (f.includes('%')) {
    const dec = (f.split('.')[1] ?? '').replace(/[^0]/g, '').length;
    return `${(v * 100).toFixed(dec)}%`;
  }
  const m = /0\.(0+)/.exec(f);
  if (m) return v.toFixed(m[1].length);
  if (Number.isInteger(v)) return String(v);
  return String(Math.round(v * 1e6) / 1e6);
}

function textStyle(txPr: XEl | undefined, ctx: ColorContext, theme: Theme, base: TextStyle): TextStyle {
  const def = path(txPr, 'a:p', 'a:pPr', 'a:defRPr');
  if (!def) return base;
  const sz = numAttr(def, 'sz');
  const fill = child(def, 'a:solidFill');
  const latin = attr(child(def, 'a:latin'), 'typeface');
  return {
    size: sz ? (sz / 100) * 96 / 72 : base.size,
    color: (fill && colorIn(fill, ctx)) || base.color,
    bold: attr(def, 'b') === '1' ? true : attr(def, 'b') === '0' ? false : base.bold,
    font: latin && !latin.startsWith('+') ? latin : base.font,
  };
}

function textWidth(s: string, size: number): number {
  let w = 0;
  for (const ch of s) w += fallbackAdvance(ch.codePointAt(0)!);
  return w * size;
}

function label(s: string, x: number, y: number, st: TextStyle, anchor: 'start' | 'middle' | 'end' = 'middle', baseline: 'central' | 'auto' = 'central'): string {
  return `<text x="${n2(x)}" y="${n2(y)}" font-size="${n2(st.size)}" font-family="'${esc(st.font)}',sans-serif" fill="${css(st.color)}"${st.bold ? ' font-weight="bold"' : ''} text-anchor="${anchor}"${baseline === 'central' ? ' dominant-baseline="central"' : ''}>${esc(s)}</text>`;
}

/** 坐标轴刻度：按 Excel 的习惯取整（最大值留约 5% 余量，单位取 1/2/5 × 10^n） */
function niceScale(min: number, max: number, fixedMin?: number, fixedMax?: number, fixedUnit?: number) {
  let lo = fixedMin ?? (min >= 0 ? 0 : min);
  let hi = fixedMax ?? max;
  if (hi === lo) hi = lo + 1;
  const span = (fixedMax ?? (hi + (hi - lo) * 0.05)) - lo;
  let unit = fixedUnit ?? 0;
  if (!unit) {
    const mag = Math.pow(10, Math.floor(Math.log10(span)));
    for (const m of [0.1, 0.2, 0.5, 1, 2, 5, 10]) {
      unit = m * mag;
      if (span / unit <= 10) break;
    }
  }
  if (fixedMax === undefined) hi = Math.ceil((hi + (hi - lo) * 0.05) / unit) * unit;
  if (fixedMin === undefined && lo < 0) lo = Math.floor(lo / unit) * unit;
  return { lo, hi, unit };
}

export interface ChartEnv {
  colors: ColorContext;
  theme: Theme;
  part: string;
  warn(msg: string): void;
}

export function renderChart(space: XEl | undefined, w: number, h: number, env: ChartEnv): string {
  if (!space) return '';
  const chart = child(space, 'c:chart');
  const plotArea = child(chart, 'c:plotArea');
  const { colors, theme } = env;
  const out: string[] = [];

  // 整个图表区的背景和边框
  const csSpPr = child(space, 'c:spPr');
  const bgFill = parseFill(findFillEl(csSpPr), colors, env.part);
  const bgLine = parseLine([child(csSpPr, 'a:ln')], [colors], env.part);
  if (bgFill && bgFill.kind === 'solid') out.push(`<rect width="${n2(w)}" height="${n2(h)}" fill="${css(bgFill.color)}"/>`);
  if (bgLine?.color) out.push(`<rect width="${n2(w)}" height="${n2(h)}" fill="none" stroke="${css(bgLine.color)}" stroke-width="${n2(bgLine.width)}"/>`);

  const baseText: TextStyle = textStyle(child(space, 'c:txPr'), colors, theme, {
    size: 10 * 96 / 72, color: { r: 89, g: 89, b: 89, a: 1 }, bold: false, font: theme.minorLatin || 'Calibri',
  });

  // ---------------- 读数据
  const plots: Plot[] = [];
  let serialIdx = 0;
  for (const p of plotArea?.children ?? []) {
    const local = p.name.slice(2);
    let kind: Plot['kind'] | undefined;
    if (local === 'barChart' || local === 'bar3DChart') kind = 'bar';
    else if (local === 'lineChart' || local === 'line3DChart') kind = 'line';
    else if (local === 'areaChart' || local === 'area3DChart') kind = 'area';
    else if (local === 'pieChart' || local === 'pie3DChart' || local === 'ofPieChart') kind = 'pie';
    else if (local === 'doughnutChart') kind = 'doughnut';
    else if (local === 'scatterChart') kind = 'scatter';
    else if (local === 'radarChart') kind = 'radar';
    else if (local.endsWith('Chart')) { env.warn(`图表类型暂未支持：${local}`); continue; }
    else continue;
    const plotMarker = attr(child(p, 'c:marker'), 'val') !== '0';
    const plotLabels = readLabels(child(p, 'c:dLbls'), undefined, colors, theme, baseText);
    const series: Series[] = children(p, 'c:ser').map((s) => {
      const idx = numAttr(child(s, 'c:idx'), 'val') ?? serialIdx;
      serialIdx++;
      const spPr = child(s, 'c:spPr');
      const fill = parseFill(findFillEl(spPr), colors, env.part);
      const accent = colorIn({ name: 'x', attrs: {}, text: '', children: [{ name: 'a:schemeClr', attrs: { val: ACCENTS[idx % 6] }, children: [], text: '' }] }, colors)!;
      const line = parseLine([child(spPr, 'a:ln')], [colors], env.part);
      const cat = cacheValues(child(s, kind === 'scatter' ? 'c:xVal' : 'c:cat'));
      const val = cacheValues(child(s, kind === 'scatter' ? 'c:yVal' : 'c:val'));
      const n = Math.max(cat.count, val.count);
      const cats: string[] = [];
      const vals: (number | null)[] = [];
      for (let i = 0; i < n; i++) {
        const c = cat.pts.get(i);
        cats.push(c === undefined ? String(i + 1) : cat.format !== 'General' && c !== '' && !isNaN(Number(c)) ? formatNumber(Number(c), cat.format) : c);
        const v = val.pts.get(i);
        vals.push(v === undefined || v === '' ? null : Number(v));
      }
      const pointFills = new Map<number, Rgba>();
      for (const d of children(s, 'c:dPt')) {
        const f = parseFill(findFillEl(child(d, 'c:spPr')), colors, env.part);
        if (f?.kind === 'solid') pointFills.set(numAttr(child(d, 'c:idx'), 'val') ?? 0, f.color);
      }
      const mk = child(s, 'c:marker');
      const symbol = attr(child(mk, 'c:symbol'), 'val');
      const radarStyle = attr(child(p, 'c:radarStyle'), 'val') ?? 'marker';
      const hasLine = kind === 'line' || kind === 'scatter' || (kind === 'radar' && radarStyle !== 'filled');
      const mkFill = parseFill(findFillEl(child(mk, 'c:spPr')), colors, env.part);
      const mkLine = parseLine([child(child(mk, 'c:spPr'), 'a:ln')], [colors], env.part);
      const marker = kind === 'line' ? plotMarker && symbol !== 'none' && (symbol !== undefined || local === 'lineChart')
        : kind === 'scatter' ? symbol !== 'none'
          : kind === 'radar' ? radarStyle !== 'filled' && symbol !== undefined && symbol !== 'none' : false;
      return {
        labels: readLabels(child(s, 'c:dLbls'), plotLabels, colors, theme, baseText),
        name: findAll(child(s, 'c:tx'), 'c:v')[0]?.text ?? child(child(s, 'c:tx'), 'c:v')?.text ?? `系列 ${idx + 1}`,
        cats, vals,
        xs: kind === 'scatter' ? cats.map((c, i) => { const v = Number(cat.pts.get(i)); return cat.pts.has(i) && !isNaN(v) ? v : i + 1; }) : undefined,
        fill: fill?.kind === 'solid' ? fill.color : fill?.kind === 'none' ? undefined : accent,
        // 线条写了"无线条"（散点图只画点）时不画线
        line: child(child(spPr, 'a:ln'), 'a:noFill') ? undefined : line ?? (hasLine ? { color: accent, width: 2.25 * 96 / 72, cap: 'round', join: 'round' } : undefined),
        marker,
        markerSize: (numAttr(child(mk, 'c:size'), 'val') ?? 5) * 96 / 72,
        markerFill: mkFill?.kind === 'solid' ? mkFill.color : mkFill?.kind === 'none' ? undefined : accent,
        markerLine: mkLine ? mkLine.color : accent,
        pointFills,
      };
    });
    plots.push({
      kind,
      axIds: children(p, 'c:axId').map((a) => attr(a, 'val') ?? ''),
      radarStyle: attr(child(p, 'c:radarStyle'), 'val') ?? 'marker',
      horizontal: attr(child(p, 'c:barDir'), 'val') === 'bar',
      grouping: attr(child(p, 'c:grouping'), 'val') ?? (kind === 'bar' ? 'clustered' : 'standard'),
      gapWidth: numAttr(child(p, 'c:gapWidth'), 'val') ?? 150,
      overlap: numAttr(child(p, 'c:overlap'), 'val') ?? 0,
      holeSize: numAttr(child(p, 'c:holeSize'), 'val') ?? 50,
      firstSliceAng: numAttr(child(p, 'c:firstSliceAng'), 'val') ?? 0,
      varyColors: attr(child(p, 'c:varyColors'), 'val') === '1',
      series,
    });
  }
  if (!plots.length) return out.join('');
  const isPie = plots[0].kind === 'pie' || plots[0].kind === 'doughnut';

  // ---------------- 标题
  // 实测：图表区四周留白约 11 磅
  const PAD = 11 * 96 / 72;
  let top = PAD, bottom = h - PAD, left = PAD, right = w - PAD;
  const titleEl = child(chart, 'c:title');
  const autoDeleted = attr(child(chart, 'c:autoTitleDeleted'), 'val') === '1';
  let titleText = '';
  if (titleEl) {
    titleText = findAll(child(titleEl, 'c:tx'), 'a:t').map((t) => t.text).join('');
    if (!titleText) titleText = plots.length === 1 && plots[0].series.length === 1 ? plots[0].series[0].name : '图表标题';
  } else if (!autoDeleted && plots.length === 1 && plots[0].series.length === 1) {
    titleText = plots[0].series[0].name;
  }
  if (titleText) {
    // 没写字号时：新版 Office 图表标题和其它文字的默认字号比例是 18.62 : 11.97
    const refSize = textStyle(child(child(chart, 'c:legend'), 'c:txPr'), colors, theme, baseText).size;
    const ts = textStyle(child(titleEl, 'c:txPr'), colors, theme, { ...baseText, size: refSize * 1862 / 1197 });
    const rich = path(titleEl, 'c:tx', 'c:rich');
    const rr = rich ? findAll(rich, 'a:rPr')[0] ?? findAll(rich, 'a:defRPr')[0] : undefined;
    const tst: TextStyle = rr ? { ...ts, size: numAttr(rr, 'sz') ? numAttr(rr, 'sz')! / 100 * 96 / 72 : ts.size } : ts;
    out.push(label(titleText, w / 2, top + tst.size * 0.6, tst));
    // 实测：带坐标轴的图标题下方多留约 10 像素，饼图不多留
    top += tst.size * 1.2 + (isPie ? 6 : 16);
  }

  // ---------------- 图例
  const legend = child(chart, 'c:legend');
  const legendPos = attr(child(legend, 'c:legendPos'), 'val') ?? 'r';
  const legendText = textStyle(child(legend, 'c:txPr'), colors, theme, baseText);
  if (legend) {
    const entries: { name: string; color: Rgba; line: boolean; marker: boolean }[] = [];
    if (isPie || (plots[0].varyColors && plots[0].series.length === 1)) {
      const s = plots[0].series[0];
      s?.cats.forEach((c, i) => entries.push({ name: c, color: s.pointFills.get(i) ?? accentColor(i, colors), line: false, marker: false }));
    } else {
      for (const p of plots) {
        for (const s of p.series) {
          const lineKey = (p.kind === 'line' || p.kind === 'scatter' || p.kind === 'radar') && !!s.line?.color && !(p.kind === 'radar' && p.radarStyle === 'filled');
          const color = (lineKey ? s.line?.color : p.kind === 'scatter' || (p.kind === 'radar' && p.radarStyle !== 'filled') ? s.markerFill : s.fill) ?? accentColor(0, colors);
          entries.push({ name: s.name, color, line: lineKey, marker: s.marker });
        }
      }
      if (plots[0].kind === 'bar' && plots[0].horizontal) entries.reverse();
    }
    const ks = legendText.size * 0.6;
    const itemW = entries.map((e) => (e.line ? ks * 3 : ks) + 4 + textWidth(e.name, legendText.size) + 10);
    if (legendPos === 'b' || legendPos === 't') {
      const total = itemW.reduce((a, b) => a + b, 0);
      let x = (w - total) / 2;
      const y = legendPos === 'b' ? bottom - legendText.size * 0.6 : top + legendText.size * 0.6;
      entries.forEach((e, i) => {
        out.push(legendKey(e, x, y, ks));
        out.push(label(e.name, x + (e.line ? ks * 3 : ks) + 4, y, legendText, 'start'));
        x += itemW[i];
      });
      if (legendPos === 'b') bottom -= legendText.size * 1.2 + 11;
      else top += legendText.size * 1.2 + 8;
    } else {
      const lw = Math.max(...itemW);
      const lh = entries.length * legendText.size * 1.4;
      const x = legendPos === 'l' ? left : right - lw;
      let y = (top + bottom) / 2 - lh / 2 + legendText.size * 0.7;
      for (const e of entries) {
        out.push(legendKey(e, x, y, ks));
        out.push(label(e.name, x + (e.line ? ks * 3 : ks) + 4, y, legendText, 'start'));
        y += legendText.size * 1.4;
      }
      if (legendPos === 'l') left += lw + 8;
      else right -= lw + 8;
    }
  }

  // ---------------- 绘图区（手动布局优先）
  const ml = path(plotArea, 'c:layout', 'c:manualLayout');
  if (ml && numAttr(child(ml, 'c:w'), 'val') !== undefined) {
    const fx = numAttr(child(ml, 'c:x'), 'val') ?? 0, fy = numAttr(child(ml, 'c:y'), 'val') ?? 0;
    const fw = numAttr(child(ml, 'c:w'), 'val') ?? 1, fh = numAttr(child(ml, 'c:h'), 'val') ?? 1;
    left = fx * w; top = fy * h; right = left + fw * w; bottom = top + fh * h;
  }

  if (isPie) {
    out.push(renderPie(plots[0], left, top, right - left, bottom - top, colors));
    return out.join('');
  }

  // ---------------- 坐标轴
  const valAxes = (plotArea?.children ?? []).filter((c) => c.name === 'c:valAx');
  const catAxes = (plotArea?.children ?? []).filter((c) => c.name === 'c:catAx' || c.name === 'c:dateAx');
  const axId = (a: XEl | undefined) => attr(child(a, 'c:axId'), 'val') ?? '';
  const axisOf = (p: Plot) => valAxes.find((a) => p.axIds.includes(axId(a))) ?? valAxes[0];
  const axisInfo = (ax: XEl | undefined, vmin: number, vmax: number, pct: boolean): AxisInfo => {
    const scaling = child(ax, 'c:scaling');
    const sc = niceScale(vmin, vmax, numAttr(child(scaling, 'c:min'), 'val'), numAttr(child(scaling, 'c:max'), 'val'), numAttr(child(ax, 'c:majorUnit'), 'val'));
    const fmt = attr(child(ax, 'c:numFmt'), 'formatCode') ?? (pct ? '0%' : 'General');
    const ticks: number[] = [];
    for (let v = sc.lo; v <= sc.hi + sc.unit * 1e-6; v += sc.unit) ticks.push(Math.round(v / sc.unit) * sc.unit);
    const g = child(ax, 'c:majorGridlines');
    return {
      lo: sc.lo, hi: sc.hi, ticks, labels: ticks.map((t) => formatNumber(t, fmt)), fmt,
      deleted: attr(child(ax, 'c:delete'), 'val') === '1',
      style: textStyle(child(ax, 'c:txPr'), colors, theme, baseText),
      grid: g ? parseLine([child(child(g, 'c:spPr'), 'a:ln')], [colors], env.part) ?? { color: { r: 217, g: 217, b: 217, a: 1 }, width: 1, cap: 'butt', join: 'round' } : undefined,
      axisLine: parseLine([child(child(ax, 'c:spPr'), 'a:ln')], [colors], env.part),
      pos: (v: number) => (v - sc.lo) / (sc.hi - sc.lo),
    };
  };

  if (plots[0].kind === 'scatter') {
    out.push(renderScatter(plots[0], valAxes, axisInfo, left, top, right, bottom));
    return out.join('');
  }
  if (plots[0].kind === 'radar') {
    const p = plots[0];
    let vmin = 0, vmax = 0;
    for (const s of p.series) for (const v of s.vals) if (v !== null) { vmax = Math.max(vmax, v); vmin = Math.min(vmin, v); }
    const rStyle = textStyle(child(catAxes[0], 'c:txPr'), colors, theme, baseText);
    out.push(renderRadar(p, axisInfo(valAxes[0], vmin, vmax, false), rStyle, attr(child(catAxes[0], 'c:delete'), 'val') === '1', left, top, right, bottom));
    return out.join('');
  }

  const catAx = catAxes.find((a) => plots[0].axIds.includes(axId(a))) ?? catAxes[0];
  const catStyle = textStyle(child(catAx, 'c:txPr'), colors, theme, baseText);
  const horizontal = plots.some((p) => p.kind === 'bar' && p.horizontal);
  const cats = plots[0].series[0]?.cats ?? [];
  const nCat = Math.max(1, ...plots.flatMap((p) => p.series.map((s) => s.vals.length)));

  // 数值范围（堆积按每个分类求和）
  const rangeOf = (ps: Plot[]): [number, number] => {
    let vmin = 0, vmax = 0;
    for (const p of ps) {
      if (p.grouping === 'percentStacked') { vmax = Math.max(vmax, 1); continue; }
      if (p.grouping === 'stacked') {
        for (let i = 0; i < nCat; i++) {
          let pos = 0, neg = 0;
          for (const s of p.series) { const v = s.vals[i] ?? 0; if (v >= 0) pos += v; else neg += v; }
          vmax = Math.max(vmax, pos); vmin = Math.min(vmin, neg);
        }
      } else {
        for (const s of p.series) for (const v of s.vals) if (v !== null) { vmax = Math.max(vmax, v); vmin = Math.min(vmin, v); }
      }
    }
    return [vmin, vmax];
  };
  // 主坐标轴和次坐标轴（组合图里某些系列画在右侧的次坐标轴上）
  const primaryAx = axisOf(plots[0]);
  const secondaryAx = valAxes.find((a) => a !== primaryAx && plots.some((p) => axisOf(p) === a));
  const onSecondary = (p: Plot) => !!secondaryAx && axisOf(p) === secondaryAx;
  const primPlots = plots.filter((p) => !onSecondary(p));
  const prim = axisInfo(primaryAx, ...rangeOf(primPlots), primPlots.some((p) => p.grouping === 'percentStacked'));
  const secPlots = plots.filter(onSecondary);
  const sec = secondaryAx ? axisInfo(secondaryAx, ...rangeOf(secPlots), secPlots.some((p) => p.grouping === 'percentStacked')) : undefined;
  const valStyle = prim.style;
  const tickLabels = prim.labels;
  const valDeleted = prim.deleted;
  const catDeleted = attr(child(catAx, 'c:delete'), 'val') === '1';

  // 留出坐标轴标签的空间
  if (!horizontal) {
    if (!valDeleted) left += Math.max(...tickLabels.map((t) => textWidth(t, valStyle.size))) + 6;
    if (sec && !sec.deleted) right -= Math.max(...sec.labels.map((t) => textWidth(t, sec.style.size))) + 6;
    if (!catDeleted) bottom -= catStyle.size * 1.2 + 8;
  } else {
    if (!catDeleted) left += Math.max(...cats.map((c) => textWidth(c, catStyle.size))) + 8;
    if (!valDeleted) bottom -= valStyle.size * 1.2 + 4;
  }
  // 分类标签落在坐标轴两端（面积图等 midCat）时，给首尾标签各留半个标签宽度
  const between = attr(child(primaryAx, 'c:crossBetween'), 'val') !== 'midCat';
  if (!between && !horizontal && !catDeleted && cats.length) {
    left = Math.max(left, PAD + textWidth(cats[0], catStyle.size) / 2 - 4);
    right = Math.min(right, w - PAD - textWidth(cats[cats.length - 1], catStyle.size) / 2 + 4);
  }
  const pw = Math.max(1, right - left), ph = Math.max(1, bottom - top);

  const vpos = prim.pos;
  // 网格线
  const gridLine = prim.grid;
  prim.ticks.forEach((t, i) => {
    const f = vpos(t);
    if (!horizontal) {
      const y = bottom - f * ph;
      if (gridLine?.color) out.push(`<line x1="${n2(left)}" y1="${n2(y)}" x2="${n2(right)}" y2="${n2(y)}" stroke="${css(gridLine.color)}" stroke-width="${n2(gridLine.width)}"/>`);
      if (!valDeleted) out.push(label(tickLabels[i], left - 6, y, valStyle, 'end'));
    } else {
      const x = left + f * pw;
      if (gridLine?.color) out.push(`<line x1="${n2(x)}" y1="${n2(top)}" x2="${n2(x)}" y2="${n2(bottom)}" stroke="${css(gridLine.color)}" stroke-width="${n2(gridLine.width)}"/>`);
      if (!valDeleted) out.push(label(tickLabels[i], x, bottom + valStyle.size * 0.8, valStyle));
    }
  });
  if (sec && !sec.deleted && !horizontal) {
    sec.ticks.forEach((t, i) => out.push(label(sec.labels[i], right + 6, bottom - sec.pos(t) * ph, sec.style, 'start')));
  }

  // 分类轴
  const catLine = parseLine([child(child(catAx, 'c:spPr'), 'a:ln')], [colors], env.part);
  const band = (horizontal ? ph : pw) / (between ? nCat : Math.max(1, nCat - 1));
  const catCenter = (i: number) => (between ? (i + 0.5) * band : i * band);
  if (!catDeleted) {
    cats.forEach((c, i) => {
      if (!horizontal) out.push(label(c, left + catCenter(i), bottom + catStyle.size * 0.8, catStyle));
      else out.push(label(c, left - 8, bottom - catCenter(i), catStyle, 'end'));
    });
  }

  // ---------------- 系列（数据标签最后画，盖在图形上面）
  const labelsOut: string[] = [];
  const zeroF = vpos(Math.max(prim.lo, Math.min(prim.hi, 0)));
  for (const p of plots) {
    const nSer = p.series.length;
    // 每个图按自己的坐标轴换算
    const A = onSecondary(p) && sec ? sec : prim;
    const vpos = A.pos;
    const valFmt = A.fmt;
    const zeroF = vpos(Math.max(A.lo, Math.min(A.hi, 0)));
    if (p.kind === 'bar') {
      const stacked = p.grouping === 'stacked' || p.grouping === 'percentStacked';
      const ov = stacked ? 1 : p.overlap / 100;
      const slots = stacked ? 1 : nSer - (nSer - 1) * ov;
      const barW = band / (slots + p.gapWidth / 100);
      const pos = new Array(nCat).fill(0), neg = new Array(nCat).fill(0);
      const totals = new Array(nCat).fill(0).map((_, i) => p.series.reduce((a, s) => a + Math.abs(s.vals[i] ?? 0), 0) || 1);
      p.series.forEach((s, si) => {
        for (let i = 0; i < nCat; i++) {
          let v = s.vals[i];
          if (v === null || v === undefined) continue;
          if (p.grouping === 'percentStacked') v = v / totals[i];
          let a: number, b: number;
          if (stacked) {
            const base = v >= 0 ? pos[i] : neg[i];
            a = base; b = base + v;
            if (v >= 0) pos[i] = b; else neg[i] = b;
          } else { a = 0; b = v; }
          const fa = stacked ? vpos(a) : zeroF, fb = vpos(b);
          const offset = i * band + (band - barW * slots) / 2 + (stacked ? 0 : si * barW * (1 - ov));
          const color = s.pointFills.get(i) ?? s.fill;
          if (!color) continue;
          const lb = s.labels;
          const raw = s.vals[i] ?? 0;
          const text = lb ? labelText(lb, raw, totals[i], s.cats[i] ?? '', s.name, valFmt) : '';
          const inside = stacked || lb?.pos === 'ctr' || lb?.pos === 'inEnd' || lb?.pos === 'inBase';
          if (!horizontal) {
            const y1 = bottom - Math.max(fa, fb) * ph, y2 = bottom - Math.min(fa, fb) * ph;
            out.push(`<rect x="${n2(left + offset)}" y="${n2(y1)}" width="${n2(barW)}" height="${n2(y2 - y1)}" fill="${css(color)}"/>`);
            if (text) labelsOut.push(label(text, left + offset + barW / 2, inside ? (y1 + y2) / 2 : y1 - 4 - lb!.style.size * 0.55, lb!.style));
          } else {
            const x1 = left + Math.min(fa, fb) * pw, x2 = left + Math.max(fa, fb) * pw;
            out.push(`<rect x="${n2(x1)}" y="${n2(bottom - offset - barW)}" width="${n2(x2 - x1)}" height="${n2(barW)}" fill="${css(color)}"/>`);
            if (text) labelsOut.push(label(text, inside ? (x1 + x2) / 2 : x2 + 4, bottom - offset - barW / 2, lb!.style, inside ? 'middle' : 'start'));
          }
        }
      });
    } else {
      // 折线、面积
      const acc = new Array(nCat).fill(0);
      const series = p.kind === 'area' && p.grouping !== 'standard' ? p.series : p.series;
      const drawn: string[] = [];
      series.forEach((s) => {
        const pts: [number, number][] = [];
        const base: [number, number][] = [];
        for (let i = 0; i < nCat; i++) {
          const v = s.vals[i];
          if (v === null || v === undefined) continue;
          const stacked = p.grouping === 'stacked' || p.grouping === 'percentStacked';
          const b0 = stacked ? acc[i] : 0;
          const v1 = stacked ? acc[i] + v : v;
          if (stacked) acc[i] = v1;
          const x = left + catCenter(i);
          pts.push([x, bottom - vpos(v1) * ph]);
          base.push([x, bottom - vpos(b0) * ph]);
        }
        if (!pts.length) return;
        if (p.kind === 'area') {
          const d = `M${pts.map((q) => `${n2(q[0])} ${n2(q[1])}`).join('L')}L${base.reverse().map((q) => `${n2(q[0])} ${n2(q[1])}`).join('L')}Z`;
          if (s.fill) drawn.push(`<path d="${d}" fill="${css(s.fill)}"/>`);
        } else {
          const lc = s.line?.color ?? s.fill;
          if (lc) drawn.push(`<path d="M${pts.map((q) => `${n2(q[0])} ${n2(q[1])}`).join('L')}" fill="none" stroke="${css(lc)}" stroke-width="${n2(s.line?.width ?? 3)}" stroke-linejoin="round" stroke-linecap="round"/>`);
          if (s.marker && lc) for (const q of pts) drawn.push(`<circle cx="${n2(q[0])}" cy="${n2(q[1])}" r="3" fill="${css(lc)}"/>`);
          const lb = s.labels;
          if (lb) {
            let k = 0;
            for (let i = 0; i < nCat; i++) {
              const v = s.vals[i];
              if (v === null || v === undefined) continue;
              const q = pts[k++];
              const text = labelText(lb, v, 0, s.cats[i] ?? '', s.name, valFmt);
              const pos = lb.pos ?? 'r';
              if (pos === 't') labelsOut.push(label(text, q[0], q[1] - 6 - lb.style.size * 0.5, lb.style));
              else if (pos === 'b') labelsOut.push(label(text, q[0], q[1] + 6 + lb.style.size * 0.5, lb.style));
              else if (pos === 'l') labelsOut.push(label(text, q[0] - 6, q[1], lb.style, 'end'));
              else if (pos === 'ctr') labelsOut.push(label(text, q[0], q[1], lb.style));
              else labelsOut.push(label(text, q[0] + 6, q[1], lb.style, 'start'));
            }
          }
        }
      });
      out.push(...drawn);
    }
  }

  // 分类轴线（画在系列上面）
  if (catLine?.color && !catDeleted) {
    if (!horizontal) out.push(`<line x1="${n2(left)}" y1="${n2(bottom - zeroF * ph)}" x2="${n2(right)}" y2="${n2(bottom - zeroF * ph)}" stroke="${css(catLine.color)}" stroke-width="${n2(catLine.width)}"/>`);
    else out.push(`<line x1="${n2(left + zeroF * pw)}" y1="${n2(top)}" x2="${n2(left + zeroF * pw)}" y2="${n2(bottom)}" stroke="${css(catLine.color)}" stroke-width="${n2(catLine.width)}"/>`);
  }
  out.push(...labelsOut);
  return out.join('');
}

function accentColor(i: number, colors: ColorContext): Rgba {
  return colorIn({ name: 'x', attrs: {}, text: '', children: [{ name: 'a:schemeClr', attrs: { val: ACCENTS[i % 6] }, children: [], text: '' }] }, colors)!;
}

function legendKey(e: { color: Rgba; line: boolean; marker: boolean }, x: number, y: number, ks: number): string {
  if (e.line) {
    return `<line x1="${n2(x)}" y1="${n2(y)}" x2="${n2(x + ks * 3)}" y2="${n2(y)}" stroke="${css(e.color)}" stroke-width="2"/>`
      + (e.marker ? `<circle cx="${n2(x + ks * 1.5)}" cy="${n2(y)}" r="3" fill="${css(e.color)}"/>` : '');
  }
  if (e.marker) return `<circle cx="${n2(x + ks / 2)}" cy="${n2(y)}" r="3" fill="${css(e.color)}"/>`;
  return `<rect x="${n2(x)}" y="${n2(y - ks / 2)}" width="${n2(ks)}" height="${n2(ks)}" fill="${css(e.color)}"/>`;
}

/** 数据点标记（圆形；其它形状先都画成圆） */
function markerSvg(s: Series, x: number, y: number): string {
  const fill = s.markerFill ?? s.line?.color;
  const stroke = s.markerLine;
  if (!fill && !stroke) return '';
  return `<circle cx="${n2(x)}" cy="${n2(y)}" r="${n2(s.markerSize / 2)}" fill="${fill ? css(fill) : 'none'}"${stroke ? ` stroke="${css(stroke)}" stroke-width="0.75"` : ''}/>`;
}

function renderPie(p: Plot, x: number, y: number, w: number, h: number, colors: ColorContext): string {
  const s = p.series[0];
  if (!s) return '';
  const vals = s.vals.map((v) => Math.max(0, v ?? 0));
  const total = vals.reduce((a, b) => a + b, 0);
  if (!total) return '';
  const cx = x + w / 2, cy = y + h / 2;
  // 实测：没有数据标签时饼图直径约为绘图区较短边的 96.5%；有标签时 PowerPoint 会缩小到约 84% 给标签留空间
  const r = Math.min(w, h) / 2 * (s.labels ? 0.84 : 0.965);
  const ri = p.kind === 'doughnut' ? r * p.holeSize / 100 : 0;
  let ang = (p.firstSliceAng - 90) * Math.PI / 180;
  const out: string[] = [];
  const labels: string[] = [];
  vals.forEach((v, i) => {
    if (!v) return;
    const a2 = ang + (v / total) * Math.PI * 2;
    const large = a2 - ang > Math.PI ? 1 : 0;
    const p1 = [cx + r * Math.cos(ang), cy + r * Math.sin(ang)], p2 = [cx + r * Math.cos(a2), cy + r * Math.sin(a2)];
    const color = s.pointFills.get(i) ?? (p.varyColors || p.kind === 'pie' || p.kind === 'doughnut' ? accentColor(i, colors) : s.fill) ?? accentColor(i, colors);
    let d: string;
    if (v === total) {
      d = `M${n2(cx - r)} ${n2(cy)}A${n2(r)} ${n2(r)} 0 1 1 ${n2(cx + r)} ${n2(cy)}A${n2(r)} ${n2(r)} 0 1 1 ${n2(cx - r)} ${n2(cy)}Z`;
      if (ri) d += `M${n2(cx - ri)} ${n2(cy)}A${n2(ri)} ${n2(ri)} 0 1 0 ${n2(cx + ri)} ${n2(cy)}A${n2(ri)} ${n2(ri)} 0 1 0 ${n2(cx - ri)} ${n2(cy)}Z`;
    } else if (ri) {
      const q1 = [cx + ri * Math.cos(a2), cy + ri * Math.sin(a2)], q2 = [cx + ri * Math.cos(ang), cy + ri * Math.sin(ang)];
      d = `M${n2(p1[0])} ${n2(p1[1])}A${n2(r)} ${n2(r)} 0 ${large} 1 ${n2(p2[0])} ${n2(p2[1])}L${n2(q1[0])} ${n2(q1[1])}A${n2(ri)} ${n2(ri)} 0 ${large} 0 ${n2(q2[0])} ${n2(q2[1])}Z`;
    } else {
      d = `M${n2(cx)} ${n2(cy)}L${n2(p1[0])} ${n2(p1[1])}A${n2(r)} ${n2(r)} 0 ${large} 1 ${n2(p2[0])} ${n2(p2[1])}Z`;
    }
    out.push(`<path d="${d}" fill="${css(color)}" fill-rule="evenodd" stroke="#fff" stroke-width="1.5"/>`);
    const lb = s.labels;
    if (lb) {
      // 默认"最佳位置"：扇形内部靠外边缘；圆环在环的中间
      const mid = (ang + a2) / 2;
      const rr = ri ? (r + ri) / 2 : lb.pos === 'ctr' ? r * 0.5 : lb.pos === 'outEnd' ? r + lb.style.size : r * 0.8;
      labels.push(label(labelText(lb, v, total, s.cats[i] ?? '', s.name, 'General'), cx + rr * Math.cos(mid), cy + rr * Math.sin(mid), lb.style));
    }
    ang = a2;
  });
  return out.join('') + labels.join('');
}

type AxisMaker = (ax: XEl | undefined, vmin: number, vmax: number, pct: boolean) => AxisInfo;

/** 散点图：横轴、纵轴都是数值轴 */
function renderScatter(p: Plot, valAxes: XEl[], makeAxis: AxisMaker, left: number, top: number, right: number, bottom: number): string {
  const xAx = valAxes.find((a) => { const pos = attr(child(a, 'c:axPos'), 'val'); return pos === 'b' || pos === 't'; }) ?? valAxes[0];
  const yAx = valAxes.find((a) => a !== xAx) ?? valAxes[1];
  let x0 = 0, x1 = 0, y0 = 0, y1 = 0;
  for (const s of p.series) {
    s.vals.forEach((v, i) => {
      const x = s.xs?.[i];
      if (v === null || x === null || x === undefined) return;
      x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, v); y1 = Math.max(y1, v);
    });
  }
  const X = makeAxis(xAx, x0, x1, false), Y = makeAxis(yAx, y0, y1, false);
  if (!Y.deleted) left += Math.max(...Y.labels.map((t) => textWidth(t, Y.style.size))) + 6;
  if (!X.deleted) bottom -= X.style.size * 1.2 + 8;
  const pw = Math.max(1, right - left), ph = Math.max(1, bottom - top);
  const out: string[] = [];
  Y.ticks.forEach((t, i) => {
    const y = bottom - Y.pos(t) * ph;
    if (Y.grid?.color) out.push(`<line x1="${n2(left)}" y1="${n2(y)}" x2="${n2(right)}" y2="${n2(y)}" stroke="${css(Y.grid.color)}" stroke-width="${n2(Y.grid.width)}"/>`);
    if (!Y.deleted) out.push(label(Y.labels[i], left - 6, y, Y.style, 'end'));
  });
  X.ticks.forEach((t, i) => {
    const x = left + X.pos(t) * pw;
    if (X.grid?.color) out.push(`<line x1="${n2(x)}" y1="${n2(top)}" x2="${n2(x)}" y2="${n2(bottom)}" stroke="${css(X.grid.color)}" stroke-width="${n2(X.grid.width)}"/>`);
    if (!X.deleted) out.push(label(X.labels[i], x, bottom + X.style.size * 0.8, X.style));
  });
  // 坐标轴线：横轴画在纵轴 0 的位置，纵轴画在横轴 0 的位置
  const x0f = X.pos(Math.max(X.lo, Math.min(X.hi, 0))), y0f = Y.pos(Math.max(Y.lo, Math.min(Y.hi, 0)));
  if (X.axisLine?.color && !X.deleted) out.push(`<line x1="${n2(left)}" y1="${n2(bottom - y0f * ph)}" x2="${n2(right)}" y2="${n2(bottom - y0f * ph)}" stroke="${css(X.axisLine.color)}" stroke-width="${n2(X.axisLine.width)}"/>`);
  if (Y.axisLine?.color && !Y.deleted) out.push(`<line x1="${n2(left + x0f * pw)}" y1="${n2(top)}" x2="${n2(left + x0f * pw)}" y2="${n2(bottom)}" stroke="${css(Y.axisLine.color)}" stroke-width="${n2(Y.axisLine.width)}"/>`);
  for (const s of p.series) {
    const pts: [number, number][] = [];
    s.vals.forEach((v, i) => {
      const x = s.xs?.[i];
      if (v === null || x === null || x === undefined) return;
      pts.push([left + X.pos(x) * pw, bottom - Y.pos(v) * ph]);
    });
    if (!pts.length) continue;
    if (s.line?.color) out.push(`<path d="M${pts.map((q) => `${n2(q[0])} ${n2(q[1])}`).join('L')}" fill="none" stroke="${css(s.line.color)}" stroke-width="${n2(s.line.width)}" stroke-linejoin="round" stroke-linecap="round"/>`);
    if (s.marker) for (const q of pts) out.push(markerSvg(s, q[0], q[1]));
  }
  return out.join('');
}

/** 雷达图：分类沿圆周均匀分布，从正上方顺时针；网格是多边形 */
function renderRadar(p: Plot, A: AxisInfo, catStyle: TextStyle, catDeleted: boolean, left: number, top: number, right: number, bottom: number): string {
  const cats = p.series[0]?.cats ?? [];
  const n = Math.max(1, ...p.series.map((s) => s.vals.length));
  const maxW = catDeleted ? 0 : Math.max(0, ...cats.map((c) => textWidth(c, catStyle.size)));
  const gap = 6;
  // 按多边形顶点实际伸出的范围留标签空间（五边形左右顶点只到半径的 0.951 倍）
  let sMax = 0, cMax = 0;
  for (let i = 0; i < n; i++) {
    const a = (Math.PI * 2 * i) / n;
    sMax = Math.max(sMax, Math.abs(Math.sin(a)));
    cMax = Math.max(cMax, Math.abs(Math.cos(a)));
  }
  const r = Math.max(1, Math.min(((right - left) / 2 - maxW - gap) / (sMax || 1), ((bottom - top) / 2 - catStyle.size * 1.2 - gap) / (cMax || 1)));
  const cx = (left + right) / 2, cy = (top + bottom) / 2;
  const at = (i: number, f: number): [number, number] => {
    const a = (Math.PI * 2 * i) / n;
    return [cx + r * f * Math.sin(a), cy - r * f * Math.cos(a)];
  };
  const poly = (ps: [number, number][]) => ps.map((q) => `${n2(q[0])},${n2(q[1])}`).join(' ');
  const out: string[] = [];
  for (const t of A.ticks) {
    const f = A.pos(t);
    if (f <= 0 || !A.grid?.color) continue;
    out.push(`<polygon points="${poly(Array.from({ length: n }, (_, i) => at(i, f)))}" fill="none" stroke="${css(A.grid.color)}" stroke-width="${n2(A.grid.width)}"/>`);
  }
  if (!catDeleted) {
    cats.forEach((c, i) => {
      const a = (Math.PI * 2 * i) / n;
      const sin = Math.sin(a), cos = Math.cos(a);
      let [x, y] = at(i, 1);
      x += sin * gap; y -= cos * gap;
      const anchor = sin > 0.1 ? 'start' : sin < -0.1 ? 'end' : 'middle';
      if (cos > 0.1) y -= catStyle.size * 0.6;
      else if (cos < -0.1) y += catStyle.size * 0.6;
      out.push(label(c, x, y, catStyle, anchor));
    });
  }
  for (const s of p.series) {
    const pts = s.vals.map((v, i) => at(i, A.pos(Math.max(A.lo, Math.min(A.hi, v ?? A.lo)))));
    if (!pts.length) continue;
    if (p.radarStyle === 'filled') {
      if (s.fill) out.push(`<polygon points="${poly(pts)}" fill="${css(s.fill)}"/>`);
      continue;
    }
    if (s.line?.color) out.push(`<polygon points="${poly(pts)}" fill="none" stroke="${css(s.line.color)}" stroke-width="${n2(s.line.width)}" stroke-linejoin="round"/>`);
    if (s.marker) for (const q of pts) out.push(markerSvg(s, q[0], q[1]));
  }
  // 数值刻度标签盖在系列上面
  if (!A.deleted) A.ticks.forEach((t, i) => out.push(label(A.labels[i], cx - 4, cy - r * A.pos(t), A.style, 'end')));
  return out.join('');
}

export { EMU_PER_PX };
