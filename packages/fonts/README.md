# @unppt/fonts

[unppt](https://github.com/spitmaster/unppt) 的默认字体包：转码器 `@unppt/unppt` 依赖它，一般不需要单独安装。

The default font pack of [unppt](https://github.com/spitmaster/unppt), a dependency of `@unppt/unppt`.

## 内容 / Contents

| 目录 | 内容 |
|---|---|
| `files/` | 显示用的开源字体（30 个文件）：思源黑体 / 思源宋体（Noto Sans SC / Noto Serif SC）、霞鹜文楷（LXGW WenKai）、朱雀仿宋（Zhuque Fangsong）、Carlito、Caladea、Liberation Sans / Serif / Mono，以及 Wingdings 1~3 的编码兼容字体（见下） |
| `metrics/` | 排版用的字体度量：457 个 Windows / Office 字体的字宽、上下高度、字距调整等**数字**，没有字形 |
| `map.json` | 原字体 → 显示用的开源字体的对照规则 |
| `fonts.json` | 每个字体文件的来源网址、SHA-256、许可证 |

`Unppt Wingdings Compat`（以及 2、3）：字形取自 Noto Sans Symbols / Symbols 2 等开源字体，按 Wingdings 的编码重新排放（课件里的字符不变，显示出来就是对应的符号）。仓库里的生成件在 `compat/`，生成脚本 `tools/fonts/build-symbol-compat.py`，`fetch-fonts` 把它们和下载的字体一起放进 `files/`。

转码时：没嵌入的原字体（微软雅黑、宋体、Calibri……）按 `metrics/` 里的度量排版，换行和文字位置和 PowerPoint 一致；字形用 `map.json` 对应的开源字体，用到的字做成子集嵌入产物。观看的人不需要安装任何字体。

## 许可证 / Licenses

- `files/` 里的字体都是 **SIL Open Font License 1.1**，许可证全文在 `LICENSES/`（每个字体家族一份），来源见 `fonts.json`；Wingdings 兼容字体是 Noto Sans Symbols 等 OFL 字体的修改版，同样按 OFL 1.1 发布（`LICENSES/NotoSymbols-OFL.txt`）。
  All font files are licensed under the SIL OFL 1.1; see `LICENSES/` and `fonts.json`.
- `metrics/` 是从字体量出来的数字（字宽、行高、字距），不包含字形、不包含字体程序。这部分的授权（是否需要单独说明、以什么许可发布）**待法务确认**（SPEC D3），在那之前包的 `license` 字段写的是 `SEE LICENSE IN README.md`。
  `metrics/` contains numeric measurements only (advance widths, vertical metrics, kerning) and no glyphs or font programs; its licensing is pending legal review.
- `index.js`、`map.json`、`check-files.mjs` 等代码和数据：Apache-2.0（和 unppt 仓库一致）。

## 发布前 / Before publishing

字体文件不在 git 里。先在仓库根目录运行 `node scripts/fetch-fonts.mjs`（按 `fonts.json` 下载并校验），`npm pack` / `npm publish` 前的 `prepack` 会检查文件齐全，缺文件就失败。
