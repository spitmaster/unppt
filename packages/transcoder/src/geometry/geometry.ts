/**
 * DrawingML 形状几何：公式引擎 + 路径生成。
 * 预设形状（prstGeom）和自定义形状（custGeom）用同一套引擎计算，输出 SVG path。
 */
import { attr, child, children, type XEl } from '../io/xml';
import { PRESETS, WARPS } from './presets';
import type { GeomCmd, GeomDef, GeomPath } from './types';

/** 每像素的 EMU（96 DPI；几何层不依赖 model，这里单独写） */
const EMU_PER_PX = 9525;

export type { GeomCmd, GeomDef, GeomPath } from './types';


export interface Geometry { paths: SvgPath[]; text: { x: number; y: number; w: number; h: number }; }

export interface SvgPath { d: string; fill: GeomPath['fill']; stroke: boolean; }

const DEG = 60000; // 角度单位：1/60000 度

function builtins(w: number, h: number): Map<string, number> {
  const ss = Math.min(w, h), ls = Math.max(w, h);
  const m = new Map<string, number>([
    ['w', w], ['h', h], ['l', 0], ['t', 0], ['r', w], ['b', h], ['hc', w / 2], ['vc', h / 2],
    ['ss', ss], ['ls', ls], ['cd2', 10800000], ['cd4', 5400000], ['cd8', 2700000],
    ['3cd4', 16200000], ['3cd8', 8100000], ['5cd8', 13500000], ['7cd8', 18900000],
  ]);
  for (const d of [2, 3, 4, 5, 6, 8, 10, 12, 16, 32]) {
    m.set(`wd${d}`, w / d);
    m.set(`hd${d}`, h / d);
    m.set(`ssd${d}`, ss / d);
  }
  m.set('3wd4', w * 3 / 4); m.set('3hd4', h * 3 / 4); m.set('3wd8', w * 3 / 8); m.set('3hd8', h * 3 / 8);
  m.set('5wd8', w * 5 / 8); m.set('5hd8', h * 5 / 8); m.set('7wd8', w * 7 / 8); m.set('7hd8', h * 7 / 8);
  return m;
}

const rad = (a: number) => (a / DEG) * Math.PI / 180;

function evalFormula(f: string, v: (s: string) => number): number {
  const p = f.trim().split(/\s+/);
  const [op] = p;
  const x = p.length > 1 ? v(p[1]) : 0;
  const y = p.length > 2 ? v(p[2]) : 0;
  const z = p.length > 3 ? v(p[3]) : 0;
  switch (op) {
    case '*/': return z === 0 ? 0 : (x * y) / z;
    case '+-': return x + y - z;
    case '+/': return z === 0 ? 0 : (x + y) / z;
    case '?:': return x > 0 ? y : z;
    case 'abs': return Math.abs(x);
    case 'at2': return (Math.atan2(y, x) * 180 / Math.PI) * DEG;
    case 'cat2': return x * Math.cos(Math.atan2(z, y));
    case 'sat2': return x * Math.sin(Math.atan2(z, y));
    case 'cos': return x * Math.cos(rad(y));
    case 'sin': return x * Math.sin(rad(y));
    case 'tan': return x * Math.tan(rad(y));
    case 'max': return Math.max(x, y);
    case 'min': return Math.min(x, y);
    case 'mod': return Math.sqrt(x * x + y * y + z * z);
    case 'pin': return y < x ? x : y > z ? z : y;
    case 'sqrt': return Math.sqrt(Math.max(0, x));
    case 'val': return x;
    default: return 0;
  }
}

