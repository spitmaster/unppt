/**
 * 三维形状（a:sp3d：棱台、拉伸等）正面的光照：按灯光方案和材质查实测表（model/face-light-data.ts），
 * 每个通道"系数 × 原值 + 偏移"。没写时是"三点"灯光、暖色哑光——正面比原色亮一点（以前 10 种颜色单独测过：1.036 × 原值 + 5，
 * 和表里的 1.044 × 原值 + 3.6 一致）。棱台边缘的高光、阴影见 effects/bevel.ts（只对三点灯光拟合过）。
 */
import { child, type XEl } from '../io/xml';
import type { Rgba } from '../model/color';
import { FACE_LIGHT, MATERIALS } from '../model/face-light-data';
import type { Fill } from './fill';

/** a:sp3d 里真的开了三维（有棱台、拉伸、轮廓或材质）才算 */
export function has3d(sp3d: XEl | undefined): boolean {
  if (!sp3d) return false;
  return !!(child(sp3d, 'a:bevelT') || child(sp3d, 'a:bevelB') || Number(sp3d.attrs.extrusionH ?? 0) > 0 || Number(sp3d.attrs.contourW ?? 0) > 0 || sp3d.attrs.prstMaterial);
}

export type LightFn = (c: Rgba) => Rgba;

const cache = new Map<string, LightFn>();

/** 某种灯光方案（a:lightRig 的 rig）、材质（a:sp3d 的 prstMaterial）下正面的颜色；不认识的按三点灯光、暖色哑光 */
export function faceLighting(rig: string | undefined, material: string | undefined): LightFn {
  const key = `${rig}/${material}`;
  let f = cache.get(key);
  if (!f) {
    const row = (FACE_LIGHT[rig ?? ''] ?? FACE_LIGHT.threePt).split('|');
    const mi = MATERIALS.indexOf(material ?? '');
    const k = row[mi >= 0 ? mi : MATERIALS.indexOf('warmMatte')].split(' ').map(Number);
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
