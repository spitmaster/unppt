/**
 * 图表：用 chart XML 里缓存的数据（numCache / strCache）直接画成 SVG，不需要 Excel。
 * 这里只负责公共部分：背景、标题、图例（legend.ts）、绘图区布局；分类轴图的坐标轴在 cat-chart.ts，
 * 每种图表怎么画由 ChartType 决定（chart-type.ts，注册在 chart-types.ts）。
 * 布局按 PowerPoint 默认的自动布局近似实现。
 */
import type { ColorContext } from '../model/color';
import type { Theme } from '../model/model';
import type { SvgDoc } from '../common/svg';
import { areaRect } from './area-fill';
import { attr, child, findAll, numAttr, path, type XEl } from '../io/xml';
import { axisMaker } from './axis';
import { renderCategoryChart } from './cat-chart';
import { pixelGrid } from './pixel-grid';
import { chartTypeOf } from './chart-types';
import { gradientRef, label, textStyle, textWidth } from './draw';
import { BOTTOM_PAD, PAD, type TextWidth } from './layout';
import { renderLegend } from './legend';
import type { ChartContext, Plot, Rect, SvgDefs, TextStyle, View3D } from './model';
import { readPlots } from './read';

export interface ChartEnv {
  colors: ColorContext;
  theme: Theme;
  part: string;
  warn(msg: string): void;
  /** 量文字宽度（有字体文件时用真实字宽）；不给时估算 */
  measure?: TextWidth;
  /** 渐变等定义：取一个页面里唯一的编号、把定义放进页面的 defs（不给时不用渐变） */
  defs?: SvgDefs;
  /** 页面的 SVG 文档（图表区、绘图区的渐变背景放定义用） */
  doc?: SvgDoc;
  /** 图表里的坐标到幻灯片像素的换算（幻灯片 x = x + sx × 图表 x）：网格线、柱子的边按它对齐整像素；不知道时不给 */
  origin?: { x: number; y: number; sx: number; sy: number };
}

