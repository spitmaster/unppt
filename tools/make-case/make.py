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


def new_pres(app, w=960, h=540, window=False):
    # 插入图表必须在有窗口的模式下（无窗口时 AddChart2 会报错）
    p = app.Presentations.Add(-1 if window else 0)
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
    # 字体名带中文的缺失字体
    textbox(s, 20, 420, 440, 50, "缺失字体测试 中文 English 123", font="思源黑体 CN Light", size=18)
    textbox(s, 480, 420, 440, 50, "缺失字体测试 中文 English 123", font="思源黑体 CN Bold", size=18)
    textbox(s, 20, 480, 440, 50, "缺失字体测试 中文 English 123", font="某某黑体", size=18)
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


def shapes_all(app):
    """PowerPoint 能画的全部预设形状（每页 24 个），用来逐个验证几何"""
    p = new_pres(app)
    slide = None
    n = 0
    for t in range(1, 190):
        if n % 24 == 0:
            slide = blank(p)
        x, y = 20 + (n % 8) * 116, 20 + ((n % 24) // 8) * 170
        try:
            sh = slide.Shapes.AddShape(t, x, y, 100, 130)
        except Exception:
            continue
        try:
            sh.Fill.ForeColor.RGB = RGB(90, 140, 210)
            sh.Line.ForeColor.RGB = RGB(30, 50, 90)
        except Exception:
            pass  # 线条类形状没有填充
        n += 1
    return p


def anim_auto(app):
    """页面一开始就自动播放的动画（上一动画之后 / 与上一动画同时），之后再接点击动画"""
    p = new_pres(app)
    s = blank(p)
    seq = s.TimeLine.MainSequence
    a = s.Shapes.AddShape(5, 60, 120, 250, 150)
    b = s.Shapes.AddShape(9, 360, 120, 250, 150)
    c = s.Shapes.AddShape(1, 660, 120, 250, 150)
    seq.AddEffect(a, 10, 0, 3)  # 上一动画之后
    seq.AddEffect(b, 10, 0, 2)  # 与上一动画同时
    seq.AddEffect(c, 10, 0, 1)  # 单击
    return p


def charts_basic(app):
    """常见图表：簇状柱形、条形、折线、饼图、圆环、面积、堆积柱形（PowerPoint 默认示例数据）"""
    p = new_pres(app, window=True)
    kinds = [(51, "簇状柱形"), (57, "条形"), (4, "折线"), (65, "带标记折线"), (5, "饼图"), (-4120, "圆环"), (1, "面积"), (52, "堆积柱形")]
    for i, (kind, _name) in enumerate(kinds):
        if i % 2 == 0:
            s = blank(p)
        ch = s.Shapes.AddChart2(-1, kind, 20 + (i % 2) * 470, 40, 450, 440)
        try:
            ch.Chart.ChartData.Workbook.Close()
        except Exception:
            pass
    return p


THEME_DIR = Path("C:/Program Files/Microsoft Office/root/Document Themes 16")


def make_theme_cases(app, names=None):
    """Office 自带的设计主题：每套主题一个文件，各放 4 种常用版式（背景、母版装饰、占位符样式都很丰富）"""
    out = []
    for thmx in sorted(THEME_DIR.glob("*.thmx")):
        name = "theme-" + thmx.stem.lower().replace(" ", "-").replace("---", "-")
        if names and name not in names:
            continue
        p = new_pres(app, window=True)
        p.ApplyTheme(str(thmx))
        layouts = p.SlideMaster.CustomLayouts
        for li in range(1, min(5, layouts.Count + 1)):
            s = p.Slides.AddSlide(p.Slides.Count + 1, layouts(li))
            for ph in s.Shapes.Placeholders:
                try:
                    t = ph.PlaceholderFormat.Type
                    if t in (1, 3):      # 标题、居中标题
                        ph.TextFrame.TextRange.Text = "演示文稿标题 Title"
                    elif t == 4:         # 副标题
                        ph.TextFrame.TextRange.Text = "副标题文字 Subtitle"
                    elif t in (2, 7):    # 正文、对象
                        ph.TextFrame.TextRange.Text = "第一条要点内容" + chr(13) + "第二条要点，文字稍长一些用来观察换行" + chr(13) + "第三条要点"
                except Exception:
                    pass
        out.append((name, p))
    return out


def pictures(app):
    """图片：裁剪、旋转、翻转、透明度、裁成圆形、图片填充形状、图片背景"""
    p = new_pres(app)
    img = str((TESTCASES / "shapes-basic" / "slide-001.png").resolve())
    s = blank(p)
    a = s.Shapes.AddPicture(img, 0, -1, 20, 20, 300, 169)
    b = s.Shapes.AddPicture(img, 0, -1, 340, 20, 300, 169)
    b.PictureFormat.CropLeft = 100
    b.PictureFormat.CropTop = 50
    c = s.Shapes.AddPicture(img, 0, -1, 660, 20, 280, 158)
    c.Rotation = 15
    d = s.Shapes.AddPicture(img, 0, -1, 20, 230, 300, 169)
    d.Flip(0)
    e = s.Shapes.AddPicture(img, 0, -1, 340, 230, 300, 169)
    e.Fill.Transparency = 0.5
    e.PictureFormat.TransparentBackground = 0
    f = s.Shapes.AddShape(9, 680, 220, 220, 220)
    f.Fill.UserPicture(img)
    s2 = blank(p)
    s2.FollowMasterBackground = 0
    s2.Background.Fill.UserPicture(img)
    t = s2.Shapes.AddTextbox(1, 100, 200, 760, 80)
    t.TextFrame.TextRange.Text = "图片背景上的文字"
    t.TextFrame.TextRange.Font.Size = 40
    return p


def smartart(app):
    """SmartArt 常见布局（文件里自带绘图缓存）"""
    p = new_pres(app, window=True)
    layouts = app.SmartArtLayouts
    for i in (1, 2, 5, 10):
        try:
            s = blank(p)
            sa = s.Shapes.AddSmartArt(layouts(i), 60, 40, 840, 460)
            nodes = sa.SmartArt.AllNodes
            for k in range(1, min(nodes.Count, 5) + 1):
                nodes(k).TextFrame2.TextRange.Text = f"项目 {k}"
        except Exception as ex:
            print("SmartArt 布局", i, "失败", ex)
    return p


def text_effects(app):
    """文字效果：艺术字、描边、阴影、渐变文字、加粗倾斜下划线"""
    p = new_pres(app)
    s = blank(p)
    w = s.Shapes.AddTextEffect(0, "艺术字 WordArt", "Microsoft YaHei", 48, 0, 0, 40, 30)
    t = textbox(s, 40, 150, 880, 70, "描边文字 Outline", size=40)
    t.TextFrame2.TextRange.Font.Line.Visible = -1
    t.TextFrame2.TextRange.Font.Line.ForeColor.RGB = RGB(200, 0, 0)
    t.TextFrame2.TextRange.Font.Line.Weight = 1
    t2 = textbox(s, 40, 240, 880, 70, "阴影文字 Shadow", size=40)
    t2.TextFrame2.TextRange.Font.Shadow.Visible = -1
    t3 = textbox(s, 40, 330, 880, 70, "渐变文字 Gradient", size=40)
    t3.TextFrame2.TextRange.Font.Fill.TwoColorGradient(1, 1)
    t3.TextFrame2.TextRange.Font.Fill.ForeColor.RGB = RGB(255, 0, 0)
    t3.TextFrame2.TextRange.Font.Fill.BackColor.RGB = RGB(0, 0, 255)
    t4 = textbox(s, 40, 420, 880, 70, "加粗 倾斜 下划线", size=32)
    r = t4.TextFrame.TextRange
    r.Characters(1, 2).Font.Bold = -1
    r.Characters(4, 2).Font.Italic = -1
    r.Characters(7, 3).Font.Underline = -1
    return p


def text_layout(app):
    """文字布局：溢出时缩小、竖排、两栏"""
    p = new_pres(app)
    s = blank(p)
    a = textbox(s, 40, 40, 280, 120, CN * 3, size=24)
    a.TextFrame2.AutoSize = 2  # 溢出时缩小文字
    b = textbox(s, 360, 40, 120, 440, "竖排文字测试内容", size=28)
    b.TextFrame.Orientation = 5  # 竖排（东亚）
    c = textbox(s, 520, 40, 400, 300, CN * 2, size=16)
    c.TextFrame2.Column.Number = 2
    c.TextFrame2.Column.Spacing = 20
    return p


def table_merge(app):
    """表格：合并单元格、自定义填充和边框、对齐"""
    p = new_pres(app)
    s = blank(p)
    t = s.Shapes.AddTable(4, 4, 60, 60, 840, 300).Table
    for r in range(1, 5):
        for c in range(1, 5):
            t.Cell(r, c).Shape.TextFrame.TextRange.Text = f"{r}-{c}"
    t.Cell(1, 1).Merge(t.Cell(1, 2))
    t.Cell(2, 3).Merge(t.Cell(3, 3))
    t.Cell(4, 4).Shape.Fill.ForeColor.RGB = RGB(255, 200, 0)
    t.Cell(3, 1).Shape.TextFrame.TextRange.ParagraphFormat.Alignment = 2
    t.Cell(4, 2).Shape.TextFrame.VerticalAnchor = 4
    return p


def links(app):
    """超链接与动作按钮：跳到指定页、下一页、外部网址、文字链接"""
    p = new_pres(app)
    s1 = blank(p)
    s2 = blank(p)
    s3 = blank(p)
    b = s1.Shapes.AddShape(1, 60, 60, 260, 80)
    b.TextFrame.TextRange.Text = "跳到第 3 页"
    b.ActionSettings(1).Action = 7  # ppActionHyperlink
    b.ActionSettings(1).Hyperlink.SubAddress = f"{s3.SlideID},{s3.SlideIndex},"
    n = s1.Shapes.AddShape(1, 360, 60, 260, 80)
    n.TextFrame.TextRange.Text = "下一页"
    n.ActionSettings(1).Action = 1  # ppActionNextSlide
    t = textbox(s1, 60, 200, 600, 60, "访问示例网址 example.com", size=24)
    t.TextFrame.TextRange.Characters(1, 6).ActionSettings(1).Hyperlink.Address = "https://example.com/"
    textbox(s2, 60, 60, 600, 60, "第 2 页", size=40)
    textbox(s3, 60, 60, 600, 60, "第 3 页", size=40)
    return p


def emf_images(app):
    """EMF 矢量图片：把几页幻灯片导出成 EMF，再作为图片插入（老课件里从 Office 粘贴的图形常是这种格式）"""
    tmp = TESTCASES.parent / ".cache" / "emf"
    tmp.mkdir(parents=True, exist_ok=True)
    files = []
    for name in ("shapes-basic", "text-sizes", "charts-basic", "table-basic"):
        src = app.Presentations.Open(str((TESTCASES / f"{name}.pptx").resolve()), True, False, False)
        out = tmp / f"{name}.emf"
        src.Slides(1).Export(str(out.resolve()), "EMF")
        src.Close()
        files.append(out)
    p = new_pres(app)
    for i, f in enumerate(files):
        if i % 2 == 0:
            s = blank(p)
        s.Shapes.AddPicture(str(f.resolve()), 0, -1, 20 + (i % 2) * 470, 120, 450, 253)
    return p


def anim_advanced(app):
    """复杂动画：段落逐条出现、强调（放大/旋转/变色）、路径动画、各方向飞入、擦除、缩放"""
    p = new_pres(app)
    s = blank(p)
    seq = s.TimeLine.MainSequence
    t = textbox(s, 40, 40, 420, 200, chr(10).join(["第一条要点", "第二条要点", "第三条要点"]), size=24)
    seq.AddEffect(t, 10, 2, 1)  # 淡入，按段落（msoAnimateTextByFirstLevel=2）
    a = s.Shapes.AddShape(1, 520, 40, 160, 100)
    e = seq.AddEffect(a, 59, 0, 1)  # 放大/缩小（msoAnimEffectGrowShrink）
    b = s.Shapes.AddShape(5, 720, 40, 160, 100)
    seq.AddEffect(b, 61, 0, 1)  # 陀螺旋（msoAnimEffectSpin）
    c = s.Shapes.AddShape(9, 520, 200, 120, 120)
    seq.AddEffect(c, 54, 0, 1)  # 改变填充颜色（msoAnimEffectChangeFillColor）
    d = s.Shapes.AddShape(4, 40, 380, 100, 100)
    seq.AddEffect(d, 41, 0, 1)  # 直线路径（msoAnimEffectPathRight 之类）
    f = s.Shapes.AddShape(1, 700, 380, 200, 100)
    ef = seq.AddEffect(f, 2, 0, 1)  # 飞入
    ef.EffectParameters.Direction = 4  # 从左
    g = s.Shapes.AddShape(1, 300, 380, 200, 100)
    eg = seq.AddEffect(g, 22, 0, 1)  # 擦除
    eg.EffectParameters.Direction = 1  # 从上
    h = s.Shapes.AddShape(9, 720, 220, 120, 120)
    seq.AddEffect(h, 53, 0, 1)  # 缩放
    return p


def charts_labels(app):
    """图表数据标签：柱形图显示数值、饼图显示百分比、折线图显示数值"""
    p = new_pres(app, window=True)

    def add(slide, kind, x, w):
        ch = slide.Shapes.AddChart2(-1, kind, x, 40, w, 440)
        try:
            ch.Chart.ChartData.Workbook.Close()  # 先关掉数据表，才能插下一个图表
        except Exception:
            pass
        return ch.Chart

    s = blank(p)
    a = add(s, 51, 20, 450)
    a.SeriesCollection(1).HasDataLabels = True
    b = add(s, 5, 490, 450)
    b.SeriesCollection(1).HasDataLabels = True
    b.SeriesCollection(1).DataLabels().ShowPercentage = True
    b.SeriesCollection(1).DataLabels().ShowValue = False
    s2 = blank(p)
    c = add(s2, 65, 20, 900)
    c.SeriesCollection(1).HasDataLabels = True
    return p

CASES = [shapes_all, text_sizes, text_align, text_spacing, text_bullets, text_missing_font, shapes_basic, fills_lines, table_basic, group_rotate, anim_basic, anim_auto, charts_basic, pictures, smartart, text_effects, text_layout, table_merge, links, emf_images, anim_advanced, charts_labels]


def main():
    names = sys.argv[1:]
    pythoncom.CoInitialize()
    app = win32com.client.DispatchEx("PowerPoint.Application")
    TESTCASES.mkdir(exist_ok=True)
    try:
        theme_names = [n for n in names if n.startswith("theme-")] if names else None
        for name, p in (make_theme_cases(app, theme_names) if theme_names is None or theme_names else []):
            out = TESTCASES / f"{name}.pptx"
            if out.exists():
                out.unlink()
            p.SaveAs(str(out.resolve()))
            p.Close()
            print("生成", out.name)
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
