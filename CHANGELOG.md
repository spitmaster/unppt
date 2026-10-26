# 更新日志 / Changelog

## 0.3.1（未发布）

**中文**

0.3.0 发布当天发现表格问题，已从 npm 撤回；0.3.1 包含 0.3.0 的全部内容，另外：

- 表格单元格的"水平居中"（`anchorCtr`）：和文本框一样，整块文字在单元格里居中、各段的对齐在块里。以前（0.2.x 起）没处理，
  单元格写"左对齐 + 水平居中"的表格（常见于模板）整列文字靠左。
- 字体名写"思源黑体 CN Light / ExtraLight"（Source Han Sans Light）的文字用字体包里的思源黑体细体（Noto Sans SC Light），以前按常规体显示。
- 用本机字体（`--system-fonts`）时，思源黑体 / 思源宋体 / Noto Sans SC / Noto Serif SC 的文字整页画成细线、粗体只是人工加粗：
  Windows 上这两个字体是可变字体（默认实例是 Thin / ExtraLight），以前直接按默认实例用。现在常规取 Regular 实例、粗体取 Bold 实例
  （和 PowerPoint 一致，实测），有同名固定字重的字体时直接用它；嵌入的字体子集不再带可变数据。
- 默认字体包里的思源宋体粗体以前用不上（粗体的思源宋体只能人工加粗），现在用真正的粗体。
- 转动或翻转的公式（Office 数学公式）方向画错：例如转 270° 的 ¬ 画成上下颠倒、翻转的公式被镜像；带边框的公式框不再重影。
- 修 0.3.0 引入的排版回退（全量课件逐页比对发现）：悬挂缩进的段落缩进取整多出 1/8 磅，刚好放得下的行多折一行；表格单元格水平居中
  没算段落右缩进；关掉中文首尾字符控制（`eaLnBrk="0"`）时破折号前不断行；允许西文单词中间换行时 `1:3` 这类冒号不悬挂。
  现在缩进只取整到 1/20 磅，断行按"行首起点 + 行宽 + 右缩进"取整到 1/8 磅后和框宽比（PowerPoint 实测）。

**English**

0.3.0 was withdrawn from npm on release day because of a table problem; 0.3.1 contains everything in 0.3.0, plus:

- Table cells honour "center horizontally" (`anchorCtr`) like text boxes: the block of text is centered in the cell, each paragraph keeps its own
  alignment inside the block. Before (since 0.2.x) it was ignored, so tables whose cells say "left aligned + centered" (common in templates) showed
  their text flush left.
- Text in "Source Han Sans CN Light / ExtraLight" (思源黑体 CN Light) uses the pack's Noto Sans SC Light; before it was shown in the regular weight.
- With `--system-fonts`, text in Source Han Sans/Serif, Noto Sans SC or Noto Serif SC was drawn as hairlines and bold was only faked: the
  Windows copies are variable fonts with a Thin/ExtraLight default instance. Variable fonts now use the Regular instance for normal text and
  the Bold instance for bold, as PowerPoint does (measured); a static face of the same family is preferred, and embedded subsets no longer
  carry variation data.
- The bold Noto Serif SC face in the default font pack was never loaded (bold serif CJK text got fake bold); it is used now.
- Rotated or flipped Office math equations were drawn in the wrong orientation (e.g. a ¬ rotated 270° came out upside down, flipped
  equations were mirrored); bordered equation boxes no longer show a doubled border.
- Fixed layout regressions introduced in 0.3.0 (found by the full per-page comparison): hanging-indent paragraphs were indented 1/8 pt too
  far, so lines that just fit wrapped one character early; centered table cells ignored the paragraph right indent; with East Asian
  line-break control off (`eaLnBrk="0"`) the text could not break before an em dash; with `latinLnBrk="1"` a colon as in `1:3` did not hang.
  Indents are now rounded to 1/20 pt only, and a line fits when (line start + width + right indent), rounded up to 1/8 pt, fits the box
  (measured in PowerPoint).

## 0.3.0（2026-10-23，已撤回 / withdrawn）

**中文**

**字体方案改了（不兼容变化）**：播放时绝不用观看者电脑上的字体，所有观看者看到的完全一样（直播课几千人同时看也一样）。

