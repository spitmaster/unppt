/**
 * 绘图缓存和数据模型对不上（WPS 存的文件才有：缓存是改之前、甚至别的 SmartArt 的）。PowerPoint 打开时按数据模型重新排版，
 * 不看缓存；我们画缓存，就会画出旧的字、多出来的形状。两种情况：
 * - 数据模型里一个节点都没有，缓存里的形状又不是这个数据模型的（形状的 modelId 不在数据模型的点里）：PowerPoint 什么都不画；
 * - 数据模型里有字的节点，一个都没出现在缓存的文字里（空白不算；只看有没有交集，节点改过几个字的缓存仍然算对得上）：
 *   PowerPoint 画的是数据模型的字。
 * 实测（样本统计）：PowerPoint 存的文件缓存形状的 modelId 全部能在数据模型里找到，WPS 存的有约 10% 找不到
 */
import { attr, child, children, type XEl } from '../io/xml';
import { allNodes, nodeText, type DiagramData } from './data';

export type CacheState = 'ok' | 'noNodes' | 'staleText';

/** 缓存里所有的字（a:t） */
function cacheText(el: XEl | undefined, out: string[] = []): string[] {
  for (const c of el?.children ?? []) {
    if (c.name === 'a:t') out.push(c.text);
    else cacheText(c, out);
  }
  return out;
}

/** 缓存里有不属于这个数据模型的形状 */
function foreign(dataModel: XEl, drawing: XEl | undefined): boolean {
  const ids = new Set<string>();
  for (const p of children(child(dataModel, 'dgm:ptLst'), 'dgm:pt')) {
    const id = attr(p, 'modelId');
    if (id) ids.add(id);
  }
  const shapes: XEl[] = [];
  const walk = (el: XEl | undefined) => {
    for (const c of el?.children ?? []) {
      if (c.name === 'dsp:sp') shapes.push(c);
      else walk(c);
    }
  };
  walk(drawing);
  return shapes.some((s) => !ids.has(attr(s, 'modelId') ?? ''));
}

/** 绘图缓存（有形状的）和数据模型对不对得上 */
export function cacheState(dataModel: XEl, data: DiagramData, drawing: XEl | undefined): CacheState {
  const nodes = allNodes(data.root);
  if (!nodes.length) return foreign(dataModel, drawing) ? 'noNodes' : 'ok';
  const norm = (s: string) => s.replace(/\s+/g, '');
  const texts = nodes.map((n) => norm(nodeText(n))).filter((t) => t);
  if (!texts.length) return 'ok';
  const all = norm(cacheText(drawing).join(''));
  return texts.some((t) => all.includes(t)) ? 'ok' : 'staleText';
}
