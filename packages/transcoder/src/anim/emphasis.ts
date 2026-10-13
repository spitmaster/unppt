/** 强调和路径动画：结束后保持的状态（缩放、旋转、移动、颜色、透明度），以及往返类动画的采样关键帧 */
import type { AnimTarget } from '../../../format/src/index';
import { colorIn, css, type ColorContext } from '../model/color';
import { attr, child, findAll, numAttr, path, type XEl } from '../io/xml';
import { motionPoints } from './motion';
import { delayOf } from './timing-util';

export interface AnimContext { width: number; height: number; colors: ColorContext }

/** 强调和路径动画结束后保持的状态 */
export function finalState(cTn: XEl | undefined, ctx: AnimContext): AnimTarget | undefined {
  const t: AnimTarget = {};
  // 缩放和旋转：按时间线算终点的值；过程有往返（autoRev）或多段的，再按时间采样关键帧
  const tl = transformTimeline(cTn);
  if (tl.list.length) {
    const end = tl.sample(tl.end);
    if (Math.abs(end.sx - 1) > 1e-6 || Math.abs(end.sy - 1) > 1e-6) t.scale = [end.sx, end.sy];
    if (Math.abs(end.rot) > 1e-6) t.rotate = end.rot;
    const scales = tl.list.filter((b) => b.rot === undefined).length, rots = tl.list.length - scales;
    if (tl.end > 0 && (tl.list.some((b) => b.autoRev || b.reps > 1) || scales > 1 || rots > 1)) {
      t.keys = Array.from({ length: 25 }, (_, k) => {
        const v = tl.sample((tl.end * k) / 24);
        return { o: k / 24, s: [round4(v.sx), round4(v.sy)], r: round4(v.rot) };
      });
    }
  }
  for (const m of findAll(cTn, 'p:animMotion')) {
    // 路径坐标是幻灯片宽高的比例
    const pts = motionPoints(attr(m, 'path') ?? '', ctx.width, ctx.height);
    if (pts.length >= 2) {
      t.move = pts[pts.length - 1];
      t.path = pts;
    }
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
  for (const a of findAll(cTn, 'p:anim')) {
    if (reverts(a)) continue;
    const names = findAll(a, 'p:attrName').map((x) => x.text.trim());
    if (!names.includes('style.opacity')) continue;
    const tav = findAll(a, 'p:tav');
    const last = tav[tav.length - 1];
    const v = attr(child(child(last, 'p:val'), 'p:fltVal'), 'val');
    if (v !== undefined) t.opacity = Number(v);
  }
  for (const st of findAll(cTn, 'p:set')) {
    if (reverts(st)) continue;
    const names = findAll(st, 'p:attrName').map((x) => x.text.trim());
    if (!names.includes('style.opacity')) continue;
    const v = attr(path(st, 'p:to', 'p:strVal'), 'val');
    if (v !== undefined && !isNaN(Number(v))) t.opacity = Number(v);
  }
  return Object.keys(t).length ? t : undefined;
}

const round4 = (v: number) => Math.round(v * 10000) / 10000;

/** 一个缩放或旋转行为：在 delay 之后用 dur 变化到目标，autoRev 时再用 dur 变回去，可重复 */
interface TransformBehavior {
  delay: number; dur: number; autoRev: boolean; reps: number;
  /** 缩放：by 是相对当前的倍数；abs 时是以原始大小为基准的目标值（from 可选） */
  sx?: number; sy?: number; abs?: boolean; fx?: number; fy?: number;
  rot?: number;
}

export function transformTimeline(cTn: XEl | undefined) {
  const list: TransformBehavior[] = [];
  const timing = (el: XEl) => {
    const c = path(el, 'p:cBhvr', 'p:cTn');
    const rep = attr(c, 'repeatCount');
    return {
      delay: delayOf(c), dur: Math.max(1, numAttr(c, 'dur') ?? 500),
      autoRev: attr(c, 'autoRev') === '1' || attr(c, 'autoRev') === 'true',
      reps: rep && rep !== 'indefinite' ? Math.max(1, Number(rep) / 1000) : 1,
    };
  };
  for (const sc of findAll(cTn, 'p:animScale')) {
    const by = child(sc, 'p:by'), to = child(sc, 'p:to'), from = child(sc, 'p:from');
    const v = by ?? to;
    if (!v) continue;
    list.push({
      ...timing(sc), sx: (numAttr(v, 'x') ?? 100000) / 100000, sy: (numAttr(v, 'y') ?? 100000) / 100000,
      ...(by ? {} : { abs: true, ...(from ? { fx: (numAttr(from, 'x') ?? 100000) / 100000, fy: (numAttr(from, 'y') ?? 100000) / 100000 } : {}) }),
    });
  }
  list.sort((a, b) => a.delay - b.delay);
  for (const r of findAll(cTn, 'p:animRot')) {
    const by = numAttr(r, 'by');
    if (by !== undefined) list.push({ ...timing(r), rot: by / 60000 });
  }
  const progress = (b: TransformBehavior, t: number) => {
    const local = t - b.delay;
    if (local <= 0) return 0;
    const cycle = b.dur * (b.autoRev ? 2 : 1);
    if (local >= cycle * b.reps) return b.autoRev ? 0 : 1;
    const c = local % cycle;
    return c < b.dur ? c / b.dur : 1 - (c - b.dur) / b.dur;
  };
  const end = Math.max(0, ...list.map((b) => b.delay + b.dur * (b.autoRev ? 2 : 1) * b.reps));
  const sample = (t: number) => {
    let sx = 1, sy = 1, rot = 0;
    for (const b of list) {
      const p = progress(b, t);
      if (b.rot !== undefined) rot += b.rot * p;
      else if (b.abs) {
        // 绝对值：从 from（没写就是当前值）插值到 to，替换当前值；还没开始的不起作用
        if (t <= b.delay) continue;
        const fx = b.fx ?? sx, fy = b.fy ?? sy;
        sx = fx + ((b.sx ?? 1) - fx) * p;
        sy = fy + ((b.sy ?? 1) - fy) * p;
      } else { sx *= 1 + ((b.sx ?? 1) - 1) * p; sy *= 1 + ((b.sy ?? 1) - 1) * p; }
    }
    return { sx, sy, rot };
  };
  return { list, end, sample };
}
