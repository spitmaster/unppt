/** 文本框属性（a:bodyPr）：内边距、换行、垂直对齐、竖排方式、自动缩小、分栏 */
import { EMU_PER_PX } from '../model/model';
import { attr, child, numAttr, type XEl } from '../io/xml';
import { merge } from './style';

export type BodyProps = ReturnType<typeof readBody>;

/** bodyPrs 从一般到具体（母版 -> 版式 -> 形状），最后是文字自己的 a:bodyPr */
export function readBody(bodyPrs: (XEl | undefined)[], own: XEl | undefined) {
  const bp = merge([...bodyPrs, own]);
  const ins = (k: string, d: number) => (numAttr(bp, k) ?? d) / EMU_PER_PX;
  const lIns = ins('lIns', 91440), rIns = ins('rIns', 91440), tIns = ins('tIns', 45720), bIns = ins('bIns', 45720);
  const wrap = attr(bp, 'wrap') !== 'none';
  const anchor = attr(bp, 'anchor') ?? 't';
  const vert = attr(bp, 'vert') ?? 'horz';
  const norm = child(bp, 'a:normAutofit');
  const fontScale = (numAttr(norm, 'fontScale') ?? 100000) / 100000;
  const lnReduce = (numAttr(norm, 'lnSpcReduction') ?? 0) / 100000;
  const vertical = vert !== 'horz';
  // 竖排时汉字保持正立（eaVert、mongolianVert、wordArtVert）；vert / vert270 是整体旋转
  const uprightWide = vert === 'eaVert' || vert === 'mongolianVert' || vert === 'wordArtVert' || vert === 'wordArtVertRtl';
  const uprightAll = vert === 'wordArtVert' || vert === 'wordArtVertRtl';
  // 列（行）的排列方向：mongolianVert、vert270 从左往右，其余竖排从右往左
  const linesLeftToRight = vert === 'mongolianVert';
  const numCol = vertical ? 1 : Math.max(1, numAttr(bp, 'numCol') ?? 1);
  const spcCol = (numAttr(bp, 'spcCol') ?? 0) / EMU_PER_PX;
  return { lIns, rIns, tIns, bIns, wrap, anchor, vert, fontScale, lnReduce, vertical, uprightWide, uprightAll, linesLeftToRight, numCol, spcCol };
}
