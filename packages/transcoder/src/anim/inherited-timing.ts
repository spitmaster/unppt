/**
 * 母版、版式上的动画：放映一页时 PowerPoint 先播母版的、再播版式的、最后是幻灯片自己的。
 * 这里把三棵时间树合成一棵：主序列（mainSeq）的各组按 母版 → 版式 → 幻灯片 的顺序拼起来，
 * 母版、版式里目标形状的编号加前缀 m / l（渲染时母版、版式形状的动画编号是 sm…、sl…，见 render.ts 的 uidOf）。
 * 触发器序列只取幻灯片自己的。
 */
import { attr, child, children, type XEl } from '../io/xml';

export interface TimingPart {
  timing: XEl | undefined;
  /** 目标形状编号的前缀：幻灯片自己的是空串，版式 l，母版 m */
  prefix: string;
}

/** 整棵树里 p:spTgt 的 spid 加前缀 */
function prefixed(el: XEl, prefix: string): XEl {
  const attrs = el.name === 'p:spTgt' && el.attrs.spid !== undefined ? { ...el.attrs, spid: prefix + el.attrs.spid } : el.attrs;
  return { ...el, attrs, children: el.children.map((c) => prefixed(c, prefix)) };
}

const mainSeqOf = (timing: XEl | undefined): XEl | undefined => {
  const root = child(child(child(timing, 'p:tnLst'), 'p:par'), 'p:cTn');
  return children(child(root, 'p:childTnLst'), 'p:seq').find((s) => attr(child(s, 'p:cTn'), 'nodeType') === 'mainSeq');
};

/** 主序列里的各组（p:par） */
const groupsOf = (timing: XEl | undefined): XEl[] => children(child(child(mainSeqOf(timing), 'p:cTn'), 'p:childTnLst'), 'p:par');

export function mergeTiming(parts: TimingPart[]): XEl | undefined {
  const own = parts.find((p) => p.prefix === '')?.timing;
  const inherited = parts.filter((p) => p.prefix !== '' && groupsOf(p.timing).length);
  if (!inherited.length) return own;
  const groups = [
    ...inherited.flatMap((p) => groupsOf(prefixed(p.timing!, p.prefix))),
    ...groupsOf(own),
  ];
  const ownMain = mainSeqOf(own);
  const mainCTn: XEl = { name: 'p:cTn', attrs: { id: '2', dur: 'indefinite', nodeType: 'mainSeq' }, text: '', children: [{ name: 'p:childTnLst', attrs: {}, text: '', children: groups }] };
  const main: XEl = ownMain
    ? { ...ownMain, children: ownMain.children.map((c) => (c.name === 'p:cTn' ? { ...c, children: c.children.map((cc) => (cc.name === 'p:childTnLst' ? { ...cc, children: groups } : cc)) } : c)) }
    : { name: 'p:seq', attrs: { concurrent: '1', nextAc: 'seek' }, text: '', children: [mainCTn] };
  // 幻灯片自己的其它序列（触发器）原样保留
  const ownRoot = child(child(child(own, 'p:tnLst'), 'p:par'), 'p:cTn');
  const others = children(child(ownRoot, 'p:childTnLst'), 'p:seq').filter((s) => attr(child(s, 'p:cTn'), 'nodeType') !== 'mainSeq');
  const root: XEl = { name: 'p:cTn', attrs: { id: '1', dur: 'indefinite', restart: 'never', nodeType: 'tmRoot' }, text: '', children: [{ name: 'p:childTnLst', attrs: {}, text: '', children: [main, ...others] }] };
  return { name: 'p:timing', attrs: {}, text: '', children: [{ name: 'p:tnLst', attrs: {}, text: '', children: [{ name: 'p:par', attrs: {}, text: '', children: [root] }] }] };
}
