/** 已注册的图表类型（新类型在这里加一行） */
import type { ChartType } from './chart-type';
import { barType } from './types/bar';
import { bubbleType } from './types/bubble';
import { areaType, lineType } from './types/line-area';
import { doughnutType, pieType } from './types/pie';
import { ofPieType } from './types/of-pie';
import { stockType } from './types/stock';
import { radarType } from './types/radar';
import { scatterType } from './types/scatter';

export const CHART_TYPES: readonly ChartType[] = [barType, lineType, areaType, pieType, doughnutType, scatterType, radarType, bubbleType, ofPieType, stockType];

/** 按 c:plotArea 下的元素名（不带前缀）找类型 */
export function chartTypeOfTag(tag: string): ChartType | undefined {
  return CHART_TYPES.find((t) => t.tags.includes(tag));
}

export function chartTypeOf(kind: string): ChartType | undefined {
  return CHART_TYPES.find((t) => t.kind === kind);
}
