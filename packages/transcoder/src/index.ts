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
import { mergeTiming } from './anim/inherited-timing';
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
import { previewSize, SlideImages, type RasterPool } from './preview/slide-images';
import { createPainter, type Painter } from './preview/paint';
import { slideNotes } from './model/notes';
import { propJson, type PropSlide } from './output/prop';
import { ZipReader } from './io/zip';

export type { InputSource, RandomAccessSource } from './io/source';
export type { WriteData, WriteFn } from './media/media';
export type { RasterPool } from './preview/slide-images';
export type { PaintJob, PaintResources, PaintResult, PaintSvg } from './preview/paint';
export { createPainter } from './preview/paint';
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
  /** 产物形式（见 output/）：single 自包含的 HTML（默认，旧名 html）；paged 按需加载；pages 按需加载并且每页一个 HTML；data 只输出 deck.json（调试用） */
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
  /**
   * 是否输出整页图 pic/{n}.jpg 和缩略图 thum/{n}.jpg（见 preview/），默认输出。
   * 不管出不出图，入口文件旁边都有 prop.json（页数、宽高、每页图片路径、备注、是否隐藏，SPEC F1）
   */
  images?: boolean;
  /** 出图用的 resvg WASM 文件字节（发布包里的 dist/resvg.wasm；命令行自动读取）。没给或加载失败时不出图并警告 */
  rasterWasm?: Uint8Array | Promise<Uint8Array | undefined>;
  /**
   * 并行出图执行器（可选，例如 Node 的 @unppt/unppt/node 里的 createRasterPool，命令行按 CPU 和内存自动创建）：
   * 给了时多页同时画，不需要 rasterWasm（执行器自己加载 resvg）；结果和本线程画的逐字节一致
   */
  rasterPool?: RasterPool;
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
    const face = lazyEmbeddedFont(() => pkg.zip.read(ef.part), ef.typeface, ef.bold, ef.italic, (reason) => pres.warn(`${reason ?? '嵌入的字体读不出来'}：${ef.typeface}`));
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
  // 整页图、缩略图（SPEC F1）。出图用的字体：嵌入字体的别名找回原来的字体，其它按名字找
  const aliasFace = (name: string) => [...usage].find(([, u]) => u.alias === name)?.[0];
  const size = previewSize(pres.width, pres.height);
  const wantImages = options.images !== false;
  const painter = wantImages ? options.rasterPool ?? await localPainter(options.rasterWasm, (m) => pres.warn(m)) : undefined;
  const images = painter
    ? new SlideImages(size, painter, (n, b, i) => aliasFace(n) ?? fonts.find(n, b, i), (h) => media.bytes(h), options.write, (m) => pres.warn(m))
    : undefined;
  // 出图时页面引用的图片要能再读一次
  media.keep = !!images;
  const propSlides: PropSlide[] = [];
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
      if (!data) { pres.warn(`字体子集化失败，没有嵌入：${face.displayFamily}`); continue; }
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
      // 母版、版式上的动画排在幻灯片自己的前面（anim/inherited-timing.ts）
      const timing = mergeTiming([...(r.inheritedTiming ?? []), { timing: r.timing, prefix: '' }]);
      const anim = compileTiming(timing, uids, { width: pres.width, height: pres.height, colors: r.colors ?? { scheme: {}, map: {} }, sounds, groups: r.groups });
      for (const w of anim.warnings) pres.warn(w);
      count++;
      slideParts.push(ref.part);
      const advance = compileAdvance(r.transition);
      await images?.add(ref.index + 1, r.svg);
      propSlides.push({ note: await slideNotes(pkg, ref.part), hidden: !!r.hidden });
      yield {
        svg: r.svg, steps: anim.steps, auto: anim.auto, hidden: anim.hidden, transition: compileTransition(r.transition, sounds),
        ...(anim.triggers.length ? { triggers: anim.triggers } : {}), ...(anim.fullScreen.length ? { fullScreen: anim.fullScreen } : {}), ...(r.hidden ? { skip: true } : {}),
        ...(advance ? { advance } : {}),
      };
    }
    // 并行出图时等所有页画完、写完：画图的警告要进 report（产物形式在所有页之后才生成 meta）
    await images?.flush();
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
  await options.write('prop.json', propJson({ width: pres.width * 0.75, height: pres.height * 0.75, thumbWidth: size.thumbWidth, thumbHeight: size.thumbHeight, slides: propSlides }));
  return { slides: count, width: pres.width, height: pres.height, report };
}

/** 在本线程画：加载 resvg；没有或加载失败时不出图并警告 */
async function localPainter(wasm: ConvertOptions['rasterWasm'], warn: (m: string) => void): Promise<Painter | undefined> {
  const bytes = await Promise.resolve(wasm).catch(() => undefined);
  if (!bytes) { warn('没有 resvg.wasm，不输出整页图和缩略图（prop.json 照常输出）'); return undefined; }
  return createPainter(bytes).catch((e: Error) => { warn(`resvg 加载失败，不输出整页图和缩略图：${e.message}`); return undefined; });
}

async function readTitle(pkg: OpcPackage): Promise<string> {
  const core = await pkg.xml('docProps/core.xml', false);
  return core?.children.find((c) => c.name === 'dc:title')?.text.trim() ?? '';
}

export type { WriteData as OutputData };
