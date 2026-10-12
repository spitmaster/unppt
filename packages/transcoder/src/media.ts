/**
 * 媒体（图片、视频、音频）：小文件内联成 data URI，大文件以数据流方式写到 media/ 目录。
 */
import type { OpcPackage } from './package';
import type { Presentation } from './model';

export type WriteData = Uint8Array | string | AsyncIterable<Uint8Array>;
export type WriteFn = (path: string, data: WriteData) => Promise<void>;

const MIME: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', jpe: 'image/jpeg', gif: 'image/gif', bmp: 'image/bmp',
  svg: 'image/svg+xml', webp: 'image/webp', ico: 'image/x-icon',
  mp4: 'video/mp4', m4v: 'video/mp4', webm: 'video/webm', ogv: 'video/ogg', mov: 'video/quicktime',
  mp3: 'audio/mpeg', m4a: 'audio/mp4', wav: 'audio/wav', ogg: 'audio/ogg', aac: 'audio/aac',
};

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

export class MediaStore {
  private hrefs = new Map<string, Promise<string | undefined>>();

  constructor(private pres: Presentation, private pkg: OpcPackage, private write: WriteFn, private inlineLimit: number) {}

  /** 关系 rid（在 part 里）指向的图片 -> href；浏览器不支持的格式返回 undefined */
  async image(part: string, rid: string): Promise<string | undefined> {
    const rel = await this.pkg.rel(part, rid);
    if (!rel || rel.external) return rel?.external ? rel.target : undefined;
    return this.href(rel.target, true);
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
    if (isImage && !BROWSER_IMAGES.has(ext)) {
      this.pres.warn(`不支持的图片格式：${ext}`);
      return undefined;
    }
    const mime = MIME[ext] ?? 'application/octet-stream';
    if (isImage && entry.size <= this.inlineLimit) {
      const bytes = await this.pkg.zip.read(target);
      return bytes ? `data:${mime};base64,${base64(bytes)}` : undefined;
    }
    const name = `media/${target.slice(target.lastIndexOf('/') + 1)}`;
    await this.write(name, this.pkg.zip.stream(entry));
    return name;
  }
}
