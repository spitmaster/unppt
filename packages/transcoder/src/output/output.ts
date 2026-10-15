/**
 * 产物形式的扩展点：转码主流程（index.ts）只负责逐页产出数据，怎么写成文件交给 OutputForm。
 * 新加一种形式 = 在 output/ 下新建一个文件 + forms.ts 里登记一行。
 */
import type { DeckFont, DeckSlide } from '../../../format/src/index';
import type { WriteFn } from '../media/media';

/** 演示数据里除了页面以外的部分（写在产物开头或结尾） */
export type DeckMeta = Record<string, unknown> & { fonts: DeckFont[] };

/** 写产物需要的东西 */
export interface OutputSource {
  /** 逐页产出（边转码边写，处理完一页就释放） */
  slides(): AsyncGenerator<DeckSlide>;
  /** 新产生、还没写出去的共享图片（只有内联图片的形式才会有） */
  takeAssets(): { id: number; uri: string }[];
  /** 所有页产出之后：用到的字体子集 */
  fontFiles(): AsyncGenerator<{ font: DeckFont; data: Uint8Array }>;
  /** 所有页和字体产出之后：元数据（含报告） */
  meta(): DeckMeta;
  title: string;
  /** 播放器脚本 */
  player: string;
  write: WriteFn;
  /** 主文件名（index.html / deck.json） */
  fileName: string;
}

export interface OutputForm {
  name: string;
  /** 小图片是否内联进主文件（否则一律写成 media/ 下的文件） */
  inlineImages: boolean;
  /** 默认是否输出缩略图文件夹 thumbs/ */
  thumbs: boolean;
  write(src: OutputSource): Promise<void>;
}

const LS = new RegExp(String.fromCharCode(0x2028), 'g');
const PS = new RegExp(String.fromCharCode(0x2029), 'g');
/** 能放进 <script> 里的 JSON（不会提前结束 script，也不含 JS 里不合法的行分隔符） */
export const jsonForHtml = (v: unknown) => JSON.stringify(v).replace(/</g, '\\u003c').replace(LS, '\\u2028').replace(PS, '\\u2029');

export function escHtml(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** HTML 开头（到播放器的挂载点为止） */
export function htmlHead(title: string, generator: string) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no"><meta name="generator" content="${generator}"><title>${escHtml(title || 'unppt')}</title></head><body><div id="unppt"></div>\n`;
}
