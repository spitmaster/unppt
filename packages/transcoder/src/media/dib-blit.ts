/**
 * EMF / WMF 位图记录共用的规则（emf.ts、wmf.ts）：源框取位图的哪一块、按光栅操作抠透明。
 * 实测见 SPEC 第 7 节（emf-bitmap-src 用例）。
 */

/** 只画位图的一部分：源框（x、y 从位图左上角算，像素）和位图的宽高 */
export interface BitmapSource { x: number; y: number; w: number; h: number; bw: number; bh: number }

/**
 * 光栅操作 -> 按哪个颜色抠透明：图标先用黑白掩码 SRCAND、再用彩色图 SRCINVERT / SRCPAINT 画，掩码的白色和彩色图的黑色
 * 都是"不改变底下"；其它光栅操作照常画
 */
export const ROP_KEY = new Map([[0x008800c6, 0xffffff], [0x00660046, 0x000000], [0x00ee0086, 0x000000]]);

/**
 * 源框不是整张位图时返回要画的部分，整张时 undefined。offBmi 是 BITMAPINFO 的位置。
 * fromBottom：源框 y 从位图最下面一行往上数（EMF 的 STRETCHDIBITS、WMF 的 STRETCHDIB，从上往下存的 DIB 也一样）；
 * 否则从左上角数（BITBLT、STRETCHBLT 一类按源设备算的）。源框超出位图的部分不算，取到的部分拉满目标框
 */
export function bitmapSource(d: DataView, offBmi: number, fromBottom: boolean, sx: number, sy: number, sw: number, sh: number): BitmapSource | undefined {
  if (offBmi + 12 > d.byteLength || sw <= 0 || sh <= 0) return undefined;
  const core = d.getUint32(offBmi, true) === 12;
  const bw = core ? d.getUint16(offBmi + 4, true) : d.getInt32(offBmi + 4, true);
  const bh = Math.abs(core ? d.getInt16(offBmi + 6, true) : d.getInt32(offBmi + 8, true));
  const top = fromBottom ? bh - (sy + sh) : sy;
  const x0 = Math.max(0, sx), y0 = Math.max(0, top), x1 = Math.min(bw, sx + sw), y1 = Math.min(bh, top + sh);
  if (x1 <= x0 || y1 <= y0) return undefined;
  const same = (a: number, b: number) => Math.abs(a - b) < 1e-3;
  if (same(x0, 0) && same(y0, 0) && same(x1, bw) && same(y1, bh)) return undefined;
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0, bw, bh };
}

const f2 = (v: number) => (Math.round(v * 100) / 100).toString();

/** 只画源框里的部分：外面套一层 <svg>（目标框），viewBox 是源框，inner 按位图原尺寸放（0 0 bw bh） */
export function partSvg(x: number, y: number, w: number, h: number, s: BitmapSource, inner: string): string {
  return `<svg x="${f2(x)}" y="${f2(y)}" width="${f2(w)}" height="${f2(h)}" viewBox="${s.x} ${s.y} ${s.w} ${s.h}" preserveAspectRatio="none">${inner}</svg>`;
}
