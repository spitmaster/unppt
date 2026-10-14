/**
 * 线条两端的箭头（a:headEnd / a:tailEnd）：按 PowerPoint 实测的几何直接画成图形，线在箭头处截短。
 * 实测（lines-arrows 用例：5 种箭头 × 1/3/6 磅线宽，三角箭头 3 × 3 种宽度、长度）：
 *   - 箭头宽 = 宽度系数 × e、长 = 长度系数 × e，系数 小 2 / 中 3 / 大 5；e = 线宽，细于 2 磅时按 2 磅；
 *   - 三角、燕尾、开放箭头的尖正好在线的端点；菱形、圆点以端点为中心；
 *   - 开放箭头是线宽的折线（斜接），外侧的尖在端点；燕尾的凹口在离尖 0.7 × 长处；
 *   - 线在箭头里面截短（三角、燕尾截到线宽被箭头完全盖住的地方），不从尖上露出来。
 * 只画在不封闭的路径两端（封闭形状 PowerPoint 不画箭头）。
 */
import { n2 } from '../common/svg';
import type { Line } from './line';

type End = NonNullable<Line['head']>;

const SIZE: Record<string, number> = { sm: 2, med: 3, lg: 5 };
/** 2 磅（像素） */
const MIN_E = 8 / 3;
/** 燕尾的凹口离尖的距离（× 长） */
const STEALTH_NOTCH = 0.7;

interface Pt { x: number; y: number }

/** 路径的起点、终点和那里的走向（单位向量，指向路径外面），以及把端点挪动后的新路径 */
interface PathEnds {
  start: Pt; startDir: Pt; end: Pt; endDir: Pt;
  rebuild(start: Pt, end: Pt): string;
}

const unit = (x: number, y: number): Pt => { const l = Math.hypot(x, y) || 1; return { x: x / l, y: y / l }; };

/** 解析绝对坐标的路径（geometry.ts 输出的 M/L/C/Q/A/Z）；有 Z 或多个子路径时返回 undefined */
function pathEnds(d: string): PathEnds | undefined {
  const toks = d.match(/[MLCQAZ]|-?[\d.]+(?:e-?\d+)?/gi);
  if (!toks || /[Zz]/.test(d)) return undefined;
  const segs: { op: string; n: number[] }[] = [];
  let i = 0;
  while (i < toks.length) {
    const op = toks[i++];
    const k = op === 'M' || op === 'L' ? 2 : op === 'C' ? 6 : op === 'Q' ? 4 : op === 'A' ? 7 : 0;
    if (!k) return undefined;
    segs.push({ op, n: toks.slice(i, i + k).map(Number) });
    i += k;
  }
  if (segs.length < 2 || segs[0].op !== 'M' || segs.slice(1).some((s) => s.op === 'M')) return undefined;
  const p0 = { x: segs[0].n[0], y: segs[0].n[1] };
  const endOf = (s: { n: number[] }): Pt => ({ x: s.n[s.n.length - 2], y: s.n[s.n.length - 1] });
  const prevEnd = (j: number): Pt => endOf(segs[j - 1]);
  // 某一段在起点（at = 0）或终点（at = 1）处的切线方向（沿路径前进的方向）
  const tangent = (j: number, at: 0 | 1): Pt => {
    const s = segs[j], a = prevEnd(j), b = endOf(s);
    if (s.op === 'C' || s.op === 'Q') {
      const c1 = { x: s.n[0], y: s.n[1] }, c2 = s.op === 'C' ? { x: s.n[2], y: s.n[3] } : c1;
      if (at === 0) return Math.hypot(c1.x - a.x, c1.y - a.y) > 1e-6 ? unit(c1.x - a.x, c1.y - a.y) : unit(b.x - a.x, b.y - a.y);
      return Math.hypot(b.x - c2.x, b.y - c2.y) > 1e-6 ? unit(b.x - c2.x, b.y - c2.y) : unit(b.x - a.x, b.y - a.y);
    }
    if (s.op === 'A') return arcTangent(a, s.n, at);
    return unit(b.x - a.x, b.y - a.y);
  };
  const last = segs.length - 1;
  const t0 = tangent(1, 0), t1 = tangent(last, 1);
  return {
    start: p0, startDir: { x: -t0.x, y: -t0.y }, end: endOf(segs[last]), endDir: t1,
    rebuild(start, end) {
      const out = segs.map((s) => ({ op: s.op, n: [...s.n] }));
      // 挪起点：第一段的控制点跟着平移，保持走向
      const ds = { x: start.x - p0.x, y: start.y - p0.y };
      out[0].n = [start.x, start.y];
      if (out[1].op === 'C' || out[1].op === 'Q') { out[1].n[0] += ds.x; out[1].n[1] += ds.y; }
      const e0 = endOf(segs[last]), de = { x: end.x - e0.x, y: end.y - e0.y };
      const ln = out[last].n;
      ln[ln.length - 2] = end.x; ln[ln.length - 1] = end.y;
      if (out[last].op === 'C') { ln[2] += de.x; ln[3] += de.y; }
      if (out[last].op === 'Q' && last > 1) { ln[0] += de.x; ln[1] += de.y; }
      return out.map((s) => `${s.op}${s.n.map(n2).join(' ')}`).join('');
    },
  };
}

