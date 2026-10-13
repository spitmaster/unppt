/** 已注册的图片解码器（新格式在这里加一行） */
import { emfDecoder } from './emf';
import type { ImageDecoder } from './image-decoder';
import { wmfDecoder } from './wmf';

export const IMAGE_DECODERS: readonly ImageDecoder[] = [emfDecoder, wmfDecoder];
