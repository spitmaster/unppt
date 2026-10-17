/**
 * EMF（增强型图元文件）-> SVG。零依赖，按 [MS-EMF] 规范解析常用的 GDI 记录。
 * Office 生成的"双格式"EMF 里同时有 EMF+ 记录（在 GDI 注释里）和 GDI 记录，这里只画 GDI 部分。
 */
import { EmfDefs, groupClips } from './emf-defs';
import { bitmapSource, ROP_KEY } from './dib-blit';
import { svgImage, type ImageDecoder } from './image-decoder';
import { keyBmp } from './bmp';

interface Pen { color: string; width: number; none: boolean; cap: string; join: string; dash?: string }
interface Brush { color: string; none: boolean }
interface Font { height: number; weight: number; italic: boolean; underline: boolean; strike: boolean; face: string; escapement: number }

interface State {
  xf: [number, number, number, number, number, number];   // 世界变换 m11 m12 m21 m22 dx dy
  winOrg: [number, number]; winExt: [number, number];
  vpOrg: [number, number]; vpExt: [number, number];
  mapMode: number;
  pen: Pen; brush: Brush; font?: Font;
  textColor: string; bkMode: number; textAlign: number; polyFill: number;
  cur: [number, number];
  clip?: string;                                           // 当前裁剪的 clipPath id
}

const STOCK: Record<number, Pen | Brush | Font> = {
  0: { color: '#ffffff', none: false } as Brush,
  1: { color: '#c0c0c0', none: false } as Brush,
  2: { color: '#808080', none: false } as Brush,
  3: { color: '#404040', none: false } as Brush,
  4: { color: '#000000', none: false } as Brush,
  5: { color: '#000000', none: true } as Brush,
  6: { color: '#ffffff', width: 1, none: false, cap: 'round', join: 'round' } as Pen,
  7: { color: '#000000', width: 1, none: false, cap: 'round', join: 'round' } as Pen,
  8: { color: '#000000', width: 1, none: true, cap: 'round', join: 'round' } as Pen,
};

const hex = (n: number) => n.toString(16).padStart(2, '0');
const colorRef = (v: number) => `#${hex(v & 255)}${hex((v >> 8) & 255)}${hex((v >> 16) & 255)}`;
const f2 = (v: number) => (Math.round(v * 100) / 100).toString();
/** XML 1.0 不允许的控制字符（GDI 的字符串里可能带 NUL 等）：留着整张 SVG 都解析不了（浏览器里整张图不显示，出图整页画不出来） */
const BAD_XML = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/g;
/** 单个字符是否 XML 不允许（BAD_XML 带 g 标志，test 会记位置，单独一个不带 g 的） */
const BAD_CHAR = new RegExp(BAD_XML.source);
const escXml = (s: string) => s.replace(BAD_XML, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function base64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000) as unknown as number[]);
  return btoa(s);
}

/**
 * DIB（BITMAPINFO + 像素）-> BMP 文件的 data URI，浏览器能直接显示。
 * alpha：ALPHABLEND 的逐像素透明度（AC_SRC_ALPHA，32 位、预乘）——普通 BMP 头浏览器会忽略透明度，
 * 换成带透明通道掩码的 BITMAPV4HEADER，像素还原成不预乘的；key：这个颜色的像素变透明（按光栅操作，见 dib-blit.ts）
 */
function dibToBmp(d: DataView, offBmi: number, cbBmi: number, offBits: number, cbBits: number, alpha = false, key?: number): string | undefined {
  if (!cbBmi || !cbBits) return undefined;
  // 32 位、普通格式（BI_RGB），或者标准 RGB 掩码的位域格式（BI_BITFIELDS）：像素都是 BGRA
  const comp = cbBmi >= 40 ? d.getUint32(offBmi + 16, true) : -1;
  const stdMasks = comp === 3 && cbBmi >= 52 && d.getUint32(offBmi + 40, true) === 0xff0000 && d.getUint32(offBmi + 44, true) === 0xff00 && d.getUint32(offBmi + 48, true) === 0xff;
  if (alpha && d.getUint32(offBmi, true) === 40 && d.getUint16(offBmi + 14, true) === 32 && (comp === 0 || stdMasks)) {
    return alphaBmp(d, offBmi, offBits, cbBits);
  }
  const total = 14 + cbBmi + cbBits;
  const out = new Uint8Array(total);
  const v = new DataView(out.buffer);
  out[0] = 0x42; out[1] = 0x4d;
  v.setUint32(2, total, true);
  v.setUint32(10, 14 + cbBmi, true);
  out.set(new Uint8Array(d.buffer, d.byteOffset + offBmi, cbBmi), 14);
  out.set(new Uint8Array(d.buffer, d.byteOffset + offBits, cbBits), 14 + cbBmi);
  return `data:image/bmp;base64,${base64(key === undefined ? out : keyBmp(out, key) ?? out)}`;
}

