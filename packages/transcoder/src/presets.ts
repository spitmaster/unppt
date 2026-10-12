/**
 * 预设形状：数据来自 ECMA-376 标准（presets-data.ts，由 tools/gen-presets.py 生成），这里负责解析。
 *
 * 语法：
 *   shape 名字
 *   av 调整值名 默认值
 *   gd 变量名 公式
 *   rect 左 上 右 下            （文字区域）
 *   path [w=数字] [h=数字] [fill=none] [stroke=0]
 *   M x y | L x y | A wR hR 起始角 扫过角 | C x1 y1 x2 y2 x y | Q x1 y1 x y | Z
 */
import type { GeomDef, GeomPath } from './geometry';
import { PRESET_SRC } from './presets-data';



/** 标准文件里缺失的定义（ECMA-376 的 presetShapeDefinitions.xml 漏了 upArrow，把 upDownArrow 重复了一次） */
const SUPPLEMENT = `
shape upArrow
av adj1 val 50000
av adj2 val 50000
gd maxAdj2 */ 100000 h ss
gd a1 pin 0 adj1 100000
gd a2 pin 0 adj2 maxAdj2
gd dy2 */ ss a2 100000
gd y2 +- t dy2 0
gd dx1 */ w a1 200000
gd x1 +- hc 0 dx1
gd x2 +- hc dx1 0
rect x1 y2 x2 b
path
M l y2
L hc t
L r y2
L x2 y2
L x2 b
L x1 b
L x1 y2
Z
`;

function parse(src: string): Map<string, GeomDef> {
  const out = new Map<string, GeomDef>();
  let cur: GeomDef | undefined;
  let path: GeomPath | undefined;
  for (const raw of src.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const [head, ...rest] = line.split(/\s+/);
    if (head === 'shape') {
      cur = { av: [], gd: [], paths: [] };
      out.set(rest[0], cur);
      path = undefined;
    } else if (!cur) {
      continue;
    } else if (head === 'av') {
      const f = rest.slice(1).join(' ');
      cur.av.push([rest[0], /^-?\d+$/.test(f) ? `val ${f}` : f]);
    } else if (head === 'rect') {
      cur.rect = [rest[0], rest[1], rest[2], rest[3]];
    } else if (head === 'gd') {
      cur.gd.push([rest[0], rest.slice(1).join(' ')]);
    } else if (head === 'path') {
      const kv = Object.fromEntries(rest.map((s) => s.split('=')));
      path = {
        w: kv.w ? Number(kv.w) : undefined, h: kv.h ? Number(kv.h) : undefined,
        fill: (kv.fill as GeomPath['fill']) ?? 'norm', stroke: kv.stroke !== '0', cmds: [],
      };
      cur.paths.push(path);
    } else if (path && 'MLACQZ'.includes(head)) {
      path.cmds.push({ op: head as GeomPath['cmds'][number]['op'], args: rest });
    }
  }
  return out;
}

export const PRESETS = parse(PRESET_SRC + SUPPLEMENT);
