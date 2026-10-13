/** 强调和路径动画：结束后保持的状态（缩放、旋转、移动、颜色、透明度），以及往返类动画的采样关键帧 */
import type { AnimTarget } from '../../../format/src/index';
import { colorIn, css, type ColorContext } from '../model/color';
import { attr, child, findAll, numAttr, path, type XEl } from '../io/xml';
import { motionPoints } from './motion';
import { easeAccel, filterTime, nonLinear, progressAt, timingOf, type Timing } from './timing-util';

export interface AnimContext {
  width: number;
  height: number;
  colors: ColorContext;
  /** 动画声音、切换声音：关系编号 -> 媒体文件路径（调用方事先取好） */
  sounds?: Map<string, string>;
}

/** 强调和路径动画结束后保持的状态 */
export function finalState(cTn: XEl | undefined, ctx: AnimContext): AnimTarget | undefined {
  const t: AnimTarget = {};
  // 整个效果的加减速（"平滑开始/平滑结束"）
  const A = (numAttr(cTn, 'accel') ?? 0) / 100000, D = (numAttr(cTn, 'decel') ?? 0) / 100000;
  // 缩放和旋转：按时间线算终点的值；过程不是匀速一次到位的（往返、多段、加减速、时间折线），再按时间采样关键帧
  const tl = transformTimeline(cTn);
  const op = opacityTimeline(cTn);
  if (tl.list.length) {
    const end = tl.sample(tl.end);
    if (Math.abs(end.sx - 1) > 1e-6 || Math.abs(end.sy - 1) > 1e-6) t.scale = [end.sx, end.sy];
    if (Math.abs(end.rot) > 1e-6) t.rotate = end.rot;
  }
  const scales = tl.list.filter((b) => b.rot === undefined).length, rots = tl.list.length - scales;
  const curved = tl.list.some((b) => b.autoRev || (b.repeat ?? 1) > 1 || nonLinear(b)) || scales > 1 || rots > 1 || ((A > 0 || D > 0) && tl.list.length > 0);
  const total = emphasisDuration(cTn);
  if (total > 0 && (curved || op.list.length)) {
    t.keys = Array.from({ length: 25 }, (_, k) => {
      const at = total * easeAccel(k / 24, A, D);
      const v = tl.sample(at);
      const key: NonNullable<AnimTarget['keys']>[number] = { o: k / 24, s: [round4(v.sx), round4(v.sy)], r: round4(v.rot) };
      if (op.list.length) key.a = round4(op.sample(k === 24 ? total + 1 : at));
      return key;
    });
  }
  for (const m of findAll(cTn, 'p:animMotion')) {
    // 路径坐标是幻灯片宽高的比例
    const pts = motionPoints(attr(m, 'path') ?? '', ctx.width, ctx.height);
    if (pts.length >= 2) {
      t.move = pts[pts.length - 1];
      t.path = pts;
    }
    // 路径的加减速：效果上的，或者路径行为自己的
    const own = timingOf(path(m, 'p:cBhvr', 'p:cTn'));
    const a = A || own?.accel || 0, d = D || own?.decel || 0;
    if (a > 0) t.accel = round4(a);
    if (d > 0) t.decel = round4(d);
  }
  if (!t.keys && tl.list.length && (A > 0 || D > 0)) {
    if (A > 0) t.accel = round4(A);
    if (D > 0) t.decel = round4(D);
  }
  // 带 autoRev 的行为播完会变回去，不影响最终状态
  const reverts = (el: XEl) => { const v = attr(path(el, 'p:cBhvr', 'p:cTn'), 'autoRev'); return v === '1' || v === 'true'; };
  for (const c of findAll(cTn, 'p:animClr')) {
    if (reverts(c)) continue;
    const names = findAll(c, 'p:attrName').map((a) => a.text.trim().toLowerCase());
    const col = colorIn(child(c, 'p:to'), ctx.colors);
    if (!col) continue;
    if (names.some((n) => n === 'fillcolor' || n === 'fill.color')) t.fill = css(col);
    if (names.some((n) => n === 'style.color')) t.color = css(col);
  }
  // 不透明度：效果保持（fill="hold"）时才留下终值
  if (op.list.length && op.hold) {
    const a = op.sample(op.end + 1);
    if (Math.abs(a - 1) > 1e-6) t.opacity = round4(a);
  }
  return Object.keys(t).length ? t : undefined;
}

const round4 = (v: number) => Math.round(v * 10000) / 10000;

/** 一个缩放或旋转行为：在 delay 之后用 dur 变化到目标（带加减速、时间折线），autoRev 时再变回去，可重复 */
interface TransformBehavior extends Timing {
  /** 缩放：by 是相对当前的倍数；abs 时是以原始大小为基准的目标值（from 可选） */
  sx?: number; sy?: number; abs?: boolean; fx?: number; fy?: number;
  rot?: number;
}

/** 行为节点的时间设置；没写时长的按 0.5 秒 */
function behaviorTiming(el: XEl): Timing | undefined {
  const c = path(el, 'p:cBhvr', 'p:cTn');
  const tm = timingOf(c);
  if (tm && attr(c, 'dur') === undefined) tm.dur = 500;
  return tm;
}

