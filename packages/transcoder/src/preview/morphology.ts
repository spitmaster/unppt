/**
 * 出图时把 feMorphology（发光的外扩，effects/glow.ts）拆成先横后竖两遍（只用于整页图，不改播放器产物，用户 2026-10-16 同意）：
 * resvg 按整个窗口逐像素求最大 / 最小值，每像素 (2r)² 次，发光半径大时一页要一两秒；矩形窗口的最大 / 最小值可以先按行、
 * 再按列求，每像素只要 2·2r 次。
 * 顺带让整页图和浏览器（播放器）一致。实测（缩放 0.75，16 种半径、膨胀和腐蚀）：
 *   - Chrome：半径乘缩放后四舍五入成 R 像素，窗口 [-R, R]（宽 2R+1）；某个方向半径是 0 时这个方向不动；
 *   - resvg：向上取整，窗口宽 2R、不对称；半径 0 当成 1 像素（窗口宽 2）；feOffset 的平移向零截断成整像素。
 * 所以按 Chrome 的规则算出 R，每遍给 (R-0.5)/缩放（resvg 向上取整后正好是 R），另一个方向的 0 被当成 1 像素，两遍合起来
 * 窗口是 [-R-1, R-1]，再整体平移 -1 像素（给 -1.5 像素，截断后是 -1）就是 [-R, R]——外框和 Chrome 逐像素一致。
 * 只改有把握的：带子区域（x/y/width/height）、primitiveUnits="objectBoundingBox"、半径不是两个正数、某一个方向四舍五入后
 * 是 0 的都不动；两个方向都是 0 时换成原样输出（Chrome 也不动）。缩放按根元素（整页图宽 / viewBox 宽）算：发光所在的元素
 * 到根之间有缩放（组合缩放、三维旋转的投影矩阵）时外框会差 1~3 像素；嵌在 SVG 图片里的 feMorphology 不经过这里（prepare.ts 先拆再展开）。
 */
import { n2 } from '../common/svg';

export function splitMorphology(svg: string): string {
  if (!svg.includes('<feMorphology')) return svg;
  const root = /^<svg\b[^>]*>/.exec(svg)?.[0] ?? '';
  const vbw = Number(/\sviewBox="[^"\d-]*-?[\d.]+[\s,]+-?[\d.]+[\s,]+([\d.]+)/.exec(root)?.[1]);
  const w = Number(/\swidth="([\d.]+)"/.exec(root)?.[1]);
  const s = vbw > 0 && w > 0 ? w / vbw : 1;
  let n = 0;
  return svg.replace(/<filter\b[^>]*>[\s\S]*?<\/filter>/g, (filter) => {
    if (/^<filter\b[^>]*\sprimitiveUnits="objectBoundingBox"/.test(filter)) return filter;
    return filter.replace(/<feMorphology\b([^>]*?)\s*\/>/g, (tag, attrs: string) => {
      if (/\s(?:x|y|width|height)="/.test(attrs)) return tag;
      const r = (/\sradius="([^"]*)"/.exec(attrs)?.[1] ?? '').trim().split(/[\s,]+/).map(Number);
      if (r.length < 1 || r.length > 2) return tag;
      const rx = r[0], ry = r[1] ?? r[0];
      if (!(rx > 0 && ry > 0)) return tag;
      const Rx = Math.round(rx * s), Ry = Math.round(ry * s);
      const input = /\sin="[^"]*"/.exec(attrs)?.[0] ?? '';
      const result = /\sresult="[^"]*"/.exec(attrs)?.[0] ?? '';
      if (!Rx && !Ry) return `<feOffset${input}${result}/>`;
      if (!Rx || !Ry) return tag;
      const rest = attrs.replace(/\s(?:radius|in|result)="[^"]*"/g, '');
      const a = `unppt-m${n}a`, b = `unppt-m${n}b`;
      n++;
      const off = n2(-1.5 / s);
      return `<feMorphology${input}${rest} radius="${n2((Rx - 0.5) / s)} 0" result="${a}"/>`
        + `<feMorphology in="${a}"${rest} radius="0 ${n2((Ry - 0.5) / s)}" result="${b}"/>`
        + `<feOffset in="${b}" dx="${off}" dy="${off}"${result}/>`;
    });
  });
}
