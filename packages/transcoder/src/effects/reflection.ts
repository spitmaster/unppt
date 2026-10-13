/** 映像不是滤镜：要把整个形状（含文字）复制一份翻转到下方 */
import { n2, type SvgDoc } from '../common/svg';
import { numAttr, type XEl } from '../io/xml';
import { EMU_PER_PX } from '../model/model';

/** 映像：整个形状（含文字）沿底边翻转到下方，按渐变逐渐透明，可带模糊 */
export function reflection(r: XEl | undefined, h: number, doc: SvgDoc, content: string): string {
  if (!r || !content) return '';
  const num = (name: string, def: number) => numAttr(r, name) ?? def;
  const dist = num('dist', 0) / EMU_PER_PX;
  const blur = num('blurRad', 0) / EMU_PER_PX;
  const k = Math.abs(num('sy', -100000) / 100000) || 1;
  const y0 = h + dist, y1 = h + dist + h * k;
  const gid = doc.id('rg'), mid = doc.id('rm');
  doc.addDef(`<linearGradient id="${gid}" gradientUnits="userSpaceOnUse" x1="0" y1="${n2(y0)}" x2="0" y2="${n2(y1)}">`
    + `<stop offset="${n2(num('stPos', 0) / 100000)}" stop-color="#fff" stop-opacity="${n2(num('stA', 100000) / 100000)}"/>`
    + `<stop offset="${n2(num('endPos', 100000) / 100000)}" stop-color="#fff" stop-opacity="${n2(num('endA', 0) / 100000)}"/></linearGradient>`);
  doc.addDef(`<mask id="${mid}" maskUnits="userSpaceOnUse" x="-100000" y="-100000" width="200000" height="200000"><rect x="-100000" y="${n2(y0)}" width="200000" height="${n2(y1 - y0)}" fill="url(#${gid})"/></mask>`);
  let fid = '';
  if (blur > 0) {
    fid = doc.id('rb');
    doc.addDef(`<filter id="${fid}" x="-10%" y="-10%" width="120%" height="120%"><feGaussianBlur stdDeviation="${n2(blur / 2)}"/></filter>`);
  }
  return `<g mask="url(#${mid})" aria-hidden="true"><g transform="matrix(1 0 0 ${n2(-k)} 0 ${n2(y1)})"${fid ? ` filter="url(#${fid})"` : ''}>${content}</g></g>`;
}
