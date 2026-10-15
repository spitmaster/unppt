# unppt

把 PowerPoint（.pptx）转成**一个自包含的 HTML 播放页**：双击就能播放，可以用 iframe 嵌入任意网页，也可以被外部页面或原生 App 控制翻页、播放动画。

- **转码器**：纯函数，不依赖外部程序和原生插件（整页图、缩略图用打包在内的 resvg WASM），字节进、文件出，可以直接放进云函数；1GB 级的大文件也能在小内存下转码。
- **安装**：`npm install @unppt/unppt`（命令行命令名是 `unppt`）（发布说明见 [docs/release.md](docs/release.md)）。
- **播放器**：零依赖，约 45KB（gzip 后约 16KB），内置在转码出来的 HTML 里；支持 Chrome、Firefox、移动端 WebView。
- **目标**：效果和 Microsoft PowerPoint 一致。开发时用本机 PowerPoint 的输出做自动比对评测。

> 当前版本 0.0.1，处于早期开发阶段。需求和设计见 [SPEC.md](SPEC.md)。

## 快速开始

```bash
npm install
npm run build
node packages/transcoder/dist/cli.js convert 演示文稿.pptx -o out/index.html --system-fonts
```

打开 `out/index.html` 即可播放：点击、方向键、空格、触屏左右滑动都能翻页。

命令行选项：

| 选项 | 说明 |
|---|---|
| `-o, --out <文件>` | 输出文件，默认与输入同名的 `.html` |
| `--fonts <目录>` | 字体目录（可写多次），转码时按真实字宽排版 |
| `--system-fonts` | 使用本机系统字体目录；Office 自带的私有字体、云字体（Aptos、Gill Sans MT 等）也会用上，并且用到时嵌入产物（浏览器用不了这些没装进系统的字体） |
| `--embed-fonts` | 把用到的字做成字体子集嵌入（观看端不需要安装字体，显示与转码时一致；商业字体请注意分发授权） |
| `--data` | 只输出演示数据 `deck.json`，交给单独部署的播放器 |
| `--inline-limit <字节>` | 小于这个大小的图片内联进 HTML，默认 2MB；视频音频总是单独输出到 `media/` |
| `--stats` | 结束时显示用时和峰值内存 |

## 在代码里使用（云函数等）

```js
import { convert } from '@unppt/unppt';

const files = new Map();
const result = await convert(pptxBytes, {
  // 输出交给你写：index.html，以及大媒体文件 media/xxx.mp4
  write: async (path, data) => { /* data 可能是字符串、Uint8Array 或数据流（AsyncIterable） */ },
  fonts: [fontBytes1, fontBytes2],   // 可选：字体文件内容
  embedFonts: true,                  // 可选：嵌入字体子集（默认关闭）
});
console.log(result.slides, result.report.missingFonts, result.report.warnings);
```

**大文件**：不要把整个文件读进内存，传一个"按位置读取"的对象即可，转码器只读需要的部分：

```js
const fh = await fs.promises.open('big.pptx');
const source = { size, read: async (offset, length) => { /* 返回 Uint8Array */ } };
await convert(source, { write });
```

实测：300 页 + 800MB 视频的文件，限制 128MB 内存，1 秒左右转完，峰值内存约 120MB。

## 嵌入网页与外部控制（JS bridge）

### iframe 嵌入（可跨域）

```html
<iframe id="ppt" src="https://cdn.example.com/deck/index.html?ui=0"></iframe>
<script type="module">
  import { UnpptFrame } from './host.js';      // packages/player/dist/host.js
  const deck = new UnpptFrame(document.getElementById('ppt'));
  await deck.ready;
  await deck.next();          // 下一步（有动画先播动画，播完再翻页）
  await deck.goto(3, 0);      // 跳到第 4 页第 0 步（页码从 0 开始）
  deck.on('change', (s) => console.log(s.slide, s.step, s.slideCount, s.stepCount));
</script>
```

不用 `host.js` 也可以直接发消息：

```js
iframe.contentWindow.postMessage({ unppt: 1, id: 1, cmd: 'goto', args: { slide: 3, step: 0 } }, '*');
// 播放器回复：{ unppt: 1, re: 1, ok: true, result: { slide, step, slideCount, stepCount } }
// 播放器事件：{ unppt: 1, event: 'ready' | 'change' | 'end' | 'link', data: { ... } }
// link：点击了课件里的外部网址，data.url 是网址（播放器默认也会在新窗口打开）
```

页码和原文件一致，`slideCount` 包括隐藏的幻灯片：和 PowerPoint 放映一样，`next` / `prev` 顺序翻页时跳过隐藏页，`goto` 和课件里的超链接、动作按钮可以跳到隐藏页。

### 同页 JS

```js
await window.unppt.next();
await window.unppt.goto({ slide: 2, step: 1 });
window.unppt.on('change', (s) => { /* ... */ });
```

### 原生 App 的 WebView

- **发指令**：执行 `window.unppt.handle('{"cmd":"next"}')`，返回值是 JSON 字符串形式的回复。
  - Android：`webView.evaluateJavascript("window.unppt.handle('{\"cmd\":\"next\"}')", null)`
  - iOS：`webView.evaluateJavaScript("window.unppt.handle('{\"cmd\":\"next\"}')")`
- **收事件**：播放器会自动调用宿主注入的对象，消息内容与 iframe 相同（JSON 字符串）：
  - Android：`webView.addJavascriptInterface(obj, "UnpptNative")`，实现 `@JavascriptInterface postMessage(String)`
  - iOS：`userContentController.add(handler, name: "unppt")`
  - React Native：`onMessage` 回调

### URL 参数

| 参数 | 说明 |
|---|---|
| `slide`、`step` | 打开时直接定位到第几页第几步（从 0 开始）；这样打开时默认不按计时自动放映 |
| `ui=0` | 隐藏播放器自带的翻页按钮，完全由宿主控制 |
| `timings=0` / `timings=1` | 关闭 / 强制开启按演示文稿里的"自动换片时间"自动放映（默认开启） |
| `origin=https://a.com,https://b.com` | 只接受这些来源的 postMessage 指令 |

完整示例见 [examples/iframe-host.html](examples/iframe-host.html)。

## 开发

| 命令 | 作用 |
|---|---|
| `npm run build` | 构建转码器和播放器 |
| `npm test` | 单元测试 |
| `python tools/make-case/make.py` | 用 PowerPoint 生成测试用例（中性内容）到 `testcases/` |
| `python tools/powerpoint/export.py run [--set testcases]` | 用 PowerPoint 导出参考图（标准答案） |
| `python tools/compare/run.py --set testcases\|daily\|all` | 转码、截图、和 PowerPoint 比对、出报告 |
| `python tools/check-player.py [chromium\|firefox]` | 播放器端到端测试（跨域 iframe、原生桥接等） |
| `python tools/powerpoint/transitions.py capture 名字,... / capture-anim 名字,... / compare` | 页面切换、动画对照：PowerPoint 放映逐帧截图，和播放器同一时刻的画面比较 |

开发工具需要 Windows + PowerPoint + Python（`pip install pywin32 numpy pillow playwright fonttools`）。

**样本安全**：真实样本放在 `samples/`（不进仓库），由样本生成的一切只放在 `.cache/`（不进仓库）。规则见 [SPEC.md](SPEC.md) 第 4 节。

## 许可证

[Apache-2.0](LICENSE)
