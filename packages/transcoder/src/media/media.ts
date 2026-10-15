/**
 * 媒体（图片、视频、音频）：小文件内联成 data URI，大文件以数据流方式写到 media/ 目录。
 * 单独的文件名带内容校验码（ZIP 里记录的 CRC32）：重新发布后浏览器、CDN 的旧缓存不会串版本。
 */
import type { OpcPackage } from '../io/package';
import type { Presentation } from '../model/model';
import { IMAGE_DECODERS } from './decoders';
import { clearOrientation } from './exif-orientation';
import type { ImageDecoder } from './image-decoder';
import { imageInfo, type ImageInfo } from './image-info';
import { colorKey } from './color-key';
import type { Rgba } from '../model/color';

export type WriteData = Uint8Array | string | AsyncIterable<Uint8Array>;
export type WriteFn = (path: string, data: WriteData) => Promise<void>;

const MIME: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', jpe: 'image/jpeg', gif: 'image/gif', bmp: 'image/bmp',
  svg: 'image/svg+xml', webp: 'image/webp', ico: 'image/x-icon',
  mp4: 'video/mp4', m4v: 'video/mp4', webm: 'video/webm', ogv: 'video/ogg', mov: 'video/quicktime',
  mp3: 'audio/mpeg', m4a: 'audio/mp4', wav: 'audio/wav', ogg: 'audio/ogg', aac: 'audio/aac',
};

/** "设置透明色"要在原图上抠的图片，文件超过这个大小的不做（退回滤镜近似） */
const KEY_MAX_BYTES = 32 * 1024 * 1024;

const BROWSER_IMAGES = new Set(['png', 'jpg', 'jpeg', 'jpe', 'gif', 'bmp', 'svg', 'webp', 'ico']);

export function extOf(p: string): string {
  return p.slice(p.lastIndexOf('.') + 1).toLowerCase();
}

export function base64(bytes: Uint8Array): string {
  let s = '';
  const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) {
    s += String.fromCharCode.apply(null, bytes.subarray(i, i + CH) as unknown as number[]);
  }
  return btoa(s);
}

/** data URI -> 字节（只认 base64 写法） */
function dataBytes(uri: string): Uint8Array | undefined {
  const i = uri.indexOf(';base64,');
  if (i < 0) return undefined;
  const s = atob(uri.slice(i + 8));
  const b = new Uint8Array(s.length);
  for (let k = 0; k < s.length; k++) b[k] = s.charCodeAt(k);
  return b;
}

/** 单独输出的媒体文件名：media/原名[后缀].校验码.扩展名 */
function mediaName(target: string, crc: number, ext: string, suffix = ''): string {
  const base = target.slice(target.lastIndexOf('/') + 1).replace(/\.[^.]*$/, '');
  return `media/${base}${suffix}.${(crc >>> 0).toString(16).padStart(8, '0')}.${ext}`;
}

/** 页面里引用共享图片的写法：unppt:asset/编号，播放器显示前替换成真正的数据 */
export const ASSET_PREFIX = 'unppt:asset/';

export class MediaStore {
  private hrefs = new Map<string, Promise<string | undefined>>();
  private nextAsset = 0;
  /** 新产生、还没写进输出的共享图片 */
  pending: { id: number; uri: string }[] = [];
  /** 要出缩略图时：记住共享图片和写出去的图片文件，缩略图要再读一次（见 bytes） */
  keep = false;
  private kept = new Map<string, () => Promise<Uint8Array | undefined>>();

  private decoders = new Map<string, ImageDecoder>();

  constructor(
    private pres: Presentation, private pkg: OpcPackage, private write: WriteFn, private inlineLimit: number,
    decoders: readonly ImageDecoder[] = IMAGE_DECODERS,
  ) {
    for (const d of decoders) for (const e of d.exts) this.decoders.set(e, d);
  }

  /** 页面里图片地址（data URI、共享图片编号、media/ 下写出去的文件）-> 图片字节；缩略图用 */
  async bytes(href: string): Promise<Uint8Array | undefined> {
    if (href.startsWith('data:')) return dataBytes(href);
    return this.kept.get(href)?.();
  }

  /** 新产生一张共享图片（内联的 data URI），返回页面里引用它的写法 */
  private asset(uri: string): string {
    const id = this.nextAsset++;
    this.pending.push({ id, uri });
    if (this.keep) this.kept.set(`${ASSET_PREFIX}${id}`, async () => dataBytes(uri));
    return `${ASSET_PREFIX}${id}`;
  }

  /** 写出一个单独的图片文件；要出缩略图时记住怎么再读到它 */
  private async file(name: string, data: Uint8Array, reread?: () => Promise<Uint8Array | undefined>) {
    await this.write(name, data);
    if (this.keep) this.kept.set(name, reread ?? (async () => data));
  }

  /** 关系 rid（在 part 里）指向的图片 -> href；浏览器不支持的格式返回 undefined */
  async image(part: string, rid: string): Promise<string | undefined> {
    const rel = await this.pkg.rel(part, rid);
    if (!rel || rel.external) return rel?.external ? rel.target : undefined;
    return this.href(rel.target, true);
  }