/** 从 XML（a:custGeom，或预设定义）读几何定义；doc：文档里的 custGeom（路径没写 w / h 时坐标是 EMU） */
export function parseGeomXml(el: XEl, doc = false): GeomDef {
  const gdList = (name: string) => children(child(el, name), 'a:gd').map((g) => [attr(g, 'name') ?? '', attr(g, 'fmla') ?? 'val 0'] as [string, string]);
  const paths: GeomPath[] = children(child(el, 'a:pathLst'), 'a:path').map((p) => {
    const cmds: GeomCmd[] = [];
    const pt = (e: XEl | undefined) => [attr(e, 'x') ?? '0', attr(e, 'y') ?? '0'];
    for (const c of p.children) {
      switch (c.name) {
        case 'a:moveTo': cmds.push({ op: 'M', args: pt(child(c, 'a:pt')) }); break;
        case 'a:lnTo': cmds.push({ op: 'L', args: pt(child(c, 'a:pt')) }); break;
        case 'a:arcTo': cmds.push({ op: 'A', args: [attr(c, 'wR') ?? '0', attr(c, 'hR') ?? '0', attr(c, 'stAng') ?? '0', attr(c, 'swAng') ?? '0'] }); break;
        case 'a:cubicBezTo': cmds.push({ op: 'C', args: children(c, 'a:pt').flatMap(pt) }); break;
        case 'a:quadBezTo': cmds.push({ op: 'Q', args: children(c, 'a:pt').flatMap(pt) }); break;
        case 'a:close': cmds.push({ op: 'Z', args: [] }); break;
      }
    }
    return {
      w: attr(p, 'w') ? Number(attr(p, 'w')) : undefined,
      h: attr(p, 'h') ? Number(attr(p, 'h')) : undefined,
      // 诊断样本：SmartArt 缓存里的弧线 custGeom 路径没写 w / h，坐标是 EMU（以前当像素画到了几百万像素外）
      ...(doc && !Number(attr(p, 'w')) && !Number(attr(p, 'h')) ? { emu: true } : {}),
      fill: (attr(p, 'fill') as GeomPath['fill']) ?? 'norm',
      stroke: attr(p, 'stroke') !== '0' && attr(p, 'stroke') !== 'false',
      cmds,
    };
  });
  const r = child(el, 'a:rect');
  const rect = r ? [attr(r, 'l') ?? 'l', attr(r, 't') ?? 't', attr(r, 'r') ?? 'r', attr(r, 'b') ?? 'b'] as [string, string, string, string] : undefined;
  return { av: gdList('a:avLst'), gd: gdList('a:gdLst'), paths, rect };
}

const fmt = (n: number) => (Math.round(n * 100) / 100).toString();

/** 路径的接收方：遍历几何路径时依次收到各段（坐标已换算到形状坐标系） */
export interface PathSink {
  move(x: number, y: number): void;
  line(x: number, y: number): void;
  cubic(x1: number, y1: number, x2: number, y2: number, x: number, y: number): void;
  quad(x1: number, y1: number, x: number, y: number): void;
  /** 椭圆弧：圆心 (ox, oy)、半径、起始参数角 t1 和扫过的参数角 dt（弧度） */
  arc(ox: number, oy: number, wR: number, hR: number, t1: number, dt: number): void;
  close(): void;
}

/** 算出所有调整值和公式变量 */
function variables(def: GeomDef, w: number, h: number, overrides: Map<string, string>): (s: string) => number {
  const vars = builtins(w, h);
  const v = (s: string): number => {
    const n = Number(s);
    if (Number.isFinite(n) && s !== '') return n;
    return vars.get(s) ?? 0;
  };
  for (const [name, f] of def.av) vars.set(name, evalFormula(overrides.get(name) ?? f, v));
  for (const [name, f] of overrides) if (!vars.has(name)) vars.set(name, evalFormula(f, v));
  for (const [name, f] of def.gd) vars.set(name, evalFormula(f, v));
  return v;
}

