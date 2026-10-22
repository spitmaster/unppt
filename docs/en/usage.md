[中文](../zh/usage.md)

# Usage

This is the reference manual: section 2 lists **every** command-line option, section 3 explains how to call `convert()` from JavaScript, and section 4 gives three examples you can adapt directly: a Node script, an HTTP server and a cloud function.

Haven't installed unppt yet? Start with [Getting Started](getting-started.md).

---

## 1. Choose an output form first

unppt writes four output forms (the `--output` / `output` option). If you are not sure which one, follow this chart:

```mermaid
flowchart TD
  S(["Start"]) --> Q1{"Just debugging, want the raw data?"}
  Q1 -->|"Yes"| D["data<br/>deck.json only, no player"]
  Q1 -->|"No"| Q2{"Loaded over the web,<br/>and many slides or large files?"}
  Q2 -->|"No: send to people, open locally, small deck"| SG["single<br/>one HTML does it all (API default)"]
  Q2 -->|"Yes"| Q3{"Need to open or embed a single slide?"}
  Q3 -->|"No"| PG["paged (CLI default)<br/>loads only the slide being viewed"]
  Q3 -->|"Yes"| PS["pages<br/>paged + one page-001.html per slide"]
```

| Form | Images | Font subsets | Audio/video | Main file |
|---|---|---|---|---|
| `single` | Smaller than `inlineLimit` (default 2 MB) are inlined in the HTML, the rest go to `media/` | Inlined in the HTML | `media/` | `index.html` (or the name given by `-o`) |
| `paged` | All written to `media/` | `fonts/<alias>.<hash>.js` | `media/` | `index.html` + `pages/<n>.<hash>.js` |
| `pages` | Same as `paged` | Same as `paged` | `media/` | Same as `paged`, plus `page-001.html`… |
| `data` | All written to `media/` | `fonts/<alias>.woff` | `media/` | `deck.json` |

