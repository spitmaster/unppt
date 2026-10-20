# @unppt/unppt

把 PowerPoint（.pptx）转成**自带播放器的网页**：浏览器打开就能播放，可以用 iframe 嵌入任意网页，也可以由外部 JS 控制翻页、播放动画（适合直播课：老师和学生看同一份课件，外部程序用信令同步进度）。目标是效果和 Microsoft PowerPoint 一致。

- 转码器是纯函数：字节进、文件出，不读写磁盘、不联网，不依赖外部程序和原生插件，可以直接放进云函数；
- 产物里自带播放器（零依赖），观看只需要浏览器；
- 当前版本 0.2.2。

## 安装

```bash
npm install @unppt/unppt                   # 在代码里调用
npx -p @unppt/unppt unppt 课件.pptx  # 或者不安装，直接用命令行
```

需要 Node.js 20.12 及以上。

也可以从 GitHub Release 下载安装包再安装（npm 审核新版本期间、公司内网镜像下载失败时用）：先下载 `https://github.com/spitmaster/unppt/releases/latest/download/unppt.tgz`，再 `npm install -g ./unppt.tgz`。

## 命令行

```bash
unppt 课件.pptx -o out/index.html --system-fonts
unppt 课件.pptx -o out --output paged            # 按需加载：入口 HTML + 每页单独的数据文件
```

| 选项 | 说明 |
|---|---|
| `-o, --out <文件>` | 输出文件；`paged` / `pages` 形式下是输出目录 |
| `--output <形式>` | `single`（默认，一个自包含的 HTML）、`paged`（按需加载，看当前页时预加载下一页，适合放到网上）、`pages`（paged 再加每页一个独立的 HTML） |
| `--fonts <目录>` | 字体目录（可写多次），按真实字宽排版 |
| `--system-fonts` | 使用本机系统字体（Office 自带的私有字体用到时嵌入产物） |
| `--embed-fonts` | 把用到的字做成字体子集嵌入产物（商业字体注意授权） |
| `--no-images` | 不输出整页图 `pic/` 和缩略图 `thum/`（`prop.json` 照常输出） |
| `--stats` | 结束时显示用时和峰值内存 |

## 在代码里调用

```js
import { convert } from '@unppt/unppt';
import { readFile } from 'node:fs/promises';

const result = await convert(pptxBytes, {
  output: 'paged',
  // 产物文件交给你写：index.html、prop.json、pages/…、media/…、pic/1.jpg、thum/1.jpg……
  // data 可能是字符串、Uint8Array 或 AsyncIterable<Uint8Array>（数据流要读完，转码才会继续往下走）
  write: async (path, data) => { /* 写到磁盘、对象存储…… */ },
  fonts: [fontBytes],                                   // 可选：字体文件内容
  // 出整页图和缩略图要用 resvg 的 wasm（包里的 dist/resvg.wasm）；不给就只输出 prop.json
  rasterWasm: readFile(new URL(import.meta.resolve('@unppt/unppt/resvg.wasm'))),
});
console.log(result.slides, result.report.missingFonts, result.report.warnings);
```

大文件不必整个读进内存，传 `{ size, read(offset, length) }` 这样按位置读取的对象即可。

## 产物

| 文件 | 说明 |
|---|---|
| `index.html` | 播放页（自带播放器） |
| `prop.json` | 页数、画面宽高（磅）、缩略图宽高、每页的整页图 / 缩略图路径、演讲者备注（纯文本，换行是 `\n`）、是否隐藏 |
| `pic/{n}.jpg`、`thum/{n}.jpg` | 整页图（960 宽）和缩略图（216 宽），页号从 1 开始 |
| `pages/`、`fonts/`、`media/` | 按需加载形式的每页数据、嵌入字体、图片和音视频 |

```json
{ "count": 2, "picw": 960, "pich": 540, "thumw": 216, "thumh": 122,
  "slides": [{ "index": 1, "thum": "thum/1.jpg", "pic": "pic/1.jpg", "note": "备注" },
             { "index": 2, "thum": "thum/2.jpg", "pic": "pic/2.jpg", "hidden": 1 }] }
```

## 播放与外部控制

- URL 参数：`slide`、`step` 打开时定位（从 0 开始）；`ui=0` 隐藏自带的翻页按钮；`mode=watch` 观看模式（只接受 JS 控制，点击、键盘不翻页）；`links=0` 不打开课件里的外部链接（外部链接默认在新标签页打开）。
- 同页 JS：`window.unppt.next()`、`window.unppt.goto({ slide, step })`、`window.unppt.on('change', fn)`；
- iframe（可跨域）：`postMessage({ unppt: 1, id: 1, cmd: 'goto', args: { slide: 3, step: 0 } }, '*')`，播放器回复 `{ unppt: 1, re: 1, ok: true, result }`，事件 `{ unppt: 1, event: 'ready' | 'change' | 'end' | 'link', data }`。

## 文档 / Documentation

完整文档（中英文，含架构图、流程图）在 GitHub / Full docs (Chinese & English, with diagrams) on GitHub：

| 中文 | English |
|---|---|
| [快速上手](https://github.com/spitmaster/unppt/blob/main/docs/zh/getting-started.md) | [Getting started](https://github.com/spitmaster/unppt/blob/main/docs/en/getting-started.md) |
| [命令行与 API](https://github.com/spitmaster/unppt/blob/main/docs/zh/usage.md) | [CLI & API](https://github.com/spitmaster/unppt/blob/main/docs/en/usage.md) |
| [嵌入与外部控制](https://github.com/spitmaster/unppt/blob/main/docs/zh/embedding.md) | [Embedding & control](https://github.com/spitmaster/unppt/blob/main/docs/en/embedding.md) |
| [架构设计](https://github.com/spitmaster/unppt/blob/main/docs/zh/architecture.md) | [Architecture](https://github.com/spitmaster/unppt/blob/main/docs/en/architecture.md) |

## 许可证

Apache-2.0。整页图光栅化用到的 resvg（MPL-2.0）见 THIRD-PARTY-NOTICES.md。