function alphaBmp(d: DataView, offBmi: number, offBits: number, cbBits: number): string {
  const w = d.getInt32(offBmi + 4, true), h = d.getInt32(offBmi + 8, true);
  const n = Math.min(cbBits, Math.abs(w * h) * 4);
  const px = new Uint8Array(d.buffer, d.byteOffset + offBits, n).slice();
  for (let i = 0; i < n; i += 4) {
    const a = px[i + 3];
    if (a && a < 255) for (let k = 0; k < 3; k++) px[i + k] = Math.min(255, Math.round((px[i + k] * 255) / a));
  }
  const out = new Uint8Array(14 + 108 + n);
  const v = new DataView(out.buffer);
  out[0] = 0x42; out[1] = 0x4d;
  v.setUint32(2, out.length, true); v.setUint32(10, 14 + 108, true);
  v.setUint32(14, 108, true); v.setInt32(18, w, true); v.setInt32(22, h, true);
  v.setUint16(26, 1, true); v.setUint16(28, 32, true); v.setUint32(30, 3, true); v.setUint32(34, n, true);   // BI_BITFIELDS
  v.setUint32(54, 0x00ff0000, true); v.setUint32(58, 0x0000ff00, true); v.setUint32(62, 0x000000ff, true); v.setUint32(66, 0xff000000, true);
  v.setUint32(70, 0x73524742, true);                                                                       // 'sRGB'
  out.set(px, 14 + 108);
  return `data:image/bmp;base64,${base64(out)}`;
}

/** 解析失败（文件损坏、被截断）时返回 undefined，不抛异常 */
/** 注册给 MediaStore 的解码器：EMF -> SVG */
export const emfDecoder: ImageDecoder = { exts: ['emf'], decode: (bytes) => svgImage(emfToSvg(bytes)) };

export function emfToSvg(bytes: Uint8Array): string | undefined {
  try {
    return emfToSvgUnsafe(bytes);
  } catch {
    return undefined;
  }
}

