[English](../en/getting-started.md)

# 快速上手

这篇文档带你从零开始：装好 unppt，把第一个 `.pptx` 转成网页，打开播放，看懂输出了哪些文件，再解决最常见的问题。全程只需要会敲几条命令。

> 想看完整的命令行选项和在代码里调用的方法，请读 [使用说明](usage.md)。

---

## 1. unppt 是做什么的

unppt 把 PowerPoint 文件（`.pptx`）变成**网页**。网页里自带一个很小的播放器，能像 PowerPoint 放映一样翻页、播动画、播页面切换效果。

```mermaid
flowchart LR
  A[("演示文稿.pptx")] --> B["unppt 转码器<br/>（命令行或 JS 函数）"]
  B --> C[("index.html<br/>自带播放器")]
  B --> D[("pic/ thum/ prop.json<br/>整页图、缩略图、页面清单")]
  C --> E["浏览器打开即可播放<br/>也能用 iframe 嵌进你的网页"]
```

几个名词先解释一下：

| 名词 | 意思 |
|---|---|
| **转码（transcode）** | 把一种格式转换成另一种格式。这里是把 `.pptx` 转成网页。 |
| **SVG** | 一种用文字描述图形的图片格式，浏览器能直接显示，放大不会模糊。unppt 把每一页画成一张 SVG。 |
| **播放器** | 转码时一起写进网页的一段 JavaScript（约 58KB，gzip 后约 21KB），负责翻页、动画、切换效果。它**零依赖**，不需要联网加载任何东西。 |
| **iframe** | 网页里嵌入另一个网页的“窗口”标签 `<iframe>`。你可以用它把转出来的课件嵌进自己的产品页面。 |
| **步（step）** | 一页里每点击一次触发的一组动画叫一步。第 0 步是刚进入这一页、还没点击时的样子。 |

![播放器界面](../images/player.png)

---

## 2. 准备环境

你只需要 **Node.js 20.12 或更高版本**（`package.json` 里写的是 `"node": ">=20.12"`）。不需要安装 PowerPoint，也不需要任何其他程序：转码器是纯 JavaScript + WASM（一种能在 Node 和浏览器里运行的二进制代码），没有要编译的原生插件。

检查 Node 版本：

```bash
node -v
```

输出 `v20.12.0` 或更大的数字就可以。版本太低请到 <https://nodejs.org/> 下载 LTS 版本。

---

## 3. 安装

npm 包名是 **`@unppt/unppt`**，安装后的命令名是 **`unppt`**。三种方式任选一种：

```mermaid
flowchart TD
  Q{"你打算怎么用？"} -->|"经常在命令行里转换"| G["全局安装<br/>npm install -g @unppt/unppt"]
  Q -->|"在自己的项目代码里调用"| L["项目里安装<br/>npm install @unppt/unppt"]
  Q -->|"只是试一下，不想安装"| X["直接运行<br/>npx @unppt/unppt ..."]
```

**方式一：全局安装（推荐给命令行用户）**

```bash
npm install -g @unppt/unppt
unppt 演示文稿.pptx -o out/index.html
```

