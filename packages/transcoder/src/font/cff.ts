/**
 * CFF 字形轮廓（.otf 字体的 CFF 表，Type 2 字形程序）：艺术字变形要把文字变成可以弯曲的路径时用（TrueType 的见 glyf.ts）。
 * 支持普通 CFF 和 CID 字体（思源黑体、思源宋体是 CID 字体：每个字形按 FDSelect 找自己的私有字典和局部子程序）。
 * 三次曲线细分成折线点（都在线上），变形代码本来就把轮廓拆成小线段（text/warp.ts）。
 */
import type { RandomAccessSource } from '../io/source';
import type { Contour } from './glyf';

interface TableRec { offset: number; length: number; }

/** 一段三次曲线细分成几段折线 */
const CURVE_STEPS = 8;
/** 子程序最多嵌套几层（Type 2 规范上限 10） */
const MAX_DEPTH = 10;

interface Index { count: number; start: number[]; data: Uint8Array; }

function readIndex(b: Uint8Array, p: number): { index: Index; end: number } {
  const count = (b[p] << 8) | b[p + 1];
  if (count === 0) return { index: { count: 0, start: [0], data: b.subarray(0, 0) }, end: p + 2 };
  const offSize = b[p + 2];
  const offs: number[] = [];
  let q = p + 3;
  for (let i = 0; i <= count; i++) {
    let v = 0;
    for (let k = 0; k < offSize; k++) v = v * 256 + b[q + k];
    offs.push(v);
    q += offSize;
  }
  const base = q - 1;
  return { index: { count, start: offs, data: b.subarray(base + offs[0], base + offs[count]) }, end: base + offs[count] };
}

const item = (ix: Index, i: number) => ix.data.subarray(ix.start[i] - ix.start[0], ix.start[i + 1] - ix.start[0]);

/** 读 DICT：操作符 -> 操作数（两字节操作符记成 1200 + 第二字节） */
function readDict(b: Uint8Array): Map<number, number[]> {
  const out = new Map<number, number[]>();
  let ops: number[] = [];
  for (let p = 0; p < b.length;) {
    const v = b[p];
    if (v <= 21) {
      let op = v;
      p++;
      if (v === 12) { op = 1200 + b[p]; p++; }
      out.set(op, ops);
      ops = [];
    } else if (v === 28) { ops.push(((b[p + 1] << 24) >> 16) | b[p + 2]); p += 3; }
    else if (v === 29) { ops.push((b[p + 1] << 24) | (b[p + 2] << 16) | (b[p + 3] << 8) | b[p + 4]); p += 5; }
    else if (v === 30) {
      // 实数：半字节编码，变形只用到偏移量，读出来跳过即可
      let s = '';
      const nib = '0123456789.EE?-';
      p++;
      for (;;) {
        const x = b[p++];
        const hi = x >> 4, lo = x & 15;
        if (hi === 15) break;
        s += hi === 12 ? 'E-' : nib[hi];
        if (lo === 15) break;
        s += lo === 12 ? 'E-' : nib[lo];
      }
      ops.push(parseFloat(s) || 0);
    } else if (v >= 32 && v <= 246) { ops.push(v - 139); p++; }
    else if (v >= 247 && v <= 250) { ops.push((v - 247) * 256 + b[p + 1] + 108); p += 2; }
    else if (v >= 251 && v <= 254) { ops.push(-(v - 251) * 256 - b[p + 1] - 108); p += 2; }
    else p++;
  }
  return out;
}

const bias = (n: number) => (n < 1240 ? 107 : n < 33900 ? 1131 : 32768);

interface Fd { subrs: Index; }

export class CffOutlines {
  private parsed?: Promise<{ charStrings: Index; gsubrs: Index; fds: Fd[]; fdSelect: (gid: number) => number } | undefined>;
  private cache = new Map<number, Promise<Contour[]>>();

  constructor(private src: RandomAccessSource, private rec: TableRec, private upem: number) {}

  glyph(gid: number): Promise<Contour[]> {
    let p = this.cache.get(gid);
    if (!p) {
      p = this.load(gid).catch(() => []);
      this.cache.set(gid, p);
    }
    return p;
  }

