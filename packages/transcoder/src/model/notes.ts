/**
 * 演讲者备注（SPEC F1 prop.json）：幻灯片关联的备注页（notesSlide）里正文占位符的文字。
 * 纯文本：段落之间、段内换行（a:br）都是 \n，首尾空白行去掉；怎么显示由使用方决定。
 */
import type { OpcPackage } from '../io/package';
import { attr, child, children, findAll, path, type XEl } from '../io/xml';

export async function slideNotes(pkg: OpcPackage, slidePart: string): Promise<string> {
  const rel = await pkg.relByType(slidePart, 'notesSlide');
  if (!rel || rel.external) return '';
  const tree = path(await pkg.xml(rel.target), 'p:cSld', 'p:spTree');
  const body = findAll(tree, 'p:sp').find((sp) => attr(path(sp, 'p:nvSpPr', 'p:nvPr', 'p:ph'), 'type') === 'body');
  const text = children(child(body, 'p:txBody'), 'a:p').map(paragraphText).join('\n').replace(/^(\s*\n)+|(\n\s*)+$/g, '');
  return text.trim() ? text : '';
}

function paragraphText(p: XEl): string {
  let s = '';
  for (const c of p.children) {
    if (c.name === 'a:r' || c.name === 'a:fld') s += child(c, 'a:t')?.text ?? '';
    else if (c.name === 'a:br') s += '\n';
  }
  return s;
}
