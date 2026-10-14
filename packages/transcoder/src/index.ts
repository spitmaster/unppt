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
import { compileAdvance, compileTiming, compileTransition, soundRids } from './anim/anim';
import { lazyEmbeddedFont } from './font/eot';
import { FontLibrary, loadFontFile, type FontFace } from './font/font';
import { subsetFont } from './font/subset';
import type { DeckFont } from '../../format/src/index';
import { MediaStore, type WriteData, type WriteFn } from './media/media';
import { Presentation } from './model/model';
import { OpcPackage } from './io/package';
import { renderSlide } from './render/render';
import type { FontEmbedder } from './text/types';
import { toSource, type InputSource } from './io/source';
import { outputForm } from './output/forms';
import { ZipReader } from './io/zip';

export type { InputSource, RandomAccessSource } from './io/source';
export type { WriteData, WriteFn } from './media/media';
export { UNPPT_VERSION };

declare const __UNPPT_PLAYER__: string;

export interface ConvertOptions {
  /** 输出文件的写入函数。路径是相对路径，例如 "index.html"、"media/video1.mp4" */
  write: WriteFn;
  /** 字体文件（ttf / otf / ttc） */
  fonts?: InputSource[];
  /**
   * 观看端没有的字体（例如 Office 自带的私有字体、云字体）：排版用它，用到的字总是嵌入产物，
   * 不受 embedFonts 开关影响（否则浏览器显示时只能用别的字体，和排版对不上）
   */
  privateFonts?: InputSource[];
  /** 产物形式（见 output/）：single 自包含的 HTML（默认，旧名 html）；data 只输出 deck.json（调试用） */
  output?: string;
  /** 输出文件名，默认 index.html 或 deck.json */
  fileName?: string;
  /** 小于这个字节数的图片内联进 HTML，默认 2MB；视频音频总是单独输出 */
  inlineLimit?: number;
  /**
   * 把用到的字做成字体子集嵌入产物（默认关闭）。嵌入后观看端不需要安装字体，显示与转码时一致。
   * 注意：商业字体的分发需要相应授权。
   */
  embedFonts?: boolean;
  /** 每处理完一页回调一次 */
  onProgress?: (done: number, total: number) => void;
}

export interface ConvertResult {
  slides: number;
  width: number;
  height: number;
  report: DeckReport;
}

