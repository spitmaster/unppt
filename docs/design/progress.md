# 转码进度设计方案

> 状态：草案。等产品负责人定了第 9 节的几个问题再动手。建议存为 `docs/design/progress.md`。

## 结论

- **转码器只加两样东西。**
  - `onProgress` 多一个第三个参数，带阶段、页数计数和 0~100 的百分比。
  - 多一个可选的取消参数 `signal`。
  - 转码器不计时、不节流、不开定时器。产物逐字节不变。
- **百分比按实测用时加权**，出图的权重最大。百分比只增不减，**只有所有文件都写完才到 100**。
- **剩余时间、节流、心跳由调用方算**（命令行、后端），用调用方自己的时钟。
- **后端推荐用"任务记录 + 网页每 1.5 秒查一次"。** 网页上分"上传""转换"两步显示。

---

## 1. 目标和不做的事

### 现在的问题（读代码得到）

- **进度提前到"满"。** `onProgress(done, total)` 只在每页转码完时调一次（index.ts:163）。整页图在线程池里同时画，进度比转码慢几页。全部页转完以后，还要等剩下的图画完（186 行 `images.flush()`），再做字体子集，最后写入口文件和 prop.json（199-200 行）。这一段完全没有回调。
- **实测例子（8 核）。** 78 页的课件，不出图 0.8 秒，出图 4.4 秒。按这个推算，现在约 2.7 秒就显示 78/78，之后 1.7 秒一动不动，用户会以为卡住了。4 份测速课件里，出图多花的时间占总用时 46%~82%。
- **不能取消**，也没法给一份课件设超时。
- **日志里乱。** 命令行不管输出到哪里都用 `\r` 刷新（cli.ts:178），重定向到日志文件时挤成一长行。

### 目标

1. 百分比如实：只增不减，到 100 就是真的全部写完了。
2. 能显示"第几页 / 共几页"和大致剩余时间。
3. 能取消、能设超时；convert 失败返回以后，转码器不再写任何文件。
4. 后端和网页有一套能照着做的写法；命令行在终端里、写到日志文件里都显示正常。

### 明确不做（以后真需要再加）

- **转码器里不做**：算剩余时间、计时、节流、开定时器、写进度文件。
- **页内进度和按字节的进度**：一页画到哪了、大视频拷了多少字节。拷大视频时进度会停在那一页。
- **慢页诊断**：哪一页慢、每页用时、最慢页排行。
- **进度里的警告**：进度事件不带警告，也不实时推送警告。警告照旧只在结束时的 `result.report` 里。
- **错误码体系**：先靠两条约定区分——"open 事件之前失败 = 文件本身的问题"，以及 `AbortError` / `TimeoutError`。
- **更细的取消**：打断正在画的那一页（resvg 画到一半停不下来）、给出图线程池（RasterPool）加取消。
- **取消以后的善后**：删半成品（调用方删）、断点续转。也不做多份课件的总进度和排队位次。
- **推送**：SSE / WebSocket。
- **后端服务代码**：只在使用说明里给参考写法；重试、认领这些策略归平台。
- **上传和转换合成一个百分比**：浏览器上传进度和服务端进度不合并。
- **命令行**：不做 Ctrl+C 优雅取消、按终端宽度截断、"已用时间"每秒走动。
- **pages 形式的每页 HTML**：不逐个计数，所以收尾段会在 99% 停一会。

---

## 2. 进度事件

### 2.1 类型

```ts
// packages/transcoder/src/progress.ts（新文件，入口层，约 50 行；index.ts 导出类型）
export type ConvertPhase =
  | 'open'    // 课件已打开，页数已知（还没加载字体、还没开始转页）
  | 'slides'  // 逐页转码；出图时整页图同时在画
  | 'images'  // 页都转完了，等最后几页的图画完、写完（不出图时没有这一段）
  | 'finish'  // 字体子集、写入口文件、每页 HTML（pages 形式）、prop.json
  | 'done';   // 全部写完，convert 马上返回

export interface ConvertProgress {
  phase: ConvertPhase;
  /** 0~100 的整数，只增不减；只有 done 是 100 */
  percent: number;
  /** 总页数（含隐藏页） */
  total: number;
  /** 已转码的页数 */
  slides: number;
  /** 整页图和缩略图已画完的页数（画失败的也算，原因照旧进 report）；按画完的先后计，不按页码 */
  images: number;
  /** 要出图的页数：出图时等于 total；images: false 或没有 resvg 时为 0。open 事件里还没定，是 0 */
  imagesTotal: number;
}
```

