/** 嵌入对象（OLE）：显示 PowerPoint 存的预览图 */
import { child, expandAlternate, findAll, type XEl } from '../../io/xml';
import { EMU_PER_PX } from '../../model/model';
import type { FrameHandler } from './frame-handler';

export const oleFrame: FrameHandler = {
  uri: '/ole',
  async render(gd, box, r, ctx, uid) {
    const ole = expandAlternate(gd.children).find((c) => c.name === 'p:oleObj');
    // 旧版（VML）写法的 Choice 里只有 p:embed，预览图在 Fallback 那份 oleObj 里
    const pic = child(ole, 'p:pic') ?? findAll(gd, 'p:oleObj').map((o) => child(o, 'p:pic')).find((p) => p);
    if (pic) {
      // OLE 的预览图：位置用外框；编号用外框的（动画指向外框），预览图自己的编号是 0
      const id = (c: XEl): XEl => ({ ...c, children: c.children.map((x) => x.name === 'p:cNvPr' && uid ? { ...x, attrs: { ...x.attrs, id: uid.slice(1) } } : x) });
      const clone: XEl = { ...pic, children: pic.children.map((c) => c.name === 'p:nvPicPr' ? id(c) : c.name === 'p:spPr' ? { ...c, children: [{ name: 'a:xfrm', attrs: {}, text: '', children: [{ name: 'a:off', attrs: { x: String(box.x * EMU_PER_PX), y: String(box.y * EMU_PER_PX) }, children: [], text: '' }, { name: 'a:ext', attrs: { cx: String(box.w * EMU_PER_PX), cy: String(box.h * EMU_PER_PX) }, children: [], text: '' }] }, ...c.children.filter((x) => x.name !== 'a:xfrm')] } : c) };
      return { svg: await r.picture(clone, ctx), positioned: true };
    }
    r.env.pres.warn('嵌入对象（OLE）暂未支持');
    return { svg: '', positioned: true };
  },
};
