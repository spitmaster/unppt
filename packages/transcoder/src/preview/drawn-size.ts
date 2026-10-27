/**
 * 整页图里每张位图实际画多大（设备像素）：resvg 缩小位图时不先做区域平均（没有多级纹理），画得比原图小很多时照片发花、出摩尔纹，
 * 截图里的细线、小字断掉（样本里的照片、截图、表格图片、EMF / WMF 里的位图）。PowerPoint 缩小时把覆盖到的像素都平均进去。
 * 这里算出每个 <image> 元素在这张 SVG 里画多大（按元素算，不按图片：同一张图在一页里画成几种大小时各缩各的），
 * fit-images.ts 先把原图低通缩到这么大再交给 resvg。
 * 跟着变换走：元素的 transform、嵌套 <svg> 的视口、<use> 引用、填充 / 描边引用的 <pattern>（含 patternTransform）、<mask> 的内容。
 * 算不出来的用法（objectBoundingBox 单位的图案 / 遮罩内容、带 viewBox 的图案、百分比尺寸等）这个元素记 null：不缩，照原样交给 resvg。
 */

/** 仿射矩阵 a b c d e f：x' = a·x + c·y + e，y' = b·x + d·y + f */
type Mat = [number, number, number, number, number, number];

/** 一处用法：图片自己的横、竖方向各画成多少设备像素；fit 是 preserveAspectRatio（meet / slice 时按原图比例等比缩放） */
export interface DrawnUse { w: number; h: number; fit: 'none' | 'meet' | 'slice' }

/** <image> 元素（标签在 SVG 文本里的位置）-> 各处用法（被 <use>、图案引用时不止一处）；null 表示有算不出来的用法 */
export type DrawnSizes = Map<number, DrawnUse[] | null>;

const ID: Mat = [1, 0, 0, 1, 0, 0];

function mul(A: Mat, B: Mat): Mat {
  return [A[0] * B[0] + A[2] * B[1], A[1] * B[0] + A[3] * B[1], A[0] * B[2] + A[2] * B[3], A[1] * B[2] + A[3] * B[3],
    A[0] * B[4] + A[2] * B[5] + A[4], A[1] * B[4] + A[3] * B[5] + A[5]];
}

function inv(m: Mat): Mat | undefined {
  const det = m[0] * m[3] - m[1] * m[2];
  if (!det || !Number.isFinite(det)) return undefined;
  return [m[3] / det, -m[1] / det, -m[2] / det, m[0] / det, (m[2] * m[5] - m[3] * m[4]) / det, (m[1] * m[4] - m[0] * m[5]) / det];
}

