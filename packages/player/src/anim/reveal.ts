/**
 * 扩展点：显现滤镜（PowerPoint 动画里 p:animEffect 的 filter，如 wipe(down)、circle(in)、wheel(4)）。
 * 给出进度 f（0 完全看不见 ~ 1 完全露出）时的 clip-path；同一个滤镜不同进度的结果结构相同，浏览器才能在关键帧之间插值。
 * 加一种：在 FILTERS 里加一项；不认识的滤镜不裁剪（直接显示）。
 */
import { bands, polygon, rectsPolygon, wedges, type Rect } from '../clip';
import { OUTLINES } from './effects/shape';

type Pt = [number, number];
type Clip = (f: number, arg: string, el: Element) => string;

const pct = (v: number) => Math.max(0, Math.min(100, v));

/** 第 i 个按自己的进度 q（0~1）出现：q = 进度 * 个数 - 名次 */
const own = (f: number, n: number, rank: number) => Math.max(0, Math.min(1, f * n - rank));

/** 固定的伪随机顺序（每次一样） */
function order(n: number, seed: number): number[] {
  let s = seed;
  const rnd = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
  const a = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function bbox(el: Element): { width: number; height: number } {
  try { return (el as SVGGraphicsElement).getBBox(); } catch { return { width: 0, height: 0 }; }
}

/** 形状类（圆形、方框、菱形、加号）：out 从中心长大，in 从四周往中心合拢 */
const shapeClip = (kind: string): Clip => (f, arg, el) => {
  const { width: w, height: h } = bbox(el);
  if (!w || !h) return '';
  const outline = OUTLINES[kind];
  return arg === 'in'
    ? `path(evenodd, "M0 0H${w}V${h}H0Z${outline(w / 2, h / 2, w, h, 1 - f)}")`
    : `path("${outline(w / 2, h / 2, w, h, f)}")`;
};

const FILTERS: Record<string, Clip> = {
  /** 擦除：参数是开始露出的那一侧（down 从下边开始往上露出，实测） */
  wipe(f, arg) {
    const r = pct((1 - f) * 100);
    return arg === 'down' ? `inset(${r}% 0 0 0)` : arg === 'up' ? `inset(0 0 ${r}% 0)` : arg === 'right' ? `inset(0 0 0 ${r}%)` : `inset(0 ${r}% 0 0)`;
  },
  /** 劈裂：Vertical 是竖的分割线（左右展开/合拢），out 从中间展开，in 从两边合拢 */
  barn(f, arg) {
    const vert = /vertical/i.test(arg);
    if (/^out/i.test(arg)) {
      const r = pct(50 * (1 - f));
      return vert ? `inset(0 ${r}% 0 ${r}%)` : `inset(${r}% 0 ${r}% 0)`;
    }
    const d = 50 * f;
    const pts: Pt[] = [[0, 0], [d, 0], [d, 100], [100 - d, 100], [100 - d, 0], [100, 0], [100, 100], [0, 100]];
    return polygon(vert ? pts : pts.map(([x, y]): Pt => [y, x]));
  },
  circle: shapeClip('circle'),
  box: shapeClip('box'),
  diamond: shapeClip('diamond'),
  plus: shapeClip('plus'),
  /** 轮子：参数是轮辐数 */
  wheel: (f, arg) => wedges(Math.max(1, Math.min(8, Number(arg) || 1)), f),
  /** 扇形：从 12 点方向向两侧对称张开 */
  wedge(f) {
    const pts: Pt[] = [[50, 50]];
    for (let j = 0; j <= 16; j++) {
      const a = Math.PI * f * (j / 8 - 1);
      pts.push([50 + 75 * Math.sin(a), 50 - 75 * Math.cos(a)]);
    }
    return polygon(pts);
  },
  blinds: (f, arg) => bands(6, f, !/vertical/i.test(arg)),
  /** 随机线条：30 条线按固定的随机顺序各自长满 */
  randombar(f, arg) {
    const n = 30, rank = order(n, 5), horz = !/vertical/i.test(arg), s = 100 / n;
    return rectsPolygon(rank.map((k, i): Rect => {
      const q = own(f, n, k);
      return horz ? [0, i * s, 100, i * s + s * q] : [i * s, 0, i * s + s * q, 100];
    }));
  },
  /** 棋盘：每格从左（down 时从上）往右擦出，隔行错开半格 */
  checkerboard(f, arg) {
    const n = 8, down = /down/i.test(arg), s = 100 / n;
    const rects: Rect[] = [];
    for (let r = 0; r < n; r++) {
      for (let c = -1; c < n; c++) {
        const x0 = c * s + (r % 2 ? s / 2 : 0);
        const a = pct(x0), b = Math.max(a, pct(x0 + s * f));
        rects.push(down ? [r * s, a, (r + 1) * s, b] : [a, r * s, b, (r + 1) * s]);
      }
    }
    return rectsPolygon(rects);
  },
  /** 条纹：沿对角线推进（downRight 从左上角开始） */
  strips(f, arg) {
    const s = 2 * f;
    const base: Pt[] = s <= 1 ? [[0, 0], [s, 0], [s, 0], [0, s], [0, s]] : [[0, 0], [1, 0], [1, s - 1], [s - 1, 1], [0, 1]];
    const flipX = /left/i.test(arg), flipY = /up/i.test(arg);
    return polygon(base.map(([x, y]): Pt => [(flipX ? 1 - x : x) * 100, (flipY ? 1 - y : y) * 100]));
  },
  /** 溶解：10 x 10 个小块按固定的随机顺序从中心长出来 */
  dissolve(f) {
    const n = 10, rank = order(n * n, 9);
    return rectsPolygon(rank.map((k, i): Rect => {
      const q = own(f, n * n, k), x = (i % n) * 10 + 5, y = Math.floor(i / n) * 10 + 5, d = 5 * q;
      return [x - d, y - d, x + d, y + d];
    }));
  },
  /** 滑入（在自己的外框里从一侧进来）：按同方向擦除近似 */
  slide(f, arg) {
    const dir = /top/i.test(arg) ? 'up' : /bottom/i.test(arg) ? 'down' : /left/i.test(arg) ? 'left' : 'right';
    return FILTERS.wipe(f, dir, undefined as unknown as Element);
  },
};

/** 把 inset()/polygon()/path() 换成外框坐标（像素）里的路径 */
function asPath(clip: string, w: number, h: number): string {
  const n = (v: string, total: number) => (parseFloat(v) / 100) * total;
  let m = /^inset\(([^)]*)\)$/.exec(clip);
  if (m) {
    const [t, r, b, l] = m[1].trim().split(/\s+/);
    const x0 = n(l, w), y0 = n(t, h), x1 = w - n(r, w), y1 = h - n(b, h);
    return `M${x0} ${y0}H${x1}V${y1}H${x0}Z`;
  }
  m = /^polygon\(([^)]*)\)$/.exec(clip);
  if (m) return 'M' + m[1].split(',').map((p) => { const [x, y] = p.trim().split(/\s+/); return `${n(x, w)} ${n(y, h)}`; }).join('L') + 'Z';
  m = /^path\((?:evenodd,\s*)?"([^"]*)"\)$/.exec(clip);
  return m ? m[1] : '';
}

/**
 * filter 形如 name(arg)；f 是进度。进入时露出 f 对应的部分；退出（out）时 f 对应的部分被隐去，
 * 剩下的是外框减去它（evenodd 路径）。不认识的滤镜返回空串（不裁剪）
 */
export function revealClip(filter: string, f: number, el: Element, out = false): string {
  const m = /^\s*([a-z]+)\s*(?:\(([^)]*)\))?/i.exec(filter);
  if (!m) return '';
  const name = m[1].toLowerCase();
  if (!Object.prototype.hasOwnProperty.call(FILTERS, name)) return '';
  const clip = FILTERS[name](Math.max(0, Math.min(1, f)), (m[2] ?? '').trim(), el);
  if (!out || !clip) return clip;
  const { width: w, height: h } = bbox(el);
  if (!w || !h) return clip;
  return `path(evenodd, "M0 0H${w}V${h}H0Z${asPath(clip, w, h)}")`;
}
