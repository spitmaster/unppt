/**
 * 艺术字文字变形（a:bodyPr/a:prstTxWarp）：把文字换成字形轮廓，再按变形预设弯曲，输出成 path。
 *
 * 按 PowerPoint 实测的规律（包络类：路径两条一组，上边界 + 下边界）：
 *   - 整段文字按字形墨迹的外框拉伸，填满文字区域（不留内边距）；
 *   - 横向所有行一起算（短行不会单独拉宽），纵向在所属的那组包络里铺满；
 *   - 有多组包络（4、6 条路径）时，行按顺序尽量平均地分到各组，除不尽时前面的组多一行（4 行 3 组是 2、1、1）；
 *     行少的组按满组的高度比例缩放，在包络里垂直居中；
 *   - 沿上下边界按长度比例对应。
 * 跟随路径类（拱形、圆形、按钮：路径是 1 或 3 条）：字保持原大小沿路径排，见 followMapper。
 * 缺字体文件、不是 TrueType 轮廓时不变形，按普通文字输出。
 */
import { css } from '../model/color';
import { n2 } from '../common/svg';
import { walkGeometry, warpGeometry, type PathSink } from '../geometry/geometry';
import { attr, child, children, type XEl } from '../io/xml';
import type { PlacedLine } from './emit';
import { textFilter, textGradient, textPicture } from './svg-text';
import type { ParagraphLayout, RunStyle, TextEnv } from './types';

type Pt = [number, number];

/** 一条边界：按长度均匀取点 */
class Track {
  private cum: number[] = [0];
  constructor(private pts: Pt[]) {
    for (let i = 1; i < pts.length; i++) this.cum.push(this.cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  }

  get length() { return this.cum[this.cum.length - 1]; }

  /** 沿路径距离 d 处的点和单位切线；超出两端时沿端点切线延长 */
  frame(d: number): [number, number, number, number] {
    const { pts, cum } = this;
    const total = this.length;
    if (pts.length < 2 || total === 0) return [pts[0]?.[0] ?? 0, pts[0]?.[1] ?? 0, 1, 0];
    let i = 1;
    if (d >= total) i = pts.length - 1;
    else if (d > 0) { let lo = 0, hi = cum.length - 1; while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (cum[mid] <= d) lo = mid; else hi = mid; } i = hi; }
    const [ax, ay] = pts[i - 1], [bx, by] = pts[i];
    const len = Math.hypot(bx - ax, by - ay) || 1;
    const tx = (bx - ax) / len, ty = (by - ay) / len;
    const k = d - cum[i - 1];
    return [ax + tx * k, ay + ty * k, tx, ty];
  }

  /** 平行偏移 off 后的路径（往行进方向的左侧，即字头方向） */
  offset(off: number): Track {
    if (!off) return this;
    const { pts } = this;
    return new Track(pts.map((p, i) => {
      const [ax, ay] = pts[Math.max(0, i - 1)], [bx, by] = pts[Math.min(pts.length - 1, i + 1)];
      const len = Math.hypot(bx - ax, by - ay) || 1;
      return [p[0] + (by - ay) / len * off, p[1] - (bx - ax) / len * off];
    }));
  }

  /** u 是 0~1 的长度比例 */
  at(u: number): Pt {
    const { pts, cum } = this;
    const total = cum[cum.length - 1];
    if (pts.length < 2 || total === 0) return pts[0] ?? [0, 0];
    const d = Math.max(0, Math.min(1, u)) * total;
    let lo = 0, hi = cum.length - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (cum[mid] <= d) lo = mid; else hi = mid; }
    const t = (d - cum[lo]) / ((cum[hi] - cum[lo]) || 1);
    return [pts[lo][0] + (pts[hi][0] - pts[lo][0]) * t, pts[lo][1] + (pts[hi][1] - pts[lo][1]) * t];
  }
}

