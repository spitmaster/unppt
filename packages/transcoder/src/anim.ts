/**
 * 动画编译：p:timing（主序列）-> 每次点击要执行的动作；p:transition -> 页面切换效果。
 */
import type { AnimAction, AnimEffect, AnimTarget, SlideTransition } from '../../format/src/index';
import { colorIn, css, type ColorContext } from './color';
import { attr, child, children, findAll, numAttr, path, type XEl } from './xml';

export interface CompiledAnim {
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
  for (const sc of findAll(cTn, 'p:animScale')) {
    const by = child(sc, 'p:by');
    if (by) t.scale = [(numAttr(by, 'x') ?? 100000) / 100000, (numAttr(by, 'y') ?? 100000) / 100000];
  }
  for (const r of findAll(cTn, 'p:animRot')) {
    const by = numAttr(r, 'by');
    if (by !== undefined) t.rotate = (t.rotate ?? 0) + by / 60000;
  }
  for (const m of findAll(cTn, 'p:animMotion')) {
    // 路径坐标是幻灯片宽高的比例，取终点
    const nums = (attr(m, 'path') ?? '').match(/-?\d*\.?\d+(e-?\d+)?/gi)?.map(Number) ?? [];
    if (nums.length >= 2) t.move = [nums[nums.length - 2] * ctx.width, nums[nums.length - 1] * ctx.height];
  }
  for (const c of findAll(cTn, 'p:animClr')) {
    const names = findAll(c, 'p:attrName').map((a) => a.text.trim());
    const col = colorIn(child(c, 'p:to'), ctx.colors);
    if (!col) continue;
    if (names.some((n) => n === 'fillcolor' || n === 'fill.color')) t.fill = css(col);
    else if (names.some((n) => n === 'style.color')) t.color = css(col);
  }
  for (const a of findAll(cTn, 'p:anim')) {
    const names = findAll(a, 'p:attrName').map((x) => x.text.trim());
    if (!names.includes('style.opacity')) continue;
    const tav = findAll(a, 'p:tav');
    const last = tav[tav.length - 1];
    const v = attr(child(child(last, 'p:val'), 'p:fltVal'), 'val');
    if (v !== undefined) t.opacity = Number(v);
  }
  for (const st of findAll(cTn, 'p:set')) {
    const names = findAll(st, 'p:attrName').map((x) => x.text.trim());
    if (!names.includes('style.opacity')) continue;
    const v = attr(path(st, 'p:to', 'p:strVal'), 'val');
    if (v !== undefined && !isNaN(Number(v))) t.opacity = Number(v);
  }
  return Object.keys(t).length ? t : undefined;
}

function effectAction(eff: XEl, base: number, ctx: AnimContext): AnimAction | undefined {
  const cTn = child(eff, 'p:cTn');
  const cls = attr(cTn, 'presetClass');
  if (!cls) return undefined;
  const spTgt = findAll(cTn, 'p:spTgt')[0];
  const spid = attr(spTgt, 'spid');
  if (!spid) return undefined;
  const pRg = child(child(spTgt, 'p:txEl'), 'p:pRg');
  const uid = pRg ? `s${spid}p${attr(pRg, 'st') ?? '0'}` : `s${spid}`;
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
  return {
    uid, effect, dir, dur: dur || (effect === 'appear' ? 0 : 500), delay: base + delayOf(cTn),
    from: effect === 'fly' || effect === 'wipe' ? dirFromSubtype(numAttr(cTn, 'presetSubtype')) : undefined,
    ...(to ? { to } : {}),
  };
}

export function compileTiming(timing: XEl | undefined, existing: Set<string>, ctx: AnimContext): CompiledAnim {
  const result: CompiledAnim = { steps: [], auto: [], hidden: [], warnings: [] };
  if (!timing) return result;
  const seqs = findAll(timing, 'p:seq');
  const main = seqs.find((s) => attr(child(s, 'p:cTn'), 'nodeType') === 'mainSeq');
  if (seqs.some((s) => attr(child(s, 'p:cTn'), 'nodeType') === 'interactiveSeq')) result.warnings.push('触发器动画暂未支持');
  if (!main) return result;
  const firstSeen = new Map<string, AnimAction>();
  const groups = children(child(child(main, 'p:cTn'), 'p:childTnLst'), 'p:par');
  for (const g of groups) {
    const gTn = child(g, 'p:cTn');
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
  const type: SlideTransition['type'] = local === 'push' ? 'push' : local === 'wipe' ? 'wipe' : local === 'cover' || local === 'pull' ? 'cover' : 'fade';
  return { type, dur };
}
