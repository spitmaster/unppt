/**
 * WMF（Windows 图元文件，比 EMF 更老的 16 位格式）-> SVG。零依赖，按 [MS-WMF] 规范解析常用记录。
 * 注意：WMF 记录的参数多数是"倒序"存放的（例如矩形是 下、右、上、左）。
 */
import { svgImage, type ImageDecoder } from './image-decoder';

interface Pen { color: string; width: number; none: boolean }
interface Brush { color: string; none: boolean }
interface Font { height: number; weight: number; italic: boolean; underline: boolean; strike: boolean; face: string; charset: number; escapement: number }
type Obj = { kind: 'pen'; v: Pen } | { kind: 'brush'; v: Brush } | { kind: 'font'; v: Font } | { kind: 'other' };

const hex = (n: number) => n.toString(16).padStart(2, '0');
const colorRef = (v: number) => `#${hex(v & 255)}${hex((v >> 8) & 255)}${hex((v >> 16) & 255)}`;
const f2 = (v: number) => (Math.round(v * 100) / 100).toString();
const escXml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * 按字符集解码文字（中文 GBK、繁体 Big5、日文 Shift-JIS、韩文 EUC-KR）。
 * 很多 WMF 把字符集标成 0（西文），实际存的是生成机器的系统代码页：
 * 这时如果含高位字节、并且能按 GBK 完整解出汉字，就当 GBK。
 */
function decodeText(bytes: Uint8Array, charset: number): string {
  const name = charset === 134 ? 'gbk' : charset === 136 ? 'big5' : charset === 128 ? 'shift_jis' : charset === 129 ? 'euc-kr' : '';
  try {
    if (name) return new TextDecoder(name).decode(bytes);
    if (bytes.some((b) => b >= 0x80)) {
      const t = new TextDecoder('gbk', { fatal: true }).decode(bytes);
      if (/[一-鿿]/.test(t)) return t;
    }
  } catch { /* 不是 GBK */ }
  return new TextDecoder('windows-1252').decode(bytes);
}

function base64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000) as unknown as number[]);
  return btoa(s);
}

function dibToBmp(dib: Uint8Array): string | undefined {
  if (dib.length < 40) return undefined;
  const v = new DataView(dib.buffer, dib.byteOffset, dib.byteLength);
  const hsize = v.getUint32(0, true);
  const bits = v.getUint16(14, true);
  const used = hsize >= 36 ? v.getUint32(32, true) : 0;
  const palette = bits <= 8 ? (used || 1 << bits) * 4 : 0;
  const out = new Uint8Array(14 + dib.length);
  const ov = new DataView(out.buffer);
  out[0] = 0x42; out[1] = 0x4d;
  ov.setUint32(2, out.length, true);
  ov.setUint32(10, 14 + hsize + palette, true);
  out.set(dib, 14);
  return `data:image/bmp;base64,${base64(out)}`;
}

/** 解析失败（文件损坏、被截断）时返回 undefined，不抛异常 */
/** 注册给 MediaStore 的解码器：WMF -> SVG */
export const wmfDecoder: ImageDecoder = { exts: ['wmf'], decode: (bytes) => svgImage(wmfToSvg(bytes)) };

export function wmfToSvg(bytes: Uint8Array): string | undefined {
  try {
    return wmfToSvgUnsafe(bytes);
  } catch {
    return undefined;
  }
}

