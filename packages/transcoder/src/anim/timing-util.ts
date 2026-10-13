/** 时间节点（p:cTn）的公共读取：开始延迟、是否等点击、时间设置；以及时间变换的计算 */
import type { AnimBehavior } from '../../../format/src/index';
import { attr, child, children, numAttr, type XEl } from '../io/xml';

export function delayOf(cTn: XEl | undefined): number {
  const d = attr(child(child(cTn, 'p:stCondLst'), 'p:cond'), 'delay');
  if (!d || d === 'indefinite') return 0;
  const n = Number(d);
  return Number.isFinite(n) ? n : 0;
}

/**
 * 这一组是否要等点击。注意：页面一开始就自动播放的组，PowerPoint 会同时写
 * delay="indefinite" 和 evt="onBegin" 两个条件，后者表示随序列开始自动触发。
 */
export function isClick(cTn: XEl | undefined): boolean {
  const conds = children(child(cTn, 'p:stCondLst'), 'p:cond');
  if (conds.some((c) => attr(c, 'evt') === 'onBegin')) return false;
  return conds.some((c) => attr(c, 'delay') === 'indefinite');
}

export type Timing = Pick<AnimBehavior, 'delay' | 'dur' | 'accel' | 'decel' | 'tmFilter' | 'autoRev' | 'repeat'>;

/** 时间节点上的设置：开始、时长、加减速、时间折线、往返、重复；时长不合法时返回 undefined */
export function timingOf(cTn: XEl | undefined): Timing | undefined {
  const d = attr(cTn, 'dur');
  const dur = d === undefined ? 1 : Number(d);
  if (!(dur >= 0) || !isFinite(dur)) return undefined;
  const out: Timing = { delay: delayOf(cTn), dur: Math.max(1, dur) };
  const accel = (numAttr(cTn, 'accel') ?? 0) / 100000, decel = (numAttr(cTn, 'decel') ?? 0) / 100000;
  if (accel > 0) out.accel = Math.min(1, accel);
  if (decel > 0) out.decel = Math.min(1 - (out.accel ?? 0), decel);
  const tf = attr(cTn, 'tmFilter');
  if (tf) {
    const pts = tf.split(';').map((p) => p.split(',').map((v) => Number(v.trim()))).filter((p) => p.length === 2 && p.every(isFinite));
    if (pts.length >= 2) out.tmFilter = pts.map(([a, b]) => [a, b] as [number, number]);
  }
  const ar = attr(cTn, 'autoRev');
  if (ar === '1' || ar === 'true') out.autoRev = true;
  const rc = attr(cTn, 'repeatCount');
  if (rc && rc !== 'indefinite' && Number(rc) > 1000) out.repeat = Math.min(1000, Number(rc) / 1000);
  return out;
}

/** SMIL 的加速/减速：前 accel 匀加速、后 decel 匀减速，中间匀速，总进度不变 */
export function easeAccel(s: number, accel = 0, decel = 0): number {
  if (!accel && !decel) return s;
  const r = 1 / (1 - accel / 2 - decel / 2);
  if (s < accel) return (r * s * s) / (2 * accel);
  if (s > 1 - decel) return 1 - (r * (1 - s) * (1 - s)) / (2 * decel);
  return r * (s - accel / 2);
}

/** tmFilter：[时间, 进度] 折线 */
export function filterTime(s: number, pts: [number, number][] | undefined): number {
  if (!pts || pts.length < 2) return s;
  if (s <= pts[0][0]) return pts[0][1];
  for (let i = 1; i < pts.length; i++) {
    const [t1, v1] = pts[i];
    if (s <= t1) {
      const [t0, v0] = pts[i - 1];
      return t1 > t0 ? v0 + ((v1 - v0) * (s - t0)) / (t1 - t0) : v1;
    }
  }
  return pts[pts.length - 1][1];
}

/** 行为在效果时间 t 时的进度（0~1，含往返、重复、加减速、时间折线）；还没开始返回 undefined */
export function progressAt(b: Timing, t: number): number | undefined {
  const local = t - b.delay;
  if (local < 0) return undefined;
  const cycle = b.dur * (b.autoRev ? 2 : 1);
  const total = cycle * Math.max(1, b.repeat ?? 1);
  let q: number;
  if (local >= total) q = b.autoRev ? 0 : 1;
  else {
    const c = local % cycle;
    q = c < b.dur ? c / b.dur : 1 - (c - b.dur) / b.dur;
  }
  return filterTime(easeAccel(q, b.accel, b.decel), b.tmFilter);
}

/** 有没有让进度不是匀速直线的设置 */
export const nonLinear = (b: Timing) => !!(b.accel || b.decel || b.tmFilter);
