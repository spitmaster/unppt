# 更新日志 / Changelog

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