`ConvertOptions` 改一项、加一项：

```ts
/**
 * 进度。done = 完整做完的页数（出图时这一页的图也要画完才算；不出图时就是转完的页），total = 总页数；
 * p = 详细进度。每有变化调一次（约每页两次），转码器不节流、不计时。
 * 转完以 convert 返回为准；p.percent === 100 是最后一次回调。
 * 回调里不要抛错：抛了，convert 会在下一个检查点以这个错误失败。要停下请用 signal
 */
onProgress?: (done: number, total: number, p: ConvertProgress) => void;
/** 取消 / 超时：在页与页之间停下，convert 以 signal.reason 失败；失败返回以后不会再调用 write */
signal?: AbortSignal;
```

- `ConvertProgress` 是纯 JSON。可以直接发给浏览器主线程（postMessage）、写进 Redis，或原样返回给网页。
- 每次回调给一个新对象，调用方存起来的旧对象不会被后面的事件改掉。

### 2.2 什么时候发

| 时刻 | 代码位置 | 事件 |
|---|---|---|
| 演示文稿结构读完 | index.ts:87 `pres.load()` 之后 | `open`，percent 0，total 已知 |
| 开始逐页转码（出不出图这时已经定了） | 150 行 `slides()` 开头 | `slides`，imagesTotal 定下来 |
| 每页 renderSlide 之后 | 162-163 行，替换原来的 onProgress 调用 | slides + 1 |
| 每页图画完或画失败 | slide-images.ts：准备失败的 catch（56-59 行）；绘制结果出来时（63 行那个 `then`） | images + 1 |
| 所有页转完、flush 之前 | 186 行之前 | `images`（不出图时跳过） |
| 开始做字体子集；每做完一个字体 | 135 行循环开头；140 行 yield 之后 / 137 行 continue 之前 | `finish` |
| prop.json 写完 | 200 行之后、return 之前 | `done`，percent 100 |

- **回调次数。** 约为 2 × 页数 + 字体数 + 4，78 页约 160 次。
- **分层不变。** SlideImages 不依赖进度模块，构造时多接收一个 `{ onPainted?: () => void; signal?: AbortSignal }`，preview 层的依赖方向不变。RasterPool 接口不改，工作线程不用报进度。
- **产物形式（`output/*.ts`）不用改。** 四种形式都是先迭代完 `slides()`，再迭代完 `fontFiles()`，最后 `meta()`。
- **图按"画完"计数，不等它按页码写出。** 慢页只占一个绘制名额，后面的页照样在画，所以进度走得平滑。按写出计数的话，进度会停一段再跳一截。100% 之前图一定已经写完，因为 flush 在 `slides()` 的最后。

### 2.3 百分比

```
出图：  p = 20 × 转码页/总页 + 75 × 出图页/总页 + 收尾
不出图：p = 95 × 转码页/总页 + 收尾
收尾：  5 × 已做完的字体 / (要做的字体 + 1)     // +1 留给入口文件和 prop.json，所以收尾阶段最多到 99
percent = done ? 100 : min(99, floor(p))，再和上一次的值取大（只增不减）
总页数为 0 时，比例按 1 算
```

- **权重的依据**（代码里注明"实测"）：4 份测速课件（14~193 页，8 核 16 线程）里，出图多花的时间占 46%~82%，平均约 65%。另外转码最多比出图领先"2 × 线程数"页，大部分时间是被出图拖着走的。所以出图给 75，转码给 20，收尾先给 5。
- **公式中途不换，不会跳。** 出不出图在开始逐页转码前就定了（113-116 行）。
- **单线程画时权重不起作用。** 浏览器里、`--jobs 1`、1 核云函数上，转码和出图一页一页交替，百分比和时间基本成正比。
- **以后的校准。** 觉得不准时再调权重，调的时候只看汇总数字，不记单份课件。

