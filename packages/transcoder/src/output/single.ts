/** single：一个自包含的 HTML（页面、图片、字体、播放器全部内联；大媒体文件放 media/） */
import { UNPPT_VERSION } from '../../../format/src/index';
import { base64 } from '../media/media';
import { htmlHead, jsonForHtml, type OutputForm, type OutputSource } from './output';

async function* html(src: OutputSource): AsyncGenerator<Uint8Array> {
  const enc = new TextEncoder();
  yield enc.encode(htmlHead(src.title, `unppt ${UNPPT_VERSION}`));
  for await (const s of src.slides()) {
    // 这一页新用到的共享图片先写出去，然后才是页面本身
    for (const a of src.takeAssets()) {
      yield enc.encode(`<script type="application/json" class="unppt-asset" data-id="${a.id}">${jsonForHtml(a.uri)}</script>\n`);
    }
    yield enc.encode(`<script type="application/json" class="unppt-slide">${jsonForHtml(s)}</script>\n`);
  }
  for await (const f of src.fontFiles()) {
    yield enc.encode(`<script type="application/json" class="unppt-font" data-family="${f.font.family}">${jsonForHtml(base64(f.data))}</script>\n`);
  }
  yield enc.encode(`<script type="application/json" id="unppt-meta">${jsonForHtml(src.meta())}</script>\n<script>${src.player}</script></body></html>\n`);
}

export const singleForm: OutputForm = {
  name: 'single',
  inlineImages: true,
  thumbs: false,
  write: (src) => src.write(src.fileName, html(src)),
};