function wmfToSvgUnsafe(bytes: Uint8Array): string | undefined {
  const d = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 18) return undefined;
  const u16 = (o: number) => d.getUint16(o, true);
  const i16 = (o: number) => d.getInt16(o, true);
  const u32 = (o: number) => d.getUint32(o, true);

  let p = 0;
  let vb = [0, 0, 1000, 1000];
  if (u32(0) === 0x9ac6cdd7) {
    // 可放置头：画面范围（逻辑单位）
    const l = i16(6), t = i16(8), r = i16(10), b = i16(12);
    vb = [Math.min(l, r), Math.min(t, b), Math.abs(r - l) || 1, Math.abs(b - t) || 1];
    p = 22;
  }
  const headerWords = u16(p + 2);
  if (headerWords !== 9) return undefined;
  const numObjects = u16(p + 10);
  p += headerWords * 2;

  const objects: (Obj | undefined)[] = new Array(Math.max(numObjects, 1)).fill(undefined);
  const addObj = (o: Obj) => {
    const i = objects.findIndex((x) => !x);
    if (i >= 0) objects[i] = o; else objects.push(o);
  };
  interface St { pen: Pen; brush: Brush; font?: Font; textColor: string; textAlign: number; polyFill: number; cur: [number, number]; winOrg: [number, number]; winExt?: [number, number]; clip?: string }
  let st: St = { pen: { color: '#000000', width: 1, none: false }, brush: { color: '#ffffff', none: false }, textColor: '#000000', textAlign: 0, polyFill: 1, cur: [0, 0], winOrg: [vb[0], vb[1]] };
  const stack: St[] = [];
  const out: string[] = [];
  const defs: string[] = [];
  let idn = 0;

  const pt = (x: number, y: number) => `${f2(x)} ${f2(y)}`;
  const stroke = () => (st.pen.none ? ' stroke="none"' : ` stroke="${st.pen.color}" stroke-width="${f2(Math.max(st.pen.width, 1))}" stroke-linejoin="round" stroke-linecap="round"`);
  const fill = () => (st.brush.none ? ' fill="none"' : ` fill="${st.brush.color}"${st.polyFill === 1 ? ' fill-rule="evenodd"' : ''}`);
  const clip = () => (st.clip ? ` clip-path="url(#${st.clip})"` : '');
  const shape = (dd: string, filled: boolean) => out.push(`<path d="${dd}"${filled ? fill() : ' fill="none"'}${stroke()}${clip()}/>`);

  while (p + 6 <= bytes.length) {
    const size = u32(p) * 2;
    const fn = u16(p + 4);
    if (size < 6 || p + size > bytes.length || fn === 0) break;
    const r = p + 6;
    try {
      switch (fn) {
        case 0x020b: st.winOrg = [i16(r + 2), i16(r)]; break;          // SETWINDOWORG（y, x）
        case 0x020c: st.winExt = [i16(r + 2), i16(r)]; break;          // SETWINDOWEXT
        case 0x0106: st.polyFill = u16(r); break;
        case 0x0209: st.textColor = colorRef(u32(r)); break;
        case 0x012e: st.textAlign = u16(r); break;
        case 0x001e: stack.push({ ...st }); break;                      // SAVEDC
        case 0x0127: {                                                  // RESTOREDC
          const n = i16(r);
          const idx = n < 0 ? stack.length + n : n - 1;
          if (idx >= 0 && idx < stack.length) { st = stack[idx]; stack.length = idx; }
          break;
        }
        case 0x02fa: addObj({ kind: 'pen', v: { color: colorRef(u32(r + 6)), width: i16(r + 2), none: (u16(r) & 0xf) === 5 } }); break;
        case 0x02fc: addObj({ kind: 'brush', v: { color: colorRef(u32(r + 2)), none: u16(r) === 1 } }); break;
        case 0x02fb: {                                                  // CREATEFONTINDIRECT
          const charset = bytes[r + 15];
          let end = r + 18;
          while (end < p + size && bytes[end]) end++;
          const face = decodeText(bytes.subarray(r + 18, end), charset);
          addObj({ kind: 'font', v: { height: i16(r), escapement: i16(r + 4), weight: i16(r + 8), italic: !!bytes[r + 10], underline: !!bytes[r + 11], strike: !!bytes[r + 12], charset, face } });
          break;
        }
        case 0x00f7: case 0x06ff: case 0x0142: case 0x01f9: case 0x0322: addObj({ kind: 'other' }); break; // 调色板、区域、图案画刷等
        case 0x012d: {                                                  // SELECTOBJECT
          const o = objects[u16(r)];
          if (o?.kind === 'pen') st.pen = o.v;
          else if (o?.kind === 'brush') st.brush = o.v;
          else if (o?.kind === 'font') st.font = o.v;
          break;
        }
        case 0x01f0: objects[u16(r)] = undefined; break;                // DELETEOBJECT
        case 0x0416: {                                                  // INTERSECTCLIPRECT（下、右、上、左）
          const b = i16(r), rr = i16(r + 2), t = i16(r + 4), l = i16(r + 6);
          const id = `w${idn++}`;
          defs.push(`<clipPath id="${id}"${st.clip ? ` clip-path="url(#${st.clip})"` : ''}><rect x="${l}" y="${t}" width="${rr - l}" height="${b - t}"/></clipPath>`);
          st.clip = id;
          break;
        }
        case 0x012c: st.clip = undefined; break;                        // SELECTCLIPREGION（简化：取消裁剪）
        case 0x0214: st.cur = [i16(r + 2), i16(r)]; break;              // MOVETO（y, x）
        case 0x0213: {                                                  // LINETO
          const to: [number, number] = [i16(r + 2), i16(r)];
          shape(`M${pt(...st.cur)}L${pt(...to)}`, false);
          st.cur = to;
          break;
        }
        case 0x0324: case 0x0325: {                                     // POLYGON / POLYLINE
          const n = i16(r);
          const ps: string[] = [];
          for (let k = 0; k < n; k++) ps.push(pt(i16(r + 2 + k * 4), i16(r + 4 + k * 4)));
          if (ps.length) shape(`M${ps.join('L')}${fn === 0x0324 ? 'Z' : ''}`, fn === 0x0324);
          break;
        }
        case 0x0538: {                                                  // POLYPOLYGON
          const n = u16(r);
          let q = r + 2 + n * 2;
          const parts: string[] = [];
          for (let k = 0; k < n; k++) {
            const c = u16(r + 2 + k * 2);
            const ps: string[] = [];
            for (let j = 0; j < c; j++) { ps.push(pt(i16(q), i16(q + 2))); q += 4; }
            if (ps.length) parts.push(`M${ps.join('L')}Z`);
          }
          if (parts.length) shape(parts.join(''), true);
          break;
        }
        case 0x041b: case 0x0418: case 0x061c: {                        // RECTANGLE / ELLIPSE / ROUNDRECT
          const o = fn === 0x061c ? 4 : 0;
          const b = i16(r + o), rr = i16(r + o + 2), t = i16(r + o + 4), l = i16(r + o + 6);
          const x = Math.min(l, rr), y = Math.min(t, b), w = Math.abs(rr - l), h = Math.abs(b - t);
          if (fn === 0x0418) shape(`M${pt(x, y + h / 2)}A${f2(w / 2)} ${f2(h / 2)} 0 1 1 ${pt(x + w, y + h / 2)}A${f2(w / 2)} ${f2(h / 2)} 0 1 1 ${pt(x, y + h / 2)}Z`, true);
          else if (fn === 0x061c) {
            const ry = Math.min(h / 2, Math.abs(i16(r)) / 2), rx = Math.min(w / 2, Math.abs(i16(r + 2)) / 2);
            out.push(`<rect x="${f2(x)}" y="${f2(y)}" width="${f2(w)}" height="${f2(h)}" rx="${f2(rx)}" ry="${f2(ry)}"${fill()}${stroke()}${clip()}/>`);
          } else shape(`M${pt(x, y)}H${f2(x + w)}V${f2(y + h)}H${f2(x)}Z`, true);
          break;
        }
        case 0x0521: case 0x0a32: {                                     // TEXTOUT / EXTTEXTOUT
          let x: number, y: number, n: number, so: number;
          if (fn === 0x0521) { n = i16(r); so = r + 2; y = i16(so + ((n + 1) & ~1)); x = i16(so + ((n + 1) & ~1) + 2); }
          else {
            y = i16(r); x = i16(r + 2); n = i16(r + 4);
            const opts = u16(r + 6);
            so = r + 8 + (opts & 6 ? 8 : 0);
          }
          if (!st.font || n <= 0) break;
          const f = st.font;
          const str = decodeText(bytes.subarray(so, so + n), f.charset);
          if (!str.trim()) break;
          const ta = st.textAlign;
          const anchor = (ta & 6) === 6 ? 'middle' : (ta & 6) === 2 ? 'end' : 'start';
          const vbase = (ta & 24) === 24 ? '' : (ta & 8) === 8 ? ' dominant-baseline="text-after-edge"' : ' dominant-baseline="text-before-edge"';
          const em = Math.abs(f.height) * (f.height > 0 ? 0.82 : 1);
          const rot = f.escapement ? ` transform="rotate(${f2(-f.escapement / 10)} ${f2(x)} ${f2(y)})"` : '';
          const deco = [f.underline ? 'underline' : '', f.strike ? 'line-through' : ''].filter(Boolean).join(' ');
          out.push(`<text x="${f2(x)}" y="${f2(y)}" font-family="'${escXml(f.face)}',sans-serif" font-size="${f2(em)}" fill="${st.textColor}"${f.weight >= 600 ? ' font-weight="bold"' : ''}${f.italic ? ' font-style="italic"' : ''}${deco ? ` text-decoration="${deco}"` : ''} text-anchor="${anchor}"${vbase}${rot}${clip()} xml:space="preserve">${escXml(str)}</text>`);
          break;
        }
        case 0x0f43: case 0x0b41: {                                     // STRETCHDIB / DIBSTRETCHBLT
          const o = fn === 0x0f43 ? 2 : 0;
          const dh = i16(r + 4 + o + 8), dw = i16(r + 4 + o + 10), dy = i16(r + 4 + o + 12), dx = i16(r + 4 + o + 14);
          const dibStart = r + 4 + o + 16;
          const href = dibToBmp(bytes.subarray(dibStart, p + size));
          if (href) out.push(`<image href="${href}" x="${f2(Math.min(dx, dx + dw))}" y="${f2(Math.min(dy, dy + dh))}" width="${f2(Math.abs(dw))}" height="${f2(Math.abs(dh))}" preserveAspectRatio="none"${clip()}/>`);
          break;
        }
        default: break;
      }
    } catch {
      // 单条记录出错跳过
    }
    p += size;
  }
  // 有窗口原点/范围时以它为准
  if (st.winExt) vb = [st.winOrg[0], st.winOrg[1], st.winExt[0], st.winExt[1]];
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb.map(f2).join(' ')}" preserveAspectRatio="none">${defs.length ? `<defs>${defs.join('')}</defs>` : ''}${out.join('')}</svg>`;
}
