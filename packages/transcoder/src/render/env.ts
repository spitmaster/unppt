/** 渲染一页时用到的外部环境（演示文稿、字体、媒体、字体嵌入） */
import type { FontLibrary } from '../font/font';
import type { MediaStore } from '../media/media';
import type { Presentation } from '../model/model';
import type { FontEmbedder } from '../text/text';

export interface RenderEnv {
  pres: Presentation;
  fonts: FontLibrary;
  missingFonts: Set<string>;
  media: MediaStore;
  embed?: FontEmbedder;
}
