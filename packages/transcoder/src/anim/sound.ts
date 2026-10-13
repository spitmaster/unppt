/** 动画和切换附带的声音（PowerPoint 的 p:sndTgt、p:snd）：按关系编号找到事先取好的媒体文件 */
import type { Sound } from '../../../format/src/index';
import { attr, child, findAll, path, type XEl } from '../io/xml';

/** 一段时间线或切换里用到的所有声音的关系编号（调用方据此把声音文件写进产物） */
export function soundRids(...els: (XEl | undefined)[]): string[] {
  const out = new Set<string>();
  for (const el of els) for (const t of [...findAll(el, 'p:sndTgt'), ...findAll(el, 'p:snd')]) {
    const rid = attr(t, 'r:embed');
    if (rid) out.add(rid);
  }
  return [...out];
}

/** 效果里的声音：p:audio 的目标是 p:sndTgt；节点重复到"indefinite"时循环 */
export function effectSound(cTn: XEl | undefined, sounds: Map<string, string> | undefined): Sound | undefined {
  if (!sounds) return undefined;
  for (const au of findAll(cTn, 'p:audio')) {
    const node = child(au, 'p:cMediaNode');
    const src = sounds.get(attr(path(node, 'p:tgtEl', 'p:sndTgt'), 'r:embed') ?? '');
    if (!src) continue;
    return attr(child(node, 'p:cTn'), 'repeatCount') === 'indefinite' ? { src, loop: true } : { src };
  }
  return undefined;
}

/** 切换的声音：p:sndAc 里 p:stSnd（loop="1" 时循环到下一个声音）或 p:endSnd（停止前一声音） */
export function transitionSound(tr: XEl | undefined, sounds: Map<string, string> | undefined): { sound?: Sound; stopSound?: true } {
  const ac = child(tr, 'p:sndAc');
  if (!ac) return {};
  if (child(ac, 'p:endSnd')) return { stopSound: true };
  const st = child(ac, 'p:stSnd');
  const src = sounds?.get(attr(child(st, 'p:snd'), 'r:embed') ?? '');
  if (!src) return {};
  const loop = attr(st, 'loop') === '1' || attr(st, 'loop') === 'true';
  return { sound: loop ? { src, loop: true } : { src } };
}
