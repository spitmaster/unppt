/**
 * 动画编译：p:timing（主序列）-> 每次点击要执行的动作；p:transition -> 页面切换效果。
 */
import type { AnimAction, AnimEffect, AnimTarget, SlideTransition } from '../../format/src/index';
import { colorIn, css, type ColorContext } from './color';
import { attr, child, children, findAll, numAttr, path, type XEl } from './xml';

export interface CompiledAnim {
  triggers: { uid: string; steps: AnimAction[][] }[];
  steps: AnimAction[][];
  auto: AnimAction[];
  hidden: string[];
  warnings: string[];
}

const EFFECT_BY_ID: Record<number, AnimEffect> = {
  1: 'appear', 2: 'fly', 3: 'wipe', 4: 'zoom', 5: 'fade', 6: 'zoom', 7: 'fly', 8: 'zoom', 9: 'fade', 10: 'fade',
  12: 'fly', 13: 'zoom', 14: 'fade', 16: 'split', 17: 'zoom', 18: 'wipe', 21: 'wheel', 22: 'wipe', 23: 'zoom',
  24: 'random', 26: 'fly', 37: 'float', 42: 'float', 47: 'float', 53: 'zoom', 55: 'zoom',
};

function dirFromSubtype(sub: number | undefined): AnimAction['from'] {
  switch (sub) {
    case 1: return 't';
    case 2: return 'r';
    case 4: return 'b';
    case 8: return 'l';
    case 3: case 6: return 'r';
    case 9: case 12: return 'l';
    default: return 'b';
  }
}

function delayOf(cTn: XEl | undefined): number {
  const d = attr(child(child(cTn, 'p:stCondLst'), 'p:cond'), 'delay');
  if (!d || d === 'indefinite') return 0;
  const n = Number(d);
  return Number.isFinite(n) ? n : 0;
}

/**
 * 这一组是否要等点击。注意：页面一开始就自动播放的组，PowerPoint 会同时写
 * delay="indefinite" 和 evt="onBegin" 两个条件，后者表示随序列开始自动触发。
 */
function isClick(cTn: XEl | undefined): boolean {
  const conds = children(child(cTn, 'p:stCondLst'), 'p:cond');
  if (conds.some((c) => attr(c, 'evt') === 'onBegin')) return false;
  return conds.some((c) => attr(c, 'delay') === 'indefinite');
}

export interface AnimContext { width: number; height: number; colors: ColorContext }