- 新增默认字体包 `@unppt/fonts`（安装 `@unppt/unppt` 时自动带上，下载约 67MB）：开源字体（思源黑体 / 宋体、霞鹜文楷、朱雀仿宋、Carlito、Caladea、Liberation，都是 SIL OFL 1.1）+ 457 个 Windows / Office 字体的度量数据（只有字宽等数字，没有字形）。
- **排版按原字体，显示用开源字体**：没嵌入的微软雅黑、宋体、Calibri 等按原字体的字宽排，换行和文字位置和 PowerPoint 一样；显示用对应的开源字体，每个字放在原字体的格子里（横向居中，汉字竖直中心对齐）。
- 产物里的字体只有两个来源：PPT 里嵌入的字体和默认字体包。**默认不再用转码电脑上的系统字体**（要用加 `--system-fonts`）；`--fonts <目录>` 指定字体文件，同名时优先。用到的字一律做成子集嵌入产物（`--embed-fonts` 不再需要）。
- 符号字体不改动原文的字：**Wingdings、Wingdings 2、Wingdings 3 没嵌入时用字体包里编码兼容的开源字体显示成符号**（■ ➢ ● ✔ ◆ ❖ 等项目符号和正文里的符号，字形取自 Noto Sans Symbols 等，大小位置按 Wingdings 对齐）；其它符号字体（Webdings、Symbol 等）没嵌入时转码报告提示作者在 PowerPoint 里嵌入字体。
- 新增字体检查：`unppt check 课件.pptx [--json]` / `checkFonts()`，列出每个字体是嵌入的、默认字体包的、被替代的还是缺的，以及哪些字没有字形；转码结束时也提示有问题的字体。
- 能读 CFF 轮廓的字体（.otf，例如思源字体），艺术字变形也能用。
- 图表文字、整页图和缩略图同样只用嵌入的字体；显示用的开源字体缺字时换字体包里别的开源字体画（不交给浏览器）。
- 思源黑体 / Source Han Sans（含"CN"和粗细后缀）、思源宋体按字体包里同一套字形的思源字体排版和显示。
- 发布前的代码审查修正：默认字体包为 **0.3.1**（度量包补上含空格的字距对——Arial、Times New Roman、Gill Sans MT 等带空格的行排版和 PowerPoint 一致；去掉一个只有生僻字的补字字体；Wingdings 兼容字体补上名字，整页图和缩略图里的符号也能画出来）；同一家族有几个粗字重时粗体按 Bold（700）排版（实测）；图表里中西文混排的标签（例如"1月"）在整页图、缩略图里按各自的字体画；符号字体用 PPT 嵌入的、`--fonts` / `--system-fonts` 给的字体时，嵌入的子集能正确显示；多个原字体共用一个开源字体文件时出图只加载一份（省内存）；很长的空格段、很多制表符的段落排版不再变慢；命令行参数写错时退出码是 2（1 留给 `unppt check` 发现必须处理的问题）。

**自动换行和 PowerPoint 一致**：新增专项测试（`tools/wraptest`：用 PowerPoint 随机造几千个文本框、表格和各种形状，并对照真实课件读出每一行），按实测改了二十多条规则——破折号、省略号、弯引号、不间断空格、行首 / 行尾禁则（含隔着空格）、标点悬挂的例外、网址和小数里的半角标点、± × § ° 等符号、行尾字距、段落缩进的取整、自动缩小不缩字间距、没嵌入的符号字体项目符号的宽度、没写文字矩形的几何（自定义形状、宽度为 0 的老标题）不换行、饼形的文字区域等。对照结果：PowerPoint 随机生成的 3400 多个文本框、761 个表格单元格、181 种预设形状，换行和 PowerPoint 完全一致的 99.6% 以上；真实课件 398 份、约 1.45 万个多行文本框和 886 个多行表格单元格，和 PowerPoint 不一致的行从 512 行降到 45 行（共约 6.5 万行）；扩大到 991 份真实课件（约 4 万个多行文本框）99.8% 完全一致。

**English**

**New font strategy (breaking change)**: the player never uses fonts installed on the viewer's device, so every viewer sees exactly the same thing.

- New default font pack `@unppt/fonts` (installed with `@unppt/unppt`, ~67 MB download): open fonts (Noto Sans / Serif SC, LXGW WenKai, Zhuque Fangsong, Carlito, Caladea, Liberation — all SIL OFL 1.1) plus metrics (advance widths etc., no glyphs) of 457 Windows / Office fonts.
- **Layout uses the original font, display uses an open font**: Microsoft YaHei, SimSun, Calibri… that are not embedded are laid out with their own metrics, so line breaks and positions match PowerPoint; glyphs come from the matching open font, centered in the original font's cell (CJK vertically centered).
- Fonts in the output come only from fonts embedded in the .pptx and the default pack. **System fonts on the converting machine are no longer used by default** (`--system-fonts` to opt in); `--fonts <dir>` adds your own fonts, which win on name clashes. Used glyphs are always subset into the output (`--embed-fonts` is no longer needed).
- Characters in symbol fonts are never changed: **Wingdings, Wingdings 2 and Wingdings 3 that are not embedded display as symbols through code-compatible open fonts in the pack** (■ ➢ ● ✔ ◆ ❖ bullets and inline symbols; glyphs from Noto Sans Symbols and others, sized and positioned like Wingdings); other symbol fonts (Webdings, Symbol, …) that are not embedded make the report ask the author to embed them.
- New font check: `unppt check deck.pptx [--json]` / `checkFonts()` lists each font as embedded / default pack / substituted / missing, plus characters without glyphs; conversion also prints problem fonts.
- CFF-outline fonts (.otf, e.g. Source Han) are supported, including WordArt warps.
- Chart text, page images and thumbnails also use only embedded fonts; characters missing from an open display font are drawn with another font from the pack instead of the browser's.
- Source Han Sans / Serif (including "CN" names and weight suffixes) are laid out and shown with the pack's identical Noto Sans / Serif SC.
- Fixes from the pre-release review: the default font pack is **0.3.1** (metrics now include kerning pairs with the space, so Arial, Times New Roman, Gill Sans MT etc. lay out lines with spaces like PowerPoint; a supplement-only font was removed; the Wingdings compat fonts got proper names so symbols also draw in page images and thumbnails); when a family has several bold weights, bold uses Bold (700) (measured); chart labels mixing Latin and CJK (e.g. "1月") draw each part with its own font in page images and thumbnails; symbol fonts embedded in the PPT or given with `--fonts` / `--system-fonts` now embed working subsets; original fonts sharing one open font file load it once for page images (less memory); very long runs of spaces or many tabs no longer slow layout down; wrong command-line arguments exit with code 2 (1 is reserved for `unppt check` finding problems that must be fixed).