export async function convert(input: InputSource, options: ConvertOptions): Promise<ConvertResult> {
  const zip = await ZipReader.open(toSource(input));
  const pkg = await OpcPackage.open(zip);
  const pres = new Presentation(pkg);
  await pres.load();

  const fonts = new FontLibrary();
  // 演示文稿里嵌入的字体先加（同名时优先用它），并且总是嵌入产物：观看端多半没装这些字体（私有字体同样）
  const docFaces = new Set<FontFace>();
  for (const ef of pres.embeddedFonts) {
    // 用到才解压
    const face = lazyEmbeddedFont(() => pkg.zip.read(ef.part), ef.typeface, ef.bold, ef.italic, () => pres.warn(`嵌入的字体读不出来：${ef.typeface}`));
    docFaces.add(face);
    fonts.add([face]);
  }
  for (const f of options.fonts ?? []) fonts.add(await loadFontFile(f));
  for (const f of options.privateFonts ?? []) {
    const faces = await loadFontFile(f);
    for (const face of faces) docFaces.add(face);
    fonts.add(faces);
  }
  const missingFonts = new Set<string>();
  const form = outputForm(options.output);
  // 不内联图片的形式：图片一律写成单独文件（不在内存里攒）
  const inlineLimit = form.inlineImages ? options.inlineLimit ?? 2 * 1024 * 1024 : -1;
  const media = new MediaStore(pres, pkg, options.write, inlineLimit);
  // 字体嵌入：记录每个字体用到的字，每个字体一个唯一别名
  const usage = new Map<FontFace, { alias: string; cps: Set<number> }>();
  const entry = (face: FontFace) => {
    let u = usage.get(face);
    if (!u) { u = { alias: `unppt-f${usage.size}`, cps: new Set() }; usage.set(face, u); }
    return u;
  };
  const embeds = (face: FontFace) => options.embedFonts === true || docFaces.has(face);
  const embed: FontEmbedder = {
    use: (face, cp) => { if (embeds(face)) entry(face).cps.add(cp); },
    alias: (face) => (embeds(face) ? entry(face).alias : undefined),
  };
  const env = { pres, fonts, missingFonts, media, embed };
  const deckFonts: DeckFont[] = [];
  async function* fontFiles(): AsyncGenerator<{ font: DeckFont; data: Uint8Array }> {
    for (const [face, u] of usage) {
      const data = await subsetFont(face.source, face.offset, u.cps, u.alias);
      if (!data) { pres.warn(`字体暂不能嵌入（不是 TrueType 轮廓）：${face.displayFamily}`); continue; }
      const font: DeckFont = { family: u.alias, source: face.displayFamily, weight: face.bold ? 'bold' : 'normal', style: face.italic ? 'italic' : 'normal', format: 'woff' };
      deckFonts.push(font);
      yield { font, data };
    }
  }
  const fileName = options.fileName ?? (form.name === 'data' ? 'deck.json' : 'index.html');
  const title = await readTitle(pkg);

  let count = 0;
  const slideParts: string[] = [];
  const report: DeckReport = { missingFonts: [], warnings: [] };

  async function* slides(): AsyncGenerator<DeckSlide> {
    const total = pres.slides.length;
    let done = 0;
    for (const ref of pres.slides) {
      let r: Awaited<ReturnType<typeof renderSlide>>;
      try {
        r = await renderSlide(ref, env);
      } catch (e) {
        // 单页出错不影响整份文件：输出空白页并记录
        pres.warn(`第 ${ref.index + 1} 页渲染失败：${(e as Error).message}`);
        r = { svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${pres.width} ${pres.height}" width="${pres.width}" height="${pres.height}"><rect width="100%" height="100%" fill="#fff"/></svg>`, hidden: false };
      }
      done++;
      options.onProgress?.(done, total);
      const uids = new Set<string>();
      for (const m of r.svg.matchAll(/data-uid="([^"]+)"/g)) uids.add(m[1]);
      // 动画声音、切换声音写成媒体文件
      const sounds = new Map<string, string>();
      for (const rid of soundRids(r.timing, r.transition)) {
        const href = await media.media(ref.part, rid);
        if (href) sounds.set(rid, href);
      }
      const anim = compileTiming(r.timing, uids, { width: pres.width, height: pres.height, colors: r.colors ?? { scheme: {}, map: {} }, sounds, groups: r.groups });
      for (const w of anim.warnings) pres.warn(w);
      count++;
      slideParts.push(ref.part);
      const advance = compileAdvance(r.transition);
      yield {
        svg: r.svg, steps: anim.steps, auto: anim.auto, hidden: anim.hidden, transition: compileTransition(r.transition, sounds),
        ...(anim.triggers.length ? { triggers: anim.triggers } : {}), ...(anim.fullScreen.length ? { fullScreen: anim.fullScreen } : {}), ...(r.hidden ? { skip: true } : {}),
        ...(advance ? { advance } : {}),
      };
    }
  }

  const meta = () => {
    report.missingFonts = [...missingFonts].filter((f) => f && !fonts.has(f)).sort();
    report.warnings = [...pres.warnings].map(([m, n]) => (n > 1 ? `${m}（${n} 处）` : m));
    return {
      format: DECK_FORMAT, version: DECK_FORMAT_VERSION, generator: `unppt ${UNPPT_VERSION}`,
      width: pres.width, height: pres.height, title, fonts: deckFonts, report, slideParts, ...(pres.show ? { show: pres.show } : {}),
    };
  };
  const takeAssets = () => { const a = media.pending; media.pending = []; return a; };

  await form.write({ slides, takeAssets, fontFiles, meta, title, player: __UNPPT_PLAYER__, write: options.write, fileName });
  return { slides: count, width: pres.width, height: pres.height, report };
}

async function readTitle(pkg: OpcPackage): Promise<string> {
  const core = await pkg.xml('docProps/core.xml', false);
  return core?.children.find((c) => c.name === 'dc:title')?.text.trim() ?? '';
}

export type { WriteData as OutputData };
