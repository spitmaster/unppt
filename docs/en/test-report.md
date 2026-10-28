[中文](../zh/test-report.md)

# Test report 0.3.2

> Generated automatically from the full test run (2026-10-28). Totals only — nothing from any individual deck.

## How we test

Every deck is converted with unppt, and each resulting slide is compared with **the image Microsoft PowerPoint itself exports for the same slide**, giving a **similarity score** between 0 and 1, where **1 means the two images look identical**. (The score is SSIM, a standard image-comparison method that looks at brightness, contrast and structure — closer to what the eye notices than comparing pixel by pixel; exact method and references: [Fidelity: how the score is computed](fidelity.md#ssim).)

- **0.95 or more**: counts as a pass; differences are usually tiny, such as text a pixel or two off or slightly different picture edges;
- **0.90 – 0.95**: the same overall, with small visible differences somewhere;
- **below 0.90**: something clearly differs, such as a chart label's position or an effect not drawn right.

## Results

- **All 5212 real-world decks (168662 slides) convert**; 0 failures.
- Against PowerPoint, slide by slide: **average similarity 0.965**; **78.5% of slides reach 0.95** (pass), **95.6% are above 0.90**.
- Against the previous release 0.2.6: **55018 slides now look closer to PowerPoint, 283 look slightly worse** (all small; each cause was investigated), the other 113361 are unchanged.
- Feature test decks: 255 files, 543 slides, average similarity 0.984, 93.0% reach 0.95.
- Speed: **half of the decks convert within 14.9 seconds**, typically under 0.7 s per slide (measured with several decks at once at low priority, so real use is faster).

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
| below 0.80 | 789 | 0.5% |
| 0.80 ~ 0.85 | 1304 | 0.8% |
| 0.85 ~ 0.90 | 5247 | 3.1% |
| 0.90 ~ 0.95 | 28918 | 17.1% |
| 0.95 ~ 0.98 | 63037 | 37.4% |
| 0.98 or more | 69367 | 41.1% |

Put another way: the worst 5% of slides score below 0.905, the worst 10% below 0.926, and half score above 0.975.

## How slides with different content do

A slide can contain several kinds of content and is counted in each row. The last column is the previous release 0.2.6 on the same slides.

| Slides with | Slides | Average similarity | Reach 0.95 | Above 0.90 | 0.2.6 |
|---|---|---|---|---|---|
| pictures | 106263 | 0.968 | 81.9% | 97.1% | 0.956 |
| animations | 65040 | 0.963 | 76.5% | 95.0% | 0.953 |
| transitions | 61533 | 0.966 | 79.8% | 96.6% | 0.958 |
| groups | 59397 | 0.963 | 76.4% | 96.3% | 0.953 |
| shadows | 33007 | 0.962 | 76.2% | 95.6% | 0.953 |
| freeform shapes | 32460 | 0.963 | 76.3% | 96.5% | 0.955 |
| text autofit | 27293 | 0.959 | 70.6% | 94.4% | 0.951 |
| gradient fills | 17726 | 0.961 | 73.7% | 95.4% | 0.948 |
| tables | 11856 | 0.937 | 42.4% | 86.3% | 0.932 |
| none of these | 9353 | 0.975 | 87.2% | 97.3% | 0.968 |
| 3-D effects | 8585 | 0.956 | 66.5% | 93.6% | 0.947 |
| EMF/WMF pictures | 7674 | 0.951 | 60.6% | 90.5% | 0.943 |
| SmartArt | 3627 | 0.922 | 43.7% | 75.0% | 0.917 |
| charts | 3266 | 0.883 | 12.4% | 45.9% | 0.878 |
| vertical text | 3063 | 0.957 | 70.5% | 94.1% | 0.950 |
| SVG pictures | 2403 | 0.961 | 76.3% | 96.3% | 0.955 |
| OLE objects | 2373 | 0.948 | 58.1% | 89.2% | 0.940 |
| glow | 1164 | 0.958 | 75.7% | 93.0% | 0.947 |
| pattern fills | 1087 | 0.941 | 55.9% | 86.8% | 0.915 |
| audio/video | 909 | 0.973 | 89.7% | 97.7% | 0.967 |
| WordArt warps | 881 | 0.968 | 79.7% | 96.3% | 0.962 |
| equations | 49 | 0.924 | 32.7% | 79.6% | 0.917 |

## By authoring app and slide ratio

| Group | Slides | Average similarity | Reach 0.95 |
|---|---|---|---|
| PowerPoint (Windows) | 104809 | 0.963 | 75.9% |
| WPS | 49561 | 0.969 | 82.8% |
| PowerPoint (Mac) | 13460 | 0.970 | 82.6% |
| other | 832 | 0.957 | 77.5% |
| ratio 16:9 | 152044 | 0.965 | 78.0% |
| ratio 4:3 | 12696 | 0.970 | 86.0% |
| ratio other | 3368 | 0.959 | 73.7% |
| ratio 16:10 | 554 | 0.973 | 84.3% |

## Conversion speed

Each deck converted once (including page images, thumbnails and fonts), several at a time at low priority, so these numbers are slower than everyday use. "Half" means half of the decks (or slides) finish within that time, "90%" means 90% do, and so on.

| | Half | 90% | 99% | Slowest |
|---|---|---|---|---|
| Per deck (seconds) | 14.9 | 39.9 | 79.2 | 729.1 |
| Per slide (seconds) | 0.67 | 1.76 | 5.22 | 48.6 |

## How big the output is

5212 decks measured. 
Viewers only download the slide they are on and the next one; page images and thumbnails are for lists and previews and are not downloaded during playback.

| Part | Half of decks under (KB) | 90% of decks under (KB) | Share of total |
|---|---|---|---|
| fonts | 345 | 820 | 2.2% |
| images, audio, video | 6038 | 34740 | 79.4% |
| slide content | 288 | 1238 | 2.9% |
| page images (for lists and previews) | 1689 | 5454 | 13.8% |
| thumbnails | 183 | 542 | 1.4% |
| other (entry page etc.) | 63 | 73 | 0.4% |
| Total | 9429 | 41301 | 100% |

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

