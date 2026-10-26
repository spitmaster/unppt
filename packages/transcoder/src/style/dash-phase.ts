/**
 * 虚线从哪里开始排（实测，见 SPEC 第 7 节）：闭合的路径从闭合线段（最后一个点连回起点的那段直线）的起点开始排短划，
 * 先走闭合线段、再从原来的起点依次绕一圈——矩形从左下角往上，三角形从右下角往左，圆角矩形从左边的下端往上；
 * 不闭合的路径（直线、弧线）从起点开始。SVG 从路径起点排，所以把闭合子路径的起点挪到最后一个点（前面补一段连回原起点的直线），
 * 形状和填充都不变。闭合线段长度是 0 的（椭圆：最后一段弧正好回到起点）不动——PowerPoint 先把曲线拆成折线，实际从最后
 * 一小段折线开始（4 倍图上早 2 磅、1 倍图上早 4 磅），没管。
 */

/** 改写后的路径；closed：所有子路径都闭合（线端的相位按闭合路径算，见 line.ts strokeAttrs） */
export function dashFromClose(d: string): { d: string; closed: boolean } {
  const cmds = [...d.matchAll(/([MLCQAZ])([^MLCQAZ]*)/gi)].map((m) => ({ c: m[1], args: m[2].trim() }));
  if (!cmds.length || cmds.some((k) => k.c !== k.c.toUpperCase())) return { d, closed: false };
  const out: string[] = [];
  let closed = true;
  for (let i = 0; i < cmds.length;) {
    // 一个子路径：M 开头，到下一个 M 之前
    let j = i + 1;
    while (j < cmds.length && cmds[j].c !== 'M') j++;
    const sub = cmds.slice(i, j);
    i = j;
    const text = sub.map((k) => k.c + k.args).join('');
    if (sub[0].c !== 'M' || sub[sub.length - 1].c !== 'Z' || sub.length < 3) {
      closed &&= sub[sub.length - 1].c === 'Z';
      out.push(text);
      continue;
    }
    const start = nums(sub[0].args);
    const last = nums(sub[sub.length - 2].args).slice(-2);
    if (start.length < 2 || last.length < 2 || Math.hypot(last[0] - start[0], last[1] - start[1]) < 1e-6) {
      out.push(text);
      continue;
    }
    const lastText = sub[sub.length - 2].args.split(/[\s,]+/).slice(-2).join(' ');
    out.push(`M${lastText}L${sub[0].args}${sub.slice(1).map((k) => k.c + k.args).join('')}`);
  }
  return { d: out.join(''), closed };
}

const nums = (s: string) => s.split(/[\s,]+/).filter(Boolean).map(Number);
