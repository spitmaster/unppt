"""用 PowerPoint 生成测试用例（内容全部是中性的占位文字），放进 testcases/。

用法：
  python tools/make-case/make.py [用例名 ...]     # 不写名字则生成全部
然后导出参考图：
  python tools/powerpoint/export.py run --set testcases

每个用例是一个函数，函数名就是用例名。新增问题时照着加一个函数即可。
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from common import TESTCASES  # noqa: E402

import pythoncom  # noqa: E402
import win32com.client  # noqa: E402

# Office 常量
LAYOUT_BLANK = 12
LAYOUT_TITLE_CONTENT = 2
TEXTBOX_H = 1
ALIGN = {"l": 1, "ctr": 2, "r": 3, "just": 4, "dist": 5}
ANCHOR = {"t": 1, "ctr": 3, "b": 4}
RGB = lambda r, g, b: r + (g << 8) + (b << 16)  # noqa: E731

CN = "演示文字排版测试，包含中文与 English words 混排的一段较长内容，用来检查自动换行的位置。"
EN = "The quick brown fox jumps over the lazy dog. Pack my box with five dozen liquor jugs."


def new_pres(app, w=960, h=540):
    p = app.Presentations.Add(0)
    p.PageSetup.SlideWidth = w
    p.PageSetup.SlideHeight = h
    return p


def blank(p):
    return p.Slides.Add(p.Slides.Count + 1, LAYOUT_BLANK)


def textbox(slide, x, y, w, h, text, font="Microsoft YaHei", size=18, align="l", anchor="t", autofit=False):
    s = slide.Shapes.AddTextbox(TEXTBOX_H, x, y, w, h)
    tf = s.TextFrame
    tf.WordWrap = -1
    tf.AutoSize = 1 if autofit else 0
    tf.TextRange.Text = text.replace(chr(10), chr(13))  # PowerPoint 的分段符是 
    tf.TextRange.Font.Name = font
    tf.TextRange.Font.NameFarEast = font
    tf.TextRange.Font.Size = size
    tf.TextRange.ParagraphFormat.Alignment = ALIGN[align]
    tf.VerticalAnchor = ANCHOR[anchor]
    if not autofit:
        s.Height = h
    s.Line.Visible = -1
    s.Line.ForeColor.RGB = RGB(200, 200, 200)
    s.Line.Weight = 0.5
    return s


# ---------------------------------------------------------------- 用例

def text_sizes(app):
    """不同字体、字号的单行与多行文字（校准行高、基线、字宽）"""
    p = new_pres(app)
    s = blank(p)
    y = 20
    for font, size in [("Microsoft YaHei", 12), ("Microsoft YaHei", 24), ("Microsoft YaHei", 40), ("Arial", 20), ("SimSun", 20), ("DengXian", 20)]:
        textbox(s, 20, y, 900, size * 2, f"{font} {size}pt 字号测试 Hg", font=font, size=size)
        y += size * 2 + 10
    s = blank(p)
    textbox(s, 20, 20, 420, 200, CN * 2, size=16)
    textbox(s, 480, 20, 420, 200, EN * 2, font="Arial", size=16)
    textbox(s, 20, 260, 420, 200, CN, font="SimSun", size=20)
    textbox(s, 480, 260, 420, 200, CN, font="DengXian", size=20)
    return p


def text_align(app):
    """水平对齐、垂直对齐"""
    p = new_pres(app)
    s = blank(p)
    for i, a in enumerate(["l", "ctr", "r", "just", "dist"]):
        textbox(s, 20 + (i % 3) * 310, 20 + (i // 3) * 250, 290, 220, CN, size=16, align=a)
    s = blank(p)
    for i, a in enumerate(["t", "ctr", "b"]):
        textbox(s, 20 + i * 310, 40, 290, 300, "垂直对齐 " + a + "\n第二行", size=20, anchor=a)
    return p


def text_spacing(app):
    """行距、段前段后"""
    p = new_pres(app)
    s = blank(p)
    for i, sp in enumerate([1.0, 1.5, 2.0]):
        t = textbox(s, 20 + i * 310, 20, 290, 300, "行距测试第一段\n第二段文字较长需要换行显示出来看看", size=18)
        t.TextFrame.TextRange.ParagraphFormat.SpaceWithin = sp
    t = textbox(s, 20, 340, 290, 180, "固定行距 30 磅\n第二段", size=18)
    t.TextFrame.TextRange.ParagraphFormat.LineRuleWithin = 0
    t.TextFrame.TextRange.ParagraphFormat.SpaceWithin = 30
    t = textbox(s, 330, 340, 290, 180, "段前 12 磅段后 6 磅\n第二段\n第三段", size=16)
    t.TextFrame.TextRange.ParagraphFormat.SpaceBefore = 12
    t.TextFrame.TextRange.ParagraphFormat.SpaceAfter = 6
    return p


def text_bullets(app):
    """项目符号与编号"""
    p = new_pres(app)
    s = p.Slides.Add(1, LAYOUT_TITLE_CONTENT)
    s.Shapes(1).TextFrame.TextRange.Text = "标题占位符"
    body = s.Shapes(2).TextFrame.TextRange
    body.Text = "第一级要点\r第二级要点\r第二级另一条\r回到第一级，这一条比较长需要换行显示的内容"
    body.Paragraphs(2).IndentLevel = 2
    body.Paragraphs(3).IndentLevel = 2
    s = blank(p)
    t = textbox(s, 40, 40, 400, 300, "编号一\n编号二\n编号三", size=20)
    t.TextFrame.TextRange.ParagraphFormat.Bullet.Type = 2
    t2 = textbox(s, 480, 40, 400, 300, "圆点一\n圆点二", size=20)
    t2.TextFrame.TextRange.ParagraphFormat.Bullet.Type = 1
    return p


def text_missing_font(app):
    """文档指定了本机没有的字体：看 PowerPoint 用什么替代"""
    p = new_pres(app)
    s = blank(p)
    textbox(s, 20, 20, 900, 60, "缺失字体测试 中文 English 123", font="NoSuchFont CN Light", size=24)
    textbox(s, 20, 100, 900, 60, "缺失字体测试 中文 English 123", font="Microsoft YaHei", size=24)
    textbox(s, 20, 180, 900, 60, "缺失字体测试 中文 English 123", font="DengXian", size=24)
    textbox(s, 20, 260, 900, 60, "缺失字体测试 中文 English 123", font="SimSun", size=24)
    textbox(s, 20, 340, 900, 60, "缺失字体测试 中文 English 123", font="Arial", size=24)
    return p


def shapes_basic(app):
    """常用预设形状"""
    p = new_pres(app)
    s = blank(p)
    types = [1, 5, 9, 7, 8, 4, 2, 3, 51, 52, 6, 10, 33, 34, 35, 36, 37, 92, 61, 152, 151, 153, 155, 157]
    for i, t in enumerate(types):
        x, y = 20 + (i % 8) * 116, 20 + (i // 8) * 170
        try:
            sh = s.Shapes.AddShape(t, x, y, 100, 140 if i % 2 else 100)
            sh.Fill.ForeColor.RGB = RGB(70 + (i * 23) % 150, 110, 200 - (i * 17) % 120)
        except Exception:
            pass
    return p


def fills_lines(app):
    """渐变、透明、线型、箭头"""
    p = new_pres(app)
    s = blank(p)
    for i, ang in enumerate([0, 45, 90, 135]):
        sh = s.Shapes.AddShape(1, 20 + i * 230, 20, 200, 120)
        sh.Fill.TwoColorGradient(1, 1)
        sh.Fill.ForeColor.RGB = RGB(255, 80, 80)
        sh.Fill.BackColor.RGB = RGB(80, 80, 255)
        sh.Fill.GradientAngle = ang
    sh = s.Shapes.AddShape(9, 20, 170, 200, 120)
    sh.Fill.ForeColor.RGB = RGB(0, 150, 0)
    sh.Fill.Transparency = 0.5
    for i, dash in enumerate([1, 4, 5, 7]):
        ln = s.Shapes.AddLine(260, 180 + i * 30, 900, 180 + i * 30)
        ln.Line.Weight = 3
        ln.Line.DashStyle = dash
        ln.Line.ForeColor.RGB = RGB(40, 40, 40)
    ln = s.Shapes.AddLine(260, 320, 900, 420)
    ln.Line.Weight = 4
    ln.Line.EndArrowheadStyle = 2
    ln.Line.BeginArrowheadStyle = 5
    return p


def table_basic(app):
    """默认样式的表格"""
    p = new_pres(app)
    s = blank(p)
    t = s.Shapes.AddTable(4, 3, 60, 60, 800, 200)
    for r in range(1, 5):
        for c in range(1, 4):
            t.Table.Cell(r, c).Shape.TextFrame.TextRange.Text = f"单元格 {r}-{c}"
    return p


def group_rotate(app):
    """组合、旋转、翻转"""
    p = new_pres(app)
    s = blank(p)
    a = s.Shapes.AddShape(1, 100, 100, 150, 80)
    b = s.Shapes.AddShape(9, 200, 150, 100, 100)
    g = s.Shapes.Range([a.Name, b.Name]).Group()
    g.Rotation = 20
    c = s.Shapes.AddShape(33, 500, 100, 200, 100)
    c.Flip(0)
    d = s.Shapes.AddShape(7, 500, 300, 150, 120)
    d.Rotation = 45
    t = textbox(s, 100, 350, 300, 60, "旋转的文本框", size=20)
    t.Rotation = -15
    return p


def anim_basic(app):
    """点击动画：出现、淡入、飞入、擦除、退出"""
    p = new_pres(app)
    s = blank(p)
    seq = s.TimeLine.MainSequence
    shapes = []
    for i in range(4):
        sh = s.Shapes.AddShape(1, 40 + i * 230, 150, 200, 150)
        sh.TextFrame.TextRange.Text = f"动画 {i + 1}"
        shapes.append(sh)
    for sh, eff in zip(shapes, [1, 10, 2, 22]):  # appear, fade, fly, wipe
        seq.AddEffect(sh, eff, 0, 1)
    e = seq.AddEffect(shapes[0], 10, 0, 1)
    e.Exit = -1
    return p


CASES = [text_sizes, text_align, text_spacing, text_bullets, text_missing_font, shapes_basic, fills_lines, table_basic, group_rotate, anim_basic]


def main():
    names = sys.argv[1:]
    pythoncom.CoInitialize()
    app = win32com.client.DispatchEx("PowerPoint.Application")
    TESTCASES.mkdir(exist_ok=True)
    try:
        for fn in CASES:
            name = fn.__name__.replace("_", "-")
            if names and name not in names:
                continue
            p = fn(app)
            out = TESTCASES / f"{name}.pptx"
            if out.exists():
                out.unlink()
            p.SaveAs(str(out.resolve()))
            p.Close()
            print("生成", out.name)
    finally:
        if app.Presentations.Count == 0:
            app.Quit()


if __name__ == "__main__":
    main()
