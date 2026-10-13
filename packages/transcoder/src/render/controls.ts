/**
 * ActiveX 控件（p:cSld/p:controls，老课件里嵌 Flash 常用）：放映时显示控件保存的预览图，
 * 盖在幻灯片其它形状上面（实测：形状置顶也在控件下面）。
 * PowerPoint 2010+ 把预览图写成 p:control 里的 p:pic（在 mc:Fallback 里；Choice 里的控件只指向 VML 绘图，不画）
 */
import { children, findAll, type XEl } from '../io/xml';

export function controlPictures(controls: XEl | undefined): XEl[] {
  const pics: XEl[] = [];
  for (const c of children(controls)) {
    const pic = findAll(c, 'p:pic')[0];
    if (pic) pics.push(pic);
  }
  return pics;
}
