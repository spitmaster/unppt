/**
 * JPEG 的 EXIF 方向标记（相机竖拍时写的"显示时要旋转多少"）：PowerPoint 不按它转图，而是按原始像素画，
 * 插入图片时把旋转写到形状上（实测 pictures-exif：方向 6/3/8 的图片形状分别带 rot 90°/180°/270°）。
 * 浏览器默认会按标记再转一次，所以输出前把方向改成 1（不旋转）。只改这 2 个字节，其它内容不动。
 */

/** 有需要改的方向标记时返回改过的副本，否则返回 undefined */
export function clearOrientation(b: Uint8Array): Uint8Array | undefined {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return undefined;
  let p = 2;
  while (p + 4 <= b.length && b[p] === 0xff) {
    const marker = b[p + 1];
    if (marker === 0xda || marker === 0xd9) break;          // 图像数据开始 / 结束：后面不会再有 EXIF
    const len = (b[p + 2] << 8) | b[p + 3];
    if (marker === 0xe1 && len >= 16 && b[p + 4] === 0x45 && b[p + 5] === 0x78 && b[p + 6] === 0x69 && b[p + 7] === 0x66) {
      const at = orientationOffset(b, p + 10, p + 2 + len);
      if (at === undefined) return undefined;
      const le = b[p + 10] === 0x49;
      const v = le ? b[at] | (b[at + 1] << 8) : (b[at] << 8) | b[at + 1];
      if (v === 1) return undefined;
      const out = b.slice();
      out[at] = le ? 1 : 0;
      out[at + 1] = le ? 0 : 1;
      return out;
    }
    p += 2 + len;
  }
  return undefined;
}

/** TIFF 头从 t 开始（到 end 为止）：第 0 个 IFD 里方向标记（0x0112，SHORT）值所在的位置 */
function orientationOffset(b: Uint8Array, t: number, end: number): number | undefined {
  const le = b[t] === 0x49 && b[t + 1] === 0x49;
  if (!le && !(b[t] === 0x4d && b[t + 1] === 0x4d)) return undefined;
  const u16 = (o: number) => (le ? b[o] | (b[o + 1] << 8) : (b[o] << 8) | b[o + 1]);
  const u32 = (o: number) => (le ? (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16)) + b[o + 3] * 0x1000000 : b[o] * 0x1000000 + ((b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]));
  const ifd = t + u32(t + 4);
  if (ifd + 2 > end) return undefined;
  const n = u16(ifd);
  for (let i = 0; i < n; i++) {
    const e = ifd + 2 + i * 12;
    if (e + 12 > end) return undefined;
    if (u16(e) === 0x0112 && u16(e + 2) === 3) return e + 8;
  }
  return undefined;
}
