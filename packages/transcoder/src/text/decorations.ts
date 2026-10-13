/**
 * 文字装饰：荧光笔高亮、下划线（各种线型）、删除线（单 / 双）。
 * 全部自己画，不用浏览器的 text-decoration：Chrome 在 SVG 文字上不认 text-underline-offset，
 * 各浏览器画出来的位置和粗细也不一样。规则按 PowerPoint 实测（SPEC 第 7 节）：
 * - 高亮覆盖字体的上伸到下伸（winAscent ~ winDescent）；
 * - 下划线中心在基线下约 0.15 倍字号；单线粗约字号 / 16，粗线约字号 / 10.7，双线每条约字号 / 32；
 * - 删除线中心在字体 OS/2 表记录的位置，粗约字号 / 16；双删除线两条线间隔一个线宽。
 */
import { css, type Rgba } from '../model/color';
import { n2 } from '../common/svg';
import type { Atom, RunStyle } from './types';

const fillOf = (c: Rgba) => ` fill="${css(c)}"${c.a < 0.999 ? ` fill-opacity="${n2(c.a)}"` : ''}`;
const strokeOf = (c: Rgba) => ` stroke="${css(c)}"${c.a < 0.999 ? ` stroke-opacity="${n2(c.a)}"` : ''}`;
const px = (size: number, div: number) => Math.max(1, Math.round(size / div));

/** 一条水平线：线型 solid / dotted / dashed / wavy */
function hline(x: number, w: number, cy: number, t: number, kind: string, c: Rgba): string {
  if (kind === 'solid') return `<rect x="${n2(x)}" y="${n2(cy - t / 2)}" width="${n2(w)}" height="${t}"${fillOf(c)}/>`;
  if (kind === 'wavy') {
    // 波浪线：半个波长 2 倍线宽，振幅半个线宽
    const half = t * 2;
    let d = `M${n2(x)} ${n2(cy)}`;
    for (let i = 0, cx = x; cx < x + w - 0.01; i++, cx += half) {
      const nx = Math.min(x + w, cx + half);
      d += `Q${n2((cx + nx) / 2)} ${n2(cy + (i % 2 ? t : -t))} ${n2(nx)} ${n2(cy)}`;
    }
    return `<path d="${d}" fill="none"${strokeOf(c)} stroke-width="${t}"/>`;
  }
  const dash = kind === 'dotted' ? `${t} ${t}` : `${t * 4} ${t * 3}`;
  return `<line x1="${n2(x)}" y1="${n2(cy)}" x2="${n2(x + w)}" y2="${n2(cy)}"${strokeOf(c)} stroke-width="${t}" stroke-dasharray="${dash}"/>`;
}

/**
 * 一段同样式文字的装饰。x、w 是这段文字的横向范围，baseline 是基线（已含上下标偏移），size 是实际字号。
 * under 画在文字下面（高亮），over 画在文字上面（下划线、删除线）。
 */
export function decorate(seg: Atom[], s: RunStyle, x: number, w: number, baseline: number, size: number, under: string[], over: string[]) {
  if (s.highlight) {
    const asc = Math.max(...seg.map((q) => q.ascent)), desc = Math.max(...seg.map((q) => q.descent));
    under.push(`<rect x="${n2(x)}" y="${n2(baseline - asc)}" width="${n2(w)}" height="${n2(asc + desc)}"${fillOf(s.highlight)}/>`);
  }
  if (s.underline) {
    const u = s.uStyle ?? 'sng';
    const cy = baseline + size * 0.15;
    const kind = u.startsWith('wavy') ? 'wavy' : u.startsWith('dotted') ? 'dotted' : /^(dash|dotDash|dotDotDash)/.test(u) ? 'dashed' : 'solid';
    if (u === 'dbl' || u === 'wavyDbl') {
      const t = px(size, 32);
      for (const dy of [-t, t]) over.push(hline(x, w, cy + dy, t, kind, s.color));
    } else {
      over.push(hline(x, w, cy, px(size, /Heavy$|^heavy$/.test(u) ? 10.7 : 16), kind, s.color));
    }
  }
  if (s.strike) {
    const t = px(size, 16);
    const cy = baseline - seg[0].strikeY;
    if (s.dblStrike) for (const dy of [-t, t]) over.push(hline(x, w, cy + dy, t, 'solid', s.color));
    else over.push(hline(x, w, cy, t, 'solid', s.color));
  }
}
