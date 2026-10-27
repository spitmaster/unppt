[中文](../zh/test-report.md)

# Test report 0.3.1

> Generated automatically from the full test run (2026-10-27). Totals only — nothing from any individual deck.

## How we test

Every deck is converted with unppt, and each resulting slide is compared with **the image Microsoft PowerPoint itself exports for the same slide**, giving a **similarity score** between 0 and 1, where **1 means the two images look identical**. (The score is SSIM, a standard image-comparison method that looks at brightness, contrast and structure — closer to what the eye notices than comparing pixel by pixel.)

- **0.95 or more**: counts as a pass; differences are usually tiny, such as text a pixel or two off or slightly different picture edges;
- **0.90 – 0.95**: the same overall, with small visible differences somewhere;
- **below 0.90**: something clearly differs, such as a chart label's position or an effect not drawn right.

## Results

- **All 5212 real-world decks (168662 slides) convert**; 0 failures.
- Against PowerPoint, slide by slide: **average similarity 0.956**; **70.4% of slides reach 0.95** (pass), **93.5% are above 0.90**.
- Against the previous release 0.2.6: **1923 slides now look closer to PowerPoint, 43 look slightly worse** (all small; each cause was investigated), the other 166696 are unchanged.
- Feature test decks: 255 files, 543 slides, average similarity 0.984, 93.0% reach 0.95.
- Speed: **half of the decks convert within 8.2 seconds**, typically under 0.4 s per slide (measured with several decks at once at low priority, so real use is faster).

## The decks we test with

Real-world decks from a courseware library, tested locally and never uploaded. 9 more decks could not be opened or exported by PowerPoint itself, so there is nothing to compare against; they are not counted.

| Item | Count |
|---|---|
| Decks | 5212 |
| Slides | 168662 |
| Slides per deck: half have at most / 90% have at most / most | 25 / 66 / 339 |
| Saved with PowerPoint (Windows) | 3019 |
| Saved with WPS | 1678 |
| Saved with PowerPoint (Mac) | 485 |
| Saved with other | 30 |
| Slide ratio 16:9 | 4692 |
| Slide ratio 4:3 | 394 |
| Slide ratio other | 111 |
| Slide ratio 16:10 | 15 |

## How the similarity scores spread

| Similarity | Slides | Share |
|---|---|---|
| below 0.80 | 1476 | 0.9% |
| 0.80 ~ 0.85 | 1882 | 1.1% |
| 0.85 ~ 0.90 | 7621 | 4.5% |
| 0.90 ~ 0.95 | 38908 | 23.1% |
| 0.95 ~ 0.98 | 68453 | 40.6% |
| 0.98 or more | 50254 | 29.8% |

Put another way: the worst 5% of slides score below 0.890, the worst 10% below 0.914, and half score above 0.967.

## How slides with different content do

A slide can contain several kinds of content and is counted in each row. The last column is the previous release 0.2.6 on the same slides.

| Slides with | Slides | Average similarity | Reach 0.95 | Above 0.90 | 0.2.6 |
|---|---|---|---|---|---|
| pictures | 106263 | 0.957 | 70.3% | 94.3% | 0.956 |
| animations | 65040 | 0.953 | 69.0% | 92.4% | 0.953 |
| transitions | 61533 | 0.958 | 71.6% | 94.8% | 0.958 |
| groups | 59397 | 0.953 | 67.5% | 94.0% | 0.953 |
| shadows | 33007 | 0.953 | 66.9% | 93.1% | 0.953 |
| freeform shapes | 32460 | 0.955 | 69.4% | 94.7% | 0.955 |
| text autofit | 27293 | 0.951 | 62.5% | 91.8% | 0.951 |
| gradient fills | 17726 | 0.949 | 65.2% | 93.3% | 0.948 |
| tables | 11856 | 0.933 | 38.2% | 84.2% | 0.932 |
| none of these | 9353 | 0.968 | 84.7% | 96.2% | 0.968 |
| 3-D effects | 8585 | 0.947 | 57.9% | 90.7% | 0.947 |
| EMF/WMF pictures | 7674 | 0.943 | 52.0% | 87.3% | 0.943 |
| SmartArt | 3627 | 0.917 | 40.2% | 73.4% | 0.917 |
| charts | 3266 | 0.878 | 10.9% | 43.1% | 0.878 |
| vertical text | 3063 | 0.950 | 63.1% | 91.8% | 0.950 |
| SVG pictures | 2403 | 0.955 | 67.9% | 94.7% | 0.955 |
| OLE objects | 2373 | 0.941 | 48.9% | 86.6% | 0.940 |
| glow | 1164 | 0.947 | 60.7% | 90.9% | 0.947 |
| pattern fills | 1087 | 0.916 | 36.2% | 68.7% | 0.915 |
| audio/video | 909 | 0.967 | 84.2% | 96.6% | 0.967 |
| WordArt warps | 881 | 0.962 | 76.0% | 95.6% | 0.962 |
| equations | 49 | 0.917 | 32.7% | 69.4% | 0.917 |

