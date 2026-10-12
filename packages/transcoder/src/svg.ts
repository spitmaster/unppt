/**
 * SVG 输出辅助：转义、defs 收集、唯一 ID。
 */

export function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export const n2 = (v: number) => (Math.round(v * 100) / 100).toString();

export class SvgDoc {
  private defs: string[] = [];
  private counter = 0;
  constructor(public prefix: string) {}

  id(kind: string): string {
    return `${this.prefix}${kind}${this.counter++}`;
  }

  addDef(xml: string) {
    this.defs.push(xml);
  }

  defsXml(): string {
    return this.defs.length ? `<defs>${this.defs.join('')}</defs>` : '';
  }
}
