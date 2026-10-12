"""从 ECMA-376 标准附带的 presetShapeDefinitions.xml 生成转码器的预设形状数据。

标准下载：https://ecma-international.org/publications-and-standards/standards/ecma-376/
（Part 1 压缩包里的 OfficeOpenXML-DrawingMLGeometries.zip）

用法：python tools/gen-presets.py <presetShapeDefinitions.xml 路径>
输出：packages/transcoder/src/presets-data.ts
"""
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

A = "{http://schemas.openxmlformats.org/drawingml/2006/main}"
ROOT = Path(__file__).resolve().parent.parent


def main(src: str):
    tree = ET.parse(src)
    out = []
    for shape in tree.getroot():
        out.append(f"shape {shape.tag}")
        for gd in shape.findall(f"{A}avLst/{A}gd"):
            out.append(f"av {gd.get('name')} {gd.get('fmla')}")
        for gd in shape.findall(f"{A}gdLst/{A}gd"):
            out.append(f"gd {gd.get('name')} {gd.get('fmla')}")
        rect = shape.find(f"{A}rect")
        if rect is not None:
            out.append(f"rect {rect.get('l')} {rect.get('t')} {rect.get('r')} {rect.get('b')}")
        for path in shape.findall(f"{A}pathLst/{A}path"):
            attrs = []
            for k in ("w", "h"):
                if path.get(k):
                    attrs.append(f"{k}={path.get(k)}")
            if path.get("fill"):
                attrs.append(f"fill={path.get('fill')}")
            if path.get("stroke") in ("0", "false"):
                attrs.append("stroke=0")
            out.append("path " + " ".join(attrs) if attrs else "path")
            for c in path:
                tag = c.tag.replace(A, "")
                pts = c.findall(f"{A}pt")
                xy = " ".join(f"{p.get('x')} {p.get('y')}" for p in pts)
                if tag == "moveTo":
                    out.append(f"M {xy}")
                elif tag == "lnTo":
                    out.append(f"L {xy}")
                elif tag == "cubicBezTo":
                    out.append(f"C {xy}")
                elif tag == "quadBezTo":
                    out.append(f"Q {xy}")
                elif tag == "arcTo":
                    out.append(f"A {c.get('wR')} {c.get('hR')} {c.get('stAng')} {c.get('swAng')}")
                elif tag == "close":
                    out.append("Z")
        out.append("")
    body = "\n".join(out).replace("\\", "\\\\").replace("`", "\\`")
    ts = (
        "// 自动生成，不要手改。来源：ECMA-376 第 1 部分附带的 presetShapeDefinitions.xml\n"
        "// 生成脚本：tools/gen-presets.py\n"
        f"export const PRESET_SRC = `\n{body}`;\n"
    )
    (ROOT / "packages/transcoder/src/presets-data.ts").write_text(ts, encoding="utf-8", newline="\n")
    print(f"生成 {len(tree.getroot())} 个预设形状")


if __name__ == "__main__":
    main(sys.argv[1])
