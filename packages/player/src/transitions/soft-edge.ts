/**
 * 软边切换（擦除、分割、条纹、圆形、菱形、加号、轮子、扇形）的公共模型（实测 PowerPoint）：
 * 一条宽 w 的平滑过渡带（smoothstep）从画面外匀速移到画面另一侧外。
 * d 是到起点的归一化距离（0~1 覆盖整个画面），t 时刻 alpha(d) = smoothstep(((1 + w)u - d) / w)。
 * 用 CSS 遮罩渐变画：每帧算出过渡带的几个节点，写成渐变的色标。
 */
import { driven } from './drive';

export const smooth = (x: number) => {
  const v = Math.max(0, Math.min(1, x));
  return v * v * (3 - 2 * v);
};

/** 余弦缓动 0.5 - 0.5cos(πv)，v 限制在 0~1 */
export const cosine = (v: number) => 0.5 - 0.5 * Math.cos(Math.PI * Math.max(0, Math.min(1, v)));

/** 距离 d 处此刻的 alpha */
export const alphaAt = (u: number, w: number, d: number) => smooth(((1 + w) * u - d) / w);

/** 过渡带上的节点 [d, alpha]，d 从 0 起递增（画面外 d < 0 的部分截掉） */
export function knots(u: number, w: number): [number, number][] {
  const lead = (1 + w) * u;
  const out: [number, number][] = [[0, smooth(lead / w)]];
  for (let k = 0; k <= 4; k++) {
    const d = lead - w + (w * k) / 4;
    if (d > 0) out.push([d, smooth((lead - d) / w)]);
  }
  return out;
}

const r = (v: number) => Math.round(v * 1000) / 1000;
/** 遮罩色标：alpha 和位置（单位由调用方给，如 % 或 deg） */
export const stop = (alpha: number, pos: number, unit: string) => `rgba(0,0,0,${r(alpha)}) ${r(pos)}${unit}`;

/** 一侧过渡：位置 = d * 100% */
export function oneSide(u: number, w: number, invert = false): string {
  return knots(u, w).map(([d, a]) => stop(invert ? 1 - a : a, d * 100, '%')).join(',');
}

/** 从中线向两侧（out）或从两边向中线（in）对称展开，沿渐变方向 0~100% */
export function twoSides(u: number, w: number, way: 'in' | 'out'): string {
  let ks = knots(u, w);
  // 向内时两侧在中线（d = 1）相遇：过渡带越过中线的部分截掉，否则色标位置交叉
  if (way === 'in') ks = [...ks.filter(([d]) => d < 1), [1, alphaAt(u, w, 1)]];
  const half = way === 'out'
    ? [...ks].reverse().map(([d, a]) => stop(a, 50 - d * 50, '%')).concat(ks.map(([d, a]) => stop(a, 50 + d * 50, '%')))
    : ks.map(([d, a]) => stop(a, d * 50, '%')).concat([...ks].reverse().map(([d, a]) => stop(a, 100 - d * 50, '%')));
  return half.join(',');
}

let supported: boolean | undefined;
function maskSupported(): boolean {
  if (supported === undefined) {
    const css = typeof CSS !== 'undefined' && typeof CSS.supports === 'function' ? CSS : undefined;
    supported = !!css && (css.supports('mask-image', 'linear-gradient(#000,#000)') || css.supports('-webkit-mask-image', 'linear-gradient(#000,#000)'));
  }
  return supported;
}

function setMask(el: HTMLElement, image: string) {
  el.style.setProperty('-webkit-mask-image', image);
  el.style.setProperty('mask-image', image);
}

/**
 * 逐帧给 target 设遮罩（image(u) 返回 mask-image 的值，几层用逗号隔开，层之间取并集）。
 * 浏览器不支持遮罩时退回淡入。
 */
export function maskTransition(target: HTMLElement, el: HTMLElement, dur: number, image: (u: number) => string): Animation {
  if (!maskSupported()) return el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: dur });
  return driven(target, dur, (u) => setMask(target, image(u)), () => setMask(target, ''));
}