Every form also writes `prop.json`, and by default `pic/{n}.jpg` and `thum/{n}.jpg`. Each file is explained in [Getting Started, section 5](getting-started.md#5-what-is-in-the-output-folder).

---

## 2. CLI reference

### 2.1 Syntax

```bash
unppt <input.pptx> [-o output] [options]
```

- The first argument is the input file. With no options it creates a folder named after the .pptx next to it and writes everything there (open `index.html` inside to play). Everything else is an option.
- The 0.1.0-and-earlier form `unppt convert <input.pptx>` still works (`convert` is optional since 0.2.0).
- `unppt check <input.pptx> [--json] [font options]` only checks fonts and writes no files; see [2.6](#26-checking-fonts-only-unppt-check).
- `unppt -v` prints the version, `unppt -h` prints the usage.
- With no arguments, wrong arguments, or an unknown option, it prints the version and usage and exits with code 1.
- If conversion fails (e.g. the file is not a valid pptx) it prints the error and exits with code 1. On success the exit code is 0.

### 2.2 All options

Everything below comes from `packages/transcoder/src/cli.ts`. Without any font option, the fonts embedded in the PPT plus the default font pack `@unppt/fonts` (installed automatically with `@unppt/unppt`) are used, and every viewer sees the same thing; see [Getting started, section 7](getting-started.md#7-fonts-why-they-matter-and-how-they-are-handled-now) for how fonts are handled.

| Option | Value | Default | Description |
|---|---|---|---|
| `-o`, `--out <path>` | file or folder | see 2.3 | For `single` / `data` the output file; for `paged` / `pages` the output **folder** (entry is `index.html` inside it) |
| `--output <form>` | `single`, `paged`, `pages`, `data` (`html` is the old name of `single`) | `paged` (since 0.2.4; `convert()` in code still defaults to `single`) | Output form. An unknown form is an error |
| `--data` | none | off | Same as `--output data` |
| `--fonts <dir>` | folder | none | Explicit font folder; `.ttf` / `.otf` / `.ttc` inside it are read recursively. They win over the default font pack for the same name, are used for layout and display, and the characters used are embedded. Can be repeated |
| `--system-fonts` | none | off | Also use this machine's system fonts and Office private / cloud fonts for layout and display, embedding the characters used (**mind commercial font licenses**). **Off by default since 0.3.0** (it was on by default in 0.2.3–0.2.6) |
| `--no-system-fonts` | none | — | Old option, still accepted, no effect |
| `--no-default-fonts` | none | off | Do not use the default font pack `@unppt/fonts` (debugging; widths of fonts without a font file can only be estimated) |
| `--embed-fonts` | none | — | Old option, still accepted, no effect: since 0.3.0 subsets of every font used are always embedded |
| `--no-images` | none | images on | Do not write slide images `pic/` and thumbnails `thum/` (`prop.json` is still written) |
| `--jobs <n\|auto>` | positive integer or `auto` | `auto` | How many threads draw slide images in parallel. `auto` takes the smaller of the CPU count (the CPU quota inside a container) and available memory (400 MB budgeted per thread); `1` draws on the main thread |
| `--inline-limit <bytes>` | number | `2097152` (2 MB) | Images smaller than this are inlined in the HTML (only affects `single`) |
| `--stats` | none | off | Print slide count, time and peak memory at the end |
| `-q`, `--quiet` | none | off | Show no progress and no result lines (including font problems and notices) |
| `-v`, `--version` | none | — | Print the version only |
| `-h`, `--help` | none | — | Print the usage (exit code 0) |

### 2.3 Where output goes without `-o`

It goes into **a new folder next to the input, named after it** (since 0.2.2; earlier versions wrote next to the input):

| Form | Output of `unppt D:\work\demo.pptx` |
|---|---|
| `single` | `D:\work\demo\index.html` |
| `paged` / `pages` | `D:\work\demo\index.html` |
| `data` | `D:\work\demo\deck.json` |

`media/`, `pic/`, `thum/`, `fonts/` and `prop.json` are written in **the folder of the main file**, so without `-o` they all stay inside that folder instead of mixing with your `.pptx`. With `-o` they follow the path you give, e.g. `-o new-folder/index.html`.

### 2.4 Console output

The CLI messages are in Chinese:

```text
转码中 12/12 页                                   ← progress, "converting 12/12" (to stderr)
统计：12 页，用时 4.2 秒，峰值内存 310 MB         ← stats: slides, time, peak memory (with --stats; printed before the "done" line)
完成：12 页，用时 4.2 秒 -> D:\work\out\index.html  ← done: slides, seconds, output path
字体：                                            ← fonts: only when there are font problems; lists ⚠ / ✗ fonts (same format as unppt check)
  ✗ Wingdings  第 3 页   符号字体没有嵌入，符号会显示成字母：请在 PowerPoint 里勾选"将字体嵌入文件"
提示：……                                          ← one line per warning ("notice")
```

(The `✗` line says: Wingdings on slide 3 is a symbol font that is not embedded, so symbols will show as letters; tick "Embed fonts in the file" in PowerPoint.)

If the default font pack cannot be found, an extra line `提示：没找到默认字体包 @unppt/fonts，没有嵌入的字体只能估算字宽` ("default font pack not found; widths of non-embedded fonts can only be estimated") is printed first.

### 2.5 Common combinations

```bash
# Most common: on-demand loading, works on a website or by double-clicking (fonts: embedded in the PPT + default font pack)
unppt demo.pptx -o site/demo

# One self-contained HTML file, good as an attachment
unppt demo.pptx -o out/index.html --output single

# One HTML per slide
unppt demo.pptx -o site/demo --output pages

# Check fonts first (writes no files)
unppt check demo.pptx

# On a server: add your own font folder, no images, quiet
unppt demo.pptx -o out/index.html --fonts /opt/fonts --no-images -q

# Use this machine's fonts (glyphs match the author's computer; mind commercial font licenses)
unppt demo.pptx -o out --system-fonts

# Low-memory machine: one image thread, show peak memory
unppt demo.pptx -o out/index.html --jobs 1 --stats

# Data only
unppt demo.pptx --data -o out/deck.json
```

### 2.6 Checking fonts only: `unppt check`

```bash
unppt check <input.pptx> [--json] [--fonts dir]... [--system-fonts] [--no-default-fonts]
```

Only checks fonts (which are missing, what substitutes them, whether symbol fonts are embedded), **writes no files**, and takes a few seconds. Font options work as for conversion; the result describes a conversion with those fonts.

```text
字体检查：text-latin-cjk-font.pptx（共 1 页）
  ⚠ 楷体_GB2312  第 1 页   没有这个字体，按 Microsoft YaHei 替代（字形和换行可能和作者电脑上不同）
  ✓ 等线         第 1 页   排版按原字体，显示用 思源黑体（Noto Sans SC）
  ✓ 宋体         第 1 页   排版按原字体，显示用 思源宋体（Noto Serif SC）
  ✓ Arial        第 1 页   排版按原字体，显示用 Liberation Sans
结论：0 个必须处理的问题（✗），1 个提醒（⚠）
```

- With `--json` it prints the same JSON that [`checkFonts()`](#38-checkfontsinput-options-checking-fonts-only) returns.
- The **exit code is 1** when there is any ✗ (a problem that must be fixed, e.g. a symbol font not embedded), otherwise 0. A product can use it to reject problematic decks on upload, or to warn the author.
- See [Getting started 7.5](getting-started.md#75-checking-fonts-unppt-check) for what each mark (✓ / ⚠ / ✗) means and an English reading of the output.

---

## 3. JavaScript API

### 3.1 What the package contains

| Import path | Contents | Runs in |
|---|---|---|
| `@unppt/unppt` | `convert()`, `checkFonts()`, `createPainter()`, `UNPPT_VERSION`, and the types `ConvertOptions`, `ConvertResult`, `FontPack`, `FontCheck`, `InputSource`, `RandomAccessSource`, `WriteData`, `WriteFn`, `RasterPool` etc. | Any environment (Node, browser, cloud function); no disk, no network |
| `@unppt/unppt/node` | `createRasterPool()`, `autoWorkers()`, `loadFontPack()`, type `NodeRasterPool` | Node only (multi-threaded image drawing with `worker_threads`; reading the default font pack from disk) |
| `@unppt/unppt/resvg.wasm` | The resvg WASM file used to draw images | Read as a file and pass to `rasterWasm` or `createRasterPool` |

The package is an ES module (`"type": "module"`); load it with `import`.

**Pure function** means: `convert()` never touches the file system or the network itself. You hand it the pptx **bytes**, and it **hands the output files back** through your `write` callback. Where they go (disk, memory, object storage) is up to you.

### 3.2 `convert(input, options)`

```ts
function convert(input: InputSource, options: ConvertOptions): Promise<ConvertResult>
```

```mermaid
classDiagram
  class ConvertOptions {
    +write: WriteFn
    +fontPack?: FontPack
    +fonts?: InputSource[]
    +privateFonts?: InputSource[]
    +output?: string
    +fileName?: string
    +inlineLimit?: number
    +embedFonts?: boolean
    +images?: boolean
    +rasterWasm?: Uint8Array or Promise
    +rasterPool?: RasterPool
    +onProgress?: function
  }
  class ConvertResult {
    +slides: number
    +width: number
    +height: number
    +report: DeckReport
    +fontCheck: FontCheck
  }
  class DeckReport {
    +missingFonts: string[]
    +warnings: string[]
  }
  class FontCheck {
    +fonts: FontCheckEntry[]
    +missingChars: object[]
    +errors: number
    +warnings: number
  }
  class RandomAccessSource {
    +size: number
    +read(offset, length) Promise~Uint8Array~
  }
  class RasterPool {
    <<interface>>
    +size: number
    +paint(job, resources) Promise~PaintResult~
  }
  class NodeRasterPool {
    +close() Promise~void~
  }
  ConvertResult --> DeckReport
  ConvertResult --> FontCheck
  ConvertOptions ..> RandomAccessSource : fonts and input may be
  ConvertOptions --> RasterPool : rasterPool
  RasterPool <|-- NodeRasterPool
```

#### Input `input: InputSource`

```ts
type InputSource = Uint8Array | ArrayBuffer | RandomAccessSource;

interface RandomAccessSource {
  size: number;                                           // total size in bytes
  read(offset: number, length: number): Promise<Uint8Array>; // read `length` bytes starting at `offset`
}
```

For small files pass a `Uint8Array` (a Node `Buffer` is a `Uint8Array`). For large files pass a `RandomAccessSource`; the transcoder reads only the parts it needs, see [3.5](#35-large-files-random-access-reading).

#### Options `options: ConvertOptions`

| Option | Type | Default | Description |
|---|---|---|---|
| `write` | `(path, data) => Promise<void>` | **required** | Writes an output file, see [3.3](#33-the-write-callback) |
| `fontPack` | `FontPack` | none | The default font pack: layout with the original font's widths (Microsoft YaHei, Calibri, ...), display with the matching open-source font. In Node load it with `loadFontPack()`, see [3.7](#37-fonts-the-default-font-pack-and-specified-fonts). **Without it only fonts embedded in the PPT and `fonts` are available; widths of other fonts can only be estimated** |
| `fonts` | `InputSource[]` | `[]` | Font files specified by the caller (ttf / otf / ttc), one entry per file. They win over the font pack for the same name, are used for layout and display, and the characters used are embedded |
| `privateFonts` | `InputSource[]` | `[]` | Old option, same as `fonts` (since 0.3.0 every font used is embedded) |
| `output` | `'single' \| 'paged' \| 'pages' \| 'data'` | `'single'` | Output form (`'html'` is the old name of `'single'`); an unknown name throws |
| `fileName` | `string` | `'index.html'` (`'deck.json'` for `data`) | Main file name |
| `inlineLimit` | `number` (bytes) | `2097152` | Images smaller than this are inlined in the HTML; only affects `single`. Audio and video are always separate files |
| `embedFonts` | `boolean` | `true` | Embed subsets of the used fonts in the output (default `true` since 0.3.0): every glyph shown comes from the output, never from the viewer's computer. `false` is for debugging only |
| `images` | `boolean` | `true` | Whether to write `pic/{n}.jpg` and `thum/{n}.jpg`. `prop.json` is always written |
| `rasterWasm` | `Uint8Array \| Promise<Uint8Array \| undefined>` | none | Bytes of the resvg WASM. **When `images` is `true` you must pass this or `rasterPool`**, otherwise no images are drawn and a warning is recorded |
| `rasterPool` | `RasterPool` | none | Parallel image executor (e.g. the result of `createRasterPool()`). With it, `rasterWasm` is not needed; output is byte-identical to single-threaded drawing |
| `onProgress` | `(done: number, total: number) => void` | none | Called once after each slide is processed |

#### Result `ConvertResult`

| Field | Description |
|---|---|
| `slides` | Number of slides written |
| `width` / `height` | Slide size (pixels at 96 DPI; `picw`/`pich` in `prop.json` are these times 0.75, in points) |
| `report.missingFonts` | Font names used by the document that are neither embedded, nor in `fonts`, nor in the font pack (sorted). See `fontCheck` for the full picture |
| `report.warnings` | Notices from the conversion, e.g. "slide 3 failed to render: …" (the text is in Chinese). A message that occurs several times is written once with a count "（N 处）". A symbol font that is used but not embedded also produces a notice |
| `fontCheck` | Font check: for each font, which slides use it and the verdict, plus characters no font can show. The same data `unppt check` prints; fields in [3.8](#38-checkfontsinput-options-checking-fonts-only) |

#### Errors

- If the file is not a valid pptx, or `output` is misspelled, the Promise returned by `convert()` rejects.
- An error on **one slide** does not fail the whole conversion: that slide becomes a blank white slide and a "slide N failed to render" warning (`第 N 页渲染失败`) goes into `report.warnings`.
- An error thrown by your `write` callback makes `convert()` fail.

### 3.3 The `write` callback

```ts
type WriteData = Uint8Array | string | AsyncIterable<Uint8Array>;
type WriteFn = (path: string, data: WriteData) => Promise<void>;
```

- `path` is relative and uses `/`, e.g. `index.html`, `media/media1.1a2b3c4d.mp4`, `pic/3.jpg`, `pages/2.9f8e7d6c.js`, `prop.json`.
- `data` is one of three things: a string, bytes, or a **stream** (`AsyncIterable<Uint8Array>`, read chunk by chunk with `for await`). The main file and large videos arrive as streams so the whole file never has to sit in memory.
- Resolve the Promise only after the file is **completely** written.

> **Important: do not queue writes behind each other.** The `single` and `data` forms call `write(mainFileName, stream)` **first** (`index.html` for `single`, `deck.json` for `data`); the transcoder does its slide-by-slide work while you read that stream, and meanwhile calls `write('media/…')`, `write('pic/…')` for other files. If your `write` waits for the previous write to finish before starting the next, they deadlock. Handle each call independently.

The simplest version in Node: `fs.promises.writeFile` already accepts strings, `Uint8Array` and `AsyncIterable`:

```js
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const outDir = 'out';
const write = async (path, data) => {
  const target = join(outDir, path);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, data);
};
```

Collecting any `WriteData` into one `Buffer` (handy for memory or object storage):

```js
async function toBuffer(data) {
  if (typeof data === 'string') return Buffer.from(data);
  if (data instanceof Uint8Array) return Buffer.from(data);
  const chunks = [];
  for await (const chunk of data) chunks.push(chunk);
  return Buffer.concat(chunks);
}
```

### 3.4 What happens during one `convert` call

```mermaid
sequenceDiagram
  participant App as Your code
  participant C as convert()
  participant F as Output form (single etc.)
  participant R as Image drawing (resvg)
  App->>C: convert(input, { write, fonts, rasterWasm, ... })
  C->>C: open zip, read presentation, theme, masters, layouts
  C->>C: load fonts (embedded in the pptx > given in fonts > font pack)
  C->>F: start writing the output
  F->>App: write(main file, stream) (index.html for single, deck.json for data)
  loop each slide
    C->>C: render to SVG, compile animations and transition
    C->>App: write("media/...") (newly seen large images, audio, video)
    C->>R: draw this slide
    R-->>C: JPEG
    C->>App: write("pic/n.jpg") and write("thum/n.jpg")
    C->>App: onProgress(n, total)
    F-->>App: this slide's data (next chunk of the stream, or pages/n.hash.js for paged)
  end
  F-->>App: font subsets, metadata (paged writes index.html last)
  C->>App: write("prop.json", string)
  C-->>App: { slides, width, height, report, fontCheck }
```

The transcoder "writes as it goes": once a slide is done its data is handed out and its memory released, so even decks with hundreds of slides use little memory.

### 3.5 Large files: random-access reading

Don't read a 1 GB file into memory. Pass a `RandomAccessSource`; the transcoder reads only what it needs (e.g. the directory and each slide's XML; videos are streamed out in chunks):

```js
import { open, stat } from 'node:fs/promises';
import { convert } from '@unppt/unppt';

async function fileSource(path) {
  const { size } = await stat(path);
  const fh = await open(path, 'r');
  return {
    size,
    fh, // keep it so you can close it afterwards
    async read(offset, length) {
      const buf = new Uint8Array(Math.max(0, Math.min(length, size - offset)));
      const { bytesRead } = await fh.read(buf, 0, buf.length, offset);
      return buf.subarray(0, bytesRead);
    },
  };
}

const source = await fileSource('big.pptx');
try {
  await convert(source, { write, images: false });
} finally {
  await source.fh.close();
}
```

Fonts can be passed the same way (`fonts: [await fileSource('/opt/fonts/MyFont.ttc')]`), which also saves memory with big `.ttc` collections. In a browser, implement `read` with `Blob.slice(offset, offset + length).arrayBuffer()`.

### 3.6 Slide images and thumbnails

`images` defaults to `true`, but `convert()` does not look for `resvg.wasm` by itself; you provide it. Three ways:

```mermaid
flowchart LR
  A{"Need slide images and thumbnails?"} -->|"No"| N["images: false<br/>fastest"]
  A -->|"Yes, simple"| W["rasterWasm: bytes of resvg.wasm<br/>draws slide by slide on this thread"]
  A -->|"Yes, faster in Node"| P["rasterPool: createRasterPool(wasm)<br/>draws in parallel threads, close() when done"]
```

**Single thread:**

```js
import { readFile } from 'node:fs/promises';
import { convert } from '@unppt/unppt';

const wasm = new Uint8Array(await readFile(new URL(import.meta.resolve('@unppt/unppt/resvg.wasm'))));
const result = await convert(pptxBytes, { write, rasterWasm: wasm });
```

**Multiple threads (Node only):**

```js
import { readFile } from 'node:fs/promises';
import { convert } from '@unppt/unppt';
import { createRasterPool, autoWorkers } from '@unppt/unppt/node';

const wasm = new Uint8Array(await readFile(new URL(import.meta.resolve('@unppt/unppt/resvg.wasm'))));
const pool = await createRasterPool(wasm, autoWorkers()); // the 2nd argument is optional; it defaults to autoWorkers()
try {
  await convert(pptxBytes, { write, rasterPool: pool });
} finally {
  await pool.close(); // stop the worker threads
}
```

- `autoWorkers()`: the smaller of the CPU count (the cgroup CPU quota inside Linux containers) and "available memory ÷ 400 MB", at least 1.
- One pool can be shared by many `convert()` calls. The CLI's `--jobs` is implemented with these two functions.

### 3.7 Fonts: the default font pack and specified fonts

`convert()` is a pure function and never looks for fonts on disk; you pass them in. Fonts in the output come from three places (for the same name, in this order of priority):

| Source | How to provide | Notes |
|---|---|---|
| Fonts embedded in the PPT | Nothing to do, read automatically | Embedded fonts PowerPoint itself refuses (CFF `.otf`, unsorted table directory) are treated as missing, like PowerPoint |
| Specified fonts | `fonts: [...]` | Font files you are licensed to distribute |
| Default font pack | `fontPack` | Open-source fonts + metrics of 447 Windows / Office fonts (numbers only, no glyph shapes): layout with the original font, display with an open-source font |

Loading the default font pack in Node (`@unppt/fonts` is installed automatically with `@unppt/unppt`):

```js
import { convert } from '@unppt/unppt';
import { loadFontPack } from '@unppt/unppt/node';

const fontPack = await loadFontPack();   // finds the installed @unppt/fonts; undefined if it is missing
const result = await convert(pptxBytes, { write, fontPack });
```

- One `fontPack` can be shared by many `convert()` / `checkFonts()` calls; load it once.
- Font files in the pack are read on demand when the characters used are embedded, not loaded into memory as a whole.
- Every font used is always embedded as a subset (`embedFonts` defaults to `true`), so playback never uses the viewer's fonts and everyone sees the same thing.
- For the mapping (Microsoft YaHei → Noto Sans SC, Calibri → Carlito, ...) see [Getting started 7.3](getting-started.md#73-layout-and-display-are-separate-metrics-pack--open-source-fonts).

### 3.8 `checkFonts(input, options)`: checking fonts only

```ts
function checkFonts(
  input: InputSource,
  options?: { fontPack?: FontPack; fonts?: InputSource[]; onProgress?: (done: number, total: number) => void },
): Promise<FontCheck & { slides: number }>
```

Lays the deck out as usual but writes no files; the result is the same data as `unppt check --json` and `ConvertResult.fontCheck`. Pass `fontPack` / `fonts` as for `convert()`; the result describes a conversion with those fonts.

```js
import { checkFonts } from '@unppt/unppt';
import { loadFontPack } from '@unppt/unppt/node';

const r = await checkFonts(pptxBytes, { fontPack: await loadFontPack() });
if (r.errors > 0) {
  // e.g. reject the upload and tell the author what to fix
  for (const f of r.fonts) if (f.status === 'symbol-missing' || f.status === 'missing') console.log(f.font, f.pages);
}
```

| Field | Description |
|---|---|
| `slides` | Slide count |
| `fonts[]` | One entry per font used: `font` name, `pages` where it is used (1-based), `status`, plus optional `substitute` (substitute font name) and `shownWith` (font used for display) |
| `missingChars[]` | Characters no font can show (e.g. emoji, rare CJK characters; left to the browser's fallback): `{ page, chars }` |
| `errors` | Number of problems that must be fixed (`symbol-missing`, `missing`) |
| `warnings` | Number of warnings (`substituted`, plus each `missingChars` entry) |

`status` values:

| Value | Meaning |
|---|---|
| `embedded` | Embedded in the PPT, shown as-is |
| `specified` | A font given in `fonts` |
| `default` | Default font pack: layout with the original font, display with an open-source font (`shownWith`) |
| `substituted` | Unknown even to the font pack; substituted by PowerPoint's rules (`substitute`), so glyphs and line breaks may differ from the author's computer |
| `symbol-missing` | A symbol font (Wingdings etc.) is not embedded; symbols will show as letters |
| `missing` | Not even a substitute is available; widths can only be estimated (usually no `fontPack` was passed) |

### 3.9 Progress, warnings, font problems

```js
const result = await convert(pptxBytes, {
  write,
  fontPack,
  images: false,
  onProgress: (done, total) => console.log(`progress ${done}/${total}`),
});
console.log('slides', result.slides);
for (const f of result.fontCheck.fonts) {
  if (f.status !== 'embedded' && f.status !== 'specified' && f.status !== 'default') console.warn('font problem:', f.font, f.status, f.pages);
}
for (const w of result.report.warnings) console.warn('notice:', w);
```

---

## 4. Examples

All examples are ES modules (`.mjs` extension, or `"type": "module"` in `package.json`).

### 4.1 Node script: convert a whole folder

```js
// batch.mjs   usage: node batch.mjs <input folder> <output folder>
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, join } from 'node:path';
import { convert } from '@unppt/unppt';
import { createRasterPool, loadFontPack } from '@unppt/unppt/node';

const [inDir, outRoot] = process.argv.slice(2);
const wasm = new Uint8Array(await readFile(new URL(import.meta.resolve('@unppt/unppt/resvg.wasm'))));
const pool = await createRasterPool(wasm);
const fontPack = await loadFontPack();   // load once, share across all files

try {
  for (const name of await readdir(inDir)) {
    if (extname(name).toLowerCase() !== '.pptx') continue;
    const outDir = join(outRoot, basename(name, extname(name)));
    const write = async (path, data) => {
      const target = join(outDir, path);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, data);
    };
    try {
      const bytes = await readFile(join(inDir, name));
      const r = await convert(bytes, { write, output: 'paged', rasterPool: pool, fontPack });
      console.log(`${name}: ${r.slides} slides, ${r.fontCheck.errors} font problems, ${r.fontCheck.warnings} font warnings, ${r.report.warnings.length} notices`);
    } catch (e) {
      console.error(`${name} failed: ${e.message}`);
    }
  }
} finally {
  await pool.close();
}
```

### 4.2 HTTP server (Express): upload a pptx, get a player URL

Run `npm install express` first. The upload sends the file bytes as the request body (`Content-Type: application/octet-stream`).

```js
// server.mjs
import express from 'express';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { convert } from '@unppt/unppt';
import { loadFontPack } from '@unppt/unppt/node';

const app = express();
const OUT = join(process.cwd(), 'converted');
const wasm = new Uint8Array(await readFile(new URL(import.meta.resolve('@unppt/unppt/resvg.wasm'))));
const fontPack = await loadFontPack();   // no system fonts needed on the server

// Serve the converted files as static files
app.use('/decks', express.static(OUT));

app.post('/convert', express.raw({ type: 'application/octet-stream', limit: '500mb' }), async (req, res) => {
  const id = randomUUID();
  const dir = join(OUT, id);
  const write = async (path, data) => {
    const target = join(dir, path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, data);
  };
  try {
    const result = await convert(new Uint8Array(req.body), { write, output: 'paged', rasterWasm: wasm, fontPack });
    res.json({
      url: `/decks/${id}/index.html`,
      prop: `/decks/${id}/prop.json`,
      slides: result.slides,
      fontCheck: result.fontCheck,
      warnings: result.report.warnings,
    });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.listen(3000, () => console.log('http://localhost:3000'));
```

Try it:

```bash
curl -X POST --data-binary @demo.pptx -H "Content-Type: application/octet-stream" http://localhost:3000/convert
```

The returned `url` can go straight into `<iframe src="...">`. To reject problematic decks at upload time (e.g. a symbol font not embedded), call `checkFonts()` first and return an error when `errors > 0`; see [3.8](#38-checkfontsinput-options-checking-fonts-only).

```mermaid
sequenceDiagram
  participant B as Browser / curl
  participant S as Express server
  participant C as convert()
  participant D as converted folder
  B->>S: POST /convert (pptx bytes)
  S->>C: convert(bytes, { write, output: "paged" })
  C->>D: write(...) every output file
  C-->>S: { slides, report }
  S-->>B: returns url = /decks/{id}/index.html
  B->>S: GET /decks/{id}/index.html
  S-->>B: player page (then loads pages/ and media/ on demand)
```

### 4.3 Cloud function: read from object storage, convert, write back

Cloud functions usually have no persistent writable disk and limited memory. `convert()` never touches the disk, so it fits well. `getObject` / `putObject` below are **placeholders**; replace them with the matching calls of your cloud provider's SDK:

```js
// handler.mjs
import { convert } from '@unppt/unppt';
import { loadFontPack } from '@unppt/unppt/node';

// Outside the handler: loaded once when one instance serves several requests
const fontPackReady = loadFontPack();

// --- replace with your object storage SDK ---
async function getObject(key) { /* return a Uint8Array */ }
async function putObject(key, body) { /* body is a Buffer */ }
// --------------------------------------------

async function toBuffer(data) {
  if (typeof data === 'string') return Buffer.from(data);
  if (data instanceof Uint8Array) return Buffer.from(data);
  const chunks = [];
  for await (const chunk of data) chunks.push(chunk);
  return Buffer.concat(chunks);
}

export async function handler(event) {
  const { inputKey, outputPrefix } = event;   // e.g. "uploads/a.pptx", "decks/a/"
  const bytes = await getObject(inputKey);
  const result = await convert(bytes, {
    output: 'paged',
    images: false,                            // for images pass rasterWasm (deploy resvg.wasm with the function)
    fontPack: await fontPackReady,
    write: async (path, data) => putObject(outputPrefix + path, await toBuffer(data)),
  });
  return {
    entry: outputPrefix + 'index.html',
    slides: result.slides,
    fontCheck: result.fontCheck,
    warnings: result.report.warnings,
  };
}
```

Notes:

- For big files, `toBuffer` holds a whole video in memory. If your SDK supports streaming uploads, pass `data` (the `AsyncIterable`) straight to it to save memory; the input can also be read by range as in [3.5](#35-large-files-random-access-reading) (many object stores support Range requests).
- Cloud functions usually have no fonts at all, and **need none**: deploy `@unppt/unppt` (which brings `@unppt/fonts`, about 87 MB), call `loadFontPack()` and pass `fontPack`; the result is identical to converting on a desktop. Mind the code package size limit of your platform; if the font pack does not fit, put it in a layer or a mounted file system and pass its location with `loadFontPack(dir)`.
- If you have your own fonts (and the right to distribute them), pass their bytes with `fonts: [...]`; they win over the font pack for the same name.
- Put `index.html`, `pages/` and `media/` under the same prefix and serve them through a CDN; no server-side code is needed.

### 4.4 Converting in the browser

The main entry of `@unppt/unppt` does not depend on Node, so bundlers (e.g. Vite, webpack) can include it in a front end. A user-selected file can be read by position:

```js
import { convert } from '@unppt/unppt';

const file = input.files[0];              // <input type="file">
const source = {
  size: file.size,
  read: async (offset, length) => new Uint8Array(await file.slice(offset, offset + length).arrayBuffer()),
};
const files = new Map();
const result = await convert(source, {
  images: false,
  write: async (path, data) => {
    if (typeof data === 'string' || data instanceof Uint8Array) { files.set(path, data); return; }
    const parts = [];
    for await (const c of data) parts.push(c);
    files.set(path, new Blob(parts));
  },
});
// `files` now holds index.html, media/... and the other outputs
```

`loadFontPack()` is not available in a browser (it reads the disk). Without `fontPack`, widths of non-embedded fonts can only be estimated; if needed you can implement the `FontPack` interface (`faces`, `rules`, `metrics(id)`, `file(name)`) yourself by fetching the files of `@unppt/fonts` over the network.
