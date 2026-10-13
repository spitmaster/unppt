/**
 * 音视频的放映选项（都在时间线的媒体节点上）：跨幻灯片播放（numSld）、循环播放（repeatCount=indefinite）
 * 带到"播放"动作上；全屏播放（p:video fullScrn）、放映时隐藏（showWhenStopped="0"）记在页面上。
 * 只有触发器（单击视频播放）没有主序列的页也要处理
 */
import { attr, child, findAll, numAttr, type XEl } from '../io/xml';
import type { AnimAction } from '../../../format/src/index';

/** 编译结果里和媒体有关的部分 */
interface MediaTarget { auto: AnimAction[]; steps: AnimAction[][]; triggers: { steps: AnimAction[][] }[]; hidden: string[]; fullScreen: string[] }

export function applyMediaOptions(timing: XEl, existing: Set<string>, result: MediaTarget): void {
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
  // 全屏播放的视频
  for (const v of findAll(timing, 'p:video')) {
    if (attr(v, 'fullScrn') !== '1' && attr(v, 'fullScrn') !== 'true') continue;
    const spid = attr(findAll(v, 'p:spTgt')[0], 'spid');
    if (spid && existing.has(`s${spid}`) && !result.fullScreen.includes(`s${spid}`)) result.fullScreen.push(`s${spid}`);
  }
  // 放映时隐藏的音频/视频图标（showWhenStopped="0"）
  for (const node of findAll(timing, 'p:cMediaNode')) {
    if (attr(node, 'showWhenStopped') !== '0') continue;
    const spid = attr(findAll(node, 'p:spTgt')[0], 'spid');
    if (spid && existing.has(`s${spid}`) && !result.hidden.includes(`s${spid}`)) result.hidden.push(`s${spid}`);
  }
}
