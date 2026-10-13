/**
 * 文字类强调效果（更改字体颜色、加粗、倾斜、下划线、加粗闪烁、样式强调……）：
 * p:set 在效果保持（fill="hold"）或时长是 indefinite 时一直保留，否则只在它的时间段里出现、之后恢复（实测写法）；
 * style.fontWeight 的离散关键帧（加粗闪烁）变成一段段临时样式
 */
import type { AnimTarget, TextStyleChange } from '../../../format/src/index';
import { colorIn, css, type ColorContext } from '../model/color';
import { attr, child, children, findAll, numAttr, path, type XEl } from '../io/xml';
import { delayOf } from './timing-util';

type Flash = NonNullable<AnimTarget['flash']>[number];

function styleOf(name: string, v: string): TextStyleChange | undefined {
  const on = v === 'true' || v === 'bold' || v === 'italic';
  if (name === 'style.fontWeight') return { bold: v === 'bold' };
  if (name === 'style.fontStyle') return { italic: v === 'italic' };
  if (name === 'style.textDecorationUnderline') return { underline: on };
  return undefined;
}

/** total：效果总时长（毫秒），用来把时间换成 0~1 */
export function textStyle(cTn: XEl | undefined, colors: ColorContext, total: number): Pick<AnimTarget, 'font' | 'flash' | 'color'> {
  const out: Pick<AnimTarget, 'font' | 'flash' | 'color'> = {};
  const hold = attr(cTn, 'fill') === 'hold';
  const frac = (ms: number) => (total > 0 ? Math.max(0, Math.min(1, ms / total)) : 1);
  const flashes: Flash[] = [];
  for (const st of findAll(cTn, 'p:set')) {
    const name = findAll(st, 'p:attrName')[0]?.text.trim() ?? '';
    const tn = path(st, 'p:cBhvr', 'p:cTn');
    const forever = hold || attr(tn, 'dur') === 'indefinite';
    const to = child(st, 'p:to');
    let change: (TextStyleChange & { color?: string }) | undefined;
    if (name === 'style.color') {
      const c = colorIn(child(to, 'p:clrVal') ?? to, colors);
      if (c) change = { color: css(c) };
    } else {
      const v = attr(child(to, 'p:strVal'), 'val');
      change = v === undefined ? undefined : styleOf(name, v);
    }
    if (!change) continue;
    if (forever) {
      if (change.color) out.color = change.color;
      else out.font = { ...out.font, ...change };
    } else {
      const d = delayOf(tn), dur = numAttr(tn, 'dur') ?? 0;
      flashes.push({ from: frac(d), to: frac(d + dur), ...change });
    }
  }
  // 加粗闪烁：style.fontWeight 的离散关键帧，bold 的那几段
  for (const a of findAll(cTn, 'p:anim')) {
    if (findAll(a, 'p:attrName')[0]?.text.trim() !== 'style.fontWeight') continue;
    const tn = path(a, 'p:cBhvr', 'p:cTn');
    const d = delayOf(tn), dur = numAttr(tn, 'dur') ?? 0;
    const tavs = children(child(a, 'p:tavLst'), 'p:tav');
    tavs.forEach((t, i) => {
      if (attr(path(t, 'p:val', 'p:strVal'), 'val') !== 'bold') return;
      const t0 = (numAttr(t, 'tm') ?? 0) / 100000, t1 = i + 1 < tavs.length ? (numAttr(tavs[i + 1], 'tm') ?? 100000) / 100000 : 1;
      flashes.push({ from: frac(d + dur * t0), to: frac(d + dur * t1), bold: true });
    });
  }
  if (flashes.length) out.flash = flashes;
  return out;
}
