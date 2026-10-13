/**
 * 按 PowerPoint 的动画行为播放进入/退出效果：用元素此刻在幻灯片里的位置大小代入公式，
 * 按时间变换（加减速、tmFilter、往返、重复）算出每个时刻的位置、大小、旋转、不透明度和显现进度，
 * 采样成 Web Animations 关键帧（关键帧之间线性插值）。
 *
 * 同一属性有多个行为时，已经开始的里面最晚开始的那个说了算（结束后保持终值）；不透明度相乘。
 */
import type { AnimAction, AnimBehavior } from '../../../format/src/index';
import { slideBox, type EffectKeyframes } from './effects/anim-effect';
import { evalFormula } from './formula';
import { revealClip } from './reveal';

type Vars = Record<string, number>;

/** SMIL 的加速/减速：前 accel 匀加速、后 decel 匀减速，中间匀速，总进度不变 */
export function easeAccel(s: number, accel = 0, decel = 0): number {
  if (!accel && !decel) return s;
  const r = 1 / (1 - accel / 2 - decel / 2);
  if (s < accel) return (r * s * s) / (2 * accel);
  if (s > 1 - decel) return 1 - (r * (1 - s) * (1 - s)) / (2 * decel);
  return r * (s - accel / 2);
}

/** tmFilter：[时间, 进度] 折线 */
function filterTime(s: number, pts: [number, number][] | undefined): number {
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

/** 行为在效果时间 t 时的进度（0~1）；还没开始返回 undefined */
function progress(b: AnimBehavior, t: number): number | undefined {
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

const num = (v: number | string, vars: Vars) => (typeof v === 'number' ? v : evalFormula(v, vars));

/** 关键帧插值；某一段有公式时，插值结果代入公式的 $ */
function valueAt(b: AnimBehavior, q: number, vars: Vars): number {
  const keys = b.keys ?? [];
  if (!keys.length) return NaN;
  const apply = (k: [number, number | string, string?], v: number) => (k[2] ? evalFormula(k[2], { ...vars, $: v }) : v);
  if (keys.length === 1 || q <= keys[0][0]) return apply(keys[0], num(keys[0][1], vars));
  for (let i = 0; i < keys.length - 1; i++) {
    const a = keys[i], z = keys[i + 1];
    if (q <= z[0] || i === keys.length - 2) {
      const u = z[0] > a[0] ? Math.min(1, (q - a[0]) / (z[0] - a[0])) : 1;
      const va = num(a[1], vars), vz = num(z[1], vars);
      const v = b.discrete ? (u >= 1 ? vz : va) : va + (vz - va) * u;
      return apply(a, v);
    }
  }
  return NaN;
}

interface Sample { x: number; y: number; w: number; h: number; sx: number; sy: number; r: number; o: number; f: number }

/** 效果时间 t 时的状态（x/y/w/h 是幻灯片宽高的比例） */
function sampleAt(list: AnimBehavior[], t: number, vars: Vars): Sample {
  const s: Sample = { x: vars.ppt_x, y: vars.ppt_y, w: vars.ppt_w, h: vars.ppt_h, sx: 1, sy: 1, r: 0, o: 1, f: 1 };
  const latest: Partial<Record<AnimBehavior['prop'], { b: AnimBehavior; q: number }>> = {};
  let revealPending = false;
  for (const b of list) {
    const q = progress(b, t);
    if (q === undefined) {
      if (b.prop === 'reveal' && !b.out) revealPending = true;
      continue;
    }
    if (b.prop === 'o') {
      const v = valueAt(b, q, vars);
      if (isFinite(v)) s.o *= Math.max(0, Math.min(1, v));
      continue;
    }
    const cur = latest[b.prop];
    if (!cur || b.delay >= cur.b.delay) latest[b.prop] = { b, q };
  }
  for (const p of ['x', 'y', 'w', 'h', 'sx', 'sy', 'r'] as const) {
    const l = latest[p];
    if (!l) continue;
    const v = valueAt(l.b, l.q, vars);
    if (isFinite(v)) s[p] = v;
  }
  // 显现进度：进入时是露出的比例；退出时是被隐去的比例（播放时取补集）
  const rv = latest.reveal;
  if (rv) s.f = rv.q;
  else if (revealPending) s.f = 0;
  return s;
}

const r3 = (v: number) => Math.round(v * 1000) / 1000;

export function behaviorKeyframes(a: AnimAction, el: Element, slideW: number, slideH: number): EffectKeyframes {
  const list = a.behaviors ?? [];
  const bb = slideBox(el);
  const W = bb.width / slideW, H = bb.height / slideH;
  const vars: Vars = { ppt_x: (bb.x + bb.width / 2) / slideW, ppt_y: (bb.y + bb.height / 2) / slideH, ppt_w: W, ppt_h: H };
  const total = Math.max(1, a.dur);
  const reveal = list.find((b) => b.prop === 'reveal');
  const n = Math.max(6, Math.min(120, Math.round(total / 25)));
  const frames: Keyframe[] = [];
  for (let i = 0; i <= n; i++) {
    const o = i / n;
    const s = sampleAt(list, total * easeAccel(o, a.accel, a.decel), vars);
    const [dx, dy] = bb.local((s.x - vars.ppt_x) * slideW, (s.y - vars.ppt_y) * slideH);
    const sx = (W ? s.w / W : 1) * s.sx, sy = (H ? s.h / H : 1) * s.sy;
    const k: Keyframe = {
      offset: o,
      transform: `translate(${r3(dx)}px,${r3(dy)}px) rotate(${r3(s.r)}deg) scale(${r3(sx)},${r3(sy)})`,
      opacity: r3(s.o),
    };
    if (reveal?.filter) k.clipPath = revealClip(reveal.filter, s.f, el, reveal.out) || 'none';
    frames.push(k);
  }
  return { frames, easing: 'linear' };
}