**Automatic line wrapping matches PowerPoint**: a new test harness (`tools/wraptest`: thousands of random text boxes, tables and shapes generated in PowerPoint, plus real decks, compared line by line) drove 20+ rule fixes — dashes, ellipses, curly quotes, no-break spaces, CJK line-start/line-end rules (also across spaces), hanging punctuation exceptions, ASCII punctuation in URLs and decimals, ± × § °, kerning at line ends, paragraph indent rounding, autofit not shrinking letter spacing, widths of non-embedded symbol bullet fonts; geometries without a text rectangle (custom shapes, zero-width legacy titles) no longer wrap, and the pie text area is fixed. Over 3,400 random text boxes, 761 table cells and all 181 preset shapes generated in PowerPoint, 99.6%+ break exactly like PowerPoint; on 398 real decks (~14.5k multi-line text boxes and 886 multi-line table cells) lines that differ from PowerPoint dropped from 512 to 45 (out of ~65k); across 991 real decks (~40k multi-line text boxes) 99.8% break exactly like PowerPoint.

## 0.2.6（2026-10-22）

**中文**

用三批真实课件（1.1 万页）逐页对照 PowerPoint 修的问题：

- 文字里直接写的回车、换行符按分段排（每段各有段距、项目符号），以前挤成一段；
- 细明体等 Office 云字体嵌入后浏览器不再拒绝；
- 视频画面按图片的裁剪显示；
- 表格空单元格也撑高行；允许西文单词中间断行（latinLnBrk）；kern="0" 不做字距调整；自动编号遇到符号字体时用正文字体，起始编号不同重新计数；
- 图表：坐标轴没写线条时画默认线；数据挤在一起时数值轴不从 0 起；主轴删掉时两轴共用刻度；日期轴用坐标轴自己的数字格式；数值没缓存的空系列不画、不进图例；透明标记不画；默认系列名"系列N"；
- 图例：下方 / 上方图例一行放不下时排成多行网格；竖排图例放不下只画前几项；支持删除单个图例项；饼图标签在扇区内时不缩小饼；
- EMF 细线至少 1 像素；缩到几乎没有的阴影不画。

**English**

Fixes found by comparing three batches of real decks (11k slides) with PowerPoint:

- Carriage returns / line feeds inside text are paragraph breaks (each part gets its own spacing and bullet);
- Embedded Office cloud fonts (e.g. MingLiU) are no longer rejected by browsers;
- Video frames honor the picture crop;
- Empty table cells contribute to row height; latinLnBrk (break inside Latin words); kern="0" disables kerning; auto-numbers ignore symbol bullet fonts and restart when startAt differs;
- Charts: default axis/gridlines when none are written; value axis no longer starts at 0 when data are tightly clustered; shared scale when the primary axis is deleted; date axis number format; series without cached values are skipped (incl. legend); transparent markers hidden; default series name "系列N";
- Legends: bottom/top legends wrap into a grid when one row doesn't fit; vertical legends show only the entries that fit; deleted legend entries; pies with inside labels are not shrunk;
- EMF hairlines are at least 1 px; shadows scaled to almost nothing are not drawn.

## 0.2.5（2026-10-20）

**中文**

- 播放母版、版式上的动画：PowerPoint 放映时先播母版的、再播版式的、最后是幻灯片自己的，以前母版和版式上的动画完全不播（例如首页标题、横线由版式上的自动动画依次出现）。
- 从头打开播放页时，第一页的自动动画会播放（以前直接显示播完的样子）；指定了起始页、步骤时仍然直接显示那一步。
- 说明：第一页设置了"单击鼠标时换片"关闭（`advClick="0"`）的课件，单击不翻页、键盘和翻页按钮可以，和 PowerPoint 一样。

**English**

- Animations on slide masters and layouts now play (master first, then layout, then the slide's own, as in PowerPoint); previously they were ignored.
- Opening the player from the start now plays the first slide's automatic animations instead of showing their end state; deep links to a slide/step still jump straight there.
- Note: if a slide turns off "advance on mouse click" (`advClick="0"`), clicks don't advance it but keys and the next button do, matching PowerPoint.

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
