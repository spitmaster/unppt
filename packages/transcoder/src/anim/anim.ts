/**
 * 动画编译：p:timing（主序列、触发器序列）-> 每次点击要执行的动作。
 * 单个效果见 effect.ts，强调终态见 emphasis.ts，运动路径见 motion.ts，页面切换见 transition.ts。
 */
import type { AnimAction } from '../../../format/src/index';
import { attr, child, children, findAll, numAttr, type XEl } from '../io/xml';
import type { AnimContext } from './emphasis';
import { effectAction } from './effect';
import { delayOf, isClick } from './timing-util';

export type { AnimContext } from './emphasis';
export { compileAdvance, compileTransition } from './transition';
export { soundRids } from './sound';

export interface CompiledAnim {
  triggers: { uid: string; steps: AnimAction[][] }[];
  steps: AnimAction[][];
  auto: AnimAction[];
  hidden: string[];
  warnings: string[];
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
  // 跨幻灯片播放（numSld）、循环播放（媒体节点 repeatCount=indefinite）：带到"播放"动作上
  const mediaOpts = new Map<string, { across: number; loop: boolean }>();
  for (const node of findAll(timing, 'p:cMediaNode')) {
    const spid = attr(findAll(node, 'p:spTgt')[0], 'spid');
    if (!spid) continue;
    const across = Math.max(1, Math.min(9999, numAttr(node, 'numSld') ?? 1));
    const loop = attr(child(node, 'p:cTn'), 'repeatCount') === 'indefinite';
    if (across > 1 || loop) mediaOpts.set(`s${spid}`, { across, loop });
  }
  const allActions = [...result.auto, ...result.steps.flat(), ...result.triggers.flatMap((t) => t.steps.flat())];
  for (const a of allActions) {
    const o = a.media === 'play' ? mediaOpts.get(a.uid) : undefined;
    if (o) { if (o.across > 1) a.across = o.across; if (o.loop) a.loop = true; }
  }
  // 放映时隐藏的音频/视频图标（showWhenStopped="0"）
  for (const node of findAll(timing, 'p:cMediaNode')) {
    if (attr(node, 'showWhenStopped') !== '0') continue;
    const spid = attr(findAll(node, 'p:spTgt')[0], 'spid');
    if (spid && existing.has(`s${spid}`) && !result.hidden.includes(`s${spid}`)) result.hidden.push(`s${spid}`);
  }
  return result;
}
