# @unppt/unppt

[中文说明](https://github.com/spitmaster/unppt/blob/main/README.md)

Convert PowerPoint decks (.pptx) into a web page with one command: open it in a browser and it plays, with animations, transitions, audio and video, looking the same as in PowerPoint. It can also be embedded in any web page or app and driven from code.

## Install

Requires Node.js 20.12 or later.

```bash
npm install -g @unppt/unppt
```

## Usage

```bash
unppt slides.pptx
```

Open the generated `slides/index.html` in a browser.

More options, embedding, and the JavaScript API → [docs/en/usage.md](https://github.com/spitmaster/unppt/blob/main/docs/en/usage.md)

## Highlights

The transcoder is a pure function (bytes in, files out; no disk or network access, no external programs or native add-ons — it runs in cloud functions). The output carries a zero-dependency player, so viewers only need a browser. Viewers' own fonts are never used: the glyphs needed are subset and embedded, so every viewer sees exactly the same.

## Command line

```bash
unppt slides.pptx -o out                           # default: on-demand loading, an entry HTML plus one data file per slide
unppt slides.pptx -o out/index.html --output single # one self-contained HTML file
unppt check slides.pptx                            # check fonts only (embedded / default font pack / substituted / missing), no output
npx @unppt/unppt slides.pptx                       # run once without installing
```

| Option | Meaning |
|---|---|
| `-o, --out <file>` | Output file; the output directory for the `paged` / `pages` forms |
| `--output <form>` | `paged` (default: loads slides on demand and preloads the next one, good for hosting), `single` (one self-contained HTML, good as an attachment), `pages` (`paged` plus one standalone HTML per slide) |
| `--fonts <dir>` | Font directory (repeatable): wins over the default font pack for the same name, used for layout and display, glyphs embedded |
| `--system-fonts` | Also use the machine's system and Office fonts (**off by default** since 0.3.0; glyphs are embedded — mind commercial font licences) |
| `--no-default-fonts` | Do not use the default font pack (for debugging) |
| `--no-images` | Skip page images `pic/` and thumbnails `thum/` (`prop.json` is still written) |
| `--stats` | Print time and peak memory at the end |

## From code

```bash
npm install @unppt/unppt
```

```js
import { convert } from '@unppt/unppt';
import { loadFontPack } from '@unppt/unppt/node';   // Node only: reads the installed default font pack
import { readFile } from 'node:fs/promises';

const result = await convert(pptxBytes, {
  output: 'paged',
  // you write the output files: index.html, prop.json, pages/…, media/…, pic/1.jpg, thum/1.jpg …
  // data may be a string, a Uint8Array or an AsyncIterable<Uint8Array> (read streams to the end so conversion can continue)
  write: async (path, data) => { /* to disk, object storage … */ },
  // default font pack: without it, fonts that are not embedded can only be estimated and are drawn with the viewer's fonts
  fontPack: await loadFontPack(),
  fonts: [fontBytes],                                   // optional: your own font files, win over the pack for the same name
  // page images and thumbnails need resvg's wasm (dist/resvg.wasm in the package); without it only prop.json is written
  rasterWasm: readFile(new URL(import.meta.resolve('@unppt/unppt/resvg.wasm'))),
});
console.log(result.slides, result.fontCheck, result.report.warnings);
```

Fonts only: `checkFonts(pptxBytes, { fontPack })`.

## Fonts

- **Fonts in the output come from two sources only** (unless you pass `--fonts` / `--system-fonts`): fonts embedded in the deck, and the open-source fonts of the default font pack `@unppt/fonts` (SIL OFL 1.1). The pack is installed with `@unppt/unppt` (about 67 MB download, about 100 MB installed) and is only needed on the converting machine.
- **Laid out with the original font, displayed with an open-source font**: Microsoft YaHei, SimSun, Calibri and other fonts that are not embedded are laid out with the original font's metrics (just widths and such numbers), so line breaks and positions match PowerPoint; they are displayed with a matching open-source font (Microsoft YaHei → Noto Sans SC, Calibri → Carlito …). Fonts the pack does not know (including Source Han Sans / Serif when not embedded) are substituted the way PowerPoint does.
- **Symbol fonts** (Wingdings and others) keep their characters: Wingdings 1–3 that are not embedded are shown with encoding-compatible open-source fonts from the pack; for other symbol fonts the conversion report and `unppt check` ask the author to embed the font in PowerPoint.

Large files need not be read into memory: pass an object like `{ size, read(offset, length) }` that reads by position.

## Output

| File | Contents |
|---|---|
| `index.html` | The player page (player included) |
| `prop.json` | Slide count, slide size (points), thumbnail size, page-image / thumbnail paths per slide, speaker notes (plain text, `\n` line breaks), hidden flag |
| `pic/{n}.jpg`, `thum/{n}.jpg` | Page image (960 wide) and thumbnail (216 wide), slides numbered from 1 |
| `pages/`, `fonts/`, `media/` | Per-slide data, embedded fonts, images and media of the on-demand form |

```json
{ "count": 2, "picw": 960, "pich": 540, "thumw": 216, "thumh": 122,
  "slides": [{ "index": 1, "thum": "thum/1.jpg", "pic": "pic/1.jpg", "note": "notes" },
             { "index": 2, "thum": "thum/2.jpg", "pic": "pic/2.jpg", "hidden": 1 }] }
```

## Playback and external control

- URL parameters: `slide`, `step` to open at a position (0-based); `ui=0` hides the built-in navigation buttons; `mode=watch` viewer mode (JS control only, clicks and keys do not advance); `links=0` does not open the deck's external links (by default they open in a new tab).
- Same-page JS: `window.unppt.next()`, `window.unppt.goto({ slide, step })`, `window.unppt.on('change', fn)`.
- iframe (cross-origin): `postMessage({ unppt: 1, id: 1, cmd: 'goto', args: { slide: 3, step: 0 } }, '*')`; the player replies `{ unppt: 1, re: 1, ok: true, result }` and sends events `{ unppt: 1, event: 'ready' | 'change' | 'end' | 'link', data }`.

## Documentation

Full documentation (English and Chinese, with diagrams) on GitHub:

| English | 中文 |
|---|---|
| [Getting started](https://github.com/spitmaster/unppt/blob/main/docs/en/getting-started.md) | [快速上手](https://github.com/spitmaster/unppt/blob/main/docs/zh/getting-started.md) |
| [CLI & API](https://github.com/spitmaster/unppt/blob/main/docs/en/usage.md) | [命令行与 API](https://github.com/spitmaster/unppt/blob/main/docs/zh/usage.md) |
| [Embedding & control](https://github.com/spitmaster/unppt/blob/main/docs/en/embedding.md) | [嵌入与外部控制](https://github.com/spitmaster/unppt/blob/main/docs/zh/embedding.md) |
| [Architecture](https://github.com/spitmaster/unppt/blob/main/docs/en/architecture.md) | [架构设计](https://github.com/spitmaster/unppt/blob/main/docs/zh/architecture.md) |
| [Test report](https://github.com/spitmaster/unppt/blob/main/docs/en/test-report.md) | [测试报告](https://github.com/spitmaster/unppt/blob/main/docs/zh/test-report.md) |

## License

Apache-2.0. resvg (MPL-2.0), used for rasterizing page images, is listed in THIRD-PARTY-NOTICES.md.
