"""编码兼容的符号显示字体（SPEC D3 ⑤）：Wingdings 等符号字体的每个字符，用开源字体（Noto Sans Symbols 1 / 2，OFL）里
Unicode 对应字符的字形，放在原来的编码位置（0x20~0xFF 和 U+F020~F0FF）。课件里的字符一个不改，显示时用这个字体就画出符号。

字形按本机原字体对应字形的外框（只取数字，不取字形）等比缩放、居中对位，字宽也用原字体的，所以大小、位置和 PowerPoint 一致。
对应表：tools/fonts/symbol-maps.json。开源字体先下载到 .cache/symdl（见 docs/release.md），生成的字体提交在 packages/fonts/compat/。

用法：.venv/Scripts/python tools/fonts/build-symbol-compat.py [--sheet]
  --sheet：另外画一张"原字体 / 生成的字体"逐字对照图到 .cache/symdl/sheet-<名字>.png（原字体的字形只在本机看，不进仓库）
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

from fontTools.fontBuilder import FontBuilder
from fontTools.pens.boundsPen import BoundsPen
from fontTools.pens.cu2quPen import Cu2QuPen
from fontTools.pens.transformPen import TransformPen
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.ttLib import TTFont

ROOT = Path(__file__).resolve().parents[2]
DL = ROOT / ".cache" / "symdl"
OUT = ROOT / "packages" / "fonts" / "compat"
SOURCES = [DL / "sym2" / "NotoSansSymbols2-Regular.ttf", DL / "sym1" / "NotoSansSymbols-Regular.ttf",
           ROOT / "packages" / "fonts" / "files" / "NotoSansSC-Regular.otf", ROOT / "packages" / "fonts" / "files" / "Carlito-Regular.ttf"]
# 原字体（本机 Windows 自带）-> 生成的字体
TARGETS = {
    "Wingdings": ("C:/Windows/Fonts/wingding.ttf", "Unppt Wingdings Compat", "UnpptWingdingsCompat.ttf"),
    "Wingdings 2": ("C:/Windows/Fonts/WINGDNG2.TTF", "Unppt Wingdings 2 Compat", "UnpptWingdings2Compat.ttf"),
    "Wingdings 3": ("C:/Windows/Fonts/WINGDNG3.TTF", "Unppt Wingdings 3 Compat", "UnpptWingdings3Compat.ttf"),
}


def symbol_cmap(font: TTFont) -> dict[int, str]:
    """符号字体的 (3, 0) 子表：0x20~0xFF -> 字形名（子表里是 U+F0xx）"""
    for t in font["cmap"].tables:
        if t.platformID == 3 and t.platEncID == 0:
            return {c & 0xFF: g for c, g in t.cmap.items() if 0xF020 <= c <= 0xF0FF}
    return {c: g for c, g in font.getBestCmap().items() if 0x20 <= c <= 0xFF}


def bounds(glyphset, name):
    pen = BoundsPen(glyphset)
    glyphset[name].draw(pen)
    return pen.bounds


def build(name: str, maps: dict[str, str], sources: list[TTFont]):
    orig_path, family, file = TARGETS[name]
    orig = TTFont(orig_path)
    upem = orig["head"].unitsPerEm
    ocmap = symbol_cmap(orig)
    ogs = orig.getGlyphSet()
    hmtx = orig["hmtx"]
    glyphs = {".notdef": TTGlyphPen(None).glyph()}
    metrics = {".notdef": (upem // 2, 0)}
    cmap = {}
    report = []
    for code in range(0x20, 0x100):
        gname = ocmap.get(code)
        if not gname:
            continue
        adv = hmtx[gname][0]
        target = bounds(ogs, gname)
        uni = maps.get("0x%02X" % code)
        pen = TTGlyphPen(None)
        src_name = None
        if uni and target:
            # "mirror:U+xxxx"：字体里没有的字，用另一个字形水平翻转
            mirror = uni.startswith("mirror:")
            u = int(uni.split("U+")[1], 16)
            for sf in sources:
                sg = sf.getBestCmap().get(u)
                if not sg:
                    continue
                sgs = sf.getGlyphSet()
                sb = bounds(sgs, sg)
                if not sb:
                    continue
                # 等比缩放到原字形的外框里，居中（细长的线条类字形按较长的一边）
                sw, sh = sb[2] - sb[0], sb[3] - sb[1]
                tw, th = target[2] - target[0], target[3] - target[1]
                scales = [x for x in (tw / sw if sw > 1 else None, th / sh if sh > 1 else None) if x]
                s = min(scales) if scales else 1
                dx = (target[0] + target[2]) / 2 - (sb[0] + sb[2]) / 2 * s
                dy = (target[1] + target[3]) / 2 - (sb[1] + sb[3]) / 2 * s
                # 三次曲线（CFF 字体来的）转成二次曲线（TrueType）
                if mirror:
                    dx = (target[0] + target[2]) / 2 + (sb[0] + sb[2]) / 2 * s
                sgs[sg].draw(TransformPen(Cu2QuPen(pen, max_err=1, reverse_direction=mirror), ((-s if mirror else s), 0, 0, s, dx, dy)))
                src_name = Path(sf.reader.file.name).name
                break
        g = f"g{code:02X}"
        glyphs[g] = pen.glyph()
        metrics[g] = (adv, int(target[0]) if target else 0)
        cmap[0xF000 + code] = g
        # 0x80~0x9F 这段按 Windows 西文代码页的字符放（PowerPoint 把 •、–、“ 等也按代码页换成这些字节），其它字节就是码点本身
        uni_of_byte = bytes([code]).decode("cp1252", errors="ignore") if 0x80 <= code <= 0x9F else chr(code)
        # ™ 例外：PowerPoint 用 Wingdings 写的 ™ 照常显示成 ™
        if uni_of_byte and uni_of_byte != "™":
            cmap[ord(uni_of_byte)] = g
        if 0x80 <= code <= 0x9F:
            cmap[code] = g
        report.append((code, uni, src_name))
    fb = FontBuilder(upem, isTTF=True)
    order = list(glyphs)
    fb.setupGlyphOrder(order)
    fb.setupCharacterMap(cmap)
    fb.setupGlyf(glyphs)
    fb.setupHorizontalMetrics(metrics)
    asc, desc = orig["hhea"].ascent, orig["hhea"].descent
    fb.setupHorizontalHeader(ascent=asc, descent=desc)
    # 版权：实际用到的每个开源字体自己的版权声明（name 表 0 号）
    used = sorted({r[2] for r in report if r[2]})
    notices = [next((n.toUnicode() for n in sf["name"].names if n.nameID == 0 and n.platformID == 3), "") for sf in sources
               if Path(sf.reader.file.name).name in used]
    # 全名（4）和 PostScript 名（6）不能少：resvg（整页图、缩略图）不认没有 PostScript 名的字体
    fb.setupNameTable({
        "familyName": family, "styleName": "Regular",
        "fullName": family, "psName": family.replace(" ", "") + "-Regular", "version": "Version 1.001",
        "uniqueFontIdentifier": "UNPT;" + family.replace(" ", "") + "-Regular;1.001",
        "copyright": "Glyphs from " + ", ".join(used) + ": " + " / ".join(n for n in notices if n)
                     + ". Re-encoded by unppt to the " + name + " code points.",
        "licenseDescription": "This Font Software is licensed under the SIL Open Font License, Version 1.1.",
        "licenseInfoURL": "https://openfontlicense.org",
    })
    fb.setupOS2(sTypoAscender=asc, sTypoDescender=desc, usWinAscent=asc, usWinDescent=-desc if desc < 0 else desc, achVendID="UNPT")
    fb.setupPost()
    OUT.mkdir(parents=True, exist_ok=True)
    fb.save(str(OUT / file))
    missing = [("0x%02X" % c, u) for c, u, s in report if not s]
    print(f"{name}: {len(report)} 个字符 -> {OUT / file}，没有字形 {len(missing)} 个：{missing}")
    return report


def sheet(name: str):
    """原字体 / 生成的字体逐字对照（只在本机看）"""
    from PIL import Image, ImageDraw, ImageFont
    orig_path, _, file = TARGETS[name]
    fo = ImageFont.truetype(orig_path, 40, encoding="symb")
    fc = ImageFont.truetype(str(OUT / file), 40)
    lab = ImageFont.truetype("C:/Windows/Fonts/consola.ttf", 12)
    cols, cw, chh = 16, 110, 64
    img = Image.new("RGB", (cols * cw, 14 * chh + 10), "white")
    d = ImageDraw.Draw(img)
    for code in range(0x20, 0x100):
        i = code - 0x20
        x, y = (i % cols) * cw, (i // cols) * chh
        d.rectangle([x, y, x + cw - 1, y + chh - 1], outline="#dddddd")
        d.text((x + 3, y + 2), f"{code:02X}", font=lab, fill="#999999")
        d.text((x + 8, y + 12), chr(0xF000 + code), font=fo, fill="black")
        d.text((x + 58, y + 12), chr(code), font=fc, fill="#1a5fd0")
    p = DL / f"sheet-{name.replace(' ', '')}.png"
    img.save(p)
    print("对照图", p)


def main():
    maps = json.loads((ROOT / "tools" / "fonts" / "symbol-maps.json").read_text(encoding="utf-8"))["fonts"]
    sources = [TTFont(p) for p in SOURCES if p.exists()]
    for name in TARGETS:
        build(name, maps.get(name, {}), sources)
        if "--sheet" in sys.argv:
            sheet(name)


if __name__ == "__main__":
    main()