用这组权重推算 78 页课件的进度（按实测总用时推算，不是实测的进度轨迹）：

| 时刻 | 发生的事 | 转码 / 出图页数 | 新方案显示 | 实际时间占比 | 现在显示 |
|---|---|---|---|---|---|
| 0.3 秒 | 线程池启动好，转码先跑出 32 页 | 32 / 0 | 8% | 7% | 32/78 |
| 2.7 秒 | 最后一页转完 | 78 / 46 | 64% | 61% | 78/78 |
| 4.3 秒 | 最后一张图画完 | 78 / 78 | 95% | 98% | 78/78 |
| 4.4 秒 | 字体、入口文件、prop.json 写完 | — | 100% | 100% | 78/78 |

### 2.4 剩余时间（调用方算）

转码器不算剩余时间，原因有两个：
- 调用方各有自己的起点：后端还要算上下载和上传。
- 一行就能算出来，不值得让转码器读时钟。

```
t1  = 收到第一个 phase 为 slides 的事件的时刻（不算打开文件、加载字体的时间）
eta = (now − t1) × (100 − percent) / percent      // percent ≥ 10 且 now − t1 ≥ 3 秒才算，否则不显示
```

显示规则：
- 不到 10 秒，写"马上就好"；
- 1 分钟以内，按 5 秒向上取整，比如"约 15 秒"；
- 再长就按分钟，比如"约 3 分钟"。

某一页特别慢时百分比不动、用时在涨，算出来的剩余时间会自己变长，不需要另外处理。

### 2.5 节流

- **转码器不节流。** 回调一次只是几次加法，1000 页约 2000 次，可以忽略。浏览器、云函数里也不会留下没清掉的定时器。
- **命令行**：终端里每 100 毫秒最多刷一次；不是终端时，只在换阶段、每过 10% 时打一行。
- **后端**：回调里只改内存里的值，由一个每秒一次的定时器写库，另外每 5 秒写一次心跳（见第 6 节）。
- 换阶段和 `done` 一定要显示 / 写入。

### 2.6 错误和警告

- **整份失败**（不是 pptx、老格式 .ppt、write 失败、取消、超时）：convert 以 Promise 失败返回，和现在一样，进度事件里没有这些信息。进度停在最后的百分比，永远到不了 100。
- **文件本身的问题。** 没收到 `open` 事件就失败，说明是文件本身打不开（不是 pptx、老 .ppt、加密、主部件损坏）。zip.ts、model.ts 现在抛的错误本来就是给用户看的中文，比如"老格式的 .ppt……请用 PowerPoint 另存为 .pptx"，后端可以直接显示。
  - 前提：调用方自己的读文件函数可靠，比如后端读的是本地临时文件。
  - 如果从远程按需读，调用方要自己给读失败的错误打上标记，免得被当成"文件坏了"。
- **取消和超时**：看 `e.name`。手动取消是 `AbortError`，`AbortSignal.timeout()` 是 `TimeoutError`。
- **单页失败**：和现在一样，输出空白页或这一页不出图，并记警告。失败的页也计数，所以只要没有整份失败，进度一定能走到 100。
- **警告**（缺字体、不支持的格式等）：照旧在结束时的 `result.report` 里。出图的警告本来就攒到 flush 时才按页码顺序记，这样 report 每次都一样。用时也不进 report。

---

## 3. 和现有 onProgress 的兼容

- **签名只多一个参数。** 旧的 `(d, t) => …` 写法照常编译、照常运行。
- **含义的变化。**
  1. `done` 从"转码完的页"改成"完整做完的页"（出图时连图也画完）。原注释写的就是"每处理完一页"，这样改正好修掉"早早显示 78/78"。
  2. 回调次数变多：开头会多一次 `(0, N)`，之后会出现连续相同的值，收尾阶段会重复 `(N, N)`。
  3. `done === total` 不再表示"全部完成"（以前也不表示，那时图还没画完）。转完以 convert 返回为准。
