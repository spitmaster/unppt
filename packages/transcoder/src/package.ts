/**
 * OPC 包（pptx 的外层结构）：部件、关系、内容类型。
 */
import { ZipReader } from './zip';
import { attr, children, parseXml, type XEl } from './xml';

export interface Rel {
  id: string;
  type: string;
  target: string;      // 已解析成包内绝对路径（不带开头的 /），外部链接保持原样
  external: boolean;
}

export function relType(type: string): string {
  return type.slice(type.lastIndexOf('/') + 1);
}

export function dirname(p: string): string {
  const i = p.lastIndexOf('/');
  return i < 0 ? '' : p.slice(0, i);
}

export function resolvePath(base: string, target: string): string {
  if (target.startsWith('/')) return target.slice(1);
  const parts = (base ? base.split('/') : []);
  for (const seg of target.split('/')) {
    if (seg === '..') parts.pop();
    else if (seg !== '.' && seg !== '') parts.push(seg);
  }
  return parts.join('/');
}

export class OpcPackage {
  private xmlCache = new Map<string, XEl | null>();
  private relCache = new Map<string, Rel[]>();
  contentTypes = new Map<string, string>();
  defaultTypes = new Map<string, string>();

  private constructor(public zip: ZipReader) {}

  static async open(zip: ZipReader): Promise<OpcPackage> {
    const pkg = new OpcPackage(zip);
    const ct = await pkg.xml('[Content_Types].xml');
    for (const c of children(ct)) {
      if (c.name.endsWith('Default')) pkg.defaultTypes.set((attr(c, 'Extension') ?? '').toLowerCase(), attr(c, 'ContentType') ?? '');
      else if (c.name.endsWith('Override')) pkg.contentTypes.set((attr(c, 'PartName') ?? '').replace(/^\//, '').toLowerCase(), attr(c, 'ContentType') ?? '');
    }
    return pkg;
  }

  contentType(part: string): string {
    return this.contentTypes.get(part.toLowerCase())
      ?? this.defaultTypes.get(part.slice(part.lastIndexOf('.') + 1).toLowerCase())
      ?? '';
  }

  /** 读取并解析 XML 部件。cache=false 时不缓存（逐页处理的幻灯片用完即丢，省内存） */
  async xml(part: string, cache = true): Promise<XEl | undefined> {
    if (cache && this.xmlCache.has(part)) return this.xmlCache.get(part) ?? undefined;
    const text = await this.zip.readText(part);
    const el = text === undefined ? null : parseXml(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
    if (cache) this.xmlCache.set(part, el);
    return el ?? undefined;
  }

  forget(part: string) {
    this.xmlCache.delete(part);
  }

  async rels(part: string): Promise<Rel[]> {
    const cached = this.relCache.get(part);
    if (cached) return cached;
    const dir = dirname(part);
    const relPart = `${dir ? dir + '/' : ''}_rels/${part.slice(dir ? dir.length + 1 : 0)}.rels`;
    const el = await this.xml(relPart, false);
    const out: Rel[] = children(el).map((r) => {
      const external = attr(r, 'TargetMode') === 'External';
      const target = attr(r, 'Target') ?? '';
      return {
        id: attr(r, 'Id') ?? '',
        type: relType(attr(r, 'Type') ?? ''),
        target: external ? target : resolvePath(dir, target),
        external,
      };
    });
    this.relCache.set(part, out);
    return out;
  }

  async rel(part: string, id: string): Promise<Rel | undefined> {
    return (await this.rels(part)).find((r) => r.id === id);
  }

  async relByType(part: string, type: string): Promise<Rel | undefined> {
    return (await this.rels(part)).find((r) => r.type === type);
  }
}
