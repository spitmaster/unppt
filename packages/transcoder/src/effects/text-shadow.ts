/** 文字的外阴影（整段文字一个 feDropShadow） */
import { colorIn, css, type ColorContext } from '../model/color';
import { n2, type SvgDoc } from '../common/svg';
import { child, numAttr, type XEl } from '../io/xml';
import { EMU_PER_PX } from '../model/model';

export function shadowFilter(effectLst: XEl | undefined, ctx: ColorContext, doc: SvgDoc): string | undefined {
  const sh = child(effectLst, 'a:outerShdw');
  if (!sh) return undefined;
  const c = colorIn(sh, ctx) ?? { r: 0, g: 0, b: 0, a: 0.4 };
  const blur = (numAttr(sh, 'blurRad') ?? 0) / EMU_PER_PX;
  const dist = (numAttr(sh, 'dist') ?? 0) / EMU_PER_PX;
  const dir = ((numAttr(sh, 'dir') ?? 0) / 60000) * Math.PI / 180;
  const id = doc.id('f');
  doc.addDef(`<filter id="${id}" x="-50%" y="-50%" width="200%" height="200%"><feDropShadow dx="${n2(Math.cos(dir) * dist)}" dy="${n2(Math.sin(dir) * dist)}" stdDeviation="${n2(blur / 2)}" flood-color="${css(c)}" flood-opacity="${n2(c.a)}"/></filter>`);
  return id;
}
