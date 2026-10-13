/** 路径动画的运动路径 */

/** 运动路径（M/L/C/Z/E，可以是小写相对坐标）展平成点列，曲线每段取 12 个点，最多保留 64 个点 */
export function motionPoints(d: string, w: number, h: number): [number, number][] {
  // 命令字母里不含 e/E：E 是"路径结束"，也可能是科学计数法的指数（如 2.5E-6）
  const toks = d.match(/[a-df-zA-DF-Z]|-?\d*\.?\d+(?:[eE][-+]?\d+)?/g) ?? [];
  const pts: [number, number][] = [];
  let i = 0, cmd = 'M', cx = 0, cy = 0, sx = 0, sy = 0;
  const num = () => { const v = Number(toks[i++]); return Number.isFinite(v) ? v : 0; };
  while (i < toks.length) {
    if (/[a-zA-Z]/.test(toks[i])) cmd = toks[i++];
    const rel = cmd !== cmd.toUpperCase();
    const C = cmd.toUpperCase();
    if (C === 'M' || C === 'L') {
      let x = num(), y = num();
      if (rel) { x += cx; y += cy; }
      cx = x; cy = y;
      if (C === 'M') { sx = x; sy = y; cmd = rel ? 'l' : 'L'; }
      pts.push([x, y]);
    } else if (C === 'C') {
      const o = rel ? [cx, cy] : [0, 0];
      const x1 = num() + o[0], y1 = num() + o[1], x2 = num() + o[0], y2 = num() + o[1], x = num() + o[0], y = num() + o[1];
      for (let k = 1; k <= 12; k++) {
        const t = k / 12, u = 1 - t;
        pts.push([u * u * u * cx + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x, u * u * u * cy + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y]);
      }
      cx = x; cy = y;
    } else if (C === 'Z') {
      pts.push([sx, sy]);
      cx = sx; cy = sy;
      cmd = 'M';
    } else if (C === 'E') break;
    else i++;
  }
  const out: [number, number][] = [];
  for (const [x, y] of pts) {
    const q: [number, number] = [Math.round(x * w * 100) / 100, Math.round(y * h * 100) / 100];
    const last = out[out.length - 1];
    if (!last || last[0] !== q[0] || last[1] !== q[1]) out.push(q);
  }
  if (out.length <= 64) return out;
  const step = (out.length - 1) / 63;
  return Array.from({ length: 64 }, (_, k) => out[Math.round(k * step)]);
}
