/**
 * 出图工作线程（node-pool.ts 启动）：收到一页的 PaintJob 用 preview/paint.ts 画，画的时候要的字体、图片、背景层 SVG
 * 发消息向主线程要，画完的 JPEG 转移回去。一次画一页。resvg 出错的次数多了（每次漏一点 WASM 栈）让主线程换掉这个线程。
 */
import { parentPort, workerData } from 'node:worker_threads';
import { createPainter, resvgCrashes, type PaintJob, type PaintResources } from './preview/paint';

const port = parentPort!;
/** resvg 出错这么多次以后换线程（实测 800 次以内不影响别的页） */
const RETIRE_AFTER = 100;
const painter = await createPainter(workerData.wasm as WebAssembly.Module);
const waiting = new Map<number, (v: never) => void>();
let next = 0;

function ask<T>(kind: keyof PaintResources, key: string): Promise<T> {
  return new Promise((resolve) => {
    const req = next++;
    waiting.set(req, resolve as (v: never) => void);
    port.postMessage({ type: 'need', req, kind, key });
  });
}

const resources: PaintResources = {
  font: (id) => ask('font', id),
  image: (href) => ask('image', href),
  template: (id) => ask('template', id),
  raster: (id) => ask('raster', id),
};

port.on('message', async (m: { type: 'res'; req: number; value: never } | { type: 'job'; job: PaintJob }) => {
  if (m.type === 'res') {
    waiting.get(m.req)?.(m.value);
    waiting.delete(m.req);
    return;
  }
  try {
    const result = await painter.paint(m.job, resources);
    const transfer = [result.pic, result.thum].flatMap((b) => (b ? [b.buffer as ArrayBuffer] : []));
    port.postMessage({ type: 'done', result, retire: resvgCrashes() >= RETIRE_AFTER }, transfer);
  } catch (e) {
    port.postMessage({ type: 'error', message: (e as Error).message });
  }
});
port.postMessage({ type: 'ready' });