/** 强调和路径动画结束后保持的状态 */
function finalState(cTn: XEl | undefined, ctx: AnimContext): AnimTarget | undefined {
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

function transformTimeline(cTn: XEl | undefined) {
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

/** 运动路径（M/L/C/Z/E，可以是小写相对坐标）展平成点列，曲线每段取 12 个点，最多保留 64 个点 */
function motionPoints(d: string, w: number, h: number): [number, number][] {
  // 命令字母里不含 e/E：E 是"路径结束"，也可能是科学计数法的指数（如 2.5E-6）
  const toks = d.match(/[a-df-zA-DF-Z]|-?\d*\.?\d+(?:[eE][-+]?\d+)?/g) ?? [];
  const pts: [number, number][] = [];
  let i = 0, cmd = 'M', cx = 0, cy = 0, sx = 0, sy = 0;
  const num = () => { const v = Number(toks[i++]); return Number.isFinite(v) ? v : 0; };
  while (i < toks.length) {
    if (/[a-zA-Z]/.test(toks[i])) cmd = toks[i++];
    const rel = cmd !== cmd.toUpperCase();
    const C = cmd.toUpperCase();
    if (C === 'M' || C === 'L') {
      let x = num(), y = num();
      if (rel) { x += cx; y += cy; }
      cx = x; cy = y;
      if (C === 'M') { sx = x; sy = y; cmd = rel ? 'l' : 'L'; }
      pts.push([x, y]);
    } else if (C === 'C') {
      const o = rel ? [cx, cy] : [0, 0];
      const x1 = num() + o[0], y1 = num() + o[1], x2 = num() + o[0], y2 = num() + o[1], x = num() + o[0], y = num() + o[1];
      for (let k = 1; k <= 12; k++) {
        const t = k / 12, u = 1 - t;
        pts.push([u * u * u * cx + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x, u * u * u * cy + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y]);
      }
      cx = x; cy = y;
    } else if (C === 'Z') {
      pts.push([sx, sy]);
      cx = sx; cy = sy;
      cmd = 'M';
    } else if (C === 'E') break;
    else i++;
  }
  const out: [number, number][] = [];
  for (const [x, y] of pts) {
    const q: [number, number] = [Math.round(x * w * 100) / 100, Math.round(y * h * 100) / 100];
    const last = out[out.length - 1];
    if (!last || last[0] !== q[0] || last[1] !== q[1]) out.push(q);
  }
  if (out.length <= 64) return out;
  const step = (out.length - 1) / 63;
  return Array.from({ length: 64 }, (_, k) => out[Math.round(k * step)]);
}

function effectAction(eff: XEl, base: number, ctx: AnimContext): AnimAction | undefined {
  const cTn = child(eff, 'p:cTn');
  const cls = attr(cTn, 'presetClass');
  if (!cls) return undefined;
  const spTgt = findAll(cTn, 'p:spTgt')[0];
  const spid = attr(spTgt, 'spid');
  if (!spid || !/^\d{1,10}$/.test(spid)) return undefined;
  const pRg = child(child(spTgt, 'p:txEl'), 'p:pRg');
  const st = attr(pRg, 'st') ?? '0';
  const uid = pRg && /^\d{1,6}$/.test(st) ? `s${spid}p${st}` : `s${spid}`;
  let dur = 0;
  for (const b of findAll(cTn, 'p:cTn')) {
    const d = attr(b, 'dur');
    if (d && d !== 'indefinite') dur = Math.max(dur, Number(d) + delayOf(b));
  }
  const id = numAttr(cTn, 'presetID') ?? 0;
  if (cls === 'mediacall') {
    // 媒体命令：playFrom(秒) / pause / stop / togglePause
    const cmd = attr(findAll(cTn, 'p:cmd')[0], 'cmd') ?? '';
    const m = /playFrom\(([\d.]+)\)/.exec(cmd);
    const media: AnimAction['media'] = m || cmd === 'play' ? 'play' : cmd === 'pause' ? 'pause' : cmd === 'stop' ? 'stop' : cmd === 'togglePause' ? 'toggle' : undefined;
    if (!media) return undefined;
    return { uid, effect: 'media', dir: 'emph', dur: 0, delay: base + delayOf(cTn), media, ...(m ? { start: Number(m[1]) } : {}) };
  }
  const dir: AnimAction['dir'] = cls === 'entr' ? 'in' : cls === 'exit' ? 'out' : 'emph';
  let effect: AnimEffect = cls === 'emph' ? 'emphasis' : cls === 'path' ? 'path' : EFFECT_BY_ID[id] ?? 'fade';
  if (dir !== 'emph' && id === 1) dur = 0;
  if (effect === 'appear') dur = 0;
  const to = dir === 'emph' ? finalState(cTn, ctx) : undefined;
  // 往返、重复的行为实际时长比单段 dur 长
  if (dir === 'emph') dur = Math.max(dur, transformTimeline(cTn).end);
  const iterate = iterateOf(cTn, dur);
  return {
    uid, effect, dir, dur: dur || (effect === 'appear' ? 0 : 500), delay: base + delayOf(cTn),
    from: effect === 'fly' || effect === 'wipe' ? dirFromSubtype(numAttr(cTn, 'presetSubtype')) : undefined,
    ...(to ? { to } : {}),
    ...(iterate ? { iterate } : {}),
  };
}

/** 逐字/逐词：间隔是 tmAbs（毫秒）或 tmPct（单个字时长的百分比，单位 1/1000 %） */
function iterateOf(cTn: XEl | undefined, dur: number): AnimAction['iterate'] {
  const it = child(cTn, 'p:iterate');
  const type = attr(it, 'type');
  if (type !== 'lt' && type !== 'wd') return undefined;
  const abs = numAttr(child(it, 'p:tmAbs'), 'val');
  const pct = numAttr(child(it, 'p:tmPct'), 'val');
  const gap = abs ?? ((pct ?? 0) / 100000) * dur;
  return { by: type === 'lt' ? 'letter' : 'word', gap: Math.max(0, Math.min(gap, 10000)) };
}

export function compileTiming(timing: XEl | undefined, existing: Set<string>, ctx: AnimContext): CompiledAnim {
  const result: CompiledAnim = { steps: [], auto: [], hidden: [], warnings: [], triggers: [] };
  if (!timing) return result;
  const seqs = findAll(timing, 'p:seq');
  const main = seqs.find((s) => attr(child(s, 'p:cTn'), 'nodeType') === 'mainSeq');
  const firstSeen = new Map<string, AnimAction>();
  const groupActions = (gTn: XEl | undefined): AnimAction[] => {
    const actions: AnimAction[] = [];
    for (const sub of children(child(gTn, 'p:childTnLst'), 'p:par')) {
      const sTn = child(sub, 'p:cTn');
      const base = delayOf(sTn);
      for (const eff of children(child(sTn, 'p:childTnLst'), 'p:par')) {
        const a = effectAction(eff, base, ctx);
        if (!a) continue;
        if (!existing.has(a.uid)) {
          // 段落动画的目标如果不存在（比如段落是空的），退回到整个形状
          const shapeUid = a.uid.replace(/p\d+$/, '');
          if (existing.has(shapeUid)) a.uid = shapeUid;
          else continue;
        }
        if (!firstSeen.has(a.uid)) firstSeen.set(a.uid, a);
        actions.push(a);
      }
    }
    return actions;
  };
  // 触发器序列：点击某个形状时依次播放
  for (const seq of seqs) {
    const sTn = child(seq, 'p:cTn');
    if (attr(sTn, 'nodeType') !== 'interactiveSeq') continue;
    const cond = children(child(sTn, 'p:stCondLst'), 'p:cond').find((c) => attr(c, 'evt') === 'onClick');
    const spid = attr(findAll(cond, 'p:spTgt')[0], 'spid');
    if (!spid || !/^\d{1,10}$/.test(spid)) continue;
    const steps = children(child(sTn, 'p:childTnLst'), 'p:par').map((g) => groupActions(child(g, 'p:cTn'))).filter((x) => x.length);
    if (steps.length) result.triggers.push({ uid: `s${spid}`, steps });
  }
  if (!main) {
    for (const [uid, a] of firstSeen) if (a.dir === 'in') result.hidden.push(uid);
    return result;
  }
  const groups = children(child(child(main, 'p:cTn'), 'p:childTnLst'), 'p:par');
  for (const g of groups) {
    const gTn = child(g, 'p:cTn');
    const actions = groupActions(gTn);
    if (isClick(gTn) || result.steps.length > 0) {
      if (isClick(gTn)) result.steps.push(actions);
      else result.steps[result.steps.length - 1].push(...actions.map((a) => ({ ...a, delay: a.delay + 1 })));
    } else {
      result.auto.push(...actions);
    }
  }
  for (const [uid, a] of firstSeen) if (a.dir === 'in') result.hidden.push(uid);
  // 放映时隐藏的音频/视频图标（showWhenStopped="0"）
  for (const node of findAll(timing, 'p:cMediaNode')) {
    if (attr(node, 'showWhenStopped') !== '0') continue;
    const spid = attr(findAll(node, 'p:spTgt')[0], 'spid');
    if (spid && existing.has(`s${spid}`) && !result.hidden.includes(`s${spid}`)) result.hidden.push(`s${spid}`);
  }
  return result;
}

export function compileTransition(tr: XEl | undefined): SlideTransition | undefined {
  if (!tr) return undefined;
  const spd = attr(tr, 'spd');
  const durAttr = numAttr(tr, 'p14:dur') ?? numAttr(tr, 'dur');
  const dur = durAttr ?? (spd === 'fast' ? 500 : spd === 'slow' ? 1000 : 750);
  const kind = tr.children.find((c) => c.name.startsWith('p:') || c.name.startsWith('p14:') || c.name.startsWith('p15:'));
  if (!kind) return undefined;
  const local = kind.name.slice(kind.name.indexOf(':') + 1);
  const MAP: Record<string, SlideTransition['type']> = { cut: 'none', push: 'push', wipe: 'wipe', cover: 'cover', pull: 'pull', split: 'split', circle: 'circle' };
  const type = MAP[local] ?? 'fade';
  if (type === 'none') return { type, dur: 0 };
  const out: SlideTransition = { type, dur };
  const dir = attr(kind, 'dir');
  if (type === 'push' || type === 'wipe' || type === 'cover' || type === 'pull') {
    out.dir = dir === 'r' || dir === 'u' || dir === 'd' ? dir : 'l';
  } else if (type === 'split') {
    out.orient = attr(kind, 'orient') === 'vert' ? 'vert' : 'horz';
    out.inOut = dir === 'in' ? 'in' : 'out';
  }
  return out;
}