安装时会自动带上默认字体包 `@unppt/fonts`（开源字体 + 排版用的字体度量数据，下载约 67MB，装好后约 100MB）。它只在转码的电脑上需要，观看的人不用下载。为什么需要它见 [第 7 节](#7-字体为什么重要以及现在怎么处理)。

**方式二：装进你的项目**

```bash
npm install @unppt/unppt
npx unppt 演示文稿.pptx -o out/index.html
```

装进项目后，代码里可以 `import { convert } from '@unppt/unppt'`，见 [使用说明](usage.md#3-javascript-api)。

**方式三：不安装，直接运行**

```bash
npx @unppt/unppt 演示文稿.pptx -o out/index.html
```

第一次运行时 npx 会临时下载包，稍等一下即可。

**方式四：从 GitHub 下载安装（不经过 npm 官方源）**

npm 官方源审核新版本期间、或者连不上 npm 时，可以从 GitHub Release 下载安装包再安装（每个版本发布时自动附上，`latest` 总是最新版）。分两步：先下载安装包文件，再安装这些本地文件（npm 12 起默认不允许直接从网址安装，所以要先下载）。

0.3.0 起要下载**两个文件**：默认字体包 `unppt-fonts.tgz` 和程序本身 `unppt.tgz`，两个一起安装（字体包写在前面）。

Windows PowerShell：

```powershell
Invoke-WebRequest https://github.com/spitmaster/unppt/releases/latest/download/unppt-fonts.tgz -OutFile unppt-fonts.tgz
Invoke-WebRequest https://github.com/spitmaster/unppt/releases/latest/download/unppt.tgz -OutFile unppt.tgz
npm install -g .\unppt-fonts.tgz .\unppt.tgz
```

macOS / Linux：

```bash
curl -L -o unppt-fonts.tgz https://github.com/spitmaster/unppt/releases/latest/download/unppt-fonts.tgz
curl -L -o unppt.tgz https://github.com/spitmaster/unppt/releases/latest/download/unppt.tgz
npm install -g ./unppt-fonts.tgz ./unppt.tgz
```

macOS / Linux 提示权限不足（`EACCES` / `permission denied`）时，最后一行改成 `sudo npm install -g ./unppt-fonts.tgz ./unppt.tgz`，按提示输入电脑登录密码。

想装指定版本，把网址里的 `latest/download/` 换成 `download/v0.3.1/` 这样的格式（0.2.x 版本没有字体包，只下载 `unppt.tgz` 一个文件）。装好后运行 `unppt -v` 看版本号。

> 不带参数运行 `unppt`，会打印版本号和全部选项。

---

## 4. 转换第一个文件

下面一步一步来。假设你有一个文件 `demo.pptx`。

**第 1 步：新建一个空目录放输出**（转码会在输出文件旁边写出好几个文件和文件夹，放在单独目录里最清楚）

```bash
mkdir out
```

**第 2 步：转码**

```bash
unppt demo.pptx -o out/index.html
```

- `-o out/index.html`：输出到哪里。不写的话，默认在 `demo.pptx` 旁边新建 `demo/` 文件夹，`index.html` 和 `pic/`、`thum/`、`prop.json` 等都放在里面。
- 字体不用另外指定：默认用 PPT 里嵌入的字体和默认字体包，所有观看者看到的都一样。想先看看字体有没有问题，运行 `unppt check demo.pptx`，见 [第 7 节](#7-字体为什么重要以及现在怎么处理)。

**第 3 步：看命令行输出**

转码过程中会显示进度 `转码中 3/12 页`，结束时类似：

```text
完成：12 页，用时 4.2 秒 -> D:\work\out\index.html
字体：
  ⚠ 楷体_GB2312  第 1 页   没有这个字体，按 Microsoft YaHei 替代（字形和换行可能和作者电脑上不同）
提示：……
```

- `字体：`：只列**有问题**的字体（⚠ 提醒、✗ 必须处理），没有问题时不显示这一段。每种结论的意思见 [7.5 节](#75-检查字体unppt-check)。
- `提示`：转码时发现的问题（例如某个图片读不出来），不影响其它页面。

**第 4 步：打开播放**

直接双击 `out/index.html`，用 Chrome、Edge 或 Firefox 打开即可。不需要启动 Web 服务器。

整个过程：

```mermaid
sequenceDiagram
  participant U as 你
  participant CLI as unppt 命令行
  participant T as 转码器 convert()
  participant D as 磁盘
  U->>CLI: unppt demo.pptx -o out/index.html
  CLI->>D: 读取 demo.pptx 和字体目录
  CLI->>T: 文件内容 + 选项
  T->>CLI: write("index.html", 数据流)，每页转完就往里追加
  loop 每一页
    T->>T: 解析这一页，画成 SVG，编译动画
    T-->>CLI: 进度回调（第几页 / 共几页）
    T->>CLI: write("pic/1.jpg", ...) 等
    CLI->>D: 写文件
  end
  T->>CLI: write("prop.json", ...)
  CLI->>U: 完成：12 页 -> out/index.html
  U->>D: 双击 index.html，用浏览器播放
```

---

## 5. 输出目录里都是什么

用 `--output` 选择**产物形式**，一共四种。不管哪种形式，都会额外输出 `prop.json`，默认还会输出整页图 `pic/` 和缩略图 `thum/`。

### 5.1 四种产物形式对比

| 形式 | 命令 | 主文件 | 特点 | 适合 |
|---|---|---|---|---|
| `single` | `--output single` | 一个 `.html` | 页面、图片、字体、播放器全部写进这一个 HTML；只有大的图片和所有音视频单独放在 `media/` | 发给别人、本地双击、小文件 |
| `paged`（命令行默认） | `--output paged` | 目录里的 `index.html` | 入口很小，每页数据是单独文件；打开时只加载正在看的页，并预加载下一页 | 放在网上、页数多、文件大 |
| `pages` | `--output pages` | 目录里的 `index.html` | 和 `paged` 一样，另外每页再出一个只含这一页的 `page-001.html` | 需要单独打开、嵌入某一页 |
| `data` | `--output data` 或 `--data` | `.json` | 只有演示数据，没有播放器 | 开发调试 |

> `--output html` 也能用，它是 `single` 的旧名字。

### 5.2 single（一个自包含的 HTML）

```bash
unppt demo.pptx -o out/index.html
```

```text
out/
├── index.html        ← 双击就能播放；页面、小图片、字体、播放器都在里面
├── media/            ← 音频、视频，以及超过 --inline-limit（默认 2MB）的图片
│   └── media1.1a2b3c4d.mp4
├── pic/              ← 每页一张整页图（JPEG）
│   ├── 1.jpg
│   └── 2.jpg
├── thum/             ← 每页一张缩略图（JPEG，宽 216 像素）
│   ├── 1.jpg
│   └── 2.jpg
└── prop.json         ← 页面清单：页数、尺寸、图片路径、演讲者备注、是否隐藏
```

`media/` 只有在课件里有音视频或大图片时才会出现。文件名格式是 `media/原名.校验码.扩展名`，校验码保证内容变了文件名也会变（方便浏览器缓存）。

### 5.3 paged（按需加载）

```bash
unppt demo.pptx -o out --output paged
```

注意：`paged` / `pages` 形式下 `-o` 写的是**目录**（入口是目录里的 `index.html`）。不写 `-o` 时，同样是 pptx 旁边和它同名的目录（例如 `demo/`）。

```text
out/
├── index.html                 ← 入口：播放器 + 目录（有哪些页、每页数据在哪个文件）
├── pages/                     ← 每页的数据，一页一个脚本文件
│   ├── 1.9f8e7d6c.js
│   └── 2.0a1b2c3d.js
├── fonts/                     ← 用到的字体子集（有文字时就有）
│   └── unppt-f0.5e6f7a8b.js
├── media/                     ← 所有图片、音频、视频（这种形式下图片一律不内联）
├── pic/  thum/  prop.json     ← 同 single
```

每页数据用 `<script>` 标签加载（不是 fetch），所以本地双击打开（`file://`）、放在任何域名下、嵌进 iframe 都能正常工作。文件名里带内容哈希，可以放心设置长期缓存。

### 5.4 pages（按需加载 + 每页一个 HTML）

```bash
unppt demo.pptx -o out --output pages
```

在 `paged` 的基础上多出：

```text
out/
├── page-001.html   ← 只包含第 1 页
├── page-002.html   ← 只包含第 2 页
└── ……
```

单页 HTML 的目录里只有这一页，所以课件里“跳到别的页”的超链接在单页里不起作用。

### 5.5 data（只输出数据）

```bash
unppt demo.pptx --data -o out/deck.json
```

```text
out/
├── deck.json       ← 演示数据（每页的 SVG、动画步骤、切换效果，以及标题、尺寸、报告）
├── fonts/          ← 用到的字体子集，.woff 格式（有文字时就有）
├── media/          ← 所有图片、音视频
├── pic/  thum/  prop.json
```

这种形式没有播放器，主要给开发调试用。

### 5.6 整页图、缩略图和 prop.json

整页图和缩略图是用打包在内的 resvg（一个把 SVG 画成位图的库，WASM 版本）生成的，可以用在课件列表、分享卡片、不支持 JavaScript 的场景。

| 文件 | 尺寸 |
|---|---|
| `pic/{页号}.jpg` | 幻灯片尺寸（磅）取整的像素，例如 16:9 的默认幻灯片是 960×540 |
| `thum/{页号}.jpg` | 宽 216 像素，高按比例 |

页号从 1 开始。不想要图片（可以显著加快转码）就加 `--no-images`，这时 `prop.json` 照常输出。

`prop.json` 的样子（字段都来自 `output/prop.ts`）：

```json
{
 "count": 2,
 "picw": 960,
 "pich": 540,
 "thumw": 216,
 "thumh": 122,
 "slides": [
  { "index": 1, "thum": "thum/1.jpg", "pic": "pic/1.jpg", "note": "演讲者备注文字" },
  { "index": 2, "thum": "thum/2.jpg", "pic": "pic/2.jpg", "hidden": 1 }
 ]
}
```

| 字段 | 含义 |
|---|---|
| `count` | 页数（包括隐藏页） |
| `picw` / `pich` | 幻灯片宽高，单位是磅（pt，1 磅 = 1/72 英寸） |
| `thumw` / `thumh` | 缩略图宽高（像素） |
| `slides[].index` | 页号，从 1 开始 |
| `slides[].pic` / `thum` | 图片路径，相对 `prop.json` 所在目录 |
| `slides[].note` | 演讲者备注（没有备注时不出现） |
| `slides[].hidden` | 隐藏的幻灯片是 `1`（不隐藏时不出现） |

---

## 6. 打开和控制播放器

### 6.1 用鼠标、键盘、触屏

下面这些操作和 PowerPoint 放映时的习惯一致（来自播放器源码 `packages/player/src/ui/input.ts`）：

| 操作 | 效果 |
|---|---|
| 单击画面 | 下一步（有动画先播动画，播完再翻页）；点到超链接则跳转 |
| `→` `↓` `PageDown` `空格` `Enter` | 下一步 |
| `←` `↑` `PageUp` `Backspace` | 上一步 |
| `Home` / `End` | 第一页 / 最后一页 |
| 输入数字再按 `Enter`（如 `5` `Enter`） | 跳到第 5 页（2 秒内没继续输入就作废） |
| `B` 或 `.` | 黑屏；再按任意键或单击回到幻灯片 |
| `W` 或 `,` | 白屏；再按任意键或单击回到幻灯片 |
| 触屏向左滑 / 向右滑 | 下一步 / 上一步 |
| 鼠标移到画面上 | 右下角显示 `‹`、`›` 按钮和页码 `3 / 12` |

顺序翻页时会跳过隐藏的幻灯片，和 PowerPoint 放映一样。

### 6.2 用网址参数

在网址后面加参数，例如 `index.html?slide=2&step=1&ui=0`：

| 参数 | 作用 |
|---|---|
| `slide`、`step` | 打开时直接定位到第几页、第几步（都从 0 开始）。这样打开时默认不按计时自动放映 |
| `ui=0` | 隐藏自带的翻页按钮，完全由你的页面控制 |
| `timings=0` / `timings=1` | 关闭 / 强制开启按“自动换片时间”自动放映 |
| `links=0` | 点击外部链接时不自己打开新窗口，只发 `link` 事件给宿主 |
| `mode=watch` | 观看模式：只能由 JS 接口驱动（例如直播课的学生端） |
| `origin=https://a.com,https://b.com` | 只接受这些来源发来的 postMessage 指令 |

### 6.3 嵌进你的网页并用代码控制

**postMessage** 是浏览器提供的、让两个页面（包括跨域的 iframe）互相发消息的方法。播放器监听这些消息：

```html
<iframe id="ppt" src="out/index.html?ui=0" style="width:960px;height:540px;border:0"></iframe>
<button onclick="send('prev')">上一步</button>
<button onclick="send('next')">下一步</button>
<script>
  const frame = document.getElementById('ppt');
  let id = 0;
  function send(cmd, args) {
    frame.contentWindow.postMessage({ unppt: 1, id: ++id, cmd, args }, '*');
  }
  window.addEventListener('message', (e) => {
    const m = e.data;
    if (!m || m.unppt !== 1) return;
    if (m.event) console.log('事件', m.event, m.data);   // ready / change / end / link
    if (m.re) console.log('回复', m.re, m.ok, m.result);
  });
  // 跳到第 4 页第 0 步：send('goto', { slide: 3, step: 0 })
</script>
```

```mermaid
sequenceDiagram
  participant H as 你的页面（宿主）
  participant P as iframe 里的播放器
  P-->>H: { unppt: 1, event: "ready", data: 状态 }
  H->>P: { unppt: 1, id: 1, cmd: "next" }
  P-->>H: { unppt: 1, re: 1, ok: true, result: 状态 }
  P-->>H: { unppt: 1, event: "change", data: 状态 }
  Note over H,P: 状态 = { slide, step, slideCount, stepCount, ... }
```

指令有 `next`、`prev`、`goto`、`sync`、`getState`；事件有 `ready`、`change`、`end`、`link`。同一页面里也可以直接调用 `window.unppt.next()`、`window.unppt.goto({ slide: 2, step: 1 })`。完整的嵌入方式（包括原生 App 的 WebView）见 [嵌入与控制](embedding.md)、[播放器](player.md) 和示例 [examples/iframe-host.html](../../examples/iframe-host.html)。

---

## 7. 字体：为什么重要，以及现在怎么处理

> 0.3.0 起字体的处理方式变了：默认**不再用本机系统字体**，改用 PPT 里嵌入的字体 + 默认字体包 `@unppt/fonts`。下面从头讲一遍。

### 7.1 为什么字体重要

字体在两个时刻起作用：

| 时刻 | 字体决定了什么 |
|---|---|
| **转码时**（排版） | 每个字有多宽、一行能放几个字、在哪里换行、行和行隔多远。要和 PowerPoint 一样，转码器就要知道每个字的真实宽度 |
| **观看时**（显示） | 每个字长什么样（字形） |

unppt 的原则（SPEC D3）：**播放时绝不用观看者电脑上装的字体**。每个字的字形都来自打包进产物的字体子集（只包含用到的字）。这样不管观看的人用 Windows、Mac、安卓还是 iPhone（例如一场直播课里几千个学生），看到的都完全一样。

### 7.2 产物里的字体从哪来

不另外指定字体文件时，产物里的字体只有两个来源：

1. **作者嵌入在 `.pptx` 里的字体**：原样使用。例外：PowerPoint 自己都不认的嵌入字体（CFF 格式的 `.otf`、表目录没排序的字体），和 PowerPoint 一样当作没有嵌入。
2. **默认字体包 `@unppt/fonts`**：安装 `@unppt/unppt` 时自动装上（它是一个依赖）。里面都是开源字体，许可证都是 SIL OFL 1.1，可以自由分发。装好后约 100MB，只在转码的电脑上需要，观看的人不会下载它（产物里只有用到的字的子集）。

```mermaid
flowchart TD
  F["PPT 里用到的字体，例如「微软雅黑」"] --> E{"作者把它嵌入 PPT 了吗？<br/>（并且 PowerPoint 认它）"}
  E -->|"嵌入了"| EMB["排版、显示都用嵌入的字体"]
  E -->|"没有"| S{"用 --fonts 指定了同名字体吗？"}
  S -->|"指定了"| SPEC["排版、显示都用指定的字体"]
  S -->|"没有"| K{"字体包认识它吗？<br/>（度量包里有 457 个 Windows / Office 字体）"}
  K -->|"认识"| DEF["排版按原字体的字宽<br/>显示用对应的开源字体"]
  K -->|"不认识"| SUB["和 PowerPoint 一样找替代字体<br/>（中文→微软雅黑，西文→Calibri，日文→Yu Gothic）<br/>再按上一格处理"]
  EMB --> OUT[("用到的字做成子集<br/>嵌入产物")]
  SPEC --> OUT
  DEF --> OUT
  SUB --> OUT
  OUT --> V["所有观看者看到的一样"]
```

所有字体都没有的字（很少见，例如 emoji、生僻字）交给浏览器自己找字体显示，不同设备上可能不一样，`unppt check` 会列出来。

### 7.3 排版和显示分开：度量包 + 开源字体

微软雅黑、宋体、Calibri 这些字体是商业字体，不能随产物分发。unppt 的做法是把“排版”和“显示”分开：

- **排版**用原字体的**度量数据**：字体包里有一个度量包，只有数字（每个字的宽度、上下高度、字距调整），**没有字形**，覆盖 457 个 Windows / Office 字体。所以换行位置、每个字的位置、行距和 PowerPoint 一样。
- **显示**用对应的开源字体。字形会和原字体略有不同（例如微软雅黑显示成思源黑体），但位置不变。

| 原字体（举例） | 显示用的开源字体 |
|---|---|
| 微软雅黑、等线、黑体等无衬线中文字体 | 思源黑体（Noto Sans SC，细体 / 常规 / 粗体） |
| 宋体一类 | 思源宋体（Noto Serif SC，常规 / 粗体） |
| 楷体 | 霞鹜文楷（LXGW WenKai） |
| 仿宋 | 朱雀仿宋（Zhuque Fangsong） |
| Calibri | Carlito（和 Calibri 字宽一致） |
| Cambria | Caladea（和 Cambria 字宽一致） |
| Arial 等无衬线西文字体 | Liberation Sans（和 Arial 字宽一致） |
| Times New Roman 等衬线西文字体 | Liberation Serif（和 Times New Roman 字宽一致） |
| Courier New 等等宽字体 | Liberation Mono（和 Courier New 字宽一致） |

对照规则写在 `packages/fonts/map.json` 里，按顺序匹配，第一条命中的生效。

**思源黑体、思源宋体例外**（0.3.1 起）：字体包里虽然有思源黑体、思源宋体，但课件里写的"思源黑体""Source Han Sans""思源宋体"等名字，没嵌入时和其它缺的字体一样，按 PowerPoint 的规则找替代字体排版（中文一般是微软雅黑），`unppt check` 里标成 ⚠。原因：大多数电脑没装思源字体，PowerPoint 在这些电脑上就是这样显示的，这样所有观看者看到的一致。想保留思源的样子，请把字体嵌入 PPT。课件里直接写 Noto Sans SC / Noto Serif SC 的，照常用字体包里的同名字体。

### 7.4 符号字体（Wingdings、Webdings、Symbol 等）

符号字体里，字母的位置放的是图形（例如 Wingdings 的 `l` 是一个实心圆点）。unppt **不会改动你的字符**：

- 作者把符号字体嵌入了 PPT：照常使用，显示正确。
- **Wingdings、Wingdings 2、Wingdings 3 没有嵌入**：用默认字体包里"编码兼容"的开源字体显示——字形取自 Noto Sans Symbols 等开源字体，按 Wingdings 的编码放好，课件里的字符不变，画出来就是对应的符号（■ ➢ ● ✔ ◆ ❖ 等），大小、位置按 Wingdings 的字宽和字形外框对齐。字形和 Wingdings 略有不同（就像思源黑体之于微软雅黑）。
- 其它符号字体（Webdings、Symbol 等）没有嵌入：直接打的字母显示成普通字母；用“插入符号”插入的符号字体包里没有，交给浏览器显示（装了这个字体的电脑上是符号，其它设备上是方框）。转码报告和 `unppt check` 会提示作者嵌入字体。

在 PowerPoint 里嵌入字体：**文件 → 选项 → 保存 → 勾选“将字体嵌入文件”**，然后重新保存。也可以用 `--fonts` 指定符号字体文件。

### 7.5 检查字体：unppt check

想在转码前知道字体有没有问题（例如在产品里检查用户上传的课件），用 `unppt check`。它只检查字体，不写任何文件，几秒钟就出结果：

```bash
unppt check text-latin-cjk-font.pptx
```

```text
字体检查：text-latin-cjk-font.pptx（共 1 页）
  ⚠ 楷体_GB2312  第 1 页   没有这个字体，按 Microsoft YaHei 替代（字形和换行可能和作者电脑上不同）
  ✓ 等线         第 1 页   排版按原字体，显示用 思源黑体（Noto Sans SC）
  ✓ 宋体         第 1 页   排版按原字体，显示用 思源宋体（Noto Serif SC）
  ✓ Arial        第 1 页   排版按原字体，显示用 Liberation Sans
结论：0 个必须处理的问题（✗），1 个提醒（⚠）
```

用了 Webdings 又没有嵌入时会看到：

```text
  ✗ Webdings   第 1 页   符号字体没有嵌入，符号会显示成字母或方框：请在 PowerPoint 里勾选"将字体嵌入文件"
```

每种结论的意思（括号里是 `--json` 输出里的 `status`）：

| 标记 | 结论 | 意思 |
|---|---|---|
| ✓ | 嵌入了（`embedded`） | PPT 里嵌入了这个字体，照原样显示 |
| ✓ | 指定的（`specified`） | 用 `--fonts` / `--system-fonts` 给的字体 |
| ✓ | 默认字体包（`default`） | 排版按原字体的字宽，显示用开源字体 |
| ⚠ | 替代（`substituted`） | 字体包也不认识这个字体，按 PowerPoint 的规则找了替代字体，字形和换行可能和作者电脑上不同 |
| ✗ | 符号字体没嵌入（`symbol-missing`） | 符号会显示成字母或方框，见 [7.4 节](#74-符号字体wingdingswebdingssymbol-等) |
| ✗ | 没有字体（`missing`） | 连替代字体都没有，字宽只能估算（通常是没装默认字体包） |

- 加 `--json` 输出 JSON：`fonts`（每个字体的 `font`、`pages`、`status`，以及可能有的 `substitute` 替代字体、`shownWith` 显示用的字体）、`missingChars`（没有字体能显示的字，按页列出）、`errors`（✗ 的个数）、`warnings`（⚠ 的个数）、`slides`（页数）。
- 有 ✗ 时退出码是 `1`，产品里可以据此拒绝上传或提示作者。
- 字体选项（`--fonts`、`--system-fonts`、`--no-default-fonts`）和转码时一样写，结论就是按这些字体转码时的情况。
- 正常转码结束时也会打印字体检查，但只列有问题的字体（⚠、✗）。

### 7.6 字体选项

| 选项 | 作用 | 什么时候用 |
|---|---|---|
| （不写） | PPT 里嵌入的字体 + 默认字体包。找不到 `@unppt/fonts` 时会打印提示，这时没有嵌入的字体字宽只能估算 | 大多数情况 |
| `--fonts <目录>` | 从这个目录（包括子目录）读取 `.ttf` / `.otf` / `.ttc`。同名时压过字体包，排版和显示都用它，用到的字嵌入产物。可以写多次 | 你有自己的一套字体，并且有权分发 |
| `--system-fonts` | 也用本机系统字体和 Office 私有字体 / 云字体（例如 Aptos、Gill Sans MT），排版和显示都用它们，用到的字嵌入产物。**0.3.0 起默认关闭**（0.2.3 到 0.2.6 默认开启） | 想让字形和作者电脑上一模一样。**注意商业字体的分发授权**：嵌入产物就等于把字体子集分发给了所有观看者 |
| `--no-default-fonts` | 不用默认字体包 | 调试 |
| `--no-system-fonts` | 旧选项，照样接受，没有作用（现在本来就默认关闭） | — |
| `--embed-fonts` | 旧选项，照样接受，没有作用（现在用到的字体总是嵌入） | — |

`--system-fonts` 会查找的目录：

| 系统 | 系统字体目录 | Office 私有字体 / 云字体 |
|---|---|---|
| Windows | `%WINDIR%\Fonts`、`%LOCALAPPDATA%\Microsoft\Windows\Fonts` | `Program Files\Microsoft Office\root\vfs\Fonts\private`、`%LOCALAPPDATA%\Microsoft\FontCache\4\CloudFonts` |
| macOS | `/System/Library/Fonts`、`/Library/Fonts`、`~/Library/Fonts` | `/Applications/Microsoft PowerPoint.app/Contents/Resources/DFonts` |
| Linux | `/usr/share/fonts`、`/usr/local/share/fonts`、`~/.fonts`、`~/.local/share/fonts` | 无 |

推荐写法：

```bash
# 大多数情况：什么都不用加，在哪台电脑、服务器、云函数上转，结果都一样
unppt demo.pptx -o out

# 先检查字体
unppt check demo.pptx

# 用自己有分发授权的字体（同名时压过字体包）
unppt demo.pptx -o out --fonts /opt/fonts

# 用本机字体，字形和作者电脑上一样（注意商业字体的分发授权）
unppt demo.pptx -o out --system-fonts
```

---

## 8. 效果如何

开发时，unppt 用本机 PowerPoint 导出的图片当“标准答案”，逐页自动比对。比对用 **SSIM**（结构相似度，0 到 1 之间，1 表示两张图完全一样，怎么算的见[还原度](fidelity.md#ssim)），一页 SSIM ≥ 0.95 算通过。0.3.1 的结果（完整数字见[测试报告](test-report.md)）：

| 测试集 | 规模 | 通过率（SSIM ≥ 0.95） | 平均 SSIM |
|---|---|---|---|
| 合成测试用例 | 255 份 / 543 页 | 93.0% | 0.984 |
| 本机全部真实课件 | 5212 份 / 168662 页，0 份转码失败 | 70.4%（93.5% 的页 SSIM ≥ 0.90） | 0.956 |

上表是用 `--system-fonts`（和 PowerPoint 用同一套字体）转码测出来的，衡量的是排版规则对不对。默认用字体包时换行和文字位置不变，只是字形换成了开源字体，合成用例平均每页 SSIM 约低 0.024，全部来自字形差别。

多数没通过的页只是细节有差别（文字位置差几个像素、某个图表标签）。下面每张图左边是 Microsoft PowerPoint，右边是 unppt：

![图表](../images/compare-charts-basic.png)
![表格样式](../images/compare-table-styles.png)
![文字效果](../images/compare-text-effects.png)

已知还没做好的地方：图表日期坐标轴的时间刻度（最小/最大值、按月/年间隔）、艺术字竖排（wordArtVert）、EMF 图片里的 EMF+ 记录、部分需要重新布局的 SmartArt、旋转 180 度时的三维棱台、45 度分类标签的截断阈值。

---

## 9. 常见问题

| 现象 | 原因和解决 |
|---|---|
| `unppt` 不是内部或外部命令 / command not found | 没有全局安装，或者 npm 全局目录不在 PATH 里。改用 `npx @unppt/unppt ...`，或者重新 `npm install -g @unppt/unppt` |
| 安装或运行时报 Node 版本错误、语法错误 | Node 版本低于 20.12。运行 `node -v` 检查并升级 |
| 运行后只打印了一大段“用法” | 命令写错了：第一个参数必须是 `convert`，后面跟输入文件；选项名写错也会打印用法。看 [使用说明](usage.md#2-命令行参考) |
| 文字换行和 PowerPoint 不一样 | 转码时缺字体。运行 `unppt check 文件.pptx` 看哪些字体是 ⚠ 替代或 ✗；请作者在 PowerPoint 里嵌入字体，或用 `--fonts <目录>` 提供这些字体。见 [第 7 节](#7-字体为什么重要以及现在怎么处理) |
| 提示“没找到默认字体包 @unppt/fonts” | 字体包没装上（例如只装了 `unppt.tgz`）。重新 `npm install -g @unppt/unppt`，或者从 GitHub 安装时把 `unppt-fonts.tgz` 一起装上 |
| 字形和作者电脑上看到的不完全一样 | 正常现象：没有嵌入的商业字体（微软雅黑、Calibri 等）用开源字体显示，位置和换行不变。要完全一样，请作者嵌入字体，或者在你有授权时用 `--system-fonts` / `--fonts` |
| 符号（勾、箭头、圆点）显示成了字母 | 用了 Webdings、Symbol 这类符号字体但没有嵌入（Wingdings 1~3 不会这样）。请作者在 PowerPoint 里“将字体嵌入文件”，见 [7.4 节](#74-符号字体wingdingswebdingssymbol-等) |
| `.pptx` 旁边多出一堆 `pic/`、`thum/`、`prop.json` | 0.2.1 及以前不写 `-o` 时输出直接写在输入文件旁边。升级到 0.2.2 以上（默认放进同名文件夹），或用 `-o out/index.html` 指定目录 |
| 提示“没有 resvg.wasm，不输出整页图和缩略图” | 程序找不到出图用的 `resvg.wasm`（通常是安装不完整）。重新安装；不需要图片时加 `--no-images` |
| 转码很慢或内存不够 | 出图最耗时。加 `--no-images` 跳过出图，或用 `--jobs 1`、`--jobs 2` 减少同时出图的线程数。用 `--stats` 查看用时和峰值内存 |
| 视频不播放 | 视频在 `media/` 里，复制或上传时要连同 `media/` 一起；另外视频本身的编码要是浏览器能播的（例如 MP4/H.264） |
| 某一页是白的，提示“第 N 页渲染失败” | 那一页转码出错，其它页不受影响。欢迎把能公开的、重新做过的复现文件提给我们 |
| 浏览器显示“无法播放：……” | 产物格式和播放器版本不匹配，或文件被改坏了。用同一版本重新转码 |

遇到效果不对的课件，请在 GitHub 提 issue：<https://github.com/spitmaster/unppt/issues>。注意不要上传含有隐私或客户内容的文件，最好用 PowerPoint 新建一个只包含问题元素的小文件。
