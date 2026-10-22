/** 渲染一页时用到的外部环境（演示文稿、字体、媒体、字体嵌入） */
import type { FontLibrary } from '../font/font';
import type { MediaStore } from '../media/media';
import type { Presentation } from '../model/model';
import type { FontEmbedder } from '../text/text';
import type { TextEnv } from '../text/types';

export interface RenderEnv {
  pres: Presentation;
  fonts: FontLibrary;
  missingFonts: Set<string>;
  media: MediaStore;
  embed?: FontEmbedder;
  /** 字体检查：记录每个字用了什么字体（见 font/check.ts） */
  fontUse?: TextEnv['fontUse'];
}
