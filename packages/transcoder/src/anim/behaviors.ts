/**
 * 进入/退出效果的行为：把 p:anim（位置、大小、旋转、透明度）、p:animEffect（淡入淡出、显现滤镜）、p:set
 * 连同各自的时间设置原样整理成 AnimBehavior，由播放器按元素的真实位置求值。
 * 有看不懂的行为（缩放、路径、颜色、嵌套的时间节点……）时返回 undefined，调用方退回按预设编号的画法。
 */
import type { AnimBehavior } from '../../../format/src/index';
import { attr, child, children, findAll, numAttr, path, type XEl } from '../io/xml';
import { timingOf } from './timing-util';

const PROPS: Record<string, AnimBehavior['prop']> = {
  ppt_x: 'x', ppt_y: 'y', ppt_w: 'w', ppt_h: 'h', 'style.rotation': 'r', r: 'r', 'style.opacity': 'o',
};

/** p:val 里的值：数字或公式字符串 */
function value(v: XEl | undefined): number | string | undefined {
  const flt = attr(child(v, 'p:fltVal'), 'val') ?? attr(child(v, 'p:intVal'), 'val');
  if (flt !== undefined && isFinite(Number(flt))) return Number(flt);
  const s = attr(child(v, 'p:strVal'), 'val');
  if (s === undefined) return undefined;
  return isFinite(Number(s)) && s.trim() !== '' ? Number(s) : s;
}

function animKeys(a: XEl, prop: AnimBehavior['prop']): AnimBehavior['keys'] | undefined {
  const tavs = children(child(a, 'p:tavLst'), 'p:tav');
  if (tavs.length) {
    const keys: NonNullable<AnimBehavior['keys']> = [];
    for (const t of tavs) {
      const v = value(child(t, 'p:val'));
      if (v === undefined) return undefined;
      const tm = attr(t, 'tm');
      const k: [number, number | string, string?] = [tm === undefined ? keys.length / Math.max(1, tavs.length - 1) : Number(tm) / 100000, v];
      const f = attr(t, 'fmla');
      if (f) k[2] = f;
      keys.push(k);
    }
    return keys;
  }
  // 没有关键帧列表：from / to / by
  const base = prop === 'o' ? 1 : prop === 'r' ? 0 : `#ppt_${prop}`;
  const num = (s: string | undefined) => (s === undefined ? undefined : isFinite(Number(s)) ? Number(s) : s);
  const from = num(attr(a, 'from')) ?? base, to = num(attr(a, 'to')), by = num(attr(a, 'by'));
  if (to !== undefined) return [[0, from], [1, to]];
  if (by !== undefined) return [[0, from], [1, typeof from === 'number' && typeof by === 'number' ? from + by : `(${from})+(${by})`]];
  return undefined;
}

export function compileBehaviors(cTn: XEl | undefined): { behaviors: AnimBehavior[]; accel?: number; decel?: number } | undefined {
  if (!cTn) return undefined;
  const list = children(child(cTn, 'p:childTnLst'));
  const behaviors: AnimBehavior[] = [];
  const relative: { el: XEl; tm: NonNullable<ReturnType<typeof timingOf>> }[] = [];
  for (const el of list) {
    const tn = path(el, 'p:cBhvr', 'p:cTn');
    const names = findAll(child(el, 'p:cBhvr'), 'p:attrName').map((n) => n.text.trim());
    const tm = timingOf(tn);
    if (!tm) return undefined;
    if (el.name === 'p:set') {
      if (names.includes('style.visibility')) continue;
      const prop = PROPS[names[0] ?? ''];
      const v = value(child(el, 'p:to'));
      if (!prop || names.length !== 1 || v === undefined) return undefined;
      behaviors.push({ prop, ...tm, keys: [[0, v], [1, v]], discrete: true });
    } else if (el.name === 'p:anim') {
      const prop = PROPS[names[0] ?? ''];
      if (!prop || names.length !== 1 || attr(el, 'valueType') === 'clr' || attr(el, 'valueType') === 'str') return undefined;
      const keys = animKeys(el, prop);
      if (!keys) return undefined;
      behaviors.push({ prop, ...tm, keys, ...(attr(el, 'calcmode') === 'discrete' ? { discrete: true } : {}) });
    } else if (el.name === 'p:animEffect') {
      const filter = (attr(el, 'filter') ?? '').trim();
      const out = attr(el, 'transition') === 'out';
      if (!filter) return undefined;
      if (filter === 'fade') behaviors.push({ prop: 'o', ...tm, keys: out ? [[0, 1], [1, 0]] : [[0, 0], [1, 1]] });
      else behaviors.push({ prop: 'reveal', ...tm, filter, ...(out ? { out: true } : {}) });
    } else if (el.name === 'p:animScale' || el.name === 'p:animRot') {
      // 缩放、旋转：按开始时间先后接力，from 没写就是前一段的终值
      relative.push({ el, tm });
    } else {
      // 路径、颜色、命令、嵌套的时间节点：交给按预设编号的画法
      return undefined;
    }
  }
  relative.sort((a, b) => a.tm.delay - b.tm.delay);
  let sx = 1, sy = 1, rot = 0;
  for (const { el, tm } of relative) {
    if (el.name === 'p:animRot') {
      const by = numAttr(el, 'by'), to = numAttr(el, 'to'), from = numAttr(el, 'from');
      const r0 = from !== undefined ? from / 60000 : rot;
      const r1 = to !== undefined ? to / 60000 : by !== undefined ? r0 + by / 60000 : undefined;
      if (r1 === undefined) return undefined;
      behaviors.push({ prop: 'r', ...tm, keys: [[0, r0], [1, r1]] });
      rot = r1;
      continue;
    }
    const pctOf = (e: XEl | undefined, k: 'x' | 'y') => (e ? (numAttr(e, k) ?? 100000) / 100000 : undefined);
    const from = child(el, 'p:from'), to = child(el, 'p:to'), by = child(el, 'p:by');
    const fx = pctOf(from, 'x') ?? sx, fy = pctOf(from, 'y') ?? sy;
    const tx = pctOf(to, 'x') ?? (by ? fx * (pctOf(by, 'x') ?? 1) : undefined), ty = pctOf(to, 'y') ?? (by ? fy * (pctOf(by, 'y') ?? 1) : undefined);
    if (tx === undefined || ty === undefined) return undefined;
    behaviors.push({ prop: 'sx', ...tm, keys: [[0, fx], [1, tx]] }, { prop: 'sy', ...tm, keys: [[0, fy], [1, ty]] });
    sx = tx;
    sy = ty;
  }
  if (!behaviors.length) return undefined;
  const accel = (numAttr(cTn, 'accel') ?? 0) / 100000, decel = (numAttr(cTn, 'decel') ?? 0) / 100000;
  return { behaviors, ...(accel > 0 ? { accel: Math.min(1, accel) } : {}), ...(decel > 0 ? { decel: Math.min(1 - Math.min(1, accel), decel) } : {}) };
}