/** 把预设路径采样成折线（曲线、椭圆弧都细分） */
class SampleSink implements PathSink {
  readonly pts: Pt[] = [];
  private last: Pt = [0, 0];
  move(x: number, y: number) { this.pts.push([x, y]); this.last = [x, y]; }
  line(x: number, y: number) { this.pts.push([x, y]); this.last = [x, y]; }
  cubic(x1: number, y1: number, x2: number, y2: number, x: number, y: number) {
    const [x0, y0] = this.last;
    for (let i = 1; i <= 48; i++) {
      const t = i / 48, s = 1 - t;
      this.pts.push([s * s * s * x0 + 3 * s * s * t * x1 + 3 * s * t * t * x2 + t * t * t * x, s * s * s * y0 + 3 * s * s * t * y1 + 3 * s * t * t * y2 + t * t * t * y]);
    }
    this.last = [x, y];
  }
  quad(x1: number, y1: number, x: number, y: number) {
    const [x0, y0] = this.last;
    for (let i = 1; i <= 48; i++) {
      const t = i / 48, s = 1 - t;
      this.pts.push([s * s * x0 + 2 * s * t * x1 + t * t * x, s * s * y0 + 2 * s * t * y1 + t * t * y]);
    }
    this.last = [x, y];
  }
  arc(ox: number, oy: number, wR: number, hR: number, t1: number, dt: number) {
    const n = Math.max(8, Math.ceil(Math.abs(dt) / (Math.PI * 2) * 128));
    for (let i = 1; i <= n; i++) {
      const t = t1 + (dt * i) / n;
      this.pts.push([ox + wR * Math.cos(t), oy + hR * Math.sin(t)]);
    }
    this.last = this.pts[this.pts.length - 1];
  }
  close() { /* 边界不闭合 */ }
}

/** 一个字的轮廓，已经放到文本框坐标里（y 向下） */
interface Glyph { pi: number; li: number; group: number; style: RunStyle; /** 字宽中点的横坐标 */ cx: number; contours: { x: number; y: number; on: boolean }[][]; }

/** TrueType 轮廓（二次曲线）展开成折线，每段不超过 step */
function flatten(c: { x: number; y: number; on: boolean }[], step: number): Pt[] {
  const n = c.length;
  if (n < 2) return [];
  // 起点要在曲线上：第一个点不在时取最后一个点，或者首尾两个控制点的中点
  let start: Pt;
  let i0: number;
  if (c[0].on) { start = [c[0].x, c[0].y]; i0 = 1; } else if (c[n - 1].on) { start = [c[n - 1].x, c[n - 1].y]; i0 = 0; } else { start = [(c[0].x + c[n - 1].x) / 2, (c[0].y + c[n - 1].y) / 2]; i0 = 0; }
  const out: Pt[] = [start];
  let cur = start;
  let ctrl: Pt | undefined;
  const lineTo = (p: Pt) => {
    const k = Math.max(1, Math.ceil(Math.hypot(p[0] - cur[0], p[1] - cur[1]) / step));
    for (let j = 1; j <= k; j++) out.push([cur[0] + (p[0] - cur[0]) * j / k, cur[1] + (p[1] - cur[1]) * j / k]);
    cur = p;
  };
  const quadTo = (q: Pt, p: Pt) => {
    const len = Math.hypot(q[0] - cur[0], q[1] - cur[1]) + Math.hypot(p[0] - q[0], p[1] - q[1]);
    const k = Math.max(2, Math.ceil(len / step));
    for (let j = 1; j <= k; j++) {
      const t = j / k, s = 1 - t;
      out.push([s * s * cur[0] + 2 * s * t * q[0] + t * t * p[0], s * s * cur[1] + 2 * s * t * q[1] + t * t * p[1]]);
    }
    cur = p;
  };
  for (let k = 0; k < n; k++) {
    const q = c[(i0 + k) % n];
    const p: Pt = [q.x, q.y];
    if (q.on) {
      if (ctrl) quadTo(ctrl, p); else lineTo(p);
      ctrl = undefined;
    } else if (ctrl) {
      // 连续两个控制点之间隐含一个曲线上的点
      const mid: Pt = [(ctrl[0] + p[0]) / 2, (ctrl[1] + p[1]) / 2];
      quadTo(ctrl, mid);
      ctrl = p;
    } else ctrl = p;
  }
  if (ctrl) quadTo(ctrl, start); else lineTo(start);
  return out;
}

/** 找出文字的变形设置；没有或不变形（textNoShape）时返回 undefined */
export function warpOf(bodyPrs: (XEl | undefined)[]): XEl | undefined {
  for (let i = bodyPrs.length - 1; i >= 0; i--) {
    const w = child(bodyPrs[i], 'a:prstTxWarp');
    if (w) return attr(w, 'prst') === 'textNoShape' ? undefined : w;
  }
  return undefined;
}

/** 映射：字形上的一点（文本框坐标）-> 变形后的位置 */
type Mapper = (g: Glyph, x: number, y: number) => Pt;

/**
 * 包络类：横向按所有字的墨迹外框、沿上下边界按长度比例对应；纵向满组铺满包络，
 * 行少的组按满组的高度缩放、居中。
 */
