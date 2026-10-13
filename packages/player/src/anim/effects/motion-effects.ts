/** 靠变换的进入效果：展开旋转、翻转、弹跳 */
import { reversible, slideBox, type AnimEffect } from './anim-effect';

/** 展开旋转：从无长到原大小，同时转回 0 度 */
export const growTurn: AnimEffect = {
  name: 'growTurn',
  keyframes: (a) => ({
    frames: reversible(a, [{ transform: 'scale(0) rotate(90deg)', opacity: 0 }, { transform: 'scale(1) rotate(0deg)', opacity: 1 }]),
    easing: 'ease-out',
  }),
};

/** 翻转：绕竖轴转进来（横向缩放从 0 到 1，中间翻过一次面） */
export const swivel: AnimEffect = {
  name: 'swivel',
  keyframes: (a) => ({
    frames: reversible(a, [
      { transform: 'scaleX(0)', opacity: 0 },
      { transform: 'scaleX(-1)', opacity: 1, offset: 0.35 },
      { transform: 'scaleX(0)', offset: 0.6 },
      { transform: 'scaleX(1)', opacity: 1 },
    ]),
    easing: 'linear',
  }),
};

/** 弹跳：从幻灯片上方落下，落地后弹两下 */
export const bounce: AnimEffect = {
  name: 'bounce',
  keyframes(a, el, _w, slideH) {
    const bb = slideBox(el);
    const top = -(bb.y + bb.height);
    const hop = Math.min(slideH * 0.15, bb.y + bb.height);
    const at = (y: number, offset: number) => { const [dx, dy] = bb.local(0, y); return { transform: `translate(${dx}px,${dy}px)`, offset }; };
    return {
      frames: reversible(a, [at(top, 0), at(0, 0.5), at(-hop, 0.68), at(0, 0.82), at(-hop * 0.3, 0.92), at(0, 1)]),
      easing: 'linear',
    };
  },
};