- **影响面很小。** 仓库里唯一的调用方是 cli.ts，没有测试用到它，包还是 0.0.1，所以不保留旧语义。这些变化写进 SPEC F1。
- **考虑过、没采用**：另加一个 `onStatus` 回调、旧的不动。同一件事会有两个入口。
- **产物不变。** 进度只通过回调给出，不写进产物，`node scripts/golden.mjs check` 必须逐字节一致。

---

## 4. 取消

### 检查点

每个检查点做的事：先看回调有没有抛过错，有就抛出来；再调 `signal?.throwIfAborted()`。包要求 Node ≥ 20.12，现代浏览器也都支持。

1. `pres.load()` 之后、字体加载之后（87、103 行）。
2. 每页开始前（153 行循环开头）。`SlideImages.add` 等到空位返回后就是下一页的开头，不用另加。
3. flush 之后（186 行）。
4. 每个字体子集之前（135 行循环里）。
5. 写 prop.json 之前（200 行）。
6. 视频、音频流式拷贝的每一块之间：media.ts:175 把 `zip.stream(entry)` 包一层逐块检查的生成器。几百 MB 的视频不用等拷完才停。

### 保证

- **已经取消的 signal：** 传进来时就已经 abort，立刻失败，不调用 write。
- **失败返回以后不再调用 write。** 调用方可以放心删临时目录或对象存储前缀。做法：
  - `slides()` 外面包一层 try/catch：任何错误都先 `await images.settle()`（等写出链走完，不抛错），再抛出去；
  - 写出链的每一步先看 `signal.aborted`，已取消就跳过写图，也不再等绘制结果。
  - 这顺带修掉了现在的一个问题：任何整份失败以后，都可能还有图在后台写。
- **抛出的就是 `signal.reason`。** 手动取消和超时一起用时，传 `AbortSignal.any([ac.signal, AbortSignal.timeout(ms)])`。
- **回调里抛的错不会丢。** 出图的回调发生在后台的 Promise 里，直接抛出去会变成没人接的异常，可能让进程崩掉。所以转码器先把错误记下来，在下一个检查点抛出：convert 照样会失败，和现在一致。

### 延迟

最多是下面三者之一：
- 转完正在转的那一页；
- `add` 等空位时，等一页画完；
- 视频再拷一块。

### 不做

- **不打断正在画的页。** 线程池里已经交出去的页（最多 2 × 线程数页）会画完然后丢掉，浪费约 1~2 秒 CPU。
- **取消时不要关线程池。** 关掉的池不能再用，共用这个池的其它转码会全部出不了图。
- **不删已写出的文件**，由调用方删。

---

## 5. 命令行怎么显示

终端里（stderr 是终端）只占一行，用 `\r…\x1b[K` 原地刷新，100 毫秒节流，换阶段立刻刷：

```
读取课件…
转码 52/78 页 · 出图 31/78 · 41% · 已用 1.8 秒 · 约剩 3 秒
等待出图 70/78 · 92% · 已用 3.9 秒 · 马上就好
收尾 · 97% · 已用 4.3 秒
完成：78 页，用时 4.4 秒 -> D:\out\deck.html        ← 先清掉进度行，再打这一行
```

- 不出图时没有"出图"那一段。用时超过 1 分钟写成"已用 1 分 12 秒"。
- **不是终端时**（重定向到文件、CI、被别的程序调用）：不用 `\r`，只在换阶段、每过 10% 时打一行，例如 `[unppt] 转码 20/78 页，出图 8/78，25%，已用 0.6 秒`。这也修掉了现在日志里挤成一长行的问题。
- `-q` 照旧，什么都不显示。
- `--progress json` 要等第 9 节问题 1 定下来：只有后端不是 Node、要以子进程方式调命令行时才做，约 10 行。
  - 标准输出每行一个 `ConvertProgress`，500 毫秒节流，换阶段和 done 必出；
  - 这个模式下不输出给人看的文字；失败时错误写到 stderr，退出码 1。
- 不改的：Ctrl+C 结束进程就是取消。

示意（cli.ts 现在约 200 行，加上这段不超过 300 行，不用拆文件）：

