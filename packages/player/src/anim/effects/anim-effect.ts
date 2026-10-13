/**
 * 扩展点：进入 / 退出动画效果的关键帧。
 * 加一种效果：新建一个实现 AnimEffect 的文件，在 effects.ts 里加一行；没注册的效果按淡入淡出播放。
 * 退出动画用同一组关键帧倒着播（reversible() 帮忙处理）。
 */
import type { AnimAction } from '../../../../format/src/index';

export interface EffectKeyframes {
  frames: Keyframe[];
  easing: string;
}

export interface AnimEffect {
  /** 对应 AnimAction.effect */
  readonly name: string;
  keyframes(a: AnimAction, el: Element, slideW: number, slideH: number): EffectKeyframes;
}

export interface SlideBox {
  x: number;
  y: number;
  width: number;
  height: number;
  /** 把幻灯片坐标里的位移换算成元素 transform 用的位移（元素在组合、文本框里时两者不同） */
  local(dx: number, dy: number): [number, number];
}

/** 元素在幻灯片坐标里的外框（不含元素自己正在播的变换） */
export function slideBox(el: Element): SlideBox {
  const g = el as SVGGraphicsElement;
  let bb = { x: 0, y: 0, width: 0, height: 0 };
  try { bb = g.getBBox(); } catch { /* 未渲染时取不到 */ }
  let m: DOMMatrix | undefined;
  try {
    // 父元素坐标系 -> 幻灯片坐标系（两边都含舞台缩放，相除后抵消）
    const pm = (g.parentNode as SVGGraphicsElement | null)?.getScreenCTM?.();
    const rm = g.ownerSVGElement?.getScreenCTM();
    if (pm && rm) m = rm.inverse().multiply(pm);
  } catch { /* 取不到时按同一坐标系处理 */ }
  if (!m || m.isIdentity) return { ...bb, local: (dx, dy) => [dx, dy] };
  const t = m;
  const xs: number[] = [], ys: number[] = [];
  for (const [x, y] of [[bb.x, bb.y], [bb.x + bb.width, bb.y], [bb.x, bb.y + bb.height], [bb.x + bb.width, bb.y + bb.height]]) {
    xs.push(t.a * x + t.c * y + t.e);
    ys.push(t.b * x + t.d * y + t.f);
  }
  const inv = t.inverse();
  const x = Math.min(...xs), y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y, local: (dx, dy) => [inv.a * dx + inv.c * dy, inv.b * dx + inv.d * dy] };
}

/** 进入动画的关键帧；退出时倒过来 */
export const reversible = (a: AnimAction, frames: Keyframe[]) => (a.dir === 'out' ? frames.slice().reverse() : frames);