/** SVG 椭圆弧（端点参数）在起点 / 终点的切线方向 */
function arcTangent(a: Pt, n: number[], at: 0 | 1): Pt {
  let [rx, ry] = [Math.abs(n[0]), Math.abs(n[1])];
  const [, , , large, sweep, bx, by] = n;
  if (!rx || !ry) return unit(bx - a.x, by - a.y);
  const x1 = (a.x - bx) / 2, y1 = (a.y - by) / 2;
  const lam = (x1 * x1) / (rx * rx) + (y1 * y1) / (ry * ry);
  if (lam > 1) { rx *= Math.sqrt(lam); ry *= Math.sqrt(lam); }
  const num = rx * rx * ry * ry - rx * rx * y1 * y1 - ry * ry * x1 * x1;
  const k = (large !== sweep ? 1 : -1) * Math.sqrt(Math.max(0, num / (rx * rx * y1 * y1 + ry * ry * x1 * x1)));
  const cx = k * (rx * y1) / ry + (a.x + bx) / 2, cy = k * -(ry * x1) / rx + (a.y + by) / 2;
  const p = at === 0 ? a : { x: bx, y: by };
  // 椭圆上一点的切线：(-(p.y - cy)·rx/ry, (p.x - cx)·ry/rx)，sweep = 1 是顺时针（屏幕坐标里角度增加）
  const tx = -(p.y - cy) * (rx / ry), ty = (p.x - cx) * (ry / rx);
  return sweep ? unit(tx, ty) : unit(-tx, -ty);
}

/** 一个箭头：tip 是端点，dir 是朝外的方向；返回图形和线要截短的长度 */
function head(end: End, tip: Pt, dir: Pt, w: number, color: string): { svg: string; cut: number } {
  const e = Math.max(w, MIN_E);
  const W = (SIZE[end.w] ?? 3) * e, L = (SIZE[end.len] ?? 3) * e;
  const nx = -dir.y, ny = dir.x;
  const at = (back: number, side: number) => `${n2(tip.x - dir.x * back + nx * side)} ${n2(tip.y - dir.y * back + ny * side)}`;
  // 三角形里线宽被完全盖住的位置（离尖）
  const covered = Math.min(L * 0.9, (L * w) / W + 0.5);
  switch (end.type) {
    case 'oval': {
      const ang = (Math.atan2(dir.y, dir.x) * 180) / Math.PI;
      return { svg: `<ellipse cx="${n2(tip.x)}" cy="${n2(tip.y)}" rx="${n2(L / 2)}" ry="${n2(W / 2)}" transform="rotate(${n2(ang)} ${n2(tip.x)} ${n2(tip.y)})" fill="${color}"/>`, cut: 0 };
    }
    case 'diamond':
      return { svg: `<path d="M${at(-L / 2, 0)}L${at(0, W / 2)}L${at(L / 2, 0)}L${at(0, -W / 2)}Z" fill="${color}"/>`, cut: 0 };
    case 'stealth':
      return { svg: `<path d="M${at(0, 0)}L${at(L, W / 2)}L${at(L * STEALTH_NOTCH, 0)}L${at(L, -W / 2)}Z" fill="${color}"/>`, cut: Math.min(covered, L * STEALTH_NOTCH) };
    case 'arrow': {
      // 折线的中心线：外侧的尖落在端点，所以中心线的尖往回挪 (w/2) / sin θ
      const back = w / 2 / Math.sin(Math.atan2(W / 2, L));
      return {
        svg: `<path d="M${at(back + L, W / 2)}L${at(back, 0)}L${at(back + L, -W / 2)}" fill="none" stroke="${color}" stroke-width="${n2(w)}" stroke-linejoin="miter" stroke-miterlimit="20"/>`,
        cut: back,
      };
    }
    default:
      return { svg: `<path d="M${at(0, 0)}L${at(L, W / 2)}L${at(L, -W / 2)}Z" fill="${color}"/>`, cut: covered };
  }
}

/** 给描边路径加箭头：返回截短后的路径和箭头图形；没有箭头、路径封闭时返回 undefined */
export function arrowheads(d: string, line: Line, color: string): { d: string; heads: string } | undefined {
  const hs = line.head && line.head.type !== 'none' ? line.head : undefined;
  const ts = line.tail && line.tail.type !== 'none' ? line.tail : undefined;
  if (!hs && !ts) return undefined;
  const pe = pathEnds(d);
  if (!pe) return undefined;
  const parts: string[] = [];
  let start = pe.start, end = pe.end;
  if (hs) {
    const h = head(hs, pe.start, pe.startDir, line.width, color);
    parts.push(h.svg);
    start = { x: pe.start.x - pe.startDir.x * h.cut, y: pe.start.y - pe.startDir.y * h.cut };
  }
  if (ts) {
    const t = head(ts, pe.end, pe.endDir, line.width, color);
    parts.push(t.svg);
    end = { x: pe.end.x - pe.endDir.x * t.cut, y: pe.end.y - pe.endDir.y * t.cut };
  }
  return { d: pe.rebuild(start, end), heads: parts.join('') };
}
