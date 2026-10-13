/** PowerPoint 默认"三点"灯光（三维形状的正面、棱台斜面、三维旋转后的正面明暗都用它） */

/**
 * 默认"三点"灯光（SVG 光照滤镜的写法，颜色空间 sRGB）：环境光、两盏漫射光（方位角、仰角、强度）、
 * 两盏镜面光（方位角、仰角、强度、指数）。对着圆形棱台的导出图拟合（effects/bevel.ts）
 */
export const THREE_POINT = {
  ambient: 0.0971,
  diffuse: [[260.33, 55.72, 0.4036], [109.24, 1.2, 0.2262]],
  specular: [[246.72, 12.15, 0.4750, 19.99], [48.67, 1, 0.5543, 16.30]],
} as const;

/** 法线 n（屏幕坐标，y 向下、z 朝向观众）的面在三点灯光下：颜色乘 k、再加 add 的白色（平放的正面 k = 1、add = 0） */
export function faceLight(n: readonly [number, number, number]): { k: number; add: number } {
  const dir = (az: number, el: number) => {
    const a = (az * Math.PI) / 180, e = (el * Math.PI) / 180;
    return [Math.cos(e) * Math.cos(a), Math.cos(e) * Math.sin(a), Math.sin(e)];
  };
  const dot = (u: readonly number[], v: readonly number[]) => u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
  const diffuse = (m: readonly number[]) => THREE_POINT.diffuse.reduce((s, [az, el, kd]) => s + kd * Math.max(0, dot(m, dir(az, el))), 0);
  const specular = (m: readonly number[]) => THREE_POINT.specular.reduce((s, [az, el, ks, ex]) => {
    const l = dir(az, el), h = [l[0], l[1], l[2] + 1], len = Math.hypot(h[0], h[1], h[2]);
    return s + ks * Math.pow(Math.max(0, dot(m, h) / len), ex);
  }, 0);
  const flat = [0, 0, 1];
  return {
    k: (THREE_POINT.ambient + diffuse(n)) / (THREE_POINT.ambient + diffuse(flat)),
    add: Math.max(0, specular(n) - specular(flat)),
  };
}
