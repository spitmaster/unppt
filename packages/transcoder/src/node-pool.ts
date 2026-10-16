/**
 * Node 的并行出图执行器（RasterPool，见 preview/slide-images.ts）：工作线程池，每个线程一份 resvg、libjpeg-turbo，
 * 用 preview/paint.ts 画（和本线程画逐字节一致）。线程数默认按 CPU 和可用内存自动定（autoWorkers），创建时先启动两个，
 * 排队的页多了再补到上限，出错退出的也按需补；空闲的线程不拦着进程退出。工作线程画一页时要的字体、图片、背景层 SVG 向主线程要（主线程的 PaintResources 回答），
 * 画完的 JPEG 转移回主线程。只在 Node 用（命令行、云函数）：转码器本身（index.ts）不创建线程。
 */
import { readFileSync } from 'node:fs';
import { availableParallelism, freemem } from 'node:os';
import { Worker } from 'node:worker_threads';
import type { PaintJob, PaintResources, PaintResult } from './preview/paint';
import type { RasterPool } from './preview/slide-images';

export interface NodeRasterPool extends RasterPool {
  /** 结束所有工作线程 */
  close(): Promise<void>;
}

/** 每个工作线程按这么多内存估算（实测 10/16：16 个线程时每个平均 130~150MB，画超大图片的页时更多，留出余量） */
const WORKER_BYTES = 400 * 1024 * 1024;

/** 自动定的线程数：CPU 数（容器里按 CPU 配额）和可用内存能容纳的线程数，取小的 */
export function autoWorkers(): number {
  return Math.max(1, Math.min(cpuLimit(), Math.floor(availableBytes() / WORKER_BYTES)));
}

function cpuLimit(): number {
  let n = availableParallelism();
  // Linux 容器的 CPU 配额（cgroup v2 的 cpu.max："配额 周期"；v1 的 cfs_quota_us / cfs_period_us）
  const read = (f: string) => { try { return readFileSync(f, 'utf8').trim(); } catch { return undefined; } };
  const v2 = read('/sys/fs/cgroup/cpu.max')?.split(/\s+/);
  const quota = v2 ? Number(v2[0]) : Number(read('/sys/fs/cgroup/cpu/cpu.cfs_quota_us'));
  const period = v2 ? Number(v2[1]) : Number(read('/sys/fs/cgroup/cpu/cpu.cfs_period_us'));
  if (quota > 0 && period > 0) n = Math.min(n, Math.max(1, Math.floor(quota / period)));
  return n;
}

function availableBytes(): number {
  // Node 20.13 起的 process.availableMemory() 已经扣掉容器（cgroup）的内存上限；更早的版本用系统空闲内存
  const p = process as { availableMemory?: () => number };
  return p.availableMemory?.() ?? freemem();
}

interface Task { job: PaintJob; res: PaintResources; resolve: (r: PaintResult) => void }
interface Slot { worker: Worker; ready: boolean; task?: Task }

/**
 * wasm：resvg 的 .wasm 字节（命令行读 dist/resvg.wasm），只编译一次，所有线程共用；workers 默认 autoWorkers()。
 * 工作线程的脚本是和本文件放在一起的 raster-worker.js
 */
export async function createRasterPool(wasm: Uint8Array, workers = autoWorkers()): Promise<NodeRasterPool> {
  const module = await WebAssembly.compile(wasm as Uint8Array<ArrayBuffer>);
  const script = new URL('./raster-worker.js', import.meta.url);
  const slots: Slot[] = [];
  const queue: Task[] = [];
  let failures = 0;

  const fail = (t: Task, message: string) => t.resolve({ warnings: [`整页图画不出来：${message}`] });

  function spawn(): void {
    const slot: Slot = { worker: new Worker(script, { workerData: { wasm: module } }), ready: false };
    slots.push(slot);
    slot.worker.unref();
    slot.worker.on('message', (m: WorkerMessage) => onMessage(slot, m));
    slot.worker.on('error', (e: Error) => gone(slot, e.message));
    slot.worker.on('exit', (code) => gone(slot, `出图线程退出（${code}）`));
  }

  /** 线程出错或退出：手上的页记警告，之后按需换新线程 */
  function gone(slot: Slot, message: string) {
    const i = slots.indexOf(slot);
    if (i < 0) return;
    slots.splice(i, 1);
    if (!slot.ready) failures++;
    if (slot.task) fail(slot.task, message);
    pump();
  }

  function onMessage(slot: Slot, m: WorkerMessage) {
    if (m.type === 'ready') { slot.ready = true; failures = 0; pump(); return; }
    const t = slot.task;
    if (!t) return;
    if (m.type === 'need') {
      const r = t.res;
      const value: Promise<unknown> = m.kind === 'font' ? r.font(m.key) : m.kind === 'image' ? r.image(m.key) : r.template(m.key);
      value.catch(() => undefined).then((v) => slot.worker.postMessage({ type: 'res', req: m.req, value: share(v) }));
      return;
    }
    slot.task = undefined;
    slot.worker.unref();
    t.resolve(m.type === 'done' ? m.result : { warnings: [`整页图画不出来：${m.message}`] });
    pump();
  }

  /** 排队的页交给空闲线程；还有排队的就再启动线程（算上正在启动的，不超过上限）；连续启动失败 3 次后剩下的页都不画 */
  function pump() {
    for (const slot of slots) {
      if (!queue.length) return;
      if (!slot.ready || slot.task) continue;
      const t = queue.shift()!;
      slot.task = t;
      // 有活时拦着进程退出，空闲时不拦
      slot.worker.ref();
      slot.worker.postMessage({ type: 'job', job: t.job });
    }
    if (failures >= 3) {
      if (!slots.length) for (const t of queue.splice(0)) fail(t, '出图线程启动不了');
      return;
    }
    const starting = slots.filter((s) => !s.ready).length;
    for (let n = Math.min(queue.length - starting, workers - slots.length); n > 0; n--) spawn();
  }

  // 先启动两个（加载脚本、实例化 resvg 和主线程转码第一页同时进行），排队的页多了再补：只有一两页的课件不必启动一大堆
  for (let i = 0; i < Math.min(workers, 2); i++) spawn();
  return {
    size: workers,
    paint(job, res) {
      return new Promise((resolve) => {
        queue.push({ job, res, resolve });
        pump();
      });
    },
    async close() {
      const all = slots.splice(0);
      await Promise.all(all.map((s) => s.worker.terminate()));
    },
  };
}

type WorkerMessage =
  | { type: 'ready' }
  | { type: 'need'; req: number; kind: keyof PaintResources; key: string }
  | { type: 'done'; result: PaintResult }
  | { type: 'error'; message: string };

/** 发给线程的字节（字体、图片）放进共享内存：每个线程都要同一个字体文件时不必各复制一份；同一份字节只放一次 */
const shared = new WeakMap<Uint8Array, Uint8Array>();
function share(v: unknown): unknown {
  if (!(v instanceof Uint8Array) || v.buffer instanceof SharedArrayBuffer) return v;
  let s = shared.get(v);
  if (!s) {
    s = new Uint8Array(new SharedArrayBuffer(v.byteLength));
    s.set(v);
    shared.set(v, s);
  }
  return s;
}