## By authoring app and slide ratio

| Group | Slides | Average similarity | Reach 0.95 |
|---|---|---|---|
| PowerPoint (Windows) | 104809 | 0.954 | 67.8% |
| WPS | 49561 | 0.959 | 74.5% |
| PowerPoint (Mac) | 13460 | 0.963 | 75.0% |
| other | 832 | 0.951 | 70.4% |
| ratio 16:9 | 152044 | 0.955 | 69.5% |
| ratio 4:3 | 12696 | 0.965 | 81.3% |
| ratio other | 3368 | 0.954 | 66.1% |
| ratio 16:10 | 554 | 0.968 | 82.1% |

## Conversion speed

Each deck converted once (including page images, thumbnails and fonts), several at a time at low priority, so these numbers are slower than everyday use. "Half" means half of the decks (or slides) finish within that time, "90%" means 90% do, and so on.

| | Half | 90% | 99% | Slowest |
|---|---|---|---|---|
| Per deck (seconds) | 8.2 | 24.7 | 52.7 | 660.4 |
| Per slide (seconds) | 0.38 | 1.01 | 2.69 | 44.0 |

## How big the output is

5212 decks measured. 
Viewers only download the slide they are on and the next one; page images and thumbnails are for lists and previews and are not downloaded during playback.

| Part | Half of decks under (KB) | 90% of decks under (KB) | Share of total |
|---|---|---|---|
| fonts | 344 | 818 | 2.1% |
| images, audio, video | 6234 | 34946 | 78.9% |
| slide content | 298 | 1275 | 2.9% |
| page images (for lists and previews) | 1796 | 5741 | 14.3% |
| thumbnails | 184 | 544 | 1.4% |
| other (entry page etc.) | 63 | 73 | 0.4% |
| Total | 9641 | 41962 | 100% |

## Feature test decks

Decks made in PowerPoint specifically for testing (neutral content, public, in `testcases/`), each targeting one feature; the converted result is opened in a browser, captured, and compared with PowerPoint's export.

| Feature | Slides | Average similarity | Reach 0.95 |
|---|---|---|---|
| charts | 114 | 0.972 | 84.2% |
| text | 107 | 0.983 | 95.3% |
| animations | 85 | 0.994 | 97.6% |
| transitions | 47 | 0.999 | 100.0% |
| themes | 44 | 0.983 | 97.7% |
| shapes | 22 | 0.984 | 95.5% |
| tables | 16 | 0.986 | 100.0% |
| fills | 15 | 0.962 | 80.0% |
| layout placeholders | 12 | 0.996 | 100.0% |
| slide setup | 12 | 0.998 | 100.0% |
| pictures | 11 | 0.985 | 81.8% |
| SmartArt | 10 | 0.930 | 50.0% |
| audio/video | 9 | 0.999 | 100.0% |
| EMF/WMF pictures | 7 | 0.979 | 85.7% |
| lines | 6 | 0.991 | 100.0% |
| groups | 4 | 0.995 | 100.0% |
| hidden slides | 4 | 0.998 | 100.0% |
| equations | 3 | 0.981 | 100.0% |
| fonts | 3 | 0.988 | 100.0% |
| hyperlinks | 3 | 0.998 | 100.0% |
| speaker notes | 3 | 0.999 | 100.0% |
| freeform shapes | 2 | 1.000 | 100.0% |
| ActiveX controls | 1 | 0.997 | 100.0% |
| colors | 1 | 1.000 | 100.0% |
| OLE objects | 1 | 0.997 | 100.0% |
| SVG pictures | 1 | 1.000 | 100.0% |

## Test environment (for developers who want to reproduce it)

- Reference：Microsoft PowerPoint（PowerPoint.Application.16） slide export, 1280 px wide
- Machine：AMD Ryzen 7 5800H with Radeon Graphics，16 logical cores，32 GB，Windows-11-10.0.26200-SP0，Node v26.4.0
- Real decks: unppt's page image (`pic/`, rendered with resvg) vs the reference scaled to the same size, grayscale SSIM on 8×8 blocks, in system-font mode (`--system-fonts`) so glyphs match the reference and only layout/drawing differences count. Test decks: browser screenshots of the player ([Fidelity](fidelity.md), section 2).
- Reproduce: `python tools/compare/sweep_ab.py run <dir> --cli new=packages/transcoder/dist/cli.js,--system-fonts`, then `python tools/compare/corpus_report.py --results <dir>`.