```ts
const tty = !!process.stderr.isTTY;
let last = 0, lastPhase = '', lastTenth = -1, t1 = 0;
const onProgress = quiet ? undefined : (_d: number, _t: number, p: ConvertProgress) => {
  const now = Date.now();
  if (p.phase === 'slides' && !t1) t1 = now;
  const changed = p.phase !== lastPhase, tenth = Math.floor(p.percent / 10);
  if (!changed && (tty ? now - last < 100 : tenth === lastTenth)) return;
  last = now; lastPhase = p.phase; lastTenth = tenth;
  const line = progressLine(p, now - t0, t1 ? now - t1 : 0);   // 按上面的格式拼一行，剩余时间按 2.4 节
  process.stderr.write(tty ? `\r${line}\x1b[K` : `[unppt] ${line}\n`);
};
```

---

## 6. 后端 / 云函数怎么把进度给网页

### 6.1 推荐做法：任务记录 + 轮询

```
浏览器 ──① 上传（浏览器自己的上传进度）──> 对象存储
   │ ② 建任务，拿到 jobId
   ├──> 业务后端 ──投递──> worker（云函数）：下载 → convert() → 并发上传 → 写终态
   │                           │ onProgress 只改内存里的值
   │                           ▼ 每秒最多写一次，另加 5 秒一次心跳（只在 state='running' 时写得进去）
   │                       任务记录（课件表加几列，或 Redis 一个键）
   └── ③ 每 1.5 秒 GET /api/convert-jobs/:id ──┘
```

- **为什么用轮询。**
  - 跑转码的云函数实例，和响应网页请求的实例不是同一个；
  - 任务只有几秒到一分钟，1.5 秒的延迟用户看不出来；
  - 刷新页面、换设备、后端多实例、小程序 web-view、网关和 CDN 都不用特殊处理。
- **为什么不用 SSE / WebSocket。** 要另加发布订阅、一个常驻的推送服务，还要处理断线重连。以后真要推送，也只是在同一条任务记录上加一个推送出口，worker 不用改。
- **不往产物目录写进度文件。** prop.json 是和直播服务的约定；产物目录走 CDN 会被缓存，而且是公开的。没有数据库时的退路：写到 `jobs/<id>/status.json`（不在产物目录里），每 2 秒最多一次，设置 `Cache-Control: no-store`。
- **在浏览器里直接转码（Web Worker）时**，回调里 `postMessage(p)` 给页面就行，不需要后端。

### 6.2 任务记录字段

```ts
/** 业务后端的转码任务（放在业务已有的存储里）；GET /api/convert-jobs/:id 原样返回 */
interface ConvertJob {
  id: string;
  state: 'queued' | 'running' | 'succeeded' | 'failed' | 'canceled';
  /** 整个任务做到哪一段，界面用来换文字 */
  stage?: 'download' | 'convert' | 'upload';
  /** 转码阶段（ConvertProgress.phase），stage 为 convert 时有 */
  phase?: ConvertPhase;
  /** 整个任务 0~100 的整数，只增不减 */
  percent: number;
  /** 完整做完的页 / 总页数（onProgress 的前两个参数） */
  pages?: { done: number; total: number };
  /** 预计还要多少秒；算不准时没有 */
  etaSeconds?: number;
  /** 毫秒时间戳；updatedAt 兼作心跳 */
  createdAt: number; startedAt?: number; updatedAt: number; finishedAt?: number;
  /** input：文件本身的问题，要重新上传；timeout：太复杂、超时；internal：系统问题，可以重试 */
  error?: { kind: 'input' | 'timeout' | 'internal'; message: string };
  /** 成功时：入口、prop.json 地址、页数、缺的字体、提示条数（明细只进日志） */
  result?: { entry: string; prop: string; slides: number; missingFonts: string[]; warnings: number };
}
```

### 6.3 整个任务的百分比：分段拼接

```
download 0~10，convert 10~90，upload 90~100
总进度 = 本段起点 + 本段长度 × 本段比例，再和上一次取大
download：已下载字节 / 总字节；convert：percent / 100；upload：已上传字节 / 产物总字节
```

- **10 / 80 / 10 是初始值**，上线后看一次真实耗时分布再调。
- **输出推荐先写本地临时目录，最后并发上传**（并发 8~16）。原因：转码器的 write 基本是写完一个再写下一个。如果直接逐个 PUT 到对象存储，几百个小文件串行上传会把转码拖慢，排队等写的图还会堆在内存里。
- **临时目录装不下大视频时**，让 write 遇到 `media/` 下的文件直接流式分片上传。
- **全部直接写对象存储时**，就没有上传段，convert 占 10~100。

### 6.4 参考写法（写进使用说明，不进产品代码）

```ts
const SEG = { download: [0, 10], convert: [10, 90], upload: [90, 100] } as const;
const eta = (pct: number, ms: number) =>
  pct < 10 || ms < 3000 ? undefined : Math.ceil((ms * (100 - pct)) / pct / 5000) * 5;

export async function runJob(job: { id: string; src: string }, pool: RasterPool) {
  const t0 = Date.now();
  const s: Partial<ConvertJob> & { percent: number } = { state: 'running', percent: 0, startedAt: t0 };
  const ac = new AbortController();
  const signal = AbortSignal.any([ac.signal, AbortSignal.timeout(SOFT_TIMEOUT_MS)]);
  const at = (stage: keyof typeof SEG, r: number) => {
    const [a, b] = SEG[stage];
    s.stage = stage;
    s.percent = Math.max(s.percent, Math.floor(a + (b - a) * r));
  };
  // 一个定时器管节流、心跳和发现取消：有变化就写，没变化每 5 秒也写一次。
  // 写入带条件 state='running'：写不进去说明任务被取消了（或已是终态），迟到的进度也盖不掉终态
  let sent = '', sentAt = 0;
  const tick = setInterval(() => {
    const now = Date.now(), key = `${s.stage}:${s.phase}:${s.percent}:${s.pages?.done}`;
    if (key === sent && now - sentAt < 5000) return;
    sent = key; sentAt = now;
    s.etaSeconds = eta(s.percent, now - t0);
    store.update(job.id, { ...s, updatedAt: now }, { onlyIf: { state: 'running' } })
      .then((ok) => { if (!ok) ac.abort(); }, () => {});   // 存储一时出错：下一秒再写
  }, 1000);
  let opened = false;
  try {
    await download(job.src, TMP_IN, { signal, onProgress: (r) => at('download', r) });
    at('convert', 0);
    const r = await convert(fileSource(TMP_IN), {
      write: localWriter(TMP_OUT), fonts: FONTS, rasterPool: pool, signal,
      onProgress: (done, total, p) => { opened = true; s.phase = p.phase; s.pages = { done, total }; at('convert', p.percent / 100); },
    });
    await uploadDir(TMP_OUT, `courseware/${job.id}/`, { concurrency: 16, signal, onProgress: (x) => at('upload', x) });
    Object.assign(s, { state: 'succeeded', percent: 100, result: {
      entry: `courseware/${job.id}/index.html`, prop: `courseware/${job.id}/prop.json`,
      slides: r.slides, missingFonts: r.report.missingFonts, warnings: r.report.warnings.length } });
  } catch (e) {
    const err = e as Error;
    if (err.name === 'AbortError') s.state = 'canceled';
    else {
      s.state = 'failed';
      s.error = err.name === 'TimeoutError' ? { kind: 'timeout', message: '课件内容太复杂，转换超时' }
        : s.stage === 'convert' && !opened ? { kind: 'input', message: err.message }   // 文件本身打不开
        : { kind: 'internal', message: '转换失败，请稍后重试' };                        // 原始错误只进日志
    }
  } finally {
    clearInterval(tick);
    delete s.etaSeconds;
    s.finishedAt = s.updatedAt = Date.now();
    await store.update(job.id, s, { onlyIf: { state: ['running', 'canceled'] } });   // 终态一定要 await
    await cleanTmp();
  }
}
```

### 6.5 失败、超时、取消

| 情况 | 处理 |
|---|---|
| 收到 open 事件之前就失败 | `failed / input`，直接显示转码器的中文原因，不重试 |
| 软超时 | `failed / timeout`。软超时 = 平台硬超时 − 30 秒，留时间把终态写进去 |
| 用户取消 | 网页 `POST /cancel`，只在 queued / running 时能把 state 改成 canceled。worker 下一次进度写入失败 → abort，一般 5 秒加一页之内停下 |
| 其它异常 | `failed / internal`，原始错误进日志 |
| 进程被平台硬杀、机器重启 | 心跳停了。查询接口（或一个定时清理任务）发现 running 且 updatedAt 超过 **2 分钟**没变，就用条件更新改成 `failed / internal`。要不要自动重排由平台定 |

- **心跳超时取 2 分钟，不取更短。** 转页、出图前的准备、EMF/TIFF 解码都在主线程同步跑，这期间定时器发不出去。心跳超时必须大于最长的一段同步计算。
- **后端一律用线程池出图。** 1 核也建一个只有 1 个线程的池（`createRasterPool(wasm, 1)` 可以建），至少让画图不卡住主线程。
- **重复投递、认领、自动重试**都是平台的事，这里只提醒一句：worker 开始时用条件更新 `queued → running` 认领，认领失败就退出。

---

## 7. 前端进度条建议

- **分两步显示。** 先显示"上传中"，用浏览器自己的上传进度；再显示"转换中"，用任务记录里的进度。上传和转换的用时差别太大，硬拼成一条一定会跳。
- **怎么查。** 每 1.5 秒 GET 一次（标签页在后台时 5 秒一次），带 `cache: 'no-store'`；网络出错就接着查。
- **防倒退和补间。** 前端自己再对百分比取一次"上次和这次的较大值"，防止负载均衡读到旧记录时进度倒退。进度条用 CSS `transition: width .8s linear` 补间，每秒查一次看起来也是平滑的。
- **刷新页面或换设备时**，按课件或任务 id 查同一条记录，接着显示。

```ts
async function follow(id: string, show: (j: ConvertJob) => void) {
  let best = 0;
  for (;;) {
    const j: ConvertJob | undefined = await fetch(`/api/convert-jobs/${id}`, { cache: 'no-store' }).then((r) => r.json()).catch(() => undefined);
    if (j) {
      j.percent = best = Math.max(best, j.percent);
      show(j);
      if (j.state !== 'queued' && j.state !== 'running') return j;
    }
    await new Promise((r) => setTimeout(r, document.hidden ? 5000 : 1500));
  }
}
```

| 状态 | 用户看到的文字 | 进度条 |
|---|---|---|
| 上传中 | 正在上传 35%（12.3 / 35.0 MB） | 上传这一步自己的进度条 |
| queued，或 stage 为 download、phase 为 open | 正在准备… / 正在读取课件… | 来回走的动画，不显示 0% |
| phase 为 slides / images | 正在转换 第 31/78 页 · 约剩 15 秒 | 按 percent |
| phase 为 finish，或 stage 为 upload | 正在保存… | 按 percent |
| percent 15 秒没变、心跳正常 | 这一页内容比较复杂，还在处理… | 停住，不假装在动 |
| succeeded | 转换完成，共 78 页 | 走到 100%，0.3 秒后进入预览 |
| failed / input | 无法转换：{message}（例如 .ppt 要先用 PowerPoint 另存为 .pptx） | 红色，配"重新上传"按钮 |
| failed / timeout | 课件内容太复杂，转换超时 | 红色 |
| failed / internal | 转换失败，请稍后重试 | 红色，配"重试"按钮（用原文件重新建任务，不用重新上传） |
| canceled | 已取消 | — |

- 剩余时间按 2.4 节的规则显示，没有 `etaSeconds` 时不显示。
- 大部分课件几秒就转完，用户只会看到"正在转换"闪一下。进度条真正有用的是大课件和慢页，所以"慢的时候如实说"比百分比精确更重要。
- 有缺字体等提示时，要不要告诉老师、怎么说，由平台决定。转码器已经把信息放在 report 里了。

---

## 8. 实现步骤和测试方法

每一步单独提交。每步都跑 `npm run build`、`npm test`、`node scripts/golden.mjs check`（产物逐字节不变）。

1. **文档**（`docs:`）：SPEC F1 加"转码进度和取消"一条（第 2~4 节的要点），D2 的签名补上 `signal`；把本文存为 `docs/design/progress.md`。
2. **进度计算**（`feat:`）：新增 `src/progress.ts`，只负责计数和算百分比，不碰读写。
   - 新增 `test/progress.test.mjs`，测：只增不减；done 之前封顶 99，只有 done 是 100；出图 / 不出图两套权重；总页数为 0；回调抛错先记下、检查点再抛。
   - 同一个提交更新 `docs/architecture.md` 的图和表（入口层加 progress.ts）。`check-deps` 通过。
3. **接线**（`feat:`）：index.ts 在 2.2 节的时刻发事件；SlideImages 构造参数加 `{ onPainted, signal }`。
   - 在 convert.test.mjs（本线程画）和 raster-pool.test.mjs（线程池）里，用 testcases 里的一个多页用例，把每次 write 和每个事件按发生顺序记进同一个数组，测：
     - 阶段顺序是 open → slides → images → finish → done 的子序列（images 段不一定出现，不断言它出现）；
     - percent 只增不减；
     - 只有最后一个事件是 done / 100，而且在最后一次 write（prop.json）之后；
     - 出图时，第一个参数 done 等于 images；
     - `images: false` 时 imagesTotal 为 0，done 等于 slides。
4. **取消**（`feat:`）：加检查点、`settle()`、写出链跳过、视频逐块检查。测：
   - 传入已经 abort 的 signal：失败，0 次 write；
   - 在 `slides === 1` 的回调里 abort（本线程和线程池两种）：以 AbortError 失败；失败后再等 200 毫秒，write 次数不变；
   - `AbortSignal.abort(new DOMException('x', 'TimeoutError'))`：失败时 `e.name === 'TimeoutError'`；
   - 回调抛错：convert 以这个错误失败，进程里没有没人接的异常；
   - 用带视频的中性用例（没有就用 make.py 合成一个），在视频的 write 里 abort：以 AbortError 失败，不用拷完整个视频。
5. **命令行**（`feat:`）：按第 5 节显示。手动验证三种情况：Windows Terminal 里、`2> log.txt` 重定向、`-q`。
6. **（等问题 1 定了再做）** `--progress json`。
7. **使用说明**（`docs:`）：README 加 onProgress / signal 的用法；第 6、7 节的后端、前端参考写法放进使用说明，不进产品代码。

**工作量和分支。** 转码器加命令行约半天到一天。冲突面只在 index.ts 和 slide-images.ts，和正在进行的 1000 份课件验证优化互不影响，可以穿插提交（在 dev 上小步提交，或用 `git switch -c feat/convert-progress` 单拉一条，都行）。

---

## 9. 需要你定的（都有推荐选项）

1. **平台后端怎么调用转码？**
   - 推荐：后端用 Node，直接调用 `convert`，拿到的进度最全，也能取消。
   - 如果后端是 Java / Go 等，要以子进程方式起命令行，就加 `--progress json`（约 10 行）。
2. **网页怎么拿进度？**
   - 推荐：轮询任务记录（1.5 秒一次）。
   - 另外两种：走直播平台现有的 IM 信令推送，或 SSE。推荐 IM 只用来发"转换完成 / 失败"这种一次性通知，进度本身仍走轮询。
3. **取消按钮和超时上限。**
   - 推荐：转码器一定支持取消（改动小）。
   - 网页先不放单独的取消按钮：老师重新上传或删除课件时，后端自动取消旧任务。
   - 单份课件软超时先定 10 分钟（硬超时 10 分 30 秒），上线后按实际耗时分布再收紧。
4. **失败提示要不要分开？**
   - 推荐分三种：
     - "文件有问题"：附具体原因，比如 .ppt 要先另存为 .pptx，配"重新上传"；
     - "系统问题"：配"重试"；
     - "超时"：单独一句。
   - 靠"open 事件之前失败"的约定就能区分，不用加错误码。
