/**
 * 可变字体（OpenType fvar 表）：有哪些轴、范围和默认值；PowerPoint 的常规、粗体用哪个字重的实例。
 * 可变字体不能直接用：它的字宽、字形、OS/2 字重都是默认实例的（Windows 自带的 Noto Sans SC 默认是 Thin），见 instance.ts
 */
import { be16, be32, tagOf } from './sfnt';

export interface VarAxis {
  tag: string;
  min: number;
  def: number;
  max: number;
}

/** fvar 表 -> 轴（16.16 定点数） */
export function parseAxes(t: Uint8Array): VarAxis[] {
  const fixed = (o: number) => { const v = be32(t, o); return (v >= 0x80000000 ? v - 0x100000000 : v) / 65536; };
  const at = be16(t, 4), count = be16(t, 8), size = be16(t, 10);
  const out: VarAxis[] = [];
  for (let i = 0; i < count; i++) {
    const a = at + i * size;
    if (a + 16 > t.length) break;
    out.push({ tag: tagOf(t, a), min: fixed(a + 4), def: fixed(a + 8), max: fixed(a + 12) });
  }
  return out;
}

/**
 * 常规、粗体用的实例的字重。实测（text-noto-weights，COM 量字宽）：本机装的可变字体 Noto Sans SC / Noto Serif SC，
 * 不加粗时 PowerPoint 用 Regular 实例（wght 400）、加粗时用 Bold 实例（700），字宽和对应的固定字重字体逐字一致，不用默认实例（Thin / ExtraLight）。
 * 字重轴够不到 600 的字体没有粗体实例：加粗也取常规的（再由人工加粗）；没有字重轴时返回 undefined（字重轴之外的轴都取默认值）
 */
export function instanceWeight(axes: VarAxis[], bold: boolean): number | undefined {
  const w = axes.find((a) => a.tag === 'wght');
  if (!w) return undefined;
  const clamp = (v: number) => Math.min(w.max, Math.max(w.min, v));
  return bold && clamp(700) >= 600 ? clamp(700) : clamp(400);
}