/** 遍历一条路径，把各段交给 sink */
function walkPath(p: GeomPath, w: number, h: number, v: (s: string) => number, sink: PathSink) {
  const sx = p.w ? w / p.w : p.emu ? 1 / EMU_PER_PX : 1;
  const sy = p.h ? h / p.h : p.emu ? 1 / EMU_PER_PX : 1;
  let cx = 0, cy = 0;
  for (const c of p.cmds) {
    const a = c.args.map(v);
    switch (c.op) {
      case 'M': cx = a[0] * sx; cy = a[1] * sy; sink.move(cx, cy); break;
      case 'L': cx = a[0] * sx; cy = a[1] * sy; sink.line(cx, cy); break;
      case 'C': sink.cubic(a[0] * sx, a[1] * sy, a[2] * sx, a[3] * sy, a[4] * sx, a[5] * sy); cx = a[4] * sx; cy = a[5] * sy; break;
      case 'Q': sink.quad(a[0] * sx, a[1] * sy, a[2] * sx, a[3] * sy); cx = a[2] * sx; cy = a[3] * sy; break;
      case 'A': {
        const wR = a[0] * sx, hR = a[1] * sy;
        const st = rad(a[2]), sw = rad(a[3]);
        if (wR === 0 || hR === 0) break;
        // 角度是"视觉角度"，换算成椭圆参数角
        const param = (ang: number) => Math.atan2(wR * Math.sin(ang), hR * Math.cos(ang));
        const t1 = param(st);
        const t2 = param(st + sw);
        // 圆心
        const ox = cx - wR * Math.cos(t1);
        const oy = cy - hR * Math.sin(t1);
        // 参数角的扫过量，保持与 sw 同向
        let dt = t2 - t1;
        if (sw > 0) while (dt < 0) dt += Math.PI * 2;
        if (sw < 0) while (dt > 0) dt -= Math.PI * 2;
        if (Math.abs(sw) >= Math.PI * 2 - 1e-9) dt = sw > 0 ? Math.PI * 2 : -Math.PI * 2;
        sink.arc(ox, oy, wR, hR, t1, dt);
        cx = ox + wR * Math.cos(t1 + dt);
        cy = oy + hR * Math.sin(t1 + dt);
        break;
      }
      case 'Z': sink.close(); break;
    }
  }
}

/** 输出 SVG path 数据 */
class SvgPathSink implements PathSink {
  readonly out: string[] = [];
  move(x: number, y: number) { this.out.push(`M${fmt(x)} ${fmt(y)}`); }
  line(x: number, y: number) { this.out.push(`L${fmt(x)} ${fmt(y)}`); }
  cubic(x1: number, y1: number, x2: number, y2: number, x: number, y: number) { this.out.push(`C${fmt(x1)} ${fmt(y1)} ${fmt(x2)} ${fmt(y2)} ${fmt(x)} ${fmt(y)}`); }
  quad(x1: number, y1: number, x: number, y: number) { this.out.push(`Q${fmt(x1)} ${fmt(y1)} ${fmt(x)} ${fmt(y)}`); }
  arc(ox: number, oy: number, wR: number, hR: number, t1: number, dt: number) {
    // 超过半圈拆成两段，避免整圆时 SVG arc 退化
    const segs = Math.abs(dt) > Math.PI ? 2 : 1;
    for (let k = 1; k <= segs; k++) {
      const t = t1 + (dt * k) / segs;
      const ex = ox + wR * Math.cos(t);
      const ey = oy + hR * Math.sin(t);
      const large = Math.abs(dt / segs) > Math.PI ? 1 : 0;
      const sweep = dt > 0 ? 1 : 0;
      this.out.push(`A${fmt(wR)} ${fmt(hR)} 0 ${large} ${sweep} ${fmt(ex)} ${fmt(ey)}`);
    }
  }
  close() { this.out.push('Z'); }
}

/** 平面上的点映射（透视投影等）：直线段的端点、曲线的控制点映射过去；圆弧先拆成三次贝塞尔，曲线拆细后再映射 */
export type PointMap = (x: number, y: number) => [number, number];

