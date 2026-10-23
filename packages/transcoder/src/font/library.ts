/**
 * 字体库：按名字和粗细斜找字体（PPT 嵌入的、调用方指定的、默认字体包里的，按优先级 rank 挑；可变字体取实例），
 * 以及没有可用字体时只用来排版的字宽（WidthFace）。
 */
import type { FontFace, FontMetrics } from './font';
import { instanceWeight } from './fvar';
import { variableInstance } from './instance';

/** 只有字宽、没有字形的字体（默认字体包里没有显示字体的符号字体）：只用来排版，见 FontLibrary.widths */
export interface WidthFace {
  families: string[];
  bold: boolean;
  italic: boolean;
  load(): Promise<Pick<FontMetrics, 'advance'>>;
}

export class FontLibrary {
  private byFamily = new Map<string, FontFace[]>();
  private widthFaces = new Map<string, WidthFace[]>();
  /** 可变字体 -> 字重 -> 实例（同一个实例只做一次，嵌入、出图也认同一个字体） */
  private instances = new Map<FontFace, Map<number | undefined, FontFace>>();
  readonly missing = new Set<string>();

  addWidths(faces: WidthFace[]) {
    for (const f of faces) for (const fam of f.families) this.widthFaces.set(fam, [...this.widthFaces.get(fam) ?? [], f]);
  }

  /** 找不到可用字体时原字体的字宽（排版按它，字形用替代字体画） */
  widths(family: string, bold: boolean, italic: boolean): Promise<Pick<FontMetrics, 'advance'>> | undefined {
    const list = this.widthFaces.get(family.toLowerCase().trim());
    if (!list?.length) return undefined;
    const best = list.find((f) => f.bold === bold && f.italic === italic) ?? list.find((f) => !f.bold && !f.italic) ?? list[0];
    return best.load();
  }

  add(faces: FontFace[]) {
    for (const f of faces) {
      for (const fam of f.families) {
        const list = this.byFamily.get(fam) ?? [];
        list.push(f);
        this.byFamily.set(fam, list);
      }
    }
  }

  find(family: string, bold: boolean, italic: boolean): FontFace | undefined {
    const want = family.toLowerCase().trim();
    const all = this.byFamily.get(want)?.filter((f) => !f.unusable);
    if (!all?.length) return undefined;
    // 同名时只在优先级最高的一组里挑（PPT 嵌入的、调用方指定的字体压过默认字体包）
    const top = Math.min(...all.map((f) => f.rank ?? 0));
    const list = all.filter((f) => (f.rank ?? 0) === top);
    let best = list[0], bestScore = -1;
    for (const f of list) {
      // 可变字体按它能给的实例算（加粗时是 Bold 实例）
      const wght = f.axes ? instanceWeight(f.axes, bold) : undefined;
      const weight = wght ?? f.weight, fb = wght === undefined ? f.bold : wght >= 600;
      // 同分时选主名字（名字表里第一个家族名）就是要的这个的：要 Aptos 时选 Aptos，不选家族名里也有 Aptos 的 Aptos Display。
      // 要粗体时选字重最接近 700 的（同一家族的 SemiBold、Bold、Black 都算粗体，GDI 选 Bold）
      const w = bold ? 0.1 * (1 - Math.min(Math.abs(weight - 700), 500) / 500) : weight === 400 ? 0.1 : 0;
      const score = (fb === bold ? 2 : 0) + (f.italic === italic ? 1 : 0) + w + (f.families[0] === want ? 0.05 : 0);
      if (score > bestScore) { best = f; bestScore = score; }
    }
    return best.axes ? this.instance(best, all, bold) : best;
  }

  /**
   * 选中的是可变字体：同名、同字重、同样斜不斜的固定字重字体（任何优先级都行，例如 --system-fonts 时本机的 Noto Sans SC 可变字体
   * 和默认字体包里的思源黑体 Regular / Bold 是同一套字形，字宽逐字一致）有就用它，省得取实例；没有再取实例（instance.ts）。
   * 只有度量、字形是别的字体的（默认字体包里的原字体）不算。取实例失败过的不再返回
   */
  private instance(vf: FontFace, all: FontFace[], bold: boolean): FontFace | undefined {
    const wght = instanceWeight(vf.axes!, bold);
    const same = all.find((f) => !f.axes && !f.metricsOnly && f.italic === vf.italic && f.weight === (wght ?? vf.weight));
    if (same) return same;
    let byWeight = this.instances.get(vf);
    if (!byWeight) this.instances.set(vf, (byWeight = new Map()));
    let face = byWeight.get(wght);
    if (!face) byWeight.set(wght, (face = variableInstance(vf, wght)));
    return face.unusable ? undefined : face;
  }

  has(family: string): boolean {
    return !!this.byFamily.get(family.toLowerCase().trim())?.some((f) => !f.unusable);
  }
}
