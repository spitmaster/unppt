/** 已注册的 graphicFrame 内容（按 uri 结尾匹配，先注册的先匹配） */
import { chartFrame } from './chart-frame';
import { diagramFrame } from './diagram-frame';
import type { FrameHandler } from './frame-handler';
import { oleFrame } from './ole-frame';
import { tableFrame } from './table-frame';

export const FRAME_HANDLERS: readonly FrameHandler[] = [tableFrame, diagramFrame, chartFrame, oleFrame];
