/**
 * resvg 内部出错（Rust panic）时找出是哪几处滤镜引起的：去掉这几处元素的滤镜（这些元素按没有效果画），能画出来就用这张。
 * 实测两种：光照滤镜（棱台效果）在某些形状、位置越界崩溃；滤镜范围落在画布右边两倍画布宽以外（画布外很远的元素带阴影，
 * 样本里一条伸出页面很长的图片胶片）。
 * 按"每处单独都会崩溃"找：去掉前 k 处能画出来的最小 k（最后一处会崩溃的是第 k 处），再找去掉第 j~k 处能画出来的最大 j
 * （第一处会崩溃的），去掉这一段的滤镜。两次二分，试画约 2·log2(滤镜数) 次；会崩溃的连在一起时（同一组伸到画布外的元素）正好，
 * 不连在一起时中间的也去掉了。
 */

const FILTER_REF = /\sfilter="url\(#([^)"]+)\)"/g;

/**
 * attempt：画一张 SVG，画不出来返回 undefined。返回能画出来的结果和去掉了滤镜的那几处引用的滤镜编号（按出现顺序，可能重复）；
 * 没有滤镜、或者去掉所有滤镜也画不出来（不是滤镜的问题）时返回 undefined
 */
export async function dropCrashingFilters<T>(svg: string, attempt: (svg: string) => Promise<T | undefined>): Promise<{ result: T; dropped: string[] } | undefined> {
  const ids = [...svg.matchAll(FILTER_REF)].map((m) => m[1]);
  if (!ids.length) return undefined;
  /** 去掉第 from~to 处（不含 to）的滤镜 */
  const without = (from: number, to: number) => {
    let k = 0;
    return svg.replace(FILTER_REF, (m) => (k++ >= from && k <= to ? '' : m));
  };
  let ok = await attempt(without(0, ids.length));
  if (ok === undefined) return undefined;
  // 去掉前 end 处能画出来的最小 end（ok 是去掉 [0, end) 画出来的）
  let a = 0, end = ids.length;
  while (a < end) {
    const mid = (a + end) >> 1;
    const r = await attempt(without(0, mid));
    if (r !== undefined) { end = mid; ok = r; } else a = mid + 1;
  }
  // 去掉 [start, end) 能画出来的最大 start（ok 是去掉 [start, end) 画出来的）
  let start = 0, b = end;
  while (start < b) {
    const mid = (start + b + 1) >> 1;
    const r = await attempt(without(mid, end));
    if (r !== undefined) { start = mid; ok = r; } else b = mid - 1;
  }
  return { result: ok, dropped: ids.slice(start, end) };
}

/** 用了光照（棱台效果的 feDiffuseLighting / feSpecularLighting）的滤镜编号 */
export function lightingFilters(svg: string): Set<string> {
  return new Set([...svg.matchAll(/<filter\b[^>]*\sid="([^"]+)"[^>]*>(?:(?!<\/filter>)[\s\S])*?<fe(?:Diffuse|Specular)Lighting\b/g)].map((m) => m[1]));
}
