/** 表格 */
import { child } from '../../io/xml';
import { renderTable } from '../table';
import type { FrameHandler } from './frame-handler';

export const tableFrame: FrameHandler = {
  uri: '/table',
  async render(gd, box, r, ctx) {
    return { svg: await renderTable(child(gd, 'a:tbl'), box, r, ctx) };
  },
};
