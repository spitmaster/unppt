/**
 * 没嵌入 ICC 配置文件的 CMYK / YCCK JPEG 怎么换成 sRGB：PowerPoint 按 Windows 自带的 SWOP 配置文件（RSWOP.icm，感知意图）换算
 * （实测 pictures-cmyk：和按它换算平均差 1 级以内，和浏览器那样直接取反相乘差 23 级）。
 * 表是在 PowerPoint 里实测的 9×9×9×9 个油墨组合（每个通道 0、32、64 … 255）显示出来的 sRGB（tools/powerpoint/cmyk_lut.py
 * 生成 cmyk-default-data.ts），中间的按和 ICC 一样的插值（icc.ts lutConvert）。
 */
import { CMYK_DEFAULT } from './cmyk-default-data';
import { lutConvert, type CmykConvert } from './icc';

const GRID = 9;
let table: Float32Array | undefined;

/** 每次解一张图取一个（换算函数记着上一个像素，不能多张图共用） */
export function defaultCmyk(): CmykConvert {
  if (!table) {
    const s = atob(CMYK_DEFAULT);
    table = new Float32Array(s.length);
    for (let i = 0; i < s.length; i++) table[i] = s.charCodeAt(i) / 255;
  }
  return lutConvert({ inCurves: [undefined, undefined, undefined, undefined], grid: [GRID, GRID, GRID, GRID], clut: table, out: 3 }, (v, out, o) => {
    for (let i = 0; i < 3; i++) out[o + i] = Math.round(Math.min(1, Math.max(0, v[i])) * 255);
  });
}
