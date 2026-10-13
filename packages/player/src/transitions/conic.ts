/**
 * 轮子、扇形用的锥形渐变：PowerPoint 的角度是在"画面压成正方形"的坐标里匀速转的，
 * 宽屏上转过水平方向时慢、转过竖直方向时快。CSS 锥形渐变按真实角度，所以每个色标换算一下。
 */

/** 归一化坐标里的角度（从 12 点顺时针，度）-> 页面上的真实角度 */
export function pageAngle(deg: number, aspect: number): number {
  const a = (deg * Math.PI) / 180;
  const p = (Math.atan2(Math.sin(a) * aspect, Math.cos(a)) * 180) / Math.PI;
  // atan2 的结果在 (-180, 180]：转成和输入同一圈的角度
  const turn = Math.floor(deg / 360) * 360;
  let v = ((p % 360) + 360) % 360 + turn;
  if (v < deg - 180) v += 360;
  if (v > deg + 180) v -= 360;
  return v;
}

/** [归一化角度, alpha] 列表 -> conic-gradient */
export function conic(points: [number, number][], aspect: number): string {
  const r = (v: number) => Math.round(v * 1000) / 1000;
  return `conic-gradient(from 0deg at 50% 50%,${points.map(([deg, a]) => `rgba(0,0,0,${r(a)}) ${r(pageAngle(deg, aspect))}deg`).join(',')})`;
}

export const aspectOf = (el: HTMLElement) => (el.clientWidth && el.clientHeight ? el.clientWidth / el.clientHeight : 16 / 9);