/** 强调效果的总时长：所有时间节点的最晚结束（含往返、重复） */
export function emphasisDuration(cTn: XEl | undefined): number {
  let dur = 0;
  for (const b of findAll(cTn, 'p:cTn')) {
    const d = attr(b, 'dur');
    if (d && d !== 'indefinite' && isFinite(Number(d))) dur = Math.max(dur, Number(d) + (timingOf(b)?.delay ?? 0));
  }
  return Math.max(dur, transformTimeline(cTn).end, opacityTimeline(cTn).end);
}

const endOf = (b: Timing) => b.delay + b.dur * (b.autoRev ? 2 : 1) * Math.max(1, b.repeat ?? 1);

export function transformTimeline(cTn: XEl | undefined) {
  const list: TransformBehavior[] = [];
  for (const sc of findAll(cTn, 'p:animScale')) {
    const by = child(sc, 'p:by'), to = child(sc, 'p:to'), from = child(sc, 'p:from');
    const v = by ?? to;
    const tm = behaviorTiming(sc);
    if (!v || !tm) continue;
    list.push({
      ...tm, sx: (numAttr(v, 'x') ?? 100000) / 100000, sy: (numAttr(v, 'y') ?? 100000) / 100000,
      ...(by ? {} : { abs: true, ...(from ? { fx: (numAttr(from, 'x') ?? 100000) / 100000, fy: (numAttr(from, 'y') ?? 100000) / 100000 } : {}) }),
    });
  }
  list.sort((a, b) => a.delay - b.delay);
  for (const r of findAll(cTn, 'p:animRot')) {
    const by = numAttr(r, 'by');
    const tm = behaviorTiming(r);
    if (by !== undefined && tm) list.push({ ...tm, rot: by / 60000 });
  }
  const end = Math.max(0, ...list.map(endOf));
  const sample = (t: number) => {
    let sx = 1, sy = 1, rot = 0;
    for (const b of list) {
      const p = progressAt(b, t);
      if (b.rot !== undefined) rot += b.rot * (p ?? 0);
      else if (b.abs) {
        // 绝对值：从 from（没写就是当前值）插值到 to，替换当前值；还没开始的不起作用
        if (p === undefined || t <= b.delay) continue;
        const fx = b.fx ?? sx, fy = b.fy ?? sy;
        sx = fx + ((b.sx ?? 1) - fx) * p;
        sy = fy + ((b.sy ?? 1) - fy) * p;
      } else { const q = p ?? 0; sx *= 1 + ((b.sx ?? 1) - 1) * q; sy *= 1 + ((b.sy ?? 1) - 1) * q; }
    }
    return { sx, sy, rot };
  };
  return { list, end, sample };
}

/** 一个改变不透明度的行为：v(q) 是进度 q 时的不透明度倍数 */
interface OpacityBehavior extends Timing { v: (q: number) => number }

/**
 * 不透明度的时间线：淡入淡出滤镜（可带时间折线，比如闪光灯先变淡再恢复）、style.opacity 的动画和设置。
 * 效果节点没有 fill="hold" 时，行为结束后恢复原样（比如"透明"强调效果到时间就恢复）
 */
export function opacityTimeline(cTn: XEl | undefined) {
  const list: OpacityBehavior[] = [];
  const hold = attr(cTn, 'fill') === 'hold';
  for (const e of findAll(cTn, 'p:animEffect')) {
    if (attr(e, 'filter') !== 'fade') continue;
    const tm = behaviorTiming(e);
    const out = attr(e, 'transition') === 'out';
    if (tm) list.push({ ...tm, v: out ? (q) => 1 - q : (q) => q });
  }
  for (const a of findAll(cTn, 'p:anim')) {
    if (!findAll(a, 'p:attrName').some((x) => x.text.trim() === 'style.opacity')) continue;
    const tm = behaviorTiming(a);
    const pts = findAll(a, 'p:tav').map((tv) => [(numAttr(tv, 'tm') ?? 0) / 100000, Number(attr(child(child(tv, 'p:val'), 'p:fltVal'), 'val') ?? attr(child(child(tv, 'p:val'), 'p:strVal'), 'val'))] as [number, number]);
    if (!tm || pts.length < 2 || pts.some(([, v]) => !isFinite(v))) continue;
    list.push({ ...tm, v: (q) => filterTime(q, pts) });
  }
  for (const st of findAll(cTn, 'p:set')) {
    if (!findAll(st, 'p:attrName').some((x) => x.text.trim() === 'style.opacity')) continue;
    const v = Number(attr(path(st, 'p:to', 'p:strVal'), 'val'));
    const tm = behaviorTiming(st);
    if (tm && isFinite(v)) list.push({ ...tm, v: () => v });
  }
  const end = Math.max(0, ...list.map(endOf));
  const sample = (t: number) => {
    let a = 1;
    for (const b of list) {
      if (!hold && t >= endOf(b) && b.dur > 1) continue;
      const p = progressAt(b, t);
      if (p !== undefined) a *= Math.max(0, Math.min(1, b.v(p)));
    }
    return a;
  };
  return { list, end, sample, hold };
}