  private infos = new Map<string, Promise<ImageInfo | undefined>>();

  /** 关系 rid 指向的图片的像素尺寸和分辨率（读文件头，同一张只读一次） */
  async info(part: string, rid: string): Promise<ImageInfo | undefined> {
    const rel = await this.pkg.rel(part, rid);
    if (!rel || rel.external) return undefined;
    let p = this.infos.get(rel.target);
    if (!p) {
      p = this.pkg.zip.read(rel.target).then((b) => (b ? imageInfo(b) : undefined));
      this.infos.set(rel.target, p);
    }
    return p;
  }

  /**
   * 关系 rid 指向的图片在原图上把 key 颜色抠成透明后的 href（"设置透明色"，见 color-key.ts）；
   * 不是 PNG / JPEG、文件太大或解不开时返回 undefined（调用方退回滤镜近似）
   */
  async keyed(part: string, rid: string, key: Rgba): Promise<string | undefined> {
    const rel = await this.pkg.rel(part, rid);
    if (!rel || rel.external) return undefined;
    const k = `${rel.target}#${key.r},${key.g},${key.b}`;
    let p = this.hrefs.get(k);
    if (!p) {
      p = this.makeKeyed(rel.target, key);
      this.hrefs.set(k, p);
    }
    return p;
  }

  private async makeKeyed(target: string, key: Rgba): Promise<string | undefined> {
    const entry = this.pkg.zip.entry(target);
    if (!entry || entry.size > KEY_MAX_BYTES) return undefined;
    const bytes = await this.pkg.zip.read(target);
    const png = bytes ? await colorKey(bytes, key) : undefined;
    if (!png) return undefined;
    if (png.length <= this.inlineLimit) return this.asset(`data:image/png;base64,${base64(png)}`);
    const hex = ((key.r << 16) | (key.g << 8) | key.b).toString(16).padStart(6, '0');
    const name = mediaName(target, entry.crc, 'png', `-key${hex}`);
    await this.file(name, png);
    return name;
  }

  /** 关系 rid 指向的视频/音频 -> href（总是写成单独文件，以免 HTML 过大） */
  async media(part: string, rid: string): Promise<string | undefined> {
    const rel = await this.pkg.rel(part, rid);
    if (!rel) return undefined;
    if (rel.external) return rel.target;
    return this.href(rel.target, false);
  }

  private href(target: string, isImage: boolean): Promise<string | undefined> {
    let p = this.hrefs.get(target);
    if (!p) {
      p = this.make(target, isImage);
      this.hrefs.set(target, p);
    }
    return p;
  }

  private async make(target: string, isImage: boolean): Promise<string | undefined> {
    const entry = this.pkg.zip.entry(target);
    if (!entry) return undefined;
    const ext = extOf(target);
    const decoder = isImage ? this.decoders.get(ext) : undefined;
    if (decoder) {
      // 浏览器不能直接显示的格式（EMF / WMF / TIFF 等）：转换后存一份（同一张只转一次）
      const bytes = await this.pkg.zip.read(target);
      const img = bytes ? await decoder.decode(bytes) : undefined;
      if (!img) { this.pres.warn(`${ext.toUpperCase()} 图片无法解析`); return undefined; }
      if (this.inlineLimit >= 0) return this.asset(`data:${img.mime};base64,${base64(img.data)}`);
      const name = mediaName(target, entry.crc, img.mime === 'image/svg+xml' ? 'svg' : img.mime.slice(6));
      await this.file(name, img.data);
      return name;
    }
    if (isImage && !BROWSER_IMAGES.has(ext)) {
      this.pres.warn(`不支持的图片格式：${ext}`);
      return undefined;
    }
    const mime = MIME[ext] ?? 'application/octet-stream';
    if (isImage && (ext === 'jpg' || ext === 'jpeg' || ext === 'jfif')) {
      // JPEG：去掉 EXIF 方向标记（PowerPoint 按原始像素画，浏览器默认会按标记再转一次，见 exif-orientation.ts）
      const raw = await this.pkg.zip.read(target);
      if (!raw) return undefined;
      const fixed = clearOrientation(raw);
      const bytes = fixed ?? raw;
      if (bytes.length <= this.inlineLimit) return this.asset(`data:${mime};base64,${base64(bytes)}`);
      const name = mediaName(target, entry.crc, ext);
      await this.file(name, bytes, async () => { const b = await this.pkg.zip.read(target); return b && (clearOrientation(b) ?? b); });
      return name;
    }
    if (isImage && entry.size <= this.inlineLimit) {
      // 同一张图片只存一份（母版上的 logo、背景每页都会用到）
      const bytes = await this.pkg.zip.read(target);
      if (!bytes) return undefined;
      return this.asset(`data:${mime};base64,${base64(bytes)}`);
    }
    const name = mediaName(target, entry.crc, ext);
    await this.write(name, this.pkg.zip.stream(entry));
    // 图片文件要出缩略图时从包里再读一次（不在内存里留着）
    if (this.keep && isImage) this.kept.set(name, () => this.pkg.zip.read(target));
    return name;
  }
}