export function renderChart(space: XEl | undefined, w: number, h: number, env: ChartEnv): string {
  if (!space) return '';
  const chart = child(space, 'c:chart');
  const plotArea = child(chart, 'c:plotArea');
  const { colors, theme } = env;
  const tw = env.measure ?? textWidth;
  const out: string[] = [];

  // 整个图表区的背景和边框（纯色、渐变）
  out.push(areaRect(child(space, 'c:spPr'), { left: 0, top: 0, right: w, bottom: h }, colors, env.part, env.doc));

  const baseText: TextStyle = textStyle(child(space, 'c:txPr'), colors, {
    size: 10 * 96 / 72, color: { r: 89, g: 89, b: 89, a: 1 }, bold: false, font: theme.minorLatin || 'Calibri',
  });

  // 趋势线、显示单位等默认名称跟随图表的界面语言（c:lang）
  const lang = attr(child(space, 'c:lang'), 'val') ?? 'zh-CN';
  const plots: Plot[] = readPlots(plotArea, colors, env.part, baseText, env.warn, lang.startsWith('zh'));
  const blanks = attr(child(chart, 'c:dispBlanksAs'), 'val');
  for (const p of plots) p.blanks = blanks === 'zero' || blanks === 'span' ? blanks : 'gap';
  // 系列、数据点的渐变填充生成定义（每个柱子、扇区各自铺满）
  const defs = env.defs;
  if (defs) {
    for (const s of plots.flatMap((p) => p.series)) {
      if (s.grad) s.paint = gradientRef(s.grad, defs);
      if (s.pointGrads) s.pointPaints = new Map([...s.pointGrads].map(([i, g]) => [i, gradientRef(g, defs)]));
    }
  }
  if (!plots.length) return out.join('');
  const type0 = chartTypeOf(plots[0].kind)!;

  // ---------------- 标题
  // 实测：图表区四周留白约 11 磅
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
    const refSize = textStyle(child(child(chart, 'c:legend'), 'c:txPr'), colors, baseText).size;
    const ts = textStyle(child(titleEl, 'c:txPr'), colors, { ...baseText, size: refSize * 1862 / 1197 });
    const rich = path(titleEl, 'c:tx', 'c:rich');
    const rr = rich ? findAll(rich, 'a:rPr')[0] ?? findAll(rich, 'a:defRPr')[0] : undefined;
    const tst: TextStyle = rr ? { ...ts, size: numAttr(rr, 'sz') ? numAttr(rr, 'sz')! / 100 * 96 / 72 : ts.size } : ts;
    out.push(label(titleText, w / 2, top + tst.size * 0.6, tst));
    // 实测：带坐标轴的图标题下方多留约 10 像素，饼图不多留（COM 读 18.62 磅标题的绘图区上沿校准到 0.01 像素）
    top += tst.size * 1.2 + (type0.hasAxes ? 16.16 : 6);
  }

  // ---------------- 图例
  ({ left, top, right, bottom } = renderLegend(child(chart, 'c:legend'), plots, { left, top, right, bottom }, w, colors, baseText, tw, out));
  // 底部没有图例时，下边只留 BOTTOM_PAD（COM 读 3 种字号：图例从下方移走后绘图区增高 1.03 × 字号 + 12 磅，比图例带多出约 5 磅）
  if (bottom === h - PAD) bottom = h - BOTTOM_PAD;

  // ---------------- 绘图区（手动布局优先）
  const ml = path(plotArea, 'c:layout', 'c:manualLayout');
  if (ml && numAttr(child(ml, 'c:w'), 'val') !== undefined) {
    const fx = numAttr(child(ml, 'c:x'), 'val') ?? 0, fy = numAttr(child(ml, 'c:y'), 'val') ?? 0;
    const fw = numAttr(child(ml, 'c:w'), 'val') ?? 1, fh = numAttr(child(ml, 'c:h'), 'val') ?? 1;
    left = fx * w; top = fy * h; right = left + fw * w; bottom = top + fh * h;
  }

  const makeAxis = axisMaker(colors, baseText, env.part, lang);
  const plotBg = (r: Rect) => areaRect(child(plotArea, 'c:spPr'), r, colors, env.part, env.doc);
  const snap = env.origin && pixelGrid(env.origin.x, env.origin.y, env.origin.sx, env.origin.sy);
  const view3D = plots.some((p) => p.is3D) ? readView3D(child(chart, 'c:view3D'), type0.kind === 'pie') : undefined;
  if (type0.layout === 'standalone') {
    const legendEl = child(chart, 'c:legend');
    const ctx: ChartContext = {
      colors, part: env.part, baseText, plotArea, makeAxis, width: tw, box: { w, h }, defs: env.defs,
      legendPos: legendEl ? attr(child(legendEl, 'c:legendPos'), 'val') ?? 'r' : undefined, hasTitle: !!titleText, manual: !!(ml && numAttr(child(ml, 'c:w'), 'val') !== undefined),
      view3D, zh: lang.startsWith('zh'), plotBg, snap,
    };
    // 雷达、散点的网格和坐标轴在类型自己的输出里：整段当背景，数据部分嵌在里面（背景总是第一步显示，不影响逐个出现）
    out.push(type0.render!(plots[0], { left, top, right, bottom }, ctx));
    return groupBackground(out);
  }

  renderCategoryChart(plots, plotArea, { left, top, right, bottom }, { colors, part: env.part, baseText, makeAxis, tw, w, view: view3D, zh: lang.startsWith('zh'), plotBg, snap }, out);
  return groupBackground(out);
}

/** 三维视图；饼图默认俯角 30°、不转，其它默认俯角 15°、转 20° */
function readView3D(v: XEl | undefined, pie: boolean): View3D {
  const num = (n: string, d: number) => numAttr(child(v, `c:${n}`), 'val') ?? d;
  return {
    rotX: num('rotX', pie ? 30 : 15), rotY: num('rotY', pie ? 0 : 20), perspective: num('perspective', 30),
    rAngAx: attr(child(v, 'c:rAngAx'), 'val') === '1', depthPercent: num('depthPercent', 100), hPercent: num('hPercent', 100),
    autoScale: !child(v, 'c:hPercent'),
  };
}

/**
 * 背景（标题、图例、坐标轴、网格……）按连续的段包起来，标成 g0、g1……：
 * "按系列""按类别"动画的第一步（gridLegend）显示它们，数据部分各自有标记（见 draw.ts 的 cpart）
 */
function groupBackground(out: string[]): string {
  const res: string[] = [];
  let run: string[] = [];
  let k = 0;
  const flush = () => {
    if (run.length) res.push(`<g data-cpart="g${k++}">${run.join('')}</g>`);
    run = [];
  };
  for (const o of out) {
    if (o.startsWith('<g data-cpart=')) { flush(); res.push(o); } else run.push(o);
  }
  flush();
  return res.join('');
}
