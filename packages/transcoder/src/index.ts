/**
 * unppt 转码器入口。
 *
 *   const result = await convert(pptxBytesOrSource, {
 *     write: async (path, data) => { ... },   // 输出文件交给调用方写
 *     fonts: [fontBytesOrSource, ...],         // 可选：字体文件
 *   });
 *
 * 纯函数：不读写磁盘、不联网。大文件请传 { size, read(offset, length) }，转码器只按需读取。
 */
import { DECK_FORMAT, DECK_FORMAT_VERSION, UNPPT_VERSION, type DeckReport, type DeckSlide } from '../../format/src/index';
import { compileTiming, compileTransition } from './anim';
import { FontLibrary, loadFontFile } from './font';
import { MediaStore, type WriteData, type WriteFn } from './media';
import { Presentation } from './model';
import { OpcPackage } from './package';
import { renderSlide } from './render';
import { toSource, type InputSource } from './source';
import { ZipReader } from './zip';

export type { InputSource, RandomAccessSource } from './source';
export type { WriteData, WriteFn } from './media';
export { UNPPT_VERSION };

declare const __UNPPT_PLAYER__: string;

export interface ConvertOptions {
  /** 输出文件的写入函数。路径是相对路径，例如 "index.html"、"media/video1.mp4" */
  write: WriteFn;
  /** 字体文件（ttf / otf / ttc） */
  fonts?: InputSource[];
  /** html：自包含的 HTML（默认）；data：只输出 deck.json，交给单独部署的播放器 */
  output?: 'html' | 'data';
  /** 输出文件名，默认 index.html 或 deck.json */
  fileName?: string;
  /** 小于这个字节数的图片内联进 HTML，默认 2MB；视频音频总是单独输出 */
  inlineLimit?: number;
  /** 每处理完一页回调一次 */
  onProgress?: (done: number, total: number) => void;
}

export interface ConvertResult {
  slides: number;
  width: number;
  height: number;
  report: DeckReport;
}

const LS = new RegExp(String.fromCharCode(0x2028), 'g');
const PS = new RegExp(String.fromCharCode(0x2029), 'g');
const jsonForHtml = (v: unknown) => JSON.stringify(v).replace(/</g, '\\u003c').replace(LS, '\\u2028').replace(PS, '\\u2029');

export async function convert(input: InputSource, options: ConvertOptions): Promise<ConvertResult> {
  const zip = await ZipReader.open(toSource(input));
  const pkg = await OpcPackage.open(zip);
  const pres = new Presentation(pkg);
  await pres.load();

  const fonts = new FontLibrary();
  for (const f of options.fonts ?? []) fonts.add(await loadFontFile(f));
  const missingFonts = new Set<string>();
  // 只输出演示数据时，图片一律写成单独文件（不在内存里攒）
  const inlineLimit = (options.output ?? 'html') === 'data' ? -1 : options.inlineLimit ?? 2 * 1024 * 1024;
  const media = new MediaStore(pres, pkg, options.write, inlineLimit);
  const env = { pres, fonts, missingFonts, media };
  const output = options.output ?? 'html';
  const fileName = options.fileName ?? (output === 'html' ? 'index.html' : 'deck.json');
  const title = await readTitle(pkg);

  let count = 0;
  const report: DeckReport = { missingFonts: [], warnings: [] };

  async function* slides(): AsyncGenerator<DeckSlide> {
    const total = pres.slides.length;
    let done = 0;
    for (const ref of pres.slides) {
      const r = await renderSlide(ref, env);
      done++;
      options.onProgress?.(done, total);
      if (r.hidden) continue;
      const uids = new Set<string>();
      for (const m of r.svg.matchAll(/data-uid="([^"]+)"/g)) uids.add(m[1]);
      const anim = compileTiming(r.timing, uids);
      for (const w of anim.warnings) pres.warn(w);
      count++;
      yield { svg: r.svg, steps: anim.steps, auto: anim.auto, hidden: anim.hidden, transition: compileTransition(r.transition) };
    }
  }

  const finishReport = () => {
    report.missingFonts = [...missingFonts].filter((f) => f && !fonts.has(f)).sort();
    report.warnings = [...pres.warnings].map(([m, n]) => (n > 1 ? `${m}（${n} 处）` : m));
  };
  const meta = () => ({
    format: DECK_FORMAT, version: DECK_FORMAT_VERSION, generator: `unppt ${UNPPT_VERSION}`,
    width: pres.width, height: pres.height, title, fonts: [], report,
  });

  async function* html(): AsyncGenerator<Uint8Array> {
    const enc = new TextEncoder();
    yield enc.encode(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no"><meta name="generator" content="unppt ${UNPPT_VERSION}"><title>${escHtml(title || 'unppt')}</title></head><body><div id="unppt"></div>\n`);
    for await (const s of slides()) {
      // 这一页新用到的共享图片先写出去，然后才是页面本身
      for (const a of media.pending) {
        yield enc.encode(`<script type="application/json" class="unppt-asset" data-id="${a.id}">${jsonForHtml(a.uri)}</script>\n`);
      }
      media.pending = [];
      yield enc.encode(`<script type="application/json" class="unppt-slide">${jsonForHtml(s)}</script>\n`);
    }
    finishReport();
    yield enc.encode(`<script type="application/json" id="unppt-meta">${jsonForHtml(meta())}</script>\n<script>${__UNPPT_PLAYER__}</script></body></html>\n`);
  }

  async function* data(): AsyncGenerator<Uint8Array> {
    const enc = new TextEncoder();
    yield enc.encode(`{"slides":[`);
    let first = true;
    for await (const s of slides()) {
      yield enc.encode((first ? '' : ',') + JSON.stringify(s));
      first = false;
    }
    finishReport();
    const m = JSON.stringify(meta());
    yield enc.encode(`],${m.slice(1)}`);
  }

  await options.write(fileName, output === 'html' ? html() : data());
  return { slides: count, width: pres.width, height: pres.height, report };
}

function escHtml(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

async function readTitle(pkg: OpcPackage): Promise<string> {
  const core = await pkg.xml('docProps/core.xml', false);
  return core?.children.find((c) => c.name === 'dc:title')?.text.trim() ?? '';
}

export type { WriteData as OutputData };