  private parse() {
    return this.parsed ??= (async () => {
      const b = await this.src.read(this.rec.offset, this.rec.length);
      const hdrSize = b[2];
      const names = readIndex(b, hdrSize);
      const top = readIndex(b, names.end);
      const strings = readIndex(b, top.end);
      const gsubrs = readIndex(b, strings.end).index;
      const dict = readDict(item(top.index, 0));
      const csOff = dict.get(17)?.[0];
      if (csOff === undefined) return undefined;
      const charStrings = readIndex(b, csOff).index;
      const privOf = (d: Map<number, number[]>): Fd => {
        const pr = d.get(18);
        if (!pr) return { subrs: { count: 0, start: [0], data: b.subarray(0, 0) } };
        const [size, off] = pr;
        const pd = readDict(b.subarray(off, off + size));
        const so = pd.get(19)?.[0];
        return { subrs: so === undefined ? { count: 0, start: [0], data: b.subarray(0, 0) } : readIndex(b, off + so).index };
      };
      // CID 字体：FDArray（1236）和 FDSelect（1237）
      const fdArrOff = dict.get(1236)?.[0], fdSelOff = dict.get(1237)?.[0];
      if (fdArrOff !== undefined && fdSelOff !== undefined) {
        const arr = readIndex(b, fdArrOff).index;
        const fds = Array.from({ length: arr.count }, (_, i) => privOf(readDict(item(arr, i))));
        const fmt = b[fdSelOff];
        let fdSelect: (gid: number) => number;
        if (fmt === 0) fdSelect = (g) => b[fdSelOff + 1 + g];
        else {
          const n = (b[fdSelOff + 1] << 8) | b[fdSelOff + 2];
          fdSelect = (g) => {
            let fd = 0;
            for (let i = 0; i < n; i++) {
              const at = fdSelOff + 3 + i * 3;
              if (((b[at] << 8) | b[at + 1]) > g) break;
              fd = b[at + 2];
            }
            return fd;
          };
        }
        return { charStrings, gsubrs, fds, fdSelect };
      }
      return { charStrings, gsubrs, fds: [privOf(dict)], fdSelect: () => 0 };
    })();
  }

