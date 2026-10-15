/**
 * paged：按需加载。入口 index.html 内嵌播放器和目录（DeckIndex），每页数据、字体是单独的脚本文件
 * （pages/<页号>.<哈希>.js、fonts/<别名>.<哈希>.js），图片、音视频在 media/。播放器只加载要看的那一页，
 * 看当前页时预加载下一页。用 <script> 加载，本地打开（file://）、任意域名托管、iframe 嵌入都能用。
 *
 * pages：在 paged 的基础上每页再输出一个独立的 HTML（page-001.html…，目录里只有这一页）。
 */
import { FONT_CALLBACK, PAGE_CALLBACK, UNPPT_VERSION, type DeckIndex } from '../../../format/src/index';
import { contentHash } from '../common/hash';
import { base64 } from '../media/media';
import { htmlHead, jsonForHtml, type OutputForm, type OutputSource } from './output';

const indexHtml = (src: OutputSource, index: DeckIndex) =>
  `${htmlHead(src.title, `unppt ${UNPPT_VERSION}`)}<script type="application/json" id="unppt-index">${jsonForHtml(index)}</script>\n<script>${src.player}</script></body></html>\n`;

async function writePaged(src: OutputSource, perPage: boolean) {
  const pages: DeckIndex['pages'] = [];
  let i = 0;
  for await (const s of src.slides()) {
    const json = jsonForHtml(s);
    const file = `pages/${i + 1}.${contentHash(json)}.js`;
    await src.write(file, `${PAGE_CALLBACK}(${i},${json});\n`);
    pages.push({ file, ...(s.skip ? { skip: true as const } : {}) });
    i++;
  }
  for await (const f of src.fontFiles()) {
    const b64 = base64(f.data);
    f.font.url = `fonts/${f.font.family}.${contentHash(b64)}.js`;
    await src.write(f.font.url, `${FONT_CALLBACK}(${JSON.stringify(f.font.family)},${JSON.stringify(b64)});\n`);
  }
  const meta = src.meta() as unknown as Omit<DeckIndex, 'pages'>;
  await src.write(src.fileName, indexHtml(src, { ...meta, pages }));
  if (!perPage) return;
  // 每页一个独立的 HTML：目录里只有这一页（站内跳转到别的页在单页里不起作用）
  for (let k = 0; k < pages.length; k++) {
    const part = meta.slideParts?.[k];
    await src.write(`page-${String(k + 1).padStart(3, '0')}.html`, indexHtml(src, { ...meta, pages: [{ file: pages[k].file }], ...(part ? { slideParts: [part] } : {}) }));
  }
}

export const pagedForm: OutputForm = { name: 'paged', inlineImages: false, thumbs: false, write: (src) => writePaged(src, false) };
export const pagesForm: OutputForm = { name: 'pages', inlineImages: false, thumbs: false, write: (src) => writePaged(src, true) };
