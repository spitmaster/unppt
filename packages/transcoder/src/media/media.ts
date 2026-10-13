/**
 * 媒体（图片、视频、音频）：小文件内联成 data URI，大文件以数据流方式写到 media/ 目录。
 */
import type { OpcPackage } from '../io/package';
import type { Presentation } from '../model/model';
import { IMAGE_DECODERS } from './decoders';
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

/** 页面里引用共享图片的写法：unppt:asset/编号，播放器显示前替换成真正的数据 */
export const ASSET_PREFIX = 'unppt:asset/';

export class MediaStore {
  private hrefs = new Map<string, Promise<string | undefined>>();
  private nextAsset = 0;
  /** 新产生、还没写进输出的共享图片 */
  pending: { id: number; uri: string }[] = [];

  private decoders = new Map<string, ImageDecoder>();

  constructor(
    private pres: Presentation, private pkg: OpcPackage, private write: WriteFn, private inlineLimit: number,
    decoders: readonly ImageDecoder[] = IMAGE_DECODERS,
  ) {
    for (const d of decoders) for (const e of d.exts) this.decoders.set(e, d);
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
    if (png.length <= this.inlineLimit) {
      const id = this.nextAsset++;
      this.pending.push({ id, uri: `data:image/png;base64,${base64(png)}` });
      return `${ASSET_PREFIX}${id}`;
    }
    const base = target.slice(target.lastIndexOf('/') + 1).replace(/\.[^.]*$/, '');
    const hex = ((key.r << 16) | (key.g << 8) | key.b).toString(16).padStart(6, '0');
    const name = `media/${base}-key${hex}.png`;
    await this.write(name, png);
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
      // 浏览器不能直接显示的格式（EMF / WMF 等）：转换后存一份（同一张只转一次）
      const bytes = await this.pkg.zip.read(target);
      const img = bytes ? decoder.decode(bytes) : undefined;
      if (!img) { this.pres.warn(`${ext.toUpperCase()} 图片无法解析`); return undefined; }
      const id = this.nextAsset++;
      this.pending.push({ id, uri: `data:${img.mime};base64,${base64(img.data)}` });
      return `${ASSET_PREFIX}${id}`;
    }
    if (isImage && !BROWSER_IMAGES.has(ext)) {
      this.pres.warn(`不支持的图片格式：${ext}`);
      return undefined;
    }
    const mime = MIME[ext] ?? 'application/octet-stream';
    if (isImage && entry.size <= this.inlineLimit) {
      // 同一张图片只存一份（母版上的 logo、背景每页都会用到）
      const bytes = await this.pkg.zip.read(target);
      if (!bytes) return undefined;
      const id = this.nextAsset++;
      this.pending.push({ id, uri: `data:${mime};base64,${base64(bytes)}` });
      return `${ASSET_PREFIX}${id}`;
    }
    const name = `media/${target.slice(target.lastIndexOf('/') + 1)}`;
    await this.write(name, this.pkg.zip.stream(entry));
    return name;
  }
}
