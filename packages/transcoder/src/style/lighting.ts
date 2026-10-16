/**
 * 三维形状（a:sp3d：棱台、拉伸等）正面的光照：按灯光方案和材质查实测表（model/face-light-data.ts），
 * 每个通道"系数 × 原值 + 偏移"。没写时是"三点"灯光、暖色哑光——正面比原色亮一点（以前 10 种颜色单独测过：1.036 × 原值 + 5，
 * 和表里的 1.044 × 原值 + 3.6 一致）。棱台边缘的高光、阴影见 effects/bevel.ts（只对三点灯光拟合过）。
 */
import { child, type XEl } from '../io/xml';
import type { Rgba } from '../model/color';
import type { SvgDoc } from '../common/svg';
import { FACE_LIGHT, MATERIALS } from '../model/face-light-data';
import type { Fill } from './fill';

/** a:sp3d 里真的开了三维（有棱台、拉伸、轮廓或材质）才算 */
export function has3d(sp3d: XEl | undefined): boolean {
  if (!sp3d) return false;
  return !!(child(sp3d, 'a:bevelT') || child(sp3d, 'a:bevelB') || Number(sp3d.attrs.extrusionH ?? 0) > 0 || Number(sp3d.attrs.contourW ?? 0) > 0 || sp3d.attrs.prstMaterial);
}

export type LightFn = (c: Rgba) => Rgba;

const cache = new Map<string, LightFn>();

/** 实测表里的 6 个数：R、G、B 各自的系数和偏移；不认识的灯光、材质按三点灯光、暖色哑光 */
function coeffs(rig: string | undefined, material: string | undefined): number[] {
  const row = (FACE_LIGHT[rig ?? ''] ?? FACE_LIGHT.threePt).split('|');
  const mi = MATERIALS.indexOf(material ?? '');
  return row[mi >= 0 ? mi : MATERIALS.indexOf('warmMatte')].split(' ').map(Number);
}

/** 某种灯光方案（a:lightRig 的 rig）、材质（a:sp3d 的 prstMaterial）下正面的颜色 */
export function faceLighting(rig: string | undefined, material: string | undefined): LightFn {
  const key = `${rig}/${material}`;
  let f = cache.get(key);
  if (!f) {
    const k = coeffs(rig, material);
    const ch = (v: number, a: number, b: number) => Math.min(255, Math.max(0, Math.round(a * v + b)));
    f = (c) => ({ r: ch(c.r, k[0], k[1]), g: ch(c.g, k[2], k[3]), b: ch(c.b, k[4], k[5]), a: c.a });
    cache.set(key, f);
  }
  return f;
}

/** 默认（三点灯光、暖色哑光）下的正面颜色 */
export const litColor: LightFn = faceLighting('threePt', 'warmMatte');

/** 正面在三维光照下的填充 */
export function litFill(fill: Fill | undefined, light: LightFn = litColor): Fill | undefined {
  if (!fill) return fill;
  switch (fill.kind) {
    case 'solid': return { ...fill, color: light(fill.color) };
    case 'grad': return { ...fill, stops: fill.stops.map((s) => ({ ...s, color: light(s.color) })) };
    case 'pattern': return { ...fill, fg: light(fill.fg), bg: light(fill.bg) };
    default: return fill;
  }
}

/** 同样的正面光照写成调色的一步（图片用：图片的每个像素和填充色一样被提亮，实测），交给 lightFilter */
export function faceLightTransfer(rig: string | undefined, material: string | undefined): string {
  const k = coeffs(rig, material);
  const fn = ['R', 'G', 'B'].map((ch, i) => `<feFunc${ch} type="linear" slope="${k[2 * i]}" intercept="${+(k[2 * i + 1] / 255).toFixed(4)}"/>`).join('');
  return `<feComponentTransfer>${fn}</feComponentTransfer>`;
}

/**
 * 几步调色（正面光照、转动后的明暗）合成一个滤镜依次做，返回编号；一步都没有时返回 undefined。
 * 实测：两个调色滤镜分两层套在带阴影的图片外面，Chrome 把里面的阴影画丢（只套一层就正常；resvg 都正常）。
 * 滤镜套在整个元素（连同它的阴影）外面，范围放到外框四周各一半：默认的外扩 10% 按图片本身的外框算，伸出去的阴影会被裁掉
 */
export function lightFilter(doc: SvgDoc, steps: (string | undefined)[]): string | undefined {
  const s = steps.filter((x): x is string => !!x);
  if (!s.length) return undefined;
  const id = doc.id('f');
  doc.addDef(`<filter id="${id}" color-interpolation-filters="sRGB" x="-50%" y="-50%" width="200%" height="200%">${s.join('')}</filter>`);
  return id;
}
