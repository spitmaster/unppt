/**
 * 清掉 glyf 简单字形点标志里的保留位 0x80。
 * 有的字体（实测 Office 云字体里的细明体）这一位是 1，Windows 不在意，但浏览器的字体检查（Chrome 的 OTS、Firefox）
 * 会因此拒绝整个字体，字退回成默认字体。HarfBuzz 子集化原样复制标志，所以在打包前清掉；字节长度不变，就地修改。
 */
import { be16, be32, bes16 } from './sfnt';

export function clearReservedGlyphFlags(tables: Map<string, Uint8Array>): void {
  const head = tables.get('head'), loca = tables.get('loca'), glyf = tables.get('glyf');
  if (!head || !loca || !glyf || head.length < 54) return;
  const long = be16(head, 50) === 1;
  const n = Math.floor(loca.length / (long ? 4 : 2)) - 1;
  const at = (i: number) => (long ? be32(loca, i * 4) : be16(loca, i * 2) * 2);
  for (let g = 0; g < n; g++) {
    const start = at(g), end = Math.min(at(g + 1), glyf.length);
    if (end - start < 10) continue;
    const contours = bes16(glyf, start);
    if (contours <= 0) continue;
    let p = start + 10;
    if (p + contours * 2 + 2 > end) continue;
    const points = be16(glyf, p + (contours - 1) * 2) + 1;
    p += contours * 2;
    p += 2 + be16(glyf, p);
    for (let k = 0; k < points && p < end;) {
      const f = glyf[p];
      glyf[p++] = f & 0x7f;
      let rep = 1;
      if (f & 0x08 && p < end) rep += glyf[p++];
      k += rep;
    }
  }
}
