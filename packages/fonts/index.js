// @unppt/fonts：字体文件在 files/，排版用的字体度量在 metrics/，显示对照规则在 map.json（SPEC D3）
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/** 字体包所在目录 */
export const fontPackDir = dirname(fileURLToPath(import.meta.url));
export const filesDir = join(fontPackDir, 'files');
export const metricsDir = join(fontPackDir, 'metrics');