  private async load(gid: number): Promise<Contour[]> {
    const f = await this.parse();
    if (!f || gid >= f.charStrings.count) return [];
    const subrs = f.fds[f.fdSelect(gid)]?.subrs ?? f.fds[0].subrs;
    const s = 1 / this.upem;
    const contours: Contour[] = [];
    let cur: Contour | undefined;
    let x = 0, y = 0, stems = 0, haveWidth = false;
    const stack: number[] = [];
    const moveTo = (nx: number, ny: number) => {
      if (cur && cur.length > 1) contours.push(cur);
      x = nx; y = ny;
      cur = [{ x: x * s, y: y * s, on: true }];
    };
    const lineTo = (nx: number, ny: number) => {
      x = nx; y = ny;
      (cur ??= []).push({ x: x * s, y: y * s, on: true });
    };
    const curveTo = (x1: number, y1: number, x2: number, y2: number, x3: number, y3: number) => {
      const x0 = x, y0 = y;
      cur ??= [];
      for (let i = 1; i <= CURVE_STEPS; i++) {
        const t = i / CURVE_STEPS, u = 1 - t;
        const px = u * u * u * x0 + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x3;
        const py = u * u * u * y0 + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y3;
        cur.push({ x: px * s, y: py * s, on: true });
      }
      x = x3; y = y3;
    };
    // 第一个清栈的操作符前面多出来的那个数是字宽，丢掉：expectEven 是这个操作符本来的参数个数是不是偶数
    const takeWidth = (expectEven: boolean) => {
      if (!haveWidth && stack.length > 0 && (stack.length % 2 === 1) === expectEven) stack.shift();
      haveWidth = true;
    };
    const run = (code: Uint8Array, depth: number): boolean => {
      if (depth > MAX_DEPTH) return true;
      for (let p = 0; p < code.length;) {
        const v = code[p++];
        if (v >= 32 || v === 28) {
          if (v === 28) { stack.push(((code[p] << 24) >> 16) | code[p + 1]); p += 2; }
          else if (v <= 246) stack.push(v - 139);
          else if (v <= 250) stack.push((v - 247) * 256 + code[p++] + 108);
          else if (v <= 254) stack.push(-(v - 251) * 256 - code[p++] - 108);
          else { stack.push(((code[p] << 24) | (code[p + 1] << 16) | (code[p + 2] << 8) | code[p + 3]) / 65536); p += 4; }
          continue;
        }
        switch (v) {
          case 1: case 3: case 18: case 23: // hstem vstem hstemhm vstemhm
            takeWidth(true); stems += stack.length >> 1; stack.length = 0; break;
          case 19: case 20: // hintmask cntrmask：前面剩下的数是 vstem
            takeWidth(true); stems += stack.length >> 1; stack.length = 0; p += (stems + 7) >> 3; break;
          case 21: takeWidth(true); moveTo(x + stack[0], y + stack[1]); stack.length = 0; break;
          case 22: takeWidth(false); moveTo(x + stack[0], y); stack.length = 0; break;
          case 4: takeWidth(false); moveTo(x, y + stack[0]); stack.length = 0; break;
          case 5: for (let i = 0; i + 1 < stack.length; i += 2) lineTo(x + stack[i], y + stack[i + 1]); stack.length = 0; break;
          case 6: case 7: { // hlineto vlineto：交替水平、竖直
            let h = v === 6;
            for (const d of stack) { if (h) lineTo(x + d, y); else lineTo(x, y + d); h = !h; }
            stack.length = 0; break;
          }
          case 8: for (let i = 0; i + 5 < stack.length; i += 6) curveTo(x + stack[i], y + stack[i + 1], x + stack[i] + stack[i + 2], y + stack[i + 1] + stack[i + 3], x + stack[i] + stack[i + 2] + stack[i + 4], y + stack[i + 1] + stack[i + 3] + stack[i + 5]); stack.length = 0; break;
          case 24: { // rcurveline
            let i = 0;
            for (; i + 7 < stack.length; i += 6) curveTo(x + stack[i], y + stack[i + 1], x + stack[i] + stack[i + 2], y + stack[i + 1] + stack[i + 3], x + stack[i] + stack[i + 2] + stack[i + 4], y + stack[i + 1] + stack[i + 3] + stack[i + 5]);
            lineTo(x + stack[i], y + stack[i + 1]); stack.length = 0; break;
          }
          case 25: { // rlinecurve
            let i = 0;
            for (; i + 7 < stack.length; i += 2) lineTo(x + stack[i], y + stack[i + 1]);
            curveTo(x + stack[i], y + stack[i + 1], x + stack[i] + stack[i + 2], y + stack[i + 1] + stack[i + 3], x + stack[i] + stack[i + 2] + stack[i + 4], y + stack[i + 1] + stack[i + 3] + stack[i + 5]);
            stack.length = 0; break;
          }
          case 26: { // vvcurveto
            let i = 0, dx1 = 0;
            if (stack.length % 2) dx1 = stack[i++];
            for (; i + 3 < stack.length; i += 4) { const ax = x + dx1, ay = y + stack[i]; curveTo(ax, ay, ax + stack[i + 1], ay + stack[i + 2], ax + stack[i + 1], ay + stack[i + 2] + stack[i + 3]); dx1 = 0; }
            stack.length = 0; break;
          }
          case 27: { // hhcurveto
            let i = 0, dy1 = 0;
            if (stack.length % 2) dy1 = stack[i++];
            for (; i + 3 < stack.length; i += 4) { const ax = x + stack[i], ay = y + dy1; curveTo(ax, ay, ax + stack[i + 1], ay + stack[i + 2], ax + stack[i + 1] + stack[i + 3], ay + stack[i + 2]); dy1 = 0; }
            stack.length = 0; break;
          }
          case 30: case 31: { // vhcurveto hvcurveto：起点方向交替
            let h = v === 31;
            for (let i = 0; i + 3 < stack.length; i += 4) {
              const last = i + 8 > stack.length && stack.length - i === 5 ? stack[i + 4] : 0;
              if (h) { const ax = x + stack[i], ay = y; curveTo(ax, ay, ax + stack[i + 1], ay + stack[i + 2], ax + stack[i + 1] + last, ay + stack[i + 2] + stack[i + 3]); }
              else { const ax = x, ay = y + stack[i]; curveTo(ax, ay, ax + stack[i + 1], ay + stack[i + 2], ax + stack[i + 1] + stack[i + 3], ay + stack[i + 2] + last); }
              h = !h;
            }
            stack.length = 0; break;
          }
          case 10: case 29: { // callsubr callgsubr
            const ix = v === 10 ? subrs : f.gsubrs;
            const i = (stack.pop() ?? 0) + bias(ix.count);
            if (i >= 0 && i < ix.count && run(item(ix, i), depth + 1)) return true;
            break;
          }
          case 11: return false; // return
          case 14: takeWidth(true); if (cur && cur.length > 1) contours.push(cur); cur = undefined; return true; // endchar
          case 12: { // flex 系列：按两段曲线画
            const op = code[p++];
            const a = stack;
            if (op === 35) { curveTo(x + a[0], y + a[1], x + a[0] + a[2], y + a[1] + a[3], x + a[0] + a[2] + a[4], y + a[1] + a[3] + a[5]); curveTo(x + a[6], y + a[7], x + a[6] + a[8], y + a[7] + a[9], x + a[6] + a[8] + a[10], y + a[7] + a[9] + a[11]); }
            else if (op === 34) { const y0 = y; curveTo(x + a[0], y, x + a[0] + a[1], y + a[2], x + a[0] + a[1] + a[3], y + a[2]); curveTo(x + a[4], y, x + a[4] + a[5], y0, x + a[4] + a[5] + a[6], y0); }
            else if (op === 36) { const y0 = y; curveTo(x + a[0], y + a[1], x + a[0] + a[2], y + a[1] + a[3], x + a[0] + a[2] + a[4], y + a[1] + a[3]); curveTo(x + a[5], y, x + a[5] + a[6], y + a[7], x + a[5] + a[6] + a[8], y0); }
            else if (op === 37) {
              const sx = x, sy = y;
              const dx = a[0] + a[2] + a[4] + a[6] + a[8], dy = a[1] + a[3] + a[5] + a[7] + a[9];
              curveTo(x + a[0], y + a[1], x + a[0] + a[2], y + a[1] + a[3], x + a[0] + a[2] + a[4], y + a[1] + a[3] + a[5]);
              const x6 = Math.abs(dx) > Math.abs(dy) ? sx + dx + a[10] : sx + dx, y6 = Math.abs(dx) > Math.abs(dy) ? sy : sy + dy + a[10];
              curveTo(x + a[6], y + a[7], x + a[6] + a[8], y + a[7] + a[9], x6, y6);
            }
            stack.length = 0; break;
          }
          default: stack.length = 0;
        }
      }
      return false;
    };
    run(item(f.charStrings, gid), 0);
    if (cur && cur.length > 1) contours.push(cur);
    return contours;
  }
}
