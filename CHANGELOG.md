# 更新日志 / Changelog

## 0.2.4（2026-10-20）

**中文**

- 命令行默认输出按需加载的形式（`paged`）：入口 `index.html` 只有几十 KB，每页的数据和图片看到那一页才加载，并预加载下一页，适合在线观看；本地双击照样能播（Chrome、Firefox 验证过）。以前默认的单文件形式会把所有图片塞进一个 HTML（大课件十几 MB），要用时加 `--output single`。
- `-o` 写成 `xxx.html` 时就把它当入口文件，其它文件放在它旁边；写目录时入口是目录里的 `index.html`。
- 在代码里调用 `convert()` 的默认形式不变（仍是 `single`）。

**English**

- The CLI now writes the on-demand form (`paged`) by default: the entry `index.html` is only tens of KB and each slide's data and images load when shown, with the next slide preloaded, so it suits online viewing; double-clicking locally still works (checked in Chrome and Firefox). The old default single file put every image into one HTML (over 10 MB for big decks); use `--output single` for that.
- `-o something.html` is used as the entry file with the rest next to it; `-o folder` puts the entry at `folder/index.html`.
- The default of `convert()` in code is unchanged (`single`).

## 0.2.3（2026-10-20）

**中文**

- 命令行默认使用本机系统字体（以前要加 `--system-fonts`）：按真实字宽排版，换行位置和 PowerPoint 一致。不加时字宽只能估算，像省略号"……"这类字宽度估错，一行会多塞或少塞几个字。不想用时加 `--no-system-fonts`；`--system-fonts` 仍然可以写。

**English**

- The CLI now uses the system fonts by default (previously `--system-fonts` was needed), so text wraps like PowerPoint. Without them widths are estimated and characters such as the ellipsis "……" can shift line breaks. Use `--no-system-fonts` to opt out; `--system-fonts` is still accepted.

## 0.2.2（2026-10-20）

**中文**

- 不写 `-o` 时，产物不再直接放在 pptx 旁边，而是在 pptx 旁边新建一个和它同名的文件夹，全部放进去：`课件.pptx` → `课件/index.html`（以及 `pic/`、`thum/`、`prop.json`、`media/`）。`--data` 时是 `课件/deck.json`。写了 `-o` 时照旧按指定位置。

**English**

- Without `-o`, output no longer lands next to the .pptx: a new folder named after it is created and everything goes inside: `deck.pptx` → `deck/index.html` (plus `pic/`, `thum/`, `prop.json`, `media/`); `--data` writes `deck/deck.json`. With `-o` nothing changes.

## 0.2.1（2026-10-20）

**中文**

- 发布流程自动化：推送版本标签后，GitHub Actions 自动构建、测试、创建 GitHub Release 并附上安装包 `unppt.tgz`，再用 npm 可信发布自动发布到 npm。
- 可以从 GitHub 下载安装（npm 审核新版本期间、公司内网镜像下载失败时用）：先下载 `https://github.com/spitmaster/unppt/releases/latest/download/unppt.tgz`，再 `npm install -g ./unppt.tgz`。
- 功能和 0.2.0 相同（0.2.0 没有发布到 npm）。

**English**

- Automated releases: pushing a version tag makes GitHub Actions build, test, create the GitHub Release with the `unppt.tgz` package attached, and publish to npm via trusted publishing.
- Install from GitHub (while npm reviews a version, or behind a corporate mirror): download `https://github.com/spitmaster/unppt/releases/latest/download/unppt.tgz`, then `npm install -g ./unppt.tgz`.
- Same features as 0.2.0 (0.2.0 was not published to npm).

## 0.2.0（2026-10-20）

**中文**

- 命令行简化：`unppt 课件.pptx` 直接转码，输出和 pptx 同名的 `.html`，放在 pptx 所在的文件夹；其它功能都用选项加。旧写法 `unppt convert 课件.pptx` 仍然可用。
- 新增 `unppt -v` / `--version`（版本号）、`unppt -h` / `--help`（用法）。
- 安装成命令：`npm install -g @unppt/unppt`（公司内网镜像下载失败时加 `--registry https://registry.npmjs.org/`）。

**English**

- Simpler CLI: `unppt deck.pptx` converts directly and writes `deck.html` next to the .pptx; everything else is an option. The old form `unppt convert deck.pptx` still works.
- New `unppt -v` / `--version` and `unppt -h` / `--help`.
- Install as a command: `npm install -g @unppt/unppt`.

## 0.1.0（2026-10-20）

第一个公开试用版。/ First public preview release.

**中文**

- 把 .pptx 转成自带播放器的网页：单文件 HTML（默认）、按需加载、每页一个 HTML、只出数据四种形式；附带整页图、缩略图和 `prop.json`。
- 播放器零依赖（约 58KB，gzip 后约 21KB）：动画、页面切换、音视频、超链接、触发器、自动换片；可以 iframe 嵌入，用 `postMessage`、同页 `window.unppt`、原生 WebView 控制；支持直播课的演绎 / 观看模式同步。
- 转码器是纯函数，不依赖外部程序和原生插件，可以放进云函数；大文件按位置读取，小内存可转。
- 准确度（和 Microsoft PowerPoint 导出的图片逐页比 SSIM，≥ 0.95 算通过）：合成用例 504 页通过 92.3%；随机 100 份真实课件 3527 页，转码失败 0，通过 78.8%，约 95% 的页 SSIM ≥ 0.90。
- 已知不足：图表日期轴的时间刻度、wordArtVert 竖排、可变字体、EMF+、部分需要重排的 SmartArt。
- 安装：`npm install @unppt/unppt`（命令 `unppt`），需要 Node.js 20.12+。文档：[README](README.md)、[docs/zh](docs/zh/)。

**English**

- Converts .pptx into web pages with a built-in player: single self-contained HTML (default), lazily loaded pages, one HTML per slide, or data only; plus slide images, thumbnails and `prop.json`.
- Zero-dependency player (about 58 KB, 21 KB gzipped): animations, transitions, audio/video, hyperlinks, triggers, auto-advance; embeddable in an iframe and controllable via `postMessage`, `window.unppt` or a native WebView; presenter/viewer sync for live classes.
- The transcoder is a pure function with no external programs or native addons, suitable for cloud functions; large files are read by position with little memory.
- Fidelity (per-page SSIM against images exported by Microsoft PowerPoint, pass at ≥ 0.95): synthetic test cases 92.3% of 504 pages; 100 random real-world decks, 3527 pages: 0 conversion failures, 78.8% pass, about 95% of pages at SSIM ≥ 0.90.
- Known gaps: chart date-axis time scaling, wordArtVert vertical text, variable fonts, EMF+, some SmartArt that needs re-layout.
- Install: `npm install @unppt/unppt` (command `unppt`), Node.js 20.12+. Docs: [README.en](README.en.md), [docs/en](docs/en/).
