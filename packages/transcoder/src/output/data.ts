/** data：只输出演示数据 deck.json（开发调试用；字体、图片是旁边的单独文件） */
import type { OutputForm, OutputSource } from './output';

async function* json(src: OutputSource): AsyncGenerator<Uint8Array> {
  const enc = new TextEncoder();
  yield enc.encode(`{"slides":[`);
  let first = true;
  for await (const s of src.slides()) {
    yield enc.encode((first ? '' : ',') + JSON.stringify(s));
    first = false;
  }
  for await (const f of src.fontFiles()) {
    f.font.url = `fonts/${f.font.family}.woff`;
    await src.write(f.font.url, f.data);
  }
  const m = JSON.stringify(src.meta());
  yield enc.encode(`],${m.slice(1)}`);
}

export const dataForm: OutputForm = {
  name: 'data',
  inlineImages: false,
  thumbs: false,
  write: (src) => src.write(src.fileName, json(src)),
};
