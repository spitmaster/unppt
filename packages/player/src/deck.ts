/** 演示数据：播放器看到的 deck 接口、格式检查、字体注册 */
import type { DeckSlide } from '../../format/src/index';
import { DECK_FORMAT, DECK_FORMAT_VERSION } from '../../format/src/index';

/** 播放器需要的演示数据：按需取某一页（大文件不必一次解析所有页） */
export interface DeckLike {
  slideParts?: string[];
  format: string;
  version: number;
  width: number;
  height: number;
  title?: string;
  slideCount: number;
  slide(i: number): DeckSlide;
  show?: { loop?: boolean; useTimings?: boolean };
}

export function checkFormat(meta: { format?: string; version?: number }) {
  if (meta.format !== DECK_FORMAT) throw new Error('不是 unppt 演示数据');
  if ((meta.version ?? 0) > DECK_FORMAT_VERSION) throw new Error(`演示数据版本 ${meta.version} 太新，请升级播放器`);
}

/** 注册嵌入的字体（文字位置在转码时已经算好，字体加载完成后浏览器会自动重绘，不需要重新排版） */
export function loadFonts(doc: Document, fonts: { family: string; weight?: string; style?: string; src: string }[]) {
  const FF = (doc.defaultView as unknown as { FontFace?: typeof FontFace }).FontFace;
  for (const f of fonts) {
    try {
      if (FF && doc.fonts) {
        const face = new FF(f.family, `url(${f.src})`, { weight: f.weight ?? 'normal', style: f.style ?? 'normal' });
        doc.fonts.add(face);
        face.load().catch(() => {});
      } else {
        const st = doc.createElement('style');
        st.textContent = `@font-face{font-family:'${f.family}';src:url(${f.src});font-weight:${f.weight ?? 'normal'};font-style:${f.style ?? 'normal'}}`;
        doc.head.appendChild(st);
      }
    } catch { /* 字体加载失败时用回退字体显示 */ }
  }
}