function envelopeMapper(glyphs: Glyph[], flat: Pt[][][], tracks: Track[], counts: number[]): Mapper | undefined {
  const groups = counts.length;
  const fullCount = Math.max(...counts);
  let X0 = Infinity, X1 = -Infinity;
  const Y0 = new Array<number>(groups).fill(Infinity), Y1 = new Array<number>(groups).fill(-Infinity);
  glyphs.forEach((g, gi) => {
    for (const pts of flat[gi]) for (const [x, y] of pts) {
      X0 = Math.min(X0, x); X1 = Math.max(X1, x);
      Y0[g.group] = Math.min(Y0[g.group], y); Y1[g.group] = Math.max(Y1[g.group], y);
    }
  });
  if (!(X1 > X0)) return undefined;
  let full = 0;
  for (let g = 0; g < groups; g++) if (counts[g] === fullCount && Y1[g] > Y0[g]) full = Math.max(full, Y1[g] - Y0[g]);
  return (g, x, y) => {
    const top = tracks[g.group * 2], bot = tracks[g.group * 2 + 1];
    const h = (counts[g.group] === fullCount ? Y1[g.group] - Y0[g.group] : full) || 1;
    const u = (x - X0) / (X1 - X0), v = 0.5 + (y - (Y0[g.group] + Y1[g.group]) / 2) / h;
    const t = top.at(u), b = bot.at(u);
    return [t[0] + (b[0] - t[0]) * v, t[1] + (b[1] - t[1]) * v];
  };
}

/**
 * 跟随路径类（拱形、圆形、按钮）：字保持原大小，沿路径排；每组最后一行的基线落在路径上，
 * 前面的行往字头方向（行进方向的左侧）偏移。按段落对齐方式从路径起点、中点或终点排起。
 * 每个字是刚性的（实测 PowerPoint 不把字压弯）：字宽中点落在路径上，整个字按那里的切线旋转。
 * 实测路径穿过基线以上约 0.32 倍 x 高度的位置（Arial、Times、Impact、雅黑都吻合到 0.006 字号以内），存在 drop 里。
 * 文字比路径长时整体等比缩小，最长的一行正好排满路径；比路径短时保持原大小。
 */
function followMapper(placed: PlacedLine[], layouts: ParagraphLayout[], tracks: Track[], groupOf: number[], drop: number[]): Mapper {
  // 每行落在路径上的那条线（基线往上 drop）
  const ref = placed.map((p, li) => p.baseline - drop[li]);
  const lastRef = new Map<number, number>();
  ref.forEach((y, li) => lastRef.set(groupOf[li], y));
  // 每行沿自己的路径排：最后一行就是预设路径，前面的行是往外平移的平行路径（字按自然间距排）
  const scale = tracks.map((tr, g) => {
    const widest = Math.max(0, ...placed.filter((_, li) => groupOf[li] === g).map((p) => p.line.width));
    return widest > tr.length && widest > 0 ? tr.length / widest : 1;
  });
  const lineTracks = ref.map((y, li) => tracks[groupOf[li]].offset(((lastRef.get(groupOf[li]) ?? y) - y) * scale[groupOf[li]]));
  const frames = new Map<Glyph, [number, number, number, number]>();
  return (g, x, y) => {
    let f = frames.get(g);
    if (!f) {
      const tr = lineTracks[g.li];
      const p = placed[g.li];
      const algn = layouts[p.pi].algn;
      const L = tr.length, k = scale[g.group];
      const d = algn === 'ctr' ? (g.cx - (p.x + p.line.width / 2)) * k + L / 2 : algn === 'r' ? L - (p.x + p.line.width - g.cx) * k : (g.cx - p.x) * k;
      f = tr.frame(d);
      frames.set(g, f);
    }
    const [px, py, tx, ty] = f;
    const k = scale[g.group];
    const dx = (x - g.cx) * k, up = (ref[g.li] - y) * k;
    return [px + tx * dx + ty * up, py + ty * dx - tx * up];
  };
}

/**
 * 输出变形后的文字（每段一个片段，带段落动画编号）。不能变形时返回 undefined，由调用方按普通文字输出。
 * box 是文字区域的大小（变形铺满它）。
 */
