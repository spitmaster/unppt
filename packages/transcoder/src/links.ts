/**
 * 超链接。
 */
import type { Rel } from './package';
import { esc } from './svg';
import { attr, type XEl } from './xml';

/**
 * 超链接 -> 属性：站内跳转写 data-link（next/prev/first/last/slide:部件路径），外部网址写 data-href。
 */
export function linkAttr(h: XEl | undefined, rels: Rel[]): string {
  if (!h) return '';
  const action = attr(h, 'action') ?? '';
  const rid = attr(h, 'r:id');
  if (action === 'ppaction://media') return ' data-link="media"';
  if (action.startsWith('ppaction://hlinkshowjump')) {
    const jump = /jump=(\w+)/.exec(action)?.[1] ?? '';
    const map: Record<string, string> = { nextslide: 'next', previousslide: 'prev', firstslide: 'first', lastslide: 'last', endshow: 'last', lastslideviewed: 'prev' };
    return map[jump] ? ` data-link="${map[jump]}"` : '';
  }
  const rel = rid ? rels.find((r) => r.id === rid) : undefined;
  if (!rel) return '';
  if (action === 'ppaction://hlinksldjump') return ` data-link="slide:${esc(rel.target)}"`;
  if (!action && rel.external && /^(https?:|mailto:|tel:)/i.test(rel.target)) return ` data-href="${esc(rel.target)}"`;
  return '';
}

