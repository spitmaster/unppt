/**
 * 已注册的形状效果。顺序就是滤镜原语的先后顺序：
 * 同一位置（under / over）的多层按这里的顺序叠放，先注册的在下面。
 */
import { glow } from './glow';
import { innerShadow } from './inner-shadow';
import { outerShadow } from './outer-shadow';
import type { ShapeEffect } from './shape-effect';
import { softEdge } from './soft-edge';

export const SHAPE_EFFECTS: readonly ShapeEffect[] = [softEdge, outerShadow, glow, innerShadow];