export async function warpText(warp: XEl, layouts: ParagraphLayout[], placed: PlacedLine[], box: { w: number; h: number }, env: TextEnv): Promise<string[] | undefined> {
  const def = warpGeometry(attr(warp, 'prst') ?? '');
  if (!def || !def.paths.length || !placed.length) return undefined;
  const overrides = new Map(children(child(warp, 'a:avLst'), 'a:gd').map((g) => [attr(g, 'name') ?? '', attr(g, 'fmla') ?? ''] as [string, string]));
  const sinks = def.paths.map(() => new SampleSink());
  walkGeometry(def, box.w, box.h, overrides, (i) => sinks[i]);
  const tracks = sinks.map((s) => new Track(s.pts));
  // 路径是奇数条的（拱形、圆形、按钮）文字沿路径排，偶数条的两两一组做包络
  const follow = tracks.length % 2 === 1;
  const groups = follow ? tracks.length : tracks.length / 2;
  // 每行属于哪一组：除不尽时前面的组多一行
  const groupOf: number[] = [];
  const counts: number[] = [];
  for (let g = 0; g < groups; g++) {
    counts.push(Math.floor(placed.length / groups) + (g < placed.length % groups ? 1 : 0));
    for (let k = 0; k < counts[g]; k++) groupOf.push(g);
  }

  // 每个字的轮廓放到文本框坐标里
  const glyphs: Glyph[] = [];
  const drop = placed.map(() => 0);
  for (let li = 0; li < placed.length; li++) {
    const { pi, line, baseline, xs } = placed[li];
    for (let k = 0; k < line.atoms.length; k++) {
      const a = line.atoms[k];
      if (a.space || a.tab || !a.text.trim()) continue;
      if (!a.face) return undefined;
      const metrics = await a.face.load();
      const outline = await metrics.outline(a.text.codePointAt(0)!);
      if (!outline) return undefined;
      const s = a.style;
      const size = s.baseline ? s.size * 0.67 : s.size;
      drop[li] ||= 0.32 * (metrics.xHeight ?? 0.5) * s.size;
      const y0 = baseline - (s.baseline ? s.baseline / 100 * s.size : 0);
      // 字体本身不是斜体而文字要斜体时，和浏览器一样倾斜约 12 度
      const slant = s.italic && !a.face.italic ? 0.21 : 0;
      glyphs.push({
        pi, li, group: groupOf[li], style: s, cx: xs[k] + a.width / 2,
        contours: outline.map((c) => c.map((q) => ({ x: xs[k] + (q.x + q.y * slant) * size, y: y0 - q.y * size, on: q.on }))),
      });
    }
  }
  if (!glyphs.length) return undefined;
  const flat = glyphs.map((g) => g.contours.map((c) => flatten(c, Math.max(0.5, g.style.size / 40))));
  const map = follow ? followMapper(placed, layouts, tracks, groupOf, drop) : envelopeMapper(glyphs, flat, tracks, counts);
  if (!map) return undefined;

  // 按段落、样式合并成 path
  const byPara = new Map<number, Map<RunStyle, string[]>>();
  glyphs.forEach((g, gi) => {
    let d = '';
    for (const pts of flat[gi]) {
      pts.forEach(([x, y], j) => {
        const [mx, my] = map(g, x, y);
        d += `${j ? 'L' : 'M'}${n2(mx)} ${n2(my)}`;
      });
      d += 'Z';
    }
    let styles = byPara.get(g.pi);
    if (!styles) { styles = new Map(); byPara.set(g.pi, styles); }
    const list = styles.get(g.style) ?? [];
    list.push(d);
    styles.set(g.style, list);
  });

  const parts: string[] = [];
  layouts.forEach((pl, pi) => {
    const styles = byPara.get(pi);
    if (!styles) return;
    const paths = [...styles].map(([s, ds]) => `<path d="${ds.join('')}"${paint(s, env)}/>`).join('');
    parts.push(pl.uid ? `<g data-uid="${pl.uid}">${paths}</g>` : paths);
  });
  return parts;
}

/** 填充、轮廓、效果（和普通文字一致） */
function paint(s: RunStyle, env: TextEnv): string {
  const pic = s.blip ? textPicture(s.blip, env) : '';
  let a = pic ? ` fill="${pic}"` : env.doc && s.grad ? ` fill="${textGradient(s.grad, env)}"` : ` fill="${css(s.color)}"${s.color.a < 0.999 ? ` fill-opacity="${n2(s.color.a)}"` : ''}`;
  if (s.outline) a += ` stroke="${css(s.outline.color)}" stroke-width="${n2(s.outline.width)}"${s.outline.color.a < 0.999 ? ` stroke-opacity="${n2(s.outline.color.a)}"` : ''}`;
  const fid = textFilter(s, env);
  if (fid) a += ` filter="url(#${fid})"`;
  return a;
}