function emfToSvgUnsafe(bytes: Uint8Array): string | undefined {
  const d = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 88 || d.getUint32(0, true) !== 1 || d.getUint32(40, true) !== 0x464d4520) return undefined;
  const i32 = (o: number) => d.getInt32(o, true);
  const u32 = (o: number) => d.getUint32(o, true);
  const i16 = (o: number) => d.getInt16(o, true);
  const f32 = (o: number) => d.getFloat32(o, true);

  // 画面范围：用 Frame（0.01 毫米）按设备分辨率换算成设备单位
  const devW = i32(72), devH = i32(76), mmW = i32(80), mmH = i32(84);
  const fx0 = i32(24), fy0 = i32(28), fx1 = i32(32), fy1 = i32(36);
  const kx = mmW ? devW / (mmW * 100) : 1, ky = mmH ? devH / (mmH * 100) : 1;
  const vb = [fx0 * kx, fy0 * ky, (fx1 - fx0) * kx, (fy1 - fy0) * ky];
  if (!(vb[2] > 0 && vb[3] > 0)) {
    vb[0] = i32(8); vb[1] = i32(12); vb[2] = i32(16) - i32(8) + 1; vb[3] = i32(20) - i32(12) + 1;
  }

  const out: string[] = [];
  let idn = 0;
  // 裁剪区域、重复的位图只定义一次（emf-defs.ts）
  const defsOf = new EmfDefs((prefix) => `${prefix}${idn++}`);
  const defs = defsOf.defs;
  /** 由路径构成的裁剪：id -> 路径（求并等组合时要用） */
  const clipD = new Map<string, string>();
  /** GRADIENTFILL 的线性渐变：方向 + 两端颜色 -> id（同样的只定义一次） */
  const grads = new Map<string, string>();
  const objects = new Map<number, Pen | Brush | Font>();
  let st: State = {
    xf: [1, 0, 0, 1, 0, 0], winOrg: [0, 0], winExt: [1, 1], vpOrg: [0, 0], vpExt: [1, 1], mapMode: 1,
    pen: STOCK[7] as Pen, brush: STOCK[0] as Brush, textColor: '#000000', bkMode: 2, textAlign: 0, polyFill: 1, cur: [0, 0],
  };
  const stack: State[] = [];
  let path: string[] | undefined;

  // 逻辑坐标 -> 设备坐标：先世界变换，再页面变换（窗口/视口）
  const scale = () => (st.mapMode === 7 || st.mapMode === 8)
    ? [st.vpExt[0] / (st.winExt[0] || 1), st.vpExt[1] / (st.winExt[1] || 1)] : [1, 1];
  const tp = (x: number, y: number): [number, number] => {
    const [a, b, c, dd, e, f] = st.xf;
    const wx = a * x + c * y + e, wy = b * x + dd * y + f;
    const [sx, sy] = scale();
    return [(wx - st.winOrg[0]) * sx + st.vpOrg[0], (wy - st.winOrg[1]) * sy + st.vpOrg[1]];
  };
  const tlen = (v: number) => {
    const [sx] = scale();
    return Math.abs(v * Math.hypot(st.xf[0], st.xf[1]) * sx);
  };
  const pts = (list: [number, number][]) => list.map(([x, y]) => tp(x, y)).map(([x, y]) => `${f2(x)} ${f2(y)}`);

  const strokeAttr = () => {
    const p = st.pen;
    if (p.none) return ' stroke="none"';
    return ` stroke="${p.color}" stroke-width="${f2(Math.max(tlen(p.width), 0.5))}" stroke-linecap="${p.cap}" stroke-linejoin="${p.join}"${p.dash ? ` stroke-dasharray="${p.dash}"` : ''}`;
  };
  const fillAttr = () => (st.brush.none ? ' fill="none"' : ` fill="${st.brush.color}"${st.polyFill === 1 ? ' fill-rule="evenodd"' : ''}`);
  const clipAttr = () => (st.clip ? ` clip-path="url(#${st.clip})"` : '');
  const emit = (el: string) => out.push(el);
  const shape = (d: string, fill: boolean, stroke: boolean) => {
    emit(`<path d="${d}"${fill ? fillAttr() : ' fill="none"'}${stroke ? strokeAttr() : ' stroke="none"'}${clipAttr()}/>`);
  };

  let p = 0;
  while (p + 8 <= bytes.length) {
    const type = u32(p), size = u32(p + 4);
    if (size < 8 || p + size > bytes.length) break;
    const r = p + 8;
    try {
    switch (type) {
      case 9: st.winExt = [i32(r), i32(r + 4)]; break;
      case 10: st.winOrg = [i32(r), i32(r + 4)]; break;
      case 11: st.vpExt = [i32(r), i32(r + 4)]; break;
      case 12: st.vpOrg = [i32(r), i32(r + 4)]; break;
      case 17: st.mapMode = u32(r); break;
      case 18: st.bkMode = u32(r); break;
      case 19: st.polyFill = u32(r); break;
      case 22: st.textAlign = u32(r); break;
      case 24: st.textColor = colorRef(u32(r)); break;
      case 27: st.cur = [i32(r), i32(r + 4)]; if (path) path.push(`M${pts([st.cur])[0]}`); break;
      case 33: stack.push({ ...st, xf: [...st.xf] as State['xf'] }); break;
      case 34: {
        const n = i32(r);
        const idx = n < 0 ? stack.length + n : n - 1;
        if (idx >= 0 && idx < stack.length) { st = stack[idx]; stack.length = idx; }
        break;
      }
      case 35: st.xf = [f32(r), f32(r + 4), f32(r + 8), f32(r + 12), f32(r + 16), f32(r + 20)]; break;
      case 36: {
        const m: State['xf'] = [f32(r), f32(r + 4), f32(r + 8), f32(r + 12), f32(r + 16), f32(r + 20)];
        const mode = u32(r + 24);
        if (mode === 1) st.xf = [1, 0, 0, 1, 0, 0];
        else {
          const [a, b, c, dd, e, f] = st.xf;
          const [ma, mb, mc, md, me, mf] = m;
          // 2 = 左乘（新变换先作用），3 = 右乘，4 = 直接设置
          if (mode === 2) st.xf = [ma * a + mb * c, ma * b + mb * dd, mc * a + md * c, mc * b + md * dd, me * a + mf * c + e, me * b + mf * dd + f];
          else if (mode === 3) st.xf = [a * ma + b * mc, a * mb + b * md, c * ma + dd * mc, c * mb + dd * md, e * ma + f * mc + me, e * mb + f * md + mf];
          else if (mode === 4) st.xf = m;
        }
        break;
      }
      case 37: {
        const ih = u32(r);
        const o = ih & 0x80000000 ? STOCK[ih & 0x7fffffff] : objects.get(ih);
        if (o) {
          if ('face' in o) st.font = o;
          else if ('cap' in o) st.pen = o as Pen;
          else st.brush = o as Brush;
        }
        break;
      }
      case 38: { // CREATEPEN
        const style = u32(r + 4);
        objects.set(u32(r), { color: colorRef(u32(r + 16)), width: Math.max(i32(r + 8), 1), none: (style & 0xf) === 5, cap: 'round', join: 'round' });
        break;
      }
      case 95: { // EXTCREATEPEN
        const style = u32(r + 20);
        const width = u32(r + 24);
        const brushStyle = u32(r + 28);
        const caps = (style >> 8) & 0xf, joins = (style >> 12) & 0xf;
        const t = style & 0xf;
        const w = Math.max(width, 1);
        const dash = t === 1 ? `${w * 3} ${w}` : t === 2 ? `${w} ${w}` : t === 3 ? `${w * 3} ${w} ${w} ${w}` : undefined;
        objects.set(u32(r), {
          color: colorRef(u32(r + 32)), width, none: t === 5 || brushStyle === 1,
          cap: caps === 1 ? 'square' : caps === 2 ? 'butt' : 'round', join: joins === 1 ? 'bevel' : joins === 2 ? 'miter' : 'round', dash,
        });
        break;
      }
      case 39: { // CREATEBRUSHINDIRECT
        const style = u32(r + 4);
        objects.set(u32(r), { color: colorRef(u32(r + 8)), none: style === 1 });
        break;
      }
      case 94: case 93: objects.set(u32(r), { color: '#808080', none: false }); break; // 图案画刷：用灰色近似
      case 40: objects.delete(u32(r)); break;
      case 82: { // EXTCREATEFONTINDIRECTW
        const lf = r + 4;
        let face = '';
        for (let k = 0; k < 32; k++) { const c = d.getUint16(lf + 28 + k * 2, true); if (!c) break; face += String.fromCharCode(c); }
        objects.set(u32(r), {
          height: i32(lf), escapement: i32(lf + 8), weight: i32(lf + 16), italic: bytes[lf + 20] !== 0,
          underline: bytes[lf + 21] !== 0, strike: bytes[lf + 22] !== 0, face,
        });
        break;
      }
      // ---------------- 路径
      case 59: path = []; break;
      case 60: break;
      case 61: if (path) path.push('Z'); break;
      case 62: case 63: case 64: {
        if (path && path.length) shape(path.join(''), type !== 64, type !== 62);
        path = undefined;
        break;
      }
      case 67: { // SELECTCLIPPATH：用当前路径做裁剪，按区域模式和原来的裁剪组合
        if (path && path.length) {
          const mode = u32(r), d = path.join(''), prev = st.clip, prevD = prev ? clipD.get(prev) : undefined;
          // 1 求交（嵌套在原来的裁剪里）；4 求差（原来的裁剪 ∩ 超大矩形挖掉路径）；2 求并、3 异或（原来的裁剪是路径时
          // 合并成一条，异或按奇偶规则）；5 替换
          let id: string;
          if (mode === 1 && prev) id = defsOf.clip(`<path d="${d}"/>`, prev);
          else if (mode === 4) id = defsOf.clip(`<path d="M-1e6 -1e6H1e6V1e6H-1e6Z${d}" clip-rule="evenodd"/>`, prev);
          else if ((mode === 2 || mode === 3) && prevD) {
            id = defsOf.clip(`<path d="${prevD}${d}"${mode === 2 ? '' : ' clip-rule="evenodd"'}/>`);
            clipD.set(id, prevD + d);
          } else { id = defsOf.clip(`<path d="${d}"/>`); clipD.set(id, d); }
          st.clip = id;
        }
        path = undefined;
        break;
      }
      case 30: { // INTERSECTCLIPRECT
        const [x0, y0] = tp(i32(r), i32(r + 4)), [x1, y1] = tp(i32(r + 8), i32(r + 12));
        st.clip = defsOf.clip(`<rect x="${f2(Math.min(x0, x1))}" y="${f2(Math.min(y0, y1))}" width="${f2(Math.abs(x1 - x0))}" height="${f2(Math.abs(y1 - y0))}"/>`, st.clip);
        break;
      }
      case 75: { // EXTSELECTCLIPRGN：区域由若干矩形组成（设备坐标）
        const cb = u32(r), mode = u32(r + 4);
        if (!cb) { st.clip = undefined; break; }
        const rh = r + 8;
        const n = u32(rh + 8);
        const rects: string[] = [];
        for (let k = 0; k < n; k++) {
          const q = rh + 32 + k * 16;
          rects.push(`<rect x="${i32(q)}" y="${i32(q + 4)}" width="${i32(q + 8) - i32(q)}" height="${i32(q + 12) - i32(q + 4)}"/>`);
        }
        st.clip = defsOf.clip(rects.join(''), mode === 1 ? st.clip : undefined);
        break;
      }
      // ---------------- 图形
      case 2: case 3: case 4: case 5: case 6: case 85: case 86: case 87: case 88: case 89: {
        const small = type >= 85;
        const n = u32(r + 16);
        const list: [number, number][] = [];
        for (let k = 0; k < n; k++) list.push(small ? [i16(r + 20 + k * 4), i16(r + 22 + k * 4)] : [i32(r + 20 + k * 8), i32(r + 24 + k * 8)]);
        const P = pts(list);
        if (!P.length) break;
        const base = small ? type - 83 : type;
        if (base === 5 || base === 6) {
          // ...TO：从当前点接着画
          const seg = base === 5 ? bez(P) : `L${P.join('L')}`;
          if (path) path.push(seg);
          else shape(`M${pts([st.cur])[0]}${seg}`, false, true);
          st.cur = list[list.length - 1];
          break;
        }
        const dd = base === 2 ? `M${P[0]}${bez(P.slice(1))}` : `M${P.join('L')}${base === 3 ? 'Z' : ''}`;
        if (path) path.push(dd);
        else shape(dd, base === 3, true);
        break;
      }
      case 7: case 8: case 90: case 91: { // POLYPOLYLINE / POLYPOLYGON
        const small = type >= 90;
        const nPolys = u32(r + 16);
        let q = r + 24 + nPolys * 4;
        const parts: string[] = [];
        for (let k = 0; k < nPolys; k++) {
          const c = u32(r + 24 + k * 4);
          const list: [number, number][] = [];
          for (let j = 0; j < c; j++) { list.push(small ? [i16(q), i16(q + 2)] : [i32(q), i32(q + 4)]); q += small ? 4 : 8; }
          const P = pts(list);
          if (P.length) parts.push(`M${P.join('L')}${type === 8 || type === 91 ? 'Z' : ''}`);
        }
        const polygon = type === 8 || type === 91;
        if (path) path.push(parts.join(''));
        else if (parts.length) shape(parts.join(''), polygon, true);
        break;
      }
      case 54: { // LINETO
        const to: [number, number] = [i32(r), i32(r + 4)];
        if (path) path.push(`L${pts([to])[0]}`);
        else shape(`M${pts([st.cur])[0]}L${pts([to])[0]}`, false, true);
        st.cur = to;
        break;
      }
      case 42: case 43: case 44: { // ELLIPSE / RECTANGLE / ROUNDRECT
        const [x0, y0] = tp(i32(r), i32(r + 4)), [x1, y1] = tp(i32(r + 8), i32(r + 12));
        const x = Math.min(x0, x1), y = Math.min(y0, y1), w = Math.abs(x1 - x0), h = Math.abs(y1 - y0);
        let dd: string;
        if (type === 42) dd = `M${f2(x)} ${f2(y + h / 2)}A${f2(w / 2)} ${f2(h / 2)} 0 1 1 ${f2(x + w)} ${f2(y + h / 2)}A${f2(w / 2)} ${f2(h / 2)} 0 1 1 ${f2(x)} ${f2(y + h / 2)}Z`;
        else if (type === 44) {
          const rx = Math.min(w / 2, tlen(i32(r + 16)) / 2), ry = Math.min(h / 2, tlen(i32(r + 20)) / 2);
          dd = `M${f2(x + rx)} ${f2(y)}H${f2(x + w - rx)}A${f2(rx)} ${f2(ry)} 0 0 1 ${f2(x + w)} ${f2(y + ry)}V${f2(y + h - ry)}A${f2(rx)} ${f2(ry)} 0 0 1 ${f2(x + w - rx)} ${f2(y + h)}H${f2(x + rx)}A${f2(rx)} ${f2(ry)} 0 0 1 ${f2(x)} ${f2(y + h - ry)}V${f2(y + ry)}A${f2(rx)} ${f2(ry)} 0 0 1 ${f2(x + rx)} ${f2(y)}Z`;
        } else dd = `M${f2(x)} ${f2(y)}H${f2(x + w)}V${f2(y + h)}H${f2(x)}Z`;
        if (path) path.push(dd); else shape(dd, true, true);
        break;
      }
      // ---------------- 文字
      case 84: case 83: {
        const wide = type === 84;
        const t = r + 28;
        // EMRTEXT：参考点、字数、字符串偏移、选项、[矩形（选项含 ETO_NO_RECT 时省略）]、间距数组偏移
        const options = u32(t + 16);
        const refX = i32(t), refY = i32(t + 4), n = u32(t + 8), offStr = u32(t + 12);
        const offDx = u32(t + (options & 0x100 ? 20 : 36));
        const chars: string[] = [];
        for (let k = 0; k < n; k++) chars.push(wide ? String.fromCharCode(d.getUint16(p + offStr + k * 2, true)) : String.fromCharCode(bytes[p + offStr + k]));
        // XML 不允许的控制字符（字数常把结束符 NUL 也算进去）连同它的位置一起去掉
        const keep = chars.map((_, k) => k).filter((k) => !BAD_CHAR.test(chars[k]));
        const str = keep.map((k) => chars[k]).join('');
        if (!str.trim() || !st.font) break;
        const f = st.font;
        const ta = st.textAlign;
        const [x0, y0] = tp(refX, refY);
        const em = tlen(Math.abs(f.height)) * (f.height > 0 ? 0.82 : 1);
        // 每个字的位置：用记录里的间距数组（逻辑单位）
        const xs: number[] = [];
        let acc = refX;
        for (let k = 0; k < n; k++) {
          xs.push(tp(acc, refY)[0]);
          acc += offDx ? i32(p + offDx + k * 4) : 0;
        }
        const anchor = (ta & 6) === 6 ? 'middle' : (ta & 6) === 2 ? 'end' : 'start';
        const vbase = (ta & 24) === 24 ? '' : (ta & 8) === 8 ? ' dominant-baseline="text-after-edge"' : ' dominant-baseline="text-before-edge"';
        const rot = f.escapement ? ` transform="rotate(${f2(-f.escapement / 10)} ${f2(x0)} ${f2(y0)})"` : '';
        const xAttr = offDx && anchor === 'start' ? keep.map((k) => f2(xs[k])).join(' ') : f2(x0);
        const deco = [f.underline ? 'underline' : '', f.strike ? 'line-through' : ''].filter(Boolean).join(' ');
        emit(`<text x="${xAttr}" y="${f2(y0)}" font-family="'${escXml(f.face)}',sans-serif" font-size="${f2(em)}" fill="${st.textColor}"${f.weight >= 600 ? ' font-weight="bold"' : ''}${f.italic ? ' font-style="italic"' : ''}${deco ? ` text-decoration="${deco}"` : ''} text-anchor="${anchor}"${vbase}${rot}${clipAttr()} xml:space="preserve">${escXml(str)}</text>`);
        break;
      }
      // ---------------- 位图
      // 114 是 ALPHABLEND：和 STRETCHBLT 的布局一样，只是光栅操作字段换成了混合方式
      case 118: { // GRADIENTFILL：矩形水平 / 垂直渐变；三角形（顶点着色）按三个顶点的平均色近似
        const nVer = u32(r + 16), nTri = u32(r + 20), mode = u32(r + 24), v0 = r + 28;
        if (nVer > 1e5 || nTri > 1e5 || v0 + nVer * 16 + nTri * (mode === 2 ? 12 : 8) > p + size) break;
        const vx = (k: number) => i32(v0 + k * 16), vy = (k: number) => i32(v0 + k * 16 + 4);
        const vc = (k: number) => [0, 2, 4].map((o) => d.getUint16(v0 + k * 16 + 8 + o, true) >> 8);
        const hex = (c: number[]) => `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
        const ix = v0 + nVer * 16;
        for (let t = 0; t < nTri; t++) {
          if (mode === 2) {
            const ks = [0, 1, 2].map((j) => u32(ix + t * 12 + j * 4)).filter((k) => k < nVer);
            if (ks.length < 3) continue;
            // 顶点着色：按大小细分成 n² 个小三角形，每块取重心处插值的颜色（导出工具拼出的小三角形 n = 1，就是平均色）
            const P = ks.map((k) => tp(vx(k), vy(k))), C = ks.map(vc);
            const edge = Math.max(...[0, 1, 2].map((j) => Math.hypot(P[j][0] - P[(j + 1) % 3][0], P[j][1] - P[(j + 1) % 3][1])));
            // 细分次数也受颜色差限制（相邻小块最多差 4 级）：三个顶点几乎同色时不用细分。
            // 实测样本里一张 EMF 有 2.4 万个顶点同色的大三角形，每个分成 100 块，转出 238 万条路径、232MB
            const delta = Math.max(...[0, 1, 2].map((ch) => Math.max(C[0][ch], C[1][ch], C[2][ch]) - Math.min(C[0][ch], C[1][ch], C[2][ch])));
            const n = Math.max(1, Math.min(10, Math.ceil(edge / Math.max(vb[2], vb[3]) * 40), Math.ceil(delta / 4)));
            const at = (a: number, b: number) => [P[0][0] + (P[1][0] - P[0][0]) * a / n + (P[2][0] - P[0][0]) * b / n, P[0][1] + (P[1][1] - P[0][1]) * a / n + (P[2][1] - P[0][1]) * b / n];
            const tri = (q: number[][]) => {
              const u = (q.reduce((s2, v) => s2 + v[0], 0) / 3) / n, w = (q.reduce((s2, v) => s2 + v[1], 0) / 3) / n;
              const c = [0, 1, 2].map((ch) => Math.round(C[0][ch] * (1 - u - w) + C[1][ch] * u + C[2][ch] * w));
              emit(`<path d="M${q.map(([a, b]) => at(a, b).map(f2).join(' ')).join('L')}Z" fill="${hex(c)}" shape-rendering="crispEdges"${clipAttr()}/>`);
            };
            for (let a = 0; a < n; a++) {
              for (let b = 0; a + b < n; b++) {
                tri([[a, b], [a + 1, b], [a, b + 1]]);
                if (a + b < n - 1) tri([[a + 1, b], [a + 1, b + 1], [a, b + 1]]);
              }
            }
            continue;
          }
          const a = u32(ix + t * 8), b = u32(ix + t * 8 + 4);
          if (a >= nVer || b >= nVer) continue;
          const [x0, y0] = tp(vx(a), vy(a)), [x1, y1] = tp(vx(b), vy(b));
          // 渐变从左上顶点的颜色到右下顶点的颜色；坐标换算翻转了方向时颜色对调
          const flip = mode === 0 ? x0 > x1 : y0 > y1;
          const ca = hex(vc(flip ? b : a)), cb = hex(vc(flip ? a : b));
          let fill = ca;
          if (ca !== cb) {
            const key = `${mode}${ca}${cb}`;
            let id = grads.get(key);
            if (!id) {
              id = `g${idn++}`;
              grads.set(key, id);
              defs.push(`<linearGradient id="${id}" x2="${mode === 0 ? 1 : 0}" y2="${mode === 0 ? 0 : 1}"><stop offset="0" stop-color="${ca}"/><stop offset="1" stop-color="${cb}"/></linearGradient>`);
            }
            fill = `url(#${id})`;
          }
          // GDI 画渐变不抗锯齿；不抗锯齿也让导出工具拼出的竖条之间没有细缝
          emit(`<rect x="${f2(Math.min(x0, x1))}" y="${f2(Math.min(y0, y1))}" width="${f2(Math.abs(x1 - x0))}" height="${f2(Math.abs(y1 - y0))}" fill="${fill}" shape-rendering="crispEdges"${clipAttr()}/>`);
        }
        break;
      }
      case 76: case 77: case 81: case 114: {
        let x: number, y: number, w: number, h: number, offBmi: number, cbBmi: number, offBits: number, cbBits: number;
        // 源框（位图里取哪一块）：BITBLT 和目标一样大
        let sx: number, sy: number, sw: number, sh: number;
        if (type === 81) {
          x = i32(r + 16); y = i32(r + 20);
          sx = i32(r + 24); sy = i32(r + 28); sw = i32(r + 32); sh = i32(r + 36);
          offBmi = u32(r + 40); cbBmi = u32(r + 44); offBits = u32(r + 48); cbBits = u32(r + 52);
          w = i32(r + 64); h = i32(r + 68);
        } else {
          x = i32(r + 16); y = i32(r + 20); w = i32(r + 24); h = i32(r + 28);
          offBmi = u32(r + 76); cbBmi = u32(r + 80); offBits = u32(r + 84); cbBits = u32(r + 88);
          [sw, sh] = type === 76 ? [w, h] : [i32(r + 92), i32(r + 96)];
          // 源坐标按源设备的变换（XformSrc）换成位图像素：录制时只存用到的那块位图，偏移写在这里（实测 BITBLT 源点 (40, 40) 存成 eDx = -39）
          const m11 = f32(r + 44), m22 = f32(r + 56), dx = f32(r + 60), dy = f32(r + 64);
          sx = m11 * i32(r + 36) + dx; sy = m22 * i32(r + 40) + dy; sw *= m11; sh *= m22;
        }
        const [ax, ay] = tp(x, y), [bx, by] = tp(x + w, y + h);
        const X = Math.min(ax, bx), Y = Math.min(ay, by), W = Math.abs(bx - ax), H = Math.abs(by - ay);
        // ALPHABLEND 的混合方式：第 3 个字节是整体透明度，第 4 个字节 AC_SRC_ALPHA（1）表示用位图自带的逐像素透明度
        const alpha = type === 114 ? d.getUint8(r + 34) / 255 : 1;
        const rop = type === 81 ? u32(r + 60) : type === 114 ? 0 : u32(r + 32);
        const href = cbBmi ? dibToBmp(d, p + offBmi, cbBmi, p + offBits, cbBits, type === 114 && d.getUint8(r + 35) === 1, ROP_KEY.get(rop)) : undefined;
        // 目标框经过坐标换算后左右或上下颠倒（世界变换翻转、目标宽高为负）时 GDI 把位图镜像着画（样本：世界变换上下翻转、
        // 位图本身倒着存，PowerPoint 显示是正的）
        const flip = { h: bx < ax, v: by < ay };
        if (href) emit(defsOf.bitmap(href, X, Y, W, H, `${alpha < 1 ? ` opacity="${f2(alpha)}"` : ''}${clipAttr()}`, cbBmi ? bitmapSource(d, p + offBmi, type === 81, sx, sy, sw, sh) : undefined, flip));
        else if (type === 76 && !st.brush.none) {
          // 没有源位图的 BitBlt：用当前画刷填充（常见于背景）
          if (rop === 0x00f00021 || rop === 0x00000042 || rop === 0x00ff0062) {
            const color = rop === 0x00000042 ? '#000000' : rop === 0x00ff0062 ? '#ffffff' : st.brush.color;
            emit(`<rect x="${f2(X)}" y="${f2(Y)}" width="${f2(W)}" height="${f2(H)}" fill="${color}"${clipAttr()}/>`);
          }
        }
        break;
      }
      case 14: p = bytes.length; continue;
      default: break;
    }
    } catch {
      // 单条记录解析失败（数据不完整等）：跳过，继续画后面的
    }
    p += size;
  }
  const body = defsOf.finish(groupClips(out));
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb.map(f2).join(' ')}" preserveAspectRatio="none">${defs.length ? `<defs>${defs.join('')}</defs>` : ''}${body}</svg>`;
}

function bez(P: string[]): string {
  let s = '';
  for (let k = 0; k + 2 < P.length; k += 3) s += `C${P[k]} ${P[k + 1]} ${P[k + 2]}`;
  return s;
}
