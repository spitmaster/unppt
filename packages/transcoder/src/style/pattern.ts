/**
 * 预设图案填充（a:pattFill）-> SVG <pattern>。点阵来自 PowerPoint 实测（patterns-data.ts，由 tools/gen-patterns.py 生成）：
 * 一个点 = 1 像素（96 DPI），从幻灯片左上角开始平铺。
 */
import { css, type Rgba } from '../model/color';
import { n2, type SvgDoc } from '../common/svg';
import { PATTERNS } from './patterns-data';

/** 每种图案按颜色只生成一份 */
const cacheKey = (prst: string, fg: Rgba, bg: Rgba, ox: number, oy: number) => `${prst}|${css(fg)}|${fg.a}|${css(bg)}|${bg.a}|${n2(ox)}|${n2(oy)}`;
const made = new WeakMap<SvgDoc, Map<string, string>>();

/** 点阵 -> 前景色的路径（每行连续的点合并成一段） */
function tilePath(hex: string): string {
  let d = '';
  for (let row = 0; row < 8; row++) {
    const bits = parseInt(hex.slice(row * 2, row * 2 + 2), 16);
    let col = 0;
    while (col < 8) {
      if (!(bits & (0x80 >> col))) { col++; continue; }
      const start = col;
      while (col < 8 && bits & (0x80 >> col)) col++;
      d += `M${start} ${row}h${col - start}v1h${start - col}z`;
    }
  }
  return d;
}

const paint = (attr: string, c: Rgba) => ` ${attr}="${css(c)}"${c.a < 0.999 ? ` ${attr}-opacity="${n2(c.a)}"` : ''}`;

/**
 * 返回 pattern 的 id；不认识的图案返回 undefined（调用方按前景、背景的混合色画）。
 * origin 是元素坐标系原点在幻灯片上的位置，用来让图案从幻灯片原点对齐。
 */
export function patternFill(doc: SvgDoc, prst: string, fg: Rgba, bg: Rgba, origin = { x: 0, y: 0 }): string | undefined {
  const hex = PATTERNS[prst];
  if (!hex) return undefined;
  const key = cacheKey(prst, fg, bg, origin.x, origin.y);
  let byDoc = made.get(doc);
  if (!byDoc) { byDoc = new Map(); made.set(doc, byDoc); }
  const hit = byDoc.get(key);
  if (hit) return hit;
  const id = doc.id('pt');
  doc.addDef(`<pattern id="${id}" patternUnits="userSpaceOnUse" x="${n2(-origin.x)}" y="${n2(-origin.y)}" width="8" height="8"><rect width="8" height="8"${paint('fill', bg)}/><path d="${tilePath(hex)}"${paint('fill', fg)} shape-rendering="crispEdges"/></pattern>`);
  byDoc.set(key, id);
  return id;
}
