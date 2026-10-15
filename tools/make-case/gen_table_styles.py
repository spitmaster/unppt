"""生成内置表格样式的定义（packages/transcoder/src/render/builtin-table-styles.ts）。

课件引用 PowerPoint 内置的表格样式时，ppt/tableStyles.xml 里不一定存了定义（PowerPoint 自己知道内置样式长什么样）。
这里让 PowerPoint 把每个样式编号套到一个空表格上，保存后从它写出的 tableStyles.xml 里取出定义——定义只引用主题颜色，和具体课件无关。
自定义样式的编号 PowerPoint 不认识，会跳过。

用法：python tools/make-case/gen_table_styles.py [编号清单文件]
  编号清单文件每行一个 {GUID}；不给时用已生成文件里的编号（重新生成）。
注意：会启动 PowerPoint（不可见），运行前请关掉自己开的 PowerPoint。
"""
from __future__ import annotations

import json
import re
import sys
import zipfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from common import CACHE, ROOT  # noqa: E402

OUT = ROOT / "packages" / "transcoder" / "src" / "render" / "builtin-table-styles.ts"


def main():
    if len(sys.argv) > 1:
        ids = [l.strip() for l in Path(sys.argv[1]).read_text(encoding="utf-8").splitlines() if l.strip()]
    else:
        ids = re.findall(r"'(\{[0-9A-F-]+\})'", OUT.read_text(encoding="utf-8"))
    import pythoncom
    import win32com.client
    pythoncom.CoInitialize()
    app = win32com.client.DispatchEx("PowerPoint.Application")
    pres = app.Presentations.Add(0)
    ok = []
    for gid in ids:
        s = pres.Slides.Add(pres.Slides.Count + 1, 12)
        t = s.Shapes.AddTable(3, 3, 40, 40, 400, 120).Table
        try:
            t.ApplyStyle(gid, False)
            ok.append(gid)
        except Exception:
            s.Delete()                      # 不是内置样式
    out = (CACHE / "make-case" / "table-styles.pptx").resolve()
    out.parent.mkdir(parents=True, exist_ok=True)
    pres.SaveAs(str(out))
    pres.Close()
    app.Quit()
    xml = zipfile.ZipFile(out).read("ppt/tableStyles.xml").decode("utf-8")
    styles = {m.group(1): m.group(0) for m in re.finditer(r'<a:tblStyle styleId="(\{[^}]+\})".*?</a:tblStyle>', xml, re.S)}
    keep = {k: styles[k] for k in sorted(styles) if k in ok}
    body = ",\n".join(f"  '{k}': {json.dumps(v, ensure_ascii=False)}" for k, v in keep.items())
    OUT.write_text(
        "/**\n * PowerPoint 内置表格样式的定义（tools/make-case/gen_table_styles.py 生成，不要手改）：\n"
        " * 课件引用内置样式但 ppt/tableStyles.xml 里没存定义时用。键是样式编号，值是 a:tblStyle 元素（只引用主题颜色）。\n */\n"
        f"export const BUILTIN_TABLE_STYLES: Record<string, string> = {{\n{body},\n}};\n",
        encoding="utf-8", newline="\n")
    print(f"内置样式 {len(keep)} 个（共试了 {len(ids)} 个编号）-> {OUT}")


if __name__ == "__main__":
    main()
