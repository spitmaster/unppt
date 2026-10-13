/** 动画目标编号的拼法（渲染和动画编译两边一致；编号会写进 HTML 属性，只允许安全的字符） */

/** SmartArt 里一个形状的动画编号：框的编号 + d + modelId 的 32 位十六进制 */
export function dgmUid(uid: string, modelId: string | undefined): string | undefined {
  const hex = (modelId ?? '').replace(/[{}-]/g, '').toLowerCase();
  return /^[0-9a-f]{32}$/.test(hex) ? `${uid}d${hex}` : undefined;
}

/**
 * 图表里一部分的动画编号：框的编号 + c + 部分（背景 g0、g1……；数据点"系列x分类"；整条线"系列s"；数据标签再加 l）
 */
export const chartUid = (uid: string, key: string) => `${uid}c${key}`;

/**
 * "按系列""按类别"动画的一步对应哪些部分（a:chart 的 seriesIdx、categoryIdx、bldStep，实测）：
 * gridLegend 是背景；series 是整个系列；category 是各系列在这个分类上的点（整条线算在第一个分类）；
 * ptInSeries / ptInCategory 是单个点
 */
export function chartStepMatcher(uid: string, series: number, category: number, step: string): (u: string) => boolean {
  const pre = `${uid}c`;
  const at = (u: string) => (u.startsWith(pre) ? u.slice(pre.length) : undefined);
  return (u) => {
    const k = at(u);
    if (k === undefined) return false;
    if (step === 'gridLegend') return /^g\d+$/.test(k);
    const m = /^(\d+)(?:x(\d+)l?|s)$/.exec(k);
    if (!m) return false;
    const si = Number(m[1]), ci = m[2] === undefined ? -1 : Number(m[2]);
    if (step === 'series') return si === series;
    if (step === 'category') return ci === category || (ci === -1 && category === 0);
    if (step === 'ptInSeries' || step === 'ptInCategory') return si === series && (ci === category || (ci === -1 && category === 0));
    // allPts 等：全部数据部分
    return true;
  };
}
