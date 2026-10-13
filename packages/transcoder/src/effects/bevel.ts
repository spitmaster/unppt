/**
 * 三维棱台（a:sp3d/a:bevelT）的边缘：用 SVG 光照滤镜把形状边缘做成斜面，替换形状本身（source 层）。
 * 做法：形状的 alpha 模糊后按截面曲线换成"高度"，用两盏漫射光算明暗系数乘到颜色上，再叠加两盏镜面光的白色高光；
 * 正面（平的地方）颜色不变（正面的提亮在 style/lighting.ts）。
 * 光照参数是对着 PowerPoint 默认"三点"灯光、圆形棱台（6 磅 × 6 磅）的导出图拟合的（shapes-3d 用例 10 种颜色，
 * 四条边截面平均误差约 5~10 个色阶）；Chromium、Firefox 在 0.5~2 倍缩放下效果一致。其它灯光、截面形状按同一套近似。
 */
import { attr, child, numAttr, type XEl } from '../io/xml';
import { n2 } from '../common/svg';
import { EMU_PER_PX } from '../model/model';
import type { FilterLayer } from './shape-effect';
import { THREE_POINT } from '../model/light-rig';

/** 拟合出的参数（宽、高都是 8 像素时）；灯光本身在 model/light-rig.ts（三维旋转的正面明暗也用它） */
const FIT = {
  /** 模糊半径 / 棱台宽度 */
  sigma: 0.6689,
  /** 斜面高度（surfaceScale）/ 棱台高度（像素） */
  height: 7.835 / 8,
  ...THREE_POINT,
} as const;

/** 反误差函数（近似，误差 < 2e-3，够做查表） */
function erfinv(y: number): number {
  const a = 0.147, ln = Math.log(1 - y * y), t = 2 / (Math.PI * a) + ln / 2;
  return Math.sign(y) * Math.sqrt(Math.sqrt(t * t - ln / a) - t);
}

/** 截面：t 是从斜面外沿往里走过的比例（0~1），返回高度比例 */
const PROFILES: Record<string, (t: number) => number> = {
  circle: (t) => Math.sqrt(Math.max(0, 1 - (1 - t) * (1 - t))),
  angle: (t) => t, slope: (t) => t, coolSlant: (t) => t, hardEdge: (t) => t,
};

/** 模糊后的 alpha（A = Φ(d/σ)）-> 高度的查表 */
function heightTable(profile: (t: number) => number): string {
  const out: string[] = [];
  for (let k = 0; k <= 40; k++) {
    const A = Math.min(k / 40, 0.999999);
    const t = A <= 0.5 ? 0 : Math.min(1, FIT.sigma * Math.SQRT2 * erfinv(2 * A - 1));
    out.push(n2(A <= 0.5 ? 0 : profile(t)));
  }
  return out.join(' ');
}

const linear = (slope: number, icpt: number) => ['R', 'G', 'B'].map((c) => `<feFunc${c} type="linear" slope="${+slope.toFixed(5)}" intercept="${+icpt.toFixed(5)}"/>`).join('');

/** 有顶部棱台时返回替换形状的滤镜层 */
export function bevelLayer(sp3d: XEl | undefined): FilterLayer | undefined {
  const bevel = child(sp3d, 'a:bevelT');
  if (!bevel) return undefined;
  const w = (numAttr(bevel, 'w') ?? 76200) / EMU_PER_PX, h = (numAttr(bevel, 'h') ?? 76200) / EMU_PER_PX;
  if (w <= 0 || h <= 0) return undefined;
  const profile = PROFILES[attr(bevel, 'prst') ?? 'circle'] ?? PROFILES.circle;
  const ss = n2(FIT.height * h);
  const light = (az: number, el: number) => `<feDistantLight azimuth="${az}" elevation="${el}"/>`;
  const flatD = FIT.diffuse.reduce((s, [, el, kd]) => s + kd * Math.sin(el * Math.PI / 180), 0);
  const flatS = FIT.specular.reduce((s, [, el, ks, n]) => s + ks * Math.pow(Math.cos((90 - el) / 2 * Math.PI / 180), n), 0);
  const sl = 0.5 / (FIT.ambient + flatD);
  const p = [
    `<feGaussianBlur in="SourceAlpha" stdDeviation="${n2(FIT.sigma * w)}" result="bvB"/>`,
    `<feComponentTransfer in="bvB" result="bvH"><feFuncA type="table" tableValues="${heightTable(profile)}"/></feComponentTransfer>`,
    // 漫射：明暗系数 F =（环境 + 漫射）/ 正面的值，先除以 2 存（通道不能超过 1），乘到颜色上以后再乘 2
    ...FIT.diffuse.map(([az, el, kd], i) => `<feDiffuseLighting in="bvH" surfaceScale="${ss}" diffuseConstant="${kd}" lighting-color="#fff" result="bvD${i}">${light(az, el)}</feDiffuseLighting>`),
    `<feComposite in="bvD0" in2="bvD1" operator="arithmetic" k2="1" k3="1" result="bvD"/>`,
    `<feComponentTransfer in="bvD" result="bvF">${linear(sl, FIT.ambient * sl)}<feFuncA type="linear" slope="0" intercept="1"/></feComponentTransfer>`,
    `<feBlend in="SourceGraphic" in2="bvF" mode="multiply" result="bvM"/>`,
    `<feComponentTransfer in="bvM" result="bvL">${linear(2, 0)}</feComponentTransfer>`,
    // 镜面：结果的强度在 alpha 里（颜色恒为白），搬到 RGB 再减去正面的值
    ...FIT.specular.map(([az, el, ks, n], i) => `<feSpecularLighting in="bvH" surfaceScale="${ss}" specularConstant="${ks}" specularExponent="${n}" lighting-color="#fff" result="bvS${i}">${light(az, el)}</feSpecularLighting>`),
    `<feComposite in="bvS0" in2="bvS1" operator="arithmetic" k2="1" k3="1" result="bvS"/>`,
    `<feColorMatrix in="bvS" type="matrix" values="${Array(3).fill(`0 0 0 1 ${+(-flatS).toFixed(5)}`).join(' ')} 0 0 0 0 1" result="bvS2"/>`,
    `<feComposite in="bvL" in2="bvS2" operator="arithmetic" k2="1" k3="1" result="bvA"/>`,
    `<feComposite in="bvA" in2="SourceAlpha" operator="in" result="bevel"/>`,
  ];
  // 拟合是在 sRGB 下做的；形状效果滤镜整体是默认的 linearRGB，所以每个原语单独标上
  const primitives = p.join('').replace(/<fe(GaussianBlur|ComponentTransfer|DiffuseLighting|SpecularLighting|Composite|Blend|ColorMatrix) /g, '<fe$1 color-interpolation-filters="sRGB" ');
  return { primitives, result: 'bevel', place: 'source', extent: 0 };
}
