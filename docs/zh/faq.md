[English](../en/faq.md)

# 常见问题（FAQ）

这里收集使用 unppt 时最常遇到的问题。每个问题都尽量给出可以直接复制的命令。

目录：

- [字体](#字体)
- [文字换行和 PowerPoint 不一样](#文字换行和-powerpoint-不一样)
- [产物大小和内存](#产物大小和内存)
- [超大文件](#超大文件)
- [支持哪些功能](#支持哪些功能)
- [已知差距](#已知差距)
- [支持哪些浏览器](#支持哪些浏览器)
- [怎样安全地反馈效果不对的课件](#怎样安全地反馈效果不对的课件)
- [版本号](#版本号)

---

## 字体

> 0.3.0 起字体的处理方式变了，完整说明见 [快速上手第 7 节](getting-started.md#7-字体为什么重要以及现在怎么处理)。

### 问：观看的人电脑上没装这个字体，会显示成别的字体吗？

不会。0.3.0 起播放器**绝不用观看者电脑上装的字体**：用到的每个字都做成字体子集打包进产物，不管观看的人用 Windows、Mac、安卓还是 iPhone，看到的都一样（[SPEC.md](../../SPEC.md) 决策 D3）。

产物里的字体只有两个来源（除非你用 `--fonts` / `--system-fonts` 明确指定）：

| 来源 | 说明 |
|---|---|
| 作者嵌入在 PPT 里的字体 | 原样使用（PowerPoint 里“将字体嵌入文件”） |
| 默认字体包 `@unppt/fonts` | 开源字体，随 `@unppt/unppt` 自动安装 |

> “字体子集”= 只保留用到的那些字的字体文件，体积比完整字体小得多。

### 问：没嵌入的微软雅黑、Calibri 会怎么样？换行还准吗？

准。排版和显示是分开的：

- **排版**按原字体的度量数据（每个字的宽度、上下高度、字距），所以换行位置、每个字的位置、行距和 PowerPoint 一样；
- **显示**用对应的开源字体：微软雅黑、等线、黑体 → 思源黑体；宋体 → 思源宋体；楷体 → 霞鹜文楷；仿宋 → 朱雀仿宋；Calibri → Carlito；Cambria → Caladea；Arial → Liberation Sans；Times New Roman → Liberation Serif；Courier New → Liberation Mono。

所以你会看到**字形**和作者电脑上略有不同，但位置不变。想要字形也一模一样，请作者把字体嵌入 PPT，或者在你有授权时用 `--system-fonts` / `--fonts`。

### 问：unppt 会分发微软雅黑、Calibri 这些商业字体吗？

不会。

- 默认字体包里**只有开源字体**，许可证都是 SIL OFL 1.1，可以自由分发、嵌入：思源黑体（Noto Sans SC）、思源宋体（Noto Serif SC）、霞鹜文楷（LXGW WenKai）、朱雀仿宋（Zhuque Fangsong）、Carlito、Caladea、Liberation Sans / Serif / Mono。许可证文件在 `packages/fonts/LICENSES/`。
- 字体包里的**度量包只有数字**（每个字的宽度、上下高度、字距调整），没有任何字形，覆盖 457 个 Windows / Office 字体。它只用来排版，不会出现在产物里。
- 产物里只会出现：开源字体的子集、作者自己嵌入 PPT 的字体的子集、你用 `--fonts` / `--system-fonts` 明确指定的字体的子集。**后两种的分发授权由作者 / 你自己负责**：嵌入产物就等于把字体子集分发给了所有观看者，商业字体请先确认授权。

### 问：怎么知道一个课件有没有字体问题？

用 `unppt check`，只检查字体、不写文件，几秒钟出结果：

```bash
unppt check 演示文稿.pptx
unppt check 演示文稿.pptx --json    # 输出 JSON，给程序用
```

每个字体一行：✓ 没问题；⚠ 提醒（例如字体包也不认识这个字体，换了替代字体）；✗ 必须处理（例如符号字体没嵌入）。有 ✗ 时退出码是 1，产品里可以据此拒绝上传或提示作者。代码里用 `checkFonts()`，或者看 `convert()` 结果里的 `fontCheck`，见 [使用说明 3.8](usage.md#38-checkfontsinput-options只检查字体)。

正常转码结束时也会列出有问题的字体（只列 ⚠ 和 ✗）。

### 问：字体包也不认识的字体怎么办？

和 PowerPoint 一样换一个替代字体来排版，再用对应的开源字体显示，`unppt check` 里标成 ⚠。替代规则（实测得到的）：

| 缺的字体 | 替代成 |
|---|---|
| 西文字体 | Calibri |
| 标了中文字符集的字体 | 微软雅黑（Microsoft YaHei） |
| 标了日文字符集的字体 | Yu Gothic（游ゴシック），它没有的字再用中文字体 |
| Helvetica、Helvetica Neue、Helv | Arial |
| Times、Tms Rmn | Times New Roman |
| Courier | Courier New |

**思源黑体、思源宋体**（课件里写的"思源黑体""Source Han Sans""思源宋体"等名字）没嵌入时也按这一条处理（0.3.1 起），虽然字体包里有同样字形的思源黑体、思源宋体：大多数电脑没装思源字体，PowerPoint 在这些电脑上就是按替代字体（一般是微软雅黑）显示的，这样所有观看者看到的一致。想保留思源的样子，请把字体嵌入 PPT。

所有字体都没有的字（很少见，例如 emoji、生僻字）交给浏览器自己找字体显示，不同设备上可能不一样，`unppt check` 会把这些字列出来。

### 问：符号（勾、箭头、圆点）显示成了字母，怎么办？

课件用了 Webdings、Symbol 这类符号字体，但没有把它嵌入 PPT。符号字体在字母的位置上放的是图形，unppt **不会改动你的字符**；Wingdings、Wingdings 2、Wingdings 3 有默认字体包里编码兼容的开源字体，没嵌入也能显示成符号，其它符号字体还没有：直接打的字母显示成普通字母，用“插入符号”插入的符号交给浏览器，装了这个字体的电脑上是符号、其它设备上是方框。转码结果和 `unppt check` 会标成 ✗。

解决：请作者在 PowerPoint 里 **文件 → 选项 → 保存 → 勾选“将字体嵌入文件”**，重新保存后再转码；或者用 `--fonts` 指定符号字体文件（注意授权）。

### 问：云函数、服务器上没有任何字体，怎么办？

不需要装字体。安装 `@unppt/unppt` 时会自动带上默认字体包，代码里读一下传给 `convert()` 就行，结果和在桌面电脑上转码完全一样：

```js
import { convert } from '@unppt/unppt';
import { loadFontPack } from '@unppt/unppt/node';

const fontPack = await loadFontPack();   // 找到已安装的 @unppt/fonts；没装时返回 undefined
const result = await convert(pptxBytes, { write, fontPack });
console.log(result.fontCheck);           // 字体检查结果
```

字体包装好后约 100MB（连同 `@unppt/unppt` 本身约 110MB），部署时注意云函数代码包的大小限制，见 [使用说明 4.3](usage.md#43-云函数从对象存储读转码写回对象存储)。

### 问：怎么用自己的字体？

```bash
# 指定字体目录（可以写多次；会递归查找 .ttf / .otf / .ttc），同名时压过字体包
unppt 演示文稿.pptx -o out --fonts ./fonts --fonts ./more-fonts

# 用本机系统字体（Windows 上还会用到 Office 自带的私有字体、云字体，例如 Aptos）；0.3.0 起默认关闭
unppt 演示文稿.pptx -o out --system-fonts
```

代码里用 `fonts: [字体文件的字节, ...]`。这些字体排版和显示都用它，用到的字会嵌入产物，**请确认你有分发授权**。

### 问：以前的 `--embed-fonts`、`--no-system-fonts` 还能用吗？

能写，但没有作用了：0.3.0 起用到的字体总是嵌入产物（代码里 `embedFonts` 默认 `true`），本机系统字体默认不用。代码里的 `privateFonts` 和 `fonts` 一样。

---

## 文字换行和 PowerPoint 不一样

最常见的原因，按可能性排序：

1. **转码时缺字体**：运行 `unppt check` 看有没有 ⚠ / ✗ 的字体。请作者把字体嵌入 PPT，或用 `--fonts` 提供（见上一节）；
2. **没装默认字体包**：命令行开头提示“没找到默认字体包 @unppt/fonts”时，没有嵌入的字体只能估算字宽。重新安装 `@unppt/unppt`，或从 GitHub 安装时把 `unppt-fonts.tgz` 一起装上；
3. **字体版本不同**：同名字体不同版本，字宽可能不同。字体包的度量来自 Windows / Office 自带的版本；作者电脑上的版本不一样时，可以用 `--fonts` 指定作者用的字体文件；
4. **属于已知差距**：例如艺术字竖排（`wordArtVert`），见[已知差距](#已知差距)。

如果以上都排除了，欢迎按[下面的方法](#怎样安全地反馈效果不对的课件)反馈。

---

## 产物大小和内存

### 问：转出来的 HTML 有多大？

产物形式由 `--output` 选择：

| 形式 | 命令 | 输出 | 适合 |
|---|---|---|---|
| `single` | `--output single` | 一个自包含的 HTML，页面、图片、字体、播放器全部内联 | 本地双击打开、发文件 |
| `paged`（命令行默认） | `--output paged` | 目录：入口 `index.html` + 每页单独的数据文件 `pages/`、`fonts/`、`media/`；打开时只加载当前页，并预加载下一页 | 放到网上播放 |
| `pages` | `--output pages` | 在 `paged` 基础上每页再输出一个独立的 `page-001.html` | 需要单页链接时 |
| `data` | `--data` 或 `--output data` | 只输出演示数据 `deck.json` | 开发调试 |

几个影响大小的点：

- **播放器本身很小**：当前构建约 58KB，gzip 后约 21KB；
- **同一张图片只存一份**，多页共用；
- **大图片不内联**：`single` 形式下，超过 2MB（`--inline-limit <字节>` 可改）的图片单独输出到 `media/` 目录；**视频、音频总是单独输出**到 `media/`；文件名带校验码，重新发布后不会被旧缓存串版本；
- 所有形式都会在入口文件旁边输出 `prop.json`（页数、尺寸、每页图片路径、备注、是否隐藏），以及每页的整页图 `pic/<n>.jpg` 和缩略图 `thum/<n>.jpg`。不需要图片时加 `--no-images`，能省下不少时间和空间。

> 把 `media/` 目录放到网上时，服务器要支持 HTTP Range 请求（常见 Web 服务器默认都支持），否则 Chromium 里视频拖不动进度。

### 问：转码要多少内存？

转码器**不会一次性读入整个文件**，而是逐页处理、处理完就释放；视频音频以流的方式原样拷贝。README 里的实测：300 页 + 800MB 视频的文件，限制 128MB 内存，1 秒左右转完，峰值内存约 120MB。

整页图、缩略图是另外的开销：命令行默认按 CPU 数和可用内存（每个线程按 400MB 估）自动决定用几个线程同时画。内存紧张时：

```bash
# 在主线程画图，最省内存
npx @unppt/unppt 演示文稿.pptx -o out/index.html --jobs 1
# 或者干脆不出图
npx @unppt/unppt 演示文稿.pptx -o out/index.html --no-images
# 看用时和峰值内存
npx @unppt/unppt 演示文稿.pptx -o out/index.html --stats
```

---

## 超大文件

### 问：1GB、几百页的课件能转吗？

能，这是设计目标之一（[SPEC.md](../../SPEC.md) 决策 D13）。命令行会自动按位置分段读文件。在自己的代码里，**不要**把整个文件读成 `Uint8Array`，而是传一个"按位置读取"的对象：

```js
import { open, stat } from 'node:fs/promises';
import { convert } from '@unppt/unppt';

const path = 'big.pptx';
const { size } = await stat(path);
const fh = await open(path, 'r');
const source = {
  size,
  async read(offset, length) {
    const buf = new Uint8Array(Math.max(0, Math.min(length, size - offset)));
    const { bytesRead } = await fh.read(buf, 0, buf.length, offset);
    return buf.subarray(0, bytesRead);
  },
};
try {
  await convert(source, { write: async (relPath, data) => { /* 写到你想写的地方 */ } });
} finally {
  await fh.close();
}
```

`write(路径, 数据)` 里的 `data` 可能是字符串、`Uint8Array`，也可能是数据流（`AsyncIterable`，大媒体文件就是这样边读边写的），你的写入函数要三种都能处理。

对网上播放，大课件建议用 `--output paged`：观看者打开时只下载当前页。

---

## 支持哪些功能

下表根据代码里已实现的模块整理（细节规则见 [SPEC.md](../../SPEC.md) 第 7 节）：

| 类别 | 支持情况 |
|---|---|
| 形状 | 全部预设形状、自定义形状（自由曲线）、组合（旋转、翻转、缩放）、连接线和箭头 |
| 填充和线条 | 纯色、渐变（线性、射线、矩形、路径）、图案、图片和纹理填充（拉伸 / 平铺）；虚线、复合线、线端 |
| 效果 | 外阴影、内阴影、发光、柔化边缘、映像、三维棱台和轮廓、三维旋转 |
| 文字 | 母版 / 版式继承、项目符号和编号、自动调整、竖排、中文禁则和标点溢出、文字效果（渐变、图片填充、描边、阴影、发光）、艺术字变形、超链接 |
| 表格 | 合并单元格、内置表格样式、斜线表头、竖排文字 |
| 图表 | 柱形 / 条形、折线、面积、饼图、三维饼图、复合饼图、圆环、雷达、散点、气泡、股价图；数据标签、图例、坐标轴、数据表、图表上画的形状 |
| SmartArt | 用文件里 PowerPoint 保存的绘图缓存显示 |
| 图片 | PNG、JPEG、GIF、BMP、TIFF、EMF、WMF、SVG；裁剪、重新着色、透明色、EXIF 方向 |
| 公式、墨迹 | 显示 PowerPoint 在文件里保存的替代图片 |
| 嵌入对象（OLE） | 显示 PowerPoint 保存的预览图 |
| 音频、视频 | 封面帧、播放控制条、剪裁、淡入淡出、全屏播放、动画声音和切换声音 |
| 动画 | 进入、退出、强调、动作路径动画，触发器，按计时自动播放 |
| 页面切换 | 淡入、推入、擦除、分割、百叶窗、棋盘、溶解、平滑（Morph）等二十多种 |
| 放映 | 隐藏的幻灯片、自动换片时间、循环放映、超链接和动作按钮、B / W 黑屏白屏、输入页码跳转 |

**不支持的：**

- **老格式 `.ppt`**：请先在 PowerPoint 里"另存为" `.pptx` 再转；
- **Office 2016 起新增的图表类型**（瀑布图、旭日图、树状图等，文件里存成 `cx:` 新格式）：代码里没有对应的绘制模块，转码器会使用文件里 PowerPoint 存的替代内容；
- **曲面图**：没有对应的图表类型。

---

## 已知差距

这些情况目前和 PowerPoint 还有明显差别：

| 方面 | 差距 |
|---|---|
| 图表日期坐标轴 | 按时间缩放（最小值 / 最大值、按月 / 年的间隔）还不完整 |
| 竖排文字 | 艺术字竖排（`wordArtVert`） |
| 图片 | EMF 图片里的 EMF+ 记录 |
| SmartArt | 部分需要重新布局的 SmartArt |
| 3D | 旋转 180° 时的三维棱台 |
| 图表分类标签 | 45° 倾斜标签的截断阈值 |

整体还原度（0.3.1）：合成用例 93.0% 的页、本机全部 5212 份真实课件 70.4% 的页达到 SSIM ≥ 0.95（93.5% 的页在 0.90 以上），没过线的大多只是细节差几个像素。完整数字见[测试报告](test-report.md)，怎么测的见[还原度](fidelity.md)。

---

## 支持哪些浏览器

| 环境 | 状态 |
|---|---|
| Chrome（及其它 Chromium 内核浏览器） | 支持，Chrome 有端到端自动测试 |
| Firefox | 支持，有端到端自动测试 |
| Android WebView、iOS WKWebView | 目标支持；WebKit 内核还没有自动测试 |
| 小程序 web-view | 能播放；但小程序和网页之间不能实时传消息，只能用改地址（`?slide=3&step=1`）的方式跳转 |
| Safari | 暂不重点兼容 |

产物里的页面按需加载用的是 `<script>` 标签，不用 fetch，所以**本地双击打开（file://）、任意域名托管、iframe 嵌入都能用**。

---

## 怎样安全地反馈效果不对的课件

请到 GitHub 提 Issue：<https://github.com/spitmaster/unppt/issues>

**最重要的一条：只分享你有权分享的文件。** Issue 是公开的，任何人都能下载附件。课件里如果有客户资料、内部数据、个人信息，**不要上传原文件**。

推荐的做法：

```mermaid
flowchart TD
  A["发现某页效果不对"] --> B{"这份课件可以公开吗？"}
  B -- "可以，我有权公开" --> C["直接附上 .pptx"]
  B -- "不确定 / 不可以" --> D["新建一个空白演示文稿"]
  D --> E["只复现出问题的那个特征<br/>文字换成占位内容，图片换成色块"]
  E --> F{"用 unppt 转一下<br/>问题还在吗？"}
  F -- "在" --> G["附上这个中性的 .pptx"]
  F -- "不在" --> H["再多还原一点特征<br/>（字体、字号、形状、效果）"]
  H --> F
  C --> I["Issue 里写明下面的信息"]
  G --> I
```

Issue 里请写明：

1. unppt 版本（`npx @unppt/unppt` 不带参数运行时第一行就是版本号）；
2. 完整的转码命令，例如 `unppt demo.pptx -o out`（有字体选项也写上）；
3. 命令行输出的 `字体：` 和 `提示：` 两类信息（或者 `unppt check` 的输出）；
4. 用的浏览器和版本；
5. 对照截图：PowerPoint 放映的画面和 unppt 播放的画面（截图同样只能用可以公开的内容）。

> 这也是项目自己遵守的规则：开发中用到的真实课件从不离开开发机，仓库里只有用 PowerPoint 重新合成的中性测试用例。见[还原度 · 样本安全](fidelity.md#7-样本安全客户文件绝不离开本机)。

---

## 版本号

- 当前版本 **0.3.1**，npm 包名 `@unppt/unppt`，需要 Node.js 20.12 或更高版本；
- 版本号格式是"主版本.次版本.修订号"。0.x 表示还在早期阶段，接口和选项可能随版本调整，升级前请看 GitHub 上的发布说明；
- 每个发布版本在 GitHub 上有对应的标签（`v0.1.0` 这样的格式）；同一个版本号在 npm 上只发布一次；
- 想固定版本：`npm install @unppt/unppt@0.3.1`，或 `npx @unppt/unppt@0.3.1 ...`；查看 npm 上的最新版本：`npm view @unppt/unppt version`；
- **产物格式有自己的版本号**：`deck.json` 里的 `"format": "unppt-deck", "version": 1`。格式有变化时增加这个数字，播放器遇到比自己新的版本会明确报错（提示升级播放器）；
- 每份产物都**带着自己的播放器**，所以已经转好的课件不受以后升级影响；想用新版本的效果，重新转码即可。