/** transform 属性 -> 矩阵；写法认不出来时 undefined */
export function parseTransform(s: string): Mat | undefined {
  let m = ID;
  const rest = s.replace(/(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/g, (_, f: string, args: string) => {
    const v = args.trim().split(/[\s,]+/).filter(Boolean).map(Number);
    let t: Mat | undefined;
    if (f === 'matrix' && v.length === 6) t = v as Mat;
    else if (f === 'translate' && v.length >= 1) t = [1, 0, 0, 1, v[0], v[1] ?? 0];
    else if (f === 'scale' && v.length >= 1) t = [v[0], 0, 0, v[1] ?? v[0], 0, 0];
    else if (f === 'rotate' && v.length >= 1) {
      const a = (v[0] * Math.PI) / 180, c = Math.cos(a), sn = Math.sin(a), cx = v[1] ?? 0, cy = v[2] ?? 0;
      t = [c, sn, -sn, c, cx - c * cx + sn * cy, cy - sn * cx - c * cy];
    } else if (f === 'skewX' && v.length === 1) t = [1, 0, Math.tan((v[0] * Math.PI) / 180), 1, 0, 0];
    else if (f === 'skewY' && v.length === 1) t = [1, Math.tan((v[0] * Math.PI) / 180), 0, 1, 0, 0];
    if (!t || t.some((x) => !Number.isFinite(x))) m = [NaN, 0, 0, 0, 0, 0];
    else m = mul(m, t);
    return '';
  });
  return rest.replace(/[\s,]/g, '') || !Number.isFinite(m[0]) ? undefined : m;
}

/** viewBox 映射到 x y w h 的视口（preserveAspectRatio）；尺寸不是数字时 undefined */
function viewport(x: number, y: number, w: number, h: number, vb: string | undefined, par: string | undefined): Mat | undefined {
  if (!(w > 0 && h > 0)) return undefined;
  if (!vb) return [1, 0, 0, 1, x, y];
  const v = vb.trim().split(/[\s,]+/).map(Number);
  if (v.length !== 4 || !(v[2] > 0 && v[3] > 0)) return undefined;
  let sx = w / v[2], sy = h / v[3];
  const p = (par ?? 'xMidYMid meet').trim();
  if (!p.startsWith('none')) {
    const s = /slice/.test(p) ? Math.max(sx, sy) : Math.min(sx, sy);
    sx = sy = s;
  }
  const ax = /xMid/.test(p) ? 0.5 : /xMax/.test(p) ? 1 : 0, ay = /YMid/.test(p) ? 0.5 : /YMax/.test(p) ? 1 : 0;
  const tx = p.startsWith('none') ? 0 : (w - v[2] * sx) * ax, ty = p.startsWith('none') ? 0 : (h - v[3] * sy) * ay;
  return [sx, 0, 0, sy, x - v[0] * sx + tx, y - v[1] * sy + ty];
}

/** m 是 undefined 时这处的变换算不出来：引用的图片都记 null。img 的 at 是 <image> 标签的位置，其它的 ref 是引用的 id */
interface Event { kind: 'img' | 'paint' | 'use' | 'mask'; m: Mat | undefined; ref: string; at?: number; w?: number; h?: number; fit?: DrawnUse['fit'] }
interface Container { events: Event[]; unknown: boolean }
/** 带 id 的普通元素：它在容器里的事件范围、它父元素的矩阵（<use> 引用它时换算用） */
interface Target { c: Container; start: number; end: number; parent: Mat }
interface Frame { name: string; m: Mat | undefined; c: Container; target?: Target }

/** 不直接画、只被引用的容器元素 */
const CONTAINERS = new Set(['defs', 'pattern', 'mask', 'clipPath', 'symbol', 'marker', 'filter']);
const TAG = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<[?!][^>]*>|<(\/?)([A-Za-z][\w:.-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g;

function attr(attrs: string, name: string): string | undefined {
  const i = attrs.indexOf(`${name}=`);
  if (i < 0) return undefined;
  const m = new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`).exec(attrs);
  return m ? m[1] ?? m[2] : undefined;
}

function num(attrs: string, name: string, def: number): number {
  const v = attr(attrs, name);
  if (v === undefined) return def;
  return /^\s*-?[\d.]+(e-?\d+)?(px)?\s*$/i.test(v) ? parseFloat(v) : NaN;
}

/**
 * 扫一遍 SVG，算每个位图元素（地址不以 # 开头的 <image>）各处画多大。fitWidth：整张 SVG 画成多宽（resvg 的 fitTo 宽度）。
 * 不认识的结构宁可记 null（不缩）也不猜
 */
export function drawnSizes(svg: string, fitWidth: number): DrawnSizes {
  const out: DrawnSizes = new Map();
  if (!svg.includes('<image')) return out;
  const root: Container = { events: [], unknown: false };
  const targets = new Map<string, Target>();
  const paints = new Map<string, { c: Container; t: Mat | undefined }>();
  const masks = new Map<string, Container>();
  const stack: Frame[] = [];
  for (const mt of svg.matchAll(TAG)) {
    const name = mt[2];
    if (!name) continue;
    if (mt[1]) {
      const f = stack.pop();
      if (f?.target) f.target.end = f.target.c.events.length;
      continue;
    }
    let attrs = mt[3];
    const self = attrs.endsWith('/');
    if (self) attrs = attrs.slice(0, -1);
    const parent = stack[stack.length - 1];
    let c = parent?.c ?? root;
    let m: Mat | undefined = parent ? parent.m : ID;
    const id = attrs.includes('id=') ? attr(attrs, 'id') : undefined;
    if (CONTAINERS.has(name)) {
      c = { events: [], unknown: name === 'symbol' || name === 'marker' };
      m = ID;
      if (name === 'pattern') {
        if (attr(attrs, 'patternContentUnits') === 'objectBoundingBox' || attr(attrs, 'viewBox') !== undefined || attr(attrs, 'href') || attr(attrs, 'xlink:href')) c.unknown = true;
        const pt = attr(attrs, 'patternTransform');
        if (id) paints.set(id, { c, t: pt ? parseTransform(pt) : ID });
      } else if (name === 'mask') {
        if (attr(attrs, 'maskContentUnits') === 'objectBoundingBox') c.unknown = true;
        if (id) masks.set(id, c);
      }
    } else if (m) {
      if (name === 'svg') {
        const x = num(attrs, 'x', 0), y = num(attrs, 'y', 0);
        const w = num(attrs, 'width', NaN), h = num(attrs, 'height', NaN);
        let vp = viewport(x, y, w, h, attr(attrs, 'viewBox'), attr(attrs, 'preserveAspectRatio'));
        // 根元素：再按 fitTo 宽度缩放（resvg 先按 width / height 定大小，再整体缩放到 fitWidth）
        if (vp && !parent) vp = mul([fitWidth / w, 0, 0, fitWidth / w, 0, 0], vp);
        m = vp ? mul(m, vp) : undefined;
      }
      const tf = attrs.includes('transform') ? attr(attrs, 'transform') : undefined;
      if (tf !== undefined && m) { const t = parseTransform(tf); m = t ? mul(m, t) : undefined; }
      if (name === 'use' && m) m = mul(m, [1, 0, 0, 1, num(attrs, 'x', 0) || 0, num(attrs, 'y', 0) || 0]);
    }
    const ev = (e: Event) => { c.events.push(e); };
    let target: Target | undefined;
    if (id && !CONTAINERS.has(name) && parent?.m) {
      target = { c, start: c.events.length, end: c.events.length, parent: parent.m };
      targets.set(id, target);
    }
    const href = attr(attrs, 'href') ?? attr(attrs, 'xlink:href');
    if (name === 'image' && href && !href.startsWith('#')) {
      const w = num(attrs, 'width', NaN), h = num(attrs, 'height', NaN);
      const par = (attr(attrs, 'preserveAspectRatio') ?? 'xMidYMid meet').trim();
      if (!m || !(w >= 0 && h >= 0) || c.unknown) out.set(mt.index!, null);
      else ev({ kind: 'img', m, ref: href, at: mt.index!, w, h, fit: par.startsWith('none') ? 'none' : /slice/.test(par) ? 'slice' : 'meet' });
    } else if (name === 'use' && href?.startsWith('#')) ev({ kind: 'use', m, ref: href.slice(1) });
    if (attrs.includes('url(')) {
      for (const u of attrs.matchAll(/(?:fill|stroke)\s*[=:]\s*["']?\s*url\(\s*["']?#([^)"']+)/g)) ev({ kind: 'paint', m, ref: u[1] });
      const mk = /\smask\s*=\s*["']url\(#([^)"']+)\)/.exec(attrs);
      if (mk) ev({ kind: 'mask', m, ref: mk[1] });
    }
    if (!self) stack.push({ name, m, c, ...(target ? { target } : {}) });
    else if (target) target.end = c.events.length;
  }

  const add = (at: number, use: DrawnUse | null) => {
    const cur = out.get(at);
    if (cur === null) return;
    if (use === null) out.set(at, null);
    else if (cur) cur.push(use);
    else out.set(at, [use]);
  };
  /** 容器 c 里 [from, to) 的事件按 B（容器坐标 -> 设备像素）展开 */
  const resolve = (c: Container, from: number, to: number, B: Mat | undefined, depth: number) => {
    for (let i = from; i < to; i++) {
      const e = c.events[i];
      const M = B && e.m ? mul(B, e.m) : undefined;
      if (e.kind === 'img') {
        add(e.at!, M && !c.unknown ? { w: e.w! * Math.hypot(M[0], M[1]), h: e.h! * Math.hypot(M[2], M[3]), fit: e.fit! } : null);
        continue;
      }
      if (depth > 8) continue;
      if (e.kind === 'paint') {
        const p = paints.get(e.ref);
        if (p) resolve(p.c, 0, p.c.events.length, M && p.t && !p.c.unknown ? mul(M, p.t) : undefined, depth + 1);
      } else if (e.kind === 'mask') {
        const mc = masks.get(e.ref);
        if (mc) resolve(mc, 0, mc.events.length, mc.unknown ? undefined : M, depth + 1);
      } else {
        const t = targets.get(e.ref);
        const pi = t && inv(t.parent);
        if (t) resolve(t.c, t.start, t.end, M && pi ? mul(M, pi) : undefined, depth + 1);
      }
    }
  };
  resolve(root, 0, root.events.length, ID, 0);
  return out;
}