/** 输出映射后的 SVG path 数据（只用 M、L、C、Z） */
class MappedPathSink implements PathSink {
  readonly out: string[] = [];
  private x = 0;
  private y = 0;
  constructor(private map: PointMap) {}
  private pt(x: number, y: number) { const [a, b] = this.map(x, y); return `${fmt(a)} ${fmt(b)}`; }
  move(x: number, y: number) { this.out.push(`M${this.pt(x, y)}`); this.x = x; this.y = y; }
  line(x: number, y: number) { this.out.push(`L${this.pt(x, y)}`); this.x = x; this.y = y; }
  cubic(x1: number, y1: number, x2: number, y2: number, x: number, y: number) {
    // 拆成 4 段再映射控制点（透视下曲线的误差随段长平方减小）
    const p0 = [this.x, this.y], p1 = [x1, y1], p2 = [x2, y2], p3 = [x, y];
    const at = (t: number) => { const u = 1 - t; return [0, 1].map((k) => u * u * u * p0[k] + 3 * u * u * t * p1[k] + 3 * u * t * t * p2[k] + t * t * t * p3[k]); };
    const d = (t: number) => { const u = 1 - t; return [0, 1].map((k) => 3 * u * u * (p1[k] - p0[k]) + 6 * u * t * (p2[k] - p1[k]) + 3 * t * t * (p3[k] - p2[k])); };
    const n = 4;
    for (let i = 0; i < n; i++) {
      const ta = i / n, tb = (i + 1) / n, a = at(ta), b = at(tb), da = d(ta), db = d(tb), s = (tb - ta) / 3;
      this.out.push(`C${this.pt(a[0] + da[0] * s, a[1] + da[1] * s)} ${this.pt(b[0] - db[0] * s, b[1] - db[1] * s)} ${this.pt(b[0], b[1])}`);
    }
    this.x = x; this.y = y;
  }
  quad(x1: number, y1: number, x: number, y: number) {
    this.cubic(this.x + (2 / 3) * (x1 - this.x), this.y + (2 / 3) * (y1 - this.y), x + (2 / 3) * (x1 - x), y + (2 / 3) * (y1 - y), x, y);
  }
  arc(ox: number, oy: number, wR: number, hR: number, t1: number, dt: number) {
    // 每段不超过 45° 的三次贝塞尔近似椭圆弧
    const n = Math.max(1, Math.ceil(Math.abs(dt) / (Math.PI / 4)));
    const h = dt / n, k = (4 / 3) * Math.tan(h / 4);
    for (let i = 0; i < n; i++) {
      const a = t1 + h * i, b = a + h;
      const ax = ox + wR * Math.cos(a), ay = oy + hR * Math.sin(a), bx = ox + wR * Math.cos(b), by = oy + hR * Math.sin(b);
      this.out.push(`C${this.pt(ax - k * wR * Math.sin(a), ay + k * hR * Math.cos(a))} ${this.pt(bx + k * wR * Math.sin(b), by - k * hR * Math.cos(b))} ${this.pt(bx, by)}`);
      this.x = bx; this.y = by;
    }
  }
  close() { this.out.push('Z'); }
}

/**
 * 计算几何，返回 SVG path 列表（坐标单位与传入的 w、h 相同，原点在形状左上角）。
 * overrides 是形状自己 a:avLst 里覆盖的调整值；map 给了时每个点再映射一次（三维旋转的透视投影）。
 */
export function buildGeometry(def: GeomDef, w: number, h: number, overrides: Map<string, string> = new Map(), map?: PointMap): Geometry {
  const v = variables(def, w, h, overrides);
  const paths = def.paths.map((p) => {
    const sink = map ? new MappedPathSink(map) : new SvgPathSink();
    walkPath(p, w, h, v, sink);
    return { d: sink.out.join(''), fill: p.fill, stroke: p.stroke };
  });
  // 文字区域（标准里每个预设形状都定义了，例如椭圆的文字框比外框小）
  let text = { x: 0, y: 0, w, h };
  if (def.rect) {
    const [l, t, r, b] = def.rect.map(v);
    if (r > l && b > t) text = { x: l, y: t, w: r - l, h: b - t };
  }
  return { paths, text };
}

/** 计算几何，每条路径交给 sinkOf(路径序号) 返回的接收方（艺术字变形按点采样时用） */
export function walkGeometry(def: GeomDef, w: number, h: number, overrides: Map<string, string>, sinkOf: (i: number) => PathSink) {
  const v = variables(def, w, h, overrides);
  def.paths.forEach((p, i) => walkPath(p, w, h, v, sinkOf(i)));
}

export function presetGeometry(name: string): GeomDef | undefined {
  return PRESETS.get(name);
}

export function warpGeometry(name: string): GeomDef | undefined {
  return WARPS.get(name);
}
