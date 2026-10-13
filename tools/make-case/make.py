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
from common import CACHE, TESTCASES  # noqa: E402

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


def smartart_3d(app):
    """SmartArt 的三维样式（快速样式库里后几个）：同一个基本流程图，分别套用不同的三维样式"""
    p = new_pres(app, window=True)
    layout = app.SmartArtLayouts(1)
    styles = app.SmartArtQuickStyles
    picks = [i for i in range(styles.Count - 5, styles.Count + 1)]
    for k, idx in enumerate(picks):
        if k % 2 == 0:
            s = blank(p)
        try:
            sa = s.Shapes.AddSmartArt(layout, 30 + (k % 2) * 470, 60, 440, 380)
            nodes = sa.SmartArt.AllNodes
            for n in range(1, min(nodes.Count, 3) + 1):
                nodes(n).TextFrame2.TextRange.Text = f"步骤 {n}"
            sa.SmartArt.QuickStyle = styles(idx)
        except Exception as ex:
            print("SmartArt 样式", idx, "失败", ex)
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

def freeform_icons(app):
    """小尺寸线条图标（自由曲线，只有描边、圆头、约 1 磅粗），模拟课件里常见的线条小图标"""
    p = new_pres(app)
    s = blank(p)
    for i in range(24):
        x, y = 40 + (i % 8) * 110, 60 + (i // 8) * 150
        size = [6, 10, 14, 20][i % 4]
        fb = s.Shapes.BuildFreeform(1, x, y)          # msoEditingAuto
        fb.AddNodes(0, 0, x + size, y + size * 0.3)    # 直线段
        fb.AddNodes(1, 1, x + size * 1.2, y + size * 0.8, x + size * 0.6, y + size * 1.4, x, y + size)  # 曲线段
        if i % 3 == 0:
            fb.AddNodes(0, 0, x, y)                    # 闭合
        shp = fb.ConvertToShape()
        shp.Fill.Visible = 0
        shp.Line.Weight = [0.75, 1, 1.5][i % 3]
        shp.Line.ForeColor.RGB = RGB(0, 2, 61)
        try:
            shp.Line.Style = 1
            shp.Line.DashStyle = 1
        except Exception:
            pass
    return p


def make_tone(path: Path, seconds=2.0, freq=440):
    """生成一段正弦波 WAV（测试用的中性音频）"""
    import math, struct, wave
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(16000)
        frames = b"".join(struct.pack("<h", int(8000 * math.sin(2 * math.pi * freq * i / 16000))) for i in range(int(16000 * seconds)))
        w.writeframes(frames)


def media_audio(app):
    """音频：第 1 页进入时自动播放并隐藏图标；第 2 页点击播放"""
    tmp = TESTCASES.parent / ".cache" / "media"
    tmp.mkdir(parents=True, exist_ok=True)
    wav = tmp / "tone.wav"
    make_tone(wav)
    p = new_pres(app, window=True)
    s1 = blank(p)
    textbox(s1, 60, 60, 600, 60, "进入页面自动播放音频", size=28)
    a = s1.Shapes.AddMediaObject2(str(wav.resolve()), 0, -1, 800, 420, 48, 48)
    a.AnimationSettings.PlaySettings.PlayOnEntry = -1
    a.AnimationSettings.PlaySettings.HideWhileNotPlaying = -1
    s2 = blank(p)
    textbox(s2, 60, 60, 600, 60, "点击播放音频", size=28)
    b = s2.Shapes.AddMediaObject2(str(wav.resolve()), 0, -1, 400, 240, 48, 48)
    return p


def anim_trigger(app):
    """触发器动画：点击"显示答案"按钮，答案淡入；普通点击动画照常按顺序"""
    p = new_pres(app)
    s = blank(p)
    q = textbox(s, 60, 60, 700, 60, "问题：一加一等于几？", size=28)
    btn = s.Shapes.AddShape(5, 60, 200, 200, 70)
    btn.TextFrame.TextRange.Text = "显示答案"
    ans = textbox(s, 320, 200, 400, 70, "答案：二", size=28)
    seq = s.TimeLine.InteractiveSequences.Add()
    seq.AddTriggerEffect(ans, 10, 4, btn)  # 淡入，触发器：单击 btn
    other = s.Shapes.AddShape(9, 760, 300, 120, 120)
    s.TimeLine.MainSequence.AddEffect(other, 10, 0, 1)
    return p


def wmf_images(app):
    """WMF 矢量图片（更老的格式）：把几页幻灯片导出成 WMF 再插入"""
    tmp = TESTCASES.parent / ".cache" / "wmf"
    tmp.mkdir(parents=True, exist_ok=True)
    files = []
    for name in ("shapes-basic", "text-sizes"):
        src = app.Presentations.Open(str((TESTCASES / f"{name}.pptx").resolve()), True, False, False)
        out = tmp / f"{name}.wmf"
        src.Slides(1).Export(str(out.resolve()), "WMF")
        src.Close()
        files.append(out)
    p = new_pres(app)
    s = blank(p)
    for i, f in enumerate(files):
        s.Shapes.AddPicture(str(f.resolve()), 0, -1, 20 + i * 470, 120, 450, 253)
    return p


def anim_iterate(app):
    """文字逐字/逐词动画：逐字淡入、逐词出现、逐字飞入、逐字退出"""
    p = new_pres(app)
    s = blank(p)
    seq = s.TimeLine.MainSequence
    texts = ["逐字淡入 Letter by letter", "逐词出现 Word by word", "逐字飞入 Fly letters", "逐字退出 Exit letters"]
    shapes = []
    for i, t in enumerate(texts):
        sh = s.Shapes.AddTextbox(1, 60, 60 + i * 110, 800, 80)
        sh.TextFrame.TextRange.Text = t
        sh.TextFrame.TextRange.Font.Size = 32
        shapes.append(sh)
    for sh, eff, unit in [(shapes[0], 10, 1), (shapes[1], 1, 2), (shapes[2], 2, 1)]:
        e = seq.AddEffect(sh, eff, 0, 1)
        seq.ConvertToTextUnitEffect(e, unit)
    e = seq.AddEffect(shapes[3], 10, 0, 1)
    e.Exit = -1
    seq.ConvertToTextUnitEffect(e, 1)
    return p


def picture_transparent(app):
    """图片"设置透明色"：深色背景上，白底图片（PNG 和 JPEG）的白色变透明"""
    from PIL import Image
    png = (TESTCASES / "shapes-basic" / "slide-001.png").resolve()
    jpg = (CACHE / "make-case" / "white-bg.jpg").resolve()
    jpg.parent.mkdir(parents=True, exist_ok=True)
    Image.open(png).convert("RGB").save(jpg, quality=85)
    p = new_pres(app)
    s = blank(p)
    s.FollowMasterBackground = 0
    s.Background.Fill.ForeColor.RGB = RGB(30, 50, 90)
    for i, img in enumerate([png, jpg]):
        pic = s.Shapes.AddPicture(str(img), 0, -1, 20 + i * 470, 120, 450, 253)
        pic.PictureFormat.TransparencyColor = RGB(255, 255, 255)
        pic.PictureFormat.TransparentBackground = -1
    return p


def charts_more(app):
    """更多图表：散点图、带直线散点图、雷达图、带标记雷达图、填充雷达图、柱形+折线次坐标轴组合图（默认示例数据）"""
    p = new_pres(app, window=True)
    kinds = [-4169, 74, -4151, 81, 82, "combo"]  # 散点、带直线和标记散点、雷达、带标记雷达、填充雷达、组合
    for i, kind in enumerate(kinds):
        if i % 2 == 0:
            s = blank(p)
        ch = s.Shapes.AddChart2(-1, 51 if kind == "combo" else kind, 20 + (i % 2) * 470, 40, 450, 440)
        if kind == "combo":
            ser = ch.Chart.SeriesCollection(2)
            ser.ChartType = 65
            ser.AxisGroup = 2
        try:
            ch.Chart.ChartData.Workbook.Close()
        except Exception:
            pass
    return p


def shape_effects(app):
    """形状效果：发光、柔化边缘、映像、内阴影、外阴影，以及带效果的主题形状样式"""
    p = new_pres(app)
    s = blank(p)
    def shp(i, kind=1):
        sh = s.Shapes.AddShape(kind, 60 + (i % 4) * 225, 60 + (i // 4) * 240, 160, 120)
        sh.Fill.ForeColor.RGB = RGB(70, 120, 200)
        sh.Line.Visible = 0
        return sh
    a = shp(0)
    a.Glow.Radius = 10
    a.Glow.Color.RGB = RGB(255, 192, 0)
    b = shp(1, 9)
    b.Glow.Radius = 18
    b.Glow.Color.RGB = RGB(112, 48, 160)
    b.Glow.Transparency = 0.4
    c = shp(2)
    c.SoftEdge.Radius = 10
    d = shp(3, 9)
    d.SoftEdge.Radius = 25
    e = shp(4)
    e.Reflection.Type = 1
    f = shp(5)
    f.Reflection.Type = 5
    g = shp(6)
    g.Shadow.Style = 1          # 内阴影
    g.Shadow.Visible = -1
    g.Shadow.Blur = 8
    g.Shadow.OffsetX = 4
    g.Shadow.OffsetY = 4
    g.Shadow.ForeColor.RGB = RGB(0, 0, 0)
    g.Shadow.Transparency = 0.4
    h = shp(7)
    h.ShapeStyle = 41           # 带阴影的主题样式（强烈效果，effectRef idx=3）
    # 第 2 页：图片上的效果（常见的图片样式：圆角+边框、映像、柔化边缘、阴影、发光）
    img = str((TESTCASES / "shapes-basic" / "slide-001.png").resolve())
    s = blank(p)
    pics = []
    for i in range(6):
        pic = s.Shapes.AddPicture(img, 0, -1, 40 + (i % 3) * 310, 40 + (i // 3) * 260, 260, 146)
        pics.append(pic)
    pics[0].AutoShapeType = 5
    pics[0].Line.Visible = -1
    pics[0].Line.Weight = 6
    pics[0].Line.ForeColor.RGB = RGB(40, 40, 40)
    pics[1].Reflection.Type = 2
    pics[2].SoftEdge.Radius = 12
    pics[3].Shadow.Visible = -1
    pics[3].Shadow.Blur = 10
    pics[3].Shadow.OffsetX = 6
    pics[3].Shadow.OffsetY = 6
    pics[4].Glow.Radius = 8
    pics[4].Glow.Color.RGB = RGB(0, 176, 80)
    pics[5].AutoShapeType = 9
    pics[5].Line.Visible = -1
    pics[5].Line.Weight = 4
    pics[5].Line.ForeColor.RGB = RGB(192, 0, 0)
    return p


def equations(app):
    """公式（Office 数学公式 a14:m）：先生成普通文本框，再把段落换成公式 XML，交给 PowerPoint 打开另存，
    由它写出 mc:Choice（公式）和 mc:Fallback（公式图片）"""
    import re
    import zipfile
    tmp = (CACHE / "make-case" / "eq-src.pptx").resolve()
    tmp.parent.mkdir(parents=True, exist_ok=True)
    p = new_pres(app)
    s = blank(p)
    for i in range(3):
        tb = s.Shapes.AddTextbox(1, 80, 60 + i * 150, 800, 100)
        tb.TextFrame.TextRange.Text = f"EQ{i}"
        tb.TextFrame.TextRange.Font.Size = 36
    if tmp.exists():
        tmp.unlink()
    p.SaveAs(str(tmp))
    p.Close()
    M = 'xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"'
    def r(t, italic=True):
        return f'<m:r><a:rPr lang="en-US" altLang="zh-CN" i="{1 if italic else 0}"><a:latin typeface="Cambria Math" panose="02040503050406030204" pitchFamily="18" charset="0"/></a:rPr><m:t>{t}</m:t></m:r>'
    eqs = [
        # a² + b² = c²
        f'<m:sSup><m:e>{r("a")}</m:e><m:sup>{r("2", False)}</m:sup></m:sSup>{r("+", False)}<m:sSup><m:e>{r("b")}</m:e><m:sup>{r("2", False)}</m:sup></m:sSup>{r("=", False)}<m:sSup><m:e>{r("c")}</m:e><m:sup>{r("2", False)}</m:sup></m:sSup>',
        # x = (-b ± √(b²-4ac)) / 2a
        f'{r("x")}{r("=", False)}<m:f><m:num>{r("−", False)}{r("b")}{r("±", False)}<m:rad><m:radPr><m:degHide m:val="1"/></m:radPr><m:deg/><m:e><m:sSup><m:e>{r("b")}</m:e><m:sup>{r("2", False)}</m:sup></m:sSup>{r("−4", False)}{r("ac")}</m:e></m:rad></m:num><m:den>{r("2", False)}{r("a")}</m:den></m:f>',
        # ∑ i = n(n+1)/2
        f'<m:nary><m:naryPr><m:chr m:val="∑"/></m:naryPr><m:sub>{r("i")}{r("=1", False)}</m:sub><m:sup>{r("n")}</m:sup><m:e>{r("i")}</m:e></m:nary>{r("=", False)}<m:f><m:num>{r("n")}{r("(", False)}{r("n")}{r("+1)", False)}</m:num><m:den>{r("2", False)}</m:den></m:f>',
    ]
    src = zipfile.ZipFile(tmp)
    out = tmp.with_name("eq-mid.pptx")
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        for item in src.infolist():
            data = src.read(item.filename)
            if item.filename == "ppt/slides/slide1.xml":
                x = data.decode("utf-8")
                for i, eq in enumerate(eqs):
                    para = f'<a:p><a14:m xmlns:a14="http://schemas.microsoft.com/office/drawing/2010/main"><m:oMathPara {M}><m:oMathParaPr><m:jc m:val="left"/></m:oMathParaPr><m:oMath>{eq}</m:oMath></m:oMathPara></a14:m><a:endParaRPr lang="en-US" sz="3600"/></a:p>'
                    x = re.sub(r'<a:p>(?:(?!</a:p>).)*EQ%d(?:(?!</a:p>).)*</a:p>' % i, lambda _m: para, x, count=1)
                data = x.encode("utf-8")
            z.writestr(item, data)
    src.close()
    return app.Presentations.Open(str(out), WithWindow=0)


def anim_path(app):
    """路径动画：曲线、直线、相对坐标路径（每次点击一个），检查终点位置和播放时沿路径移动"""
    p = new_pres(app)
    s = blank(p)
    seq = s.TimeLine.MainSequence
    for i, eff in enumerate([86, 127, 108, 147]):   # 圆弧曲线、向下直线、曲线、相对坐标阶梯
        sh = s.Shapes.AddShape(9, 60 + i * 220, 80, 70, 70)
        seq.AddEffect(sh, eff, 0, 1)
    return p


def anim_emphasis(app):
    """过程有往返的强调动画（脉冲、跷跷板等）和用 from/to 写的缩放：检查每步结束后的状态"""
    p = new_pres(app)
    s = blank(p)
    seq = s.TimeLine.MainSequence
    for i, eff in enumerate([64, 75, 80, 81, 52]):   # presetID 14、脉冲 26、跷跷板 32、33、波浪 36
        sh = s.Shapes.AddShape(1, 50 + i * 180, 200, 130, 100)
        sh.TextFrame.TextRange.Text = f"强调 {i + 1}"
        seq.AddEffect(sh, eff, 0, 1)
    return p


def transitions(app):
    """页面切换：无、淡入、推入（左/上/右）、擦除（左/上）、分割（横向向内/纵向向外）、覆盖、揭开、随机线条、圆形"""
    p = new_pres(app)
    effects = [257, 3849, 3853, 3854, 3855, 2817, 2818, 3586, 3587, 1281, 2049, 2305, 3845]
    for i, eff in enumerate(effects):
        s = blank(p)
        s.FollowMasterBackground = 0
        s.Background.Fill.ForeColor.RGB = RGB(40 + (i * 37) % 200, 90, 160 - (i * 23) % 120)
        t = s.Shapes.AddTextbox(1, 100, 220, 760, 100)
        t.TextFrame.TextRange.Text = f"第 {i + 1} 页"
        t.TextFrame.TextRange.Font.Size = 54
        t.TextFrame.TextRange.Font.Color.RGB = RGB(255, 255, 255)
        try:
            s.SlideShowTransition.EntryEffect = eff
        except Exception as ex:
            print("切换", eff, "失败", ex)
    return p



def transitions_more(app):
    """更多页面切换：穿过黑色、闪光、条纹、形状（菱形/加号/盒状）、轮子、扇形、新闻快报、百叶窗、棋盘、梳理、
    随机线条、溶解、斜向覆盖/揭开，以及浏览器里按近似画的 3D 切换（显示、平移、立方体、门、幕布、涡流）"""
    from win32com.client import gencache
    C = gencache.EnsureModule('{91493440-5A91-11CF-8700-00AA0060263B}', 0, 2, 12).constants
    names = ["Cut", "CutThroughBlack", "Fade", "Flashbulb", "StripsDownRight", "StripsUpLeft", "DiamondOut", "PlusOut",
             "BoxOut", "BoxIn", "Wheel1Spoke", "Wheel4Spokes", "WheelReverse1Spoke", "Wedge", "Newsflash",
             "BlindsHorizontal", "BlindsVertical", "CheckerboardAcross", "CheckerboardDown", "CombHorizontal", "CombVertical",
             "RandomBarsVertical", "Dissolve", "SplitVerticalIn", "CoverLeftUp", "UncoverRightDown",
             "RevealSmoothLeft", "PanLeft", "CubeLeft", "DoorsVertical", "Curtains", "VortexLeft"]
    p = new_pres(app)
    for i, name in enumerate(names):
        s = blank(p)
        s.FollowMasterBackground = 0
        s.Background.Fill.ForeColor.RGB = RGB(40 + (i * 53) % 200, 120 - (i * 17) % 80, 200 - (i * 29) % 150)
        t = s.Shapes.AddTextbox(1, 100, 220, 760, 100)
        t.TextFrame.TextRange.Text = f"第 {i + 1} 页"
        t.TextFrame.TextRange.Font.Size = 54
        t.TextFrame.TextRange.Font.Color.RGB = RGB(255, 255, 255)
        if i:
            s.SlideShowTransition.EntryEffect = getattr(C, "ppEffect" + name)
            s.SlideShowTransition.Duration = 1.0
    return p


def _beep_wav(path, freq=880, secs=0.4):
    """生成一段中性的提示音（正弦波），用作动画和切换的声音"""
    import math
    import struct
    import wave
    rate = 22050
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        n = int(rate * secs)
        w.writeframes(b"".join(struct.pack("<h", int(12000 * math.sin(2 * math.pi * freq * i / rate) * min(1, (n - i) / 2000))) for i in range(n)))


def anim_sound(app):
    """动画和切换附带的声音：第 1 页形状淡入时播放提示音；第 2 页切换时播放提示音（循环到下一个声音）；
    第 3 页切换时"停止前一声音" """
    import tempfile
    wav = Path(tempfile.gettempdir()) / "unppt-beep.wav"
    _beep_wav(wav)
    p = new_pres(app)
    s = blank(p)
    sh = s.Shapes.AddShape(1, 300, 180, 360, 180)
    e = s.TimeLine.MainSequence.AddEffect(sh, 10, 0, 1)
    e.EffectInformation.SoundEffect.ImportFromFile(str(wav))
    s2 = blank(p)
    s2.Shapes.AddShape(9, 380, 170, 200, 200)
    s2.SlideShowTransition.EntryEffect = 3849
    s2.SlideShowTransition.SoundEffect.ImportFromFile(str(wav))
    s2.SlideShowTransition.LoopSoundUntilNext = -1
    s3 = blank(p)
    s3.Shapes.AddShape(5, 380, 170, 200, 200)
    s3.SlideShowTransition.EntryEffect = 3849
    s3.SlideShowTransition.SoundEffect.Type = 1  # ppSoundStopPrevious
    return p


def anim_build(app):
    """SmartArt 逐个淡入；簇状柱形图按系列擦除、按类别擦除。COM 做不出这些动画，保存后补时间线（见 _patch_builds）"""
    p = new_pres(app, window=True)
    s = blank(p)
    sa = s.Shapes.AddSmartArt(app.SmartArtLayouts(1), 60, 40, 840, 460)
    nodes = sa.SmartArt.AllNodes
    for k in range(1, min(nodes.Count, 5) + 1):
        nodes(k).TextFrame2.TextRange.Text = f"项目 {k}"
    for _ in range(2):
        s2 = blank(p)
        ch = s2.Shapes.AddChart2(-1, 51, 80, 40, 800, 460)
        try:
            ch.Chart.ChartData.Workbook.Close()
        except Exception:
            pass
    return p


def _build_timing(spid, targets, preset, filt, bld):
    """每个目标一次单击的进入动画（targets 是 p:graphicEl 里的内容）"""
    n = [3]

    def tn():
        n[0] += 1
        return n[0]
    pars = []
    for g in targets:
        tgt = f'<p:tgtEl><p:spTgt spid="{spid}"><p:graphicEl>{g}</p:graphicEl></p:spTgt></p:tgtEl>'
        pars.append(
            f'<p:par><p:cTn id="{tn()}" fill="hold"><p:stCondLst><p:cond delay="indefinite"/></p:stCondLst><p:childTnLst>'
            f'<p:par><p:cTn id="{tn()}" fill="hold"><p:stCondLst><p:cond delay="0"/></p:stCondLst><p:childTnLst>'
            f'<p:par><p:cTn id="{tn()}" presetID="{preset[0]}" presetClass="entr" presetSubtype="{preset[1]}" fill="hold" grpId="0" nodeType="clickEffect">'
            f'<p:stCondLst><p:cond delay="0"/></p:stCondLst><p:childTnLst>'
            f'<p:set><p:cBhvr><p:cTn id="{tn()}" dur="1" fill="hold"><p:stCondLst><p:cond delay="0"/></p:stCondLst></p:cTn>{tgt}'
            f'<p:attrNameLst><p:attrName>style.visibility</p:attrName></p:attrNameLst></p:cBhvr><p:to><p:strVal val="visible"/></p:to></p:set>'
            f'<p:animEffect transition="in" filter="{filt}"><p:cBhvr><p:cTn id="{tn()}" dur="500"/>{tgt}</p:cBhvr></p:animEffect>'
            f'</p:childTnLst></p:cTn></p:par></p:childTnLst></p:cTn></p:par></p:childTnLst></p:cTn></p:par>')
    return ('<p:timing><p:tnLst><p:par><p:cTn id="1" dur="indefinite" restart="never" nodeType="tmRoot"><p:childTnLst>'
            '<p:seq concurrent="1" nextAc="seek"><p:cTn id="2" dur="indefinite" nodeType="mainSeq"><p:childTnLst>' + "".join(pars) +
            '</p:childTnLst></p:cTn><p:prevCondLst><p:cond evt="onPrev" delay="0"><p:tgtEl><p:sldTgt/></p:tgtEl></p:cond></p:prevCondLst>'
            '<p:nextCondLst><p:cond evt="onNext" delay="0"><p:tgtEl><p:sldTgt/></p:tgtEl></p:cond></p:nextCondLst></p:seq></p:childTnLst></p:cTn></p:par></p:tnLst>'
            f'<p:bldLst><p:bldGraphic spid="{spid}" grpId="0"><p:bldSub>{bld}</p:bldSub></p:bldGraphic></p:bldLst></p:timing>')


def _patch_builds(path):
    """第 1 页 SmartArt 逐个淡入：目标是绘图里每个形状的 modelId（PowerPoint 放映实测认这个）；
    第 2、3 页图表按系列、按类别擦除：先背景（gridLegend），再逐个系列 / 分类（同样用放映截图验证过）"""
    import re
    import zipfile
    tmp = path.with_suffix(".tmp")
    with zipfile.ZipFile(path) as zin:
        drawing = [n for n in zin.namelist() if n.startswith("ppt/diagrams/drawing")][0]
        ids = re.findall(r'<dsp:sp modelId="([^"]+)"', zin.read(drawing).decode())
        slides = {no: zin.read(f"ppt/slides/slide{no}.xml").decode() for no in (1, 2, 3)}
        spid = {no: re.search(r'<p:graphicFrame>.*?<p:cNvPr id="(\d+)"', x, re.S).group(1) for no, x in slides.items()}
        timings = {
            1: _build_timing(spid[1], [f'<a:dgm id="{g}"/>' for g in ids], (10, 0), "fade", '<a:bldDgm bld="one"/>'),
            2: _build_timing(spid[2], ['<a:chart seriesIdx="-3" categoryIdx="-3" bldStep="gridLegend"/>'] +
                             [f'<a:chart seriesIdx="{k}" categoryIdx="-4" bldStep="series"/>' for k in range(3)], (22, 4), "wipe(down)", '<a:bldChart bld="series"/>'),
            3: _build_timing(spid[3], ['<a:chart seriesIdx="-3" categoryIdx="-3" bldStep="gridLegend"/>'] +
                             [f'<a:chart seriesIdx="-4" categoryIdx="{k}" bldStep="category"/>' for k in range(4)], (22, 4), "wipe(down)", '<a:bldChart bld="category"/>'),
        }
        for no, x in slides.items():
            x = re.sub(r"<p:timing>.*?</p:timing>", "", x, flags=re.S)
            slides[no] = x.replace("</p:clrMapOvr>", "</p:clrMapOvr>" + timings[no]) if "</p:clrMapOvr>" in x else x.replace("</p:sld>", timings[no] + "</p:sld>")
        with zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as zout:
            for item in zin.infolist():
                data = zin.read(item.filename)
                m = re.match(r"ppt/slides/slide(\d+)\.xml$", item.filename)
                if m and int(m.group(1)) in slides:
                    data = slides[int(m.group(1))].encode()
                zout.writestr(item, data)
    tmp.replace(path)


anim_build.patch = _patch_builds

def anim_after(app):
    """"动画播放后"选项：第 1 页三段文字按段淡入，每段在下次单击时变暗成灰色；
    第 2 页三个形状依次淡入：第一个播放后隐藏，第二个下次单击后隐藏，第三个不变（选项在保存后补，见 _patch_after）"""
    p = new_pres(app)
    s = blank(p)
    t = s.Shapes.AddTextbox(1, 100, 80, 760, 360)
    t.TextFrame.TextRange.Text = "第一条要点\r第二条要点\r第三条要点"
    t.TextFrame.TextRange.Font.Size = 40
    t.TextFrame.TextRange.Font.Color.RGB = RGB(0, 0, 0)
    s.TimeLine.MainSequence.AddEffect(t, 10, 2, 1)
    s2 = blank(p)
    for k in range(3):
        sh = s2.Shapes.AddShape(1, 80 + k * 300, 180, 240, 160)
        s2.TimeLine.MainSequence.AddEffect(sh, 10, 0, 1)
    return p


def _patch_after(path):
    import re
    import zipfile

    def sub(tgt, kind, rel, tn_after):
        cond = f'<p:stCondLst><p:cond evt="end" delay="0"><p:tn val="{tn_after}"/></p:cond></p:stCondLst>' if rel == "sameClick" else ""
        tn = f'<p:cTn dur="1" fill="hold" display="0" masterRel="{rel}" afterEffect="1">{cond}</p:cTn>' if cond else f'<p:cTn dur="1" fill="hold" display="0" masterRel="{rel}" afterEffect="1"/>'
        if kind == "dim":
            return (f'<p:animClr clrSpc="rgb" dir="cw"><p:cBhvr override="childStyle">{tn}{tgt}<p:attrNameLst><p:attrName>ppt_c</p:attrName></p:attrNameLst></p:cBhvr>'
                    f'<p:to><a:srgbClr val="A6A6A6"/></p:to></p:animClr>')
        return (f'<p:set><p:cBhvr override="childStyle">{tn}{tgt}<p:attrNameLst><p:attrName>style.visibility</p:attrName></p:attrNameLst></p:cBhvr>'
                f'<p:to><p:strVal val="hidden"/></p:to></p:set>')

    def patch_slide(x, plan):
        effects = list(re.finditer(r'<p:par><p:cTn id="(\d+)" presetID="\d+" presetClass="entr".*?</p:childTnLst>', x, re.S))
        out, last = [], 0
        for i, m in enumerate(effects):
            if i >= len(plan) or not plan[i]:
                continue
            kind, rel = plan[i]
            tgt = re.search(r"<p:tgtEl>.*?</p:tgtEl>", m.group(0), re.S).group(0)
            out.append(x[last:m.end()])
            out.append(f"<p:subTnLst>{sub(tgt, kind, rel, m.group(1))}</p:subTnLst>")
            last = m.end()
        out.append(x[last:])
        return "".join(out)

    tmp = path.with_suffix(".tmp")
    with zipfile.ZipFile(path) as zin, zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as zout:
        for item in zin.infolist():
            data = zin.read(item.filename)
            if item.filename == "ppt/slides/slide1.xml":
                data = patch_slide(data.decode(), [("dim", "nextClick")] * 3).encode()
            elif item.filename == "ppt/slides/slide2.xml":
                data = patch_slide(data.decode(), [("hide", "sameClick"), ("hide", "nextClick"), None]).encode()
            zout.writestr(item, data)
    tmp.replace(path)


anim_after.patch = _patch_after


def anim_text_emphasis(app):
    """文字强调：更改字体颜色、更改字形（加粗，一直保留）、加粗闪烁、样式强调（临时）、画笔下划线、更改字号（放大 1.5 倍）"""
    p = new_pres(app)
    s = blank(p)
    effects = [56, 58, 63, 79, 67, 57]
    for k, eid in enumerate(effects):
        t = s.Shapes.AddTextbox(1, 60 + (k % 2) * 460, 40 + (k // 2) * 160, 420, 80)
        t.TextFrame.TextRange.Text = f"关键词 Keyword {k + 1}"
        t.TextFrame.TextRange.Font.Size = 28
        t.TextFrame.TextRange.Font.Color.RGB = RGB(0, 0, 0)
        e = s.TimeLine.MainSequence.AddEffect(t, eid, 0, 1)
        e.Timing.Duration = 1.0
    return p



def charts_bubble(app):
    """气泡图：默认示例数据的气泡图、三维气泡图（PowerPoint 画成平面带渐变），以及改了气泡大小比例（50%）的气泡图"""
    p = new_pres(app, window=True)
    for kind, scale in ((15, None), (87, None), (15, 50)):
        s = blank(p)
        ch = s.Shapes.AddChart2(-1, kind, 80, 40, 800, 460)
        if scale:
            try:
                ch.Chart.ChartGroups(1).BubbleScale = scale
            except Exception as ex:
                print("气泡大小比例", ex)
        try:
            ch.Chart.ChartData.Workbook.Close()
        except Exception:
            pass
    return p

def _test_video(path):
    """用 ffmpeg 生成一段中性的测试视频（彩条图案 + 440Hz 音调，4 秒）。ffmpeg 找不到时可以用 UNPPT_FFMPEG 指定"""
    import os
    import shutil
    import subprocess
    ff = os.environ.get("UNPPT_FFMPEG") or shutil.which("ffmpeg") or r"D:\library\ffmpeg\ffmpeg.exe"
    subprocess.run([ff, "-v", "error", "-y", "-f", "lavfi", "-i", "testsrc=duration=4:size=320x180:rate=15",
                    "-f", "lavfi", "-i", "sine=frequency=440:duration=4", "-shortest", "-pix_fmt", "yuv420p",
                    "-c:v", "libx264", "-c:a", "aac", str(path)], check=True)


def media_video(app):
    """视频：第 1 页单击时播放（PowerPoint 默认）；第 2 页进入时自动播放"""
    tmp = TESTCASES.parent / ".cache" / "media"
    tmp.mkdir(parents=True, exist_ok=True)
    mp4 = tmp / "test-video.mp4"
    _test_video(mp4)
    p = new_pres(app, window=True)
    for auto in (False, True):
        s = blank(p)
        textbox(s, 60, 30, 800, 60, "视频：进入时自动播放" if auto else "视频：单击时播放", size=28)
        v = s.Shapes.AddMediaObject2(str(mp4.resolve()), 0, -1, 240, 120, 480, 270)
        if auto:
            v.AnimationSettings.PlaySettings.PlayOnEntry = -1
    return p


def fills_patterns(app):
    """图案填充：多种预设图案、不同前景/背景色、不同位置（图案从幻灯片原点对齐），表格单元格的图案填充"""
    p = new_pres(app)
    s = blank(p)
    colors = [(RGB(0, 0, 0), RGB(255, 255, 255)), (RGB(192, 0, 0), RGB(255, 242, 204)), (RGB(31, 78, 121), RGB(221, 235, 247)), (RGB(84, 130, 53), RGB(255, 255, 255))]
    for k, pat in enumerate([1, 7, 13, 15, 17, 19, 21, 23, 24, 34, 35, 38, 40, 42, 43, 44, 49, 51, 53, 54]):
        fg, bg = colors[k % 4]
        sh = s.Shapes.AddShape(1 if k % 3 else 9, 30.3 + (k % 7) * 131.7, 25.6 + (k // 7) * 120.9, 112.5, 101.3)
        sh.Line.Visible = 0
        sh.Fill.Patterned(pat)
        sh.Fill.ForeColor.RGB = fg
        sh.Fill.BackColor.RGB = bg
    s2 = blank(p)
    tb = s2.Shapes.AddTable(3, 3, 100, 100, 600, 240).Table
    for i in range(1, 4):
        for j in range(1, 4):
            c = tb.Cell(i, j).Shape
            c.Fill.Patterned([2, 22, 36][(i + j) % 3])
            c.Fill.ForeColor.RGB = RGB(68, 114, 196)
            c.Fill.BackColor.RGB = RGB(255, 255, 255)
            c.TextFrame.TextRange.Text = f"{i}-{j}"
    return p


def text_decoration(app):
    """文字装饰：荧光笔高亮、各种下划线、删除线、双删除线、小型大写字母、全部大写、上下标（每行整行设置）"""
    p = new_pres(app, window=True)
    s = blank(p)
    rows = [
        ("高亮 Highlight 黄色", "hl", RGB(255, 255, 0)), ("高亮 Highlight 青色", "hl", RGB(0, 255, 255)),
        ("单下划线 Single", "u", 2), ("双下划线 Double", "u", 3), ("粗下划线 Heavy", "u", 4), ("点下划线 Dotted", "u", 5),
        ("虚下划线 Dash", "u", 7), ("波浪线 Wavy", "u", 15), ("删除线 Strike", "st", 1), ("双删除线 Double", "st", 2),
        ("Small Caps 小型大写", "caps", 1), ("All Caps 全部大写", "caps", 2), ("上标 Superscript", "sup", 0), ("下标 Subscript", "sub", 0),
    ]
    for i, (text, kind, val) in enumerate(rows):
        tb = s.Shapes.AddTextbox(1, 40 + (i // 7) * 460, 30 + (i % 7) * 70, 440, 50)
        tr = tb.TextFrame2.TextRange
        tr.Text = text
        f = tr.Font
        f.Size = 24
        if kind == "hl":
            f.Highlight.RGB = val
        elif kind == "u":
            f.UnderlineStyle = val
        elif kind == "st":
            f.Strike = val
        elif kind == "caps":
            if val == 1:
                f.Smallcaps = -1
            else:
                f.Allcaps = -1
        elif kind == "sup":
            f.Superscript = -1
        elif kind == "sub":
            f.Subscript = -1
    return p


def anim_entrance(app):
    """常用进入效果：形状（方框向内、圆形向外、菱形、加号）、劈裂四个方向、轮子、百叶窗、随机线条、展开旋转、翻转、弹跳"""
    from win32com.client import gencache
    C = gencache.EnsureModule('{91493440-5A91-11CF-8700-00AA0060263B}', 0, 2, 12).constants
    p = new_pres(app)
    s = blank(p)
    seq = s.TimeLine.MainSequence
    items = [(4, 'msoAnimDirectionIn'), (6, 'msoAnimDirectionOut'), (8, 'msoAnimDirectionOut'), (13, 'msoAnimDirectionIn'),
             (16, 'msoAnimDirectionVerticalIn'), (16, 'msoAnimDirectionHorizontalOut'), (21, None), (3, None),
             (14, None), (31, None), (19, None), (26, None)]
    for k, (eid, d) in enumerate(items):
        sh = s.Shapes.AddShape(1, 40 + (k % 6) * 150, 120 + (k // 6) * 200, 120, 120)
        sh.TextFrame.TextRange.Text = str(k + 1)
        e = seq.AddEffect(sh, eid, 0, 1)
        if d:
            e.EffectParameters.Direction = getattr(C, d)
    return p


def svg_images(app):
    """SVG 图片（PowerPoint 同时存 PNG 备用图和原始 SVG）：小图和放大的图"""
    svg = (CACHE / "make-case" / "icon.svg").resolve()
    svg.parent.mkdir(parents=True, exist_ok=True)
    svg.write_text('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="40" fill="#2e75b6"/>'
                   '<path d="M30 52 L45 66 L72 36" fill="none" stroke="#fff" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/>'
                   '<rect x="8" y="8" width="20" height="20" fill="#c00000"/></svg>', encoding="utf-8")
    p = new_pres(app)
    s = blank(p)
    s.Shapes.AddPicture(str(svg), 0, -1, 40, 60, 60, 60)
    s.Shapes.AddPicture(str(svg), 0, -1, 140, 60, 420, 420)
    s.Shapes.AddPicture(str(svg), 0, -1, 600, 100, 300, 200)
    return p


def _chart_values(ch, rows):
    """改图表数据：rows 是从 A1 开始的表格（第一行是系列名，第一列是分类）"""
    cd = ch.Chart.ChartData
    cd.Activate()
    ws = cd.Workbook.Worksheets(1)
    for r, row in enumerate(rows, start=1):
        for c, v in enumerate(row, start=1):
            ws.Cells(r, c).Value = v
    ch.Chart.SetSourceData(f"Sheet1!$A$1:${chr(64 + len(rows[0]))}${len(rows)}")


def _close_data(ch):
    try:
        ch.Chart.ChartData.Workbook.Close()
    except Exception:
        pass


def charts_options(app):
    """图表的常用选项：平滑折线、分类轴逆序的条形图、饼图分离、刻度线和次要网格线、
    趋势线（线性、多项式）、误差线、对数刻度、显示单位（千）"""
    p = new_pres(app, window=True)
    def chart(s, i, kind):
        return s.Shapes.AddChart2(-1, kind, 20 + i * 470, 40, 450, 440)
    s = blank(p)
    a = chart(s, 0, 65)                      # 带标记折线，平滑
    for k in (1, 2, 3):
        a.Chart.SeriesCollection(k).Smooth = True
    _close_data(a)
    b = chart(s, 1, 57)                      # 簇状条形，分类轴逆序（数值轴随之移到上方）
    b.Chart.Axes(1).ReversePlotOrder = True
    _close_data(b)
    s = blank(p)
    c = chart(s, 0, 5)                       # 饼图，第 2 块分离
    c.Chart.SeriesCollection(1).Points(2).Explosion = 25
    _close_data(c)
    d = chart(s, 1, 51)                      # 簇状柱形：次要网格线、刻度线
    va, ca = d.Chart.Axes(2), d.Chart.Axes(1)
    va.HasMinorGridlines = True
    va.MajorTickMark = 3                     # 外部
    va.MinorTickMark = 2                     # 内部
    ca.MajorTickMark = 4                     # 交叉
    _close_data(d)
    s = blank(p)
    e = chart(s, 0, -4169)                   # 散点（默认只有一个系列）：线性、二次多项式趋势线
    e.Chart.SeriesCollection(1).Trendlines().Add(-4132)
    e.Chart.SeriesCollection(1).Trendlines().Add(3, 2)
    _close_data(e)
    f = chart(s, 1, 51)                      # 簇状柱形：固定值误差线
    f.Chart.SeriesCollection(1).ErrorBar(1, 1, 1, 0.5)
    f.Chart.SeriesCollection(2).ErrorBar(1, 2, 1, 0.8)
    _close_data(f)
    s = blank(p)
    g = chart(s, 0, 4)                       # 折线：对数刻度
    _chart_values(g, [["", "系列 1", "系列 2"], ["类别 1", 3, 120], ["类别 2", 25, 900], ["类别 3", 400, 60], ["类别 4", 5000, 7]])
    g.Chart.Axes(2).ScaleType = -4133
    _close_data(g)
    h = chart(s, 1, 51)                      # 簇状柱形：显示单位"千"
    _chart_values(h, [["", "系列 1", "系列 2"], ["类别 1", 4300, 2400], ["类别 2", 2500, 4400], ["类别 3", 3500, 1800], ["类别 4", 4500, 2800]])
    h.Chart.Axes(2).DisplayUnit = -3
    h.Chart.Axes(2).HasDisplayUnitLabel = True
    _close_data(h)
    return p


def charts_negative(app):
    """带负数的图表：簇状柱形、条形、折线、堆积柱形（分类轴在 0 线上，标签默认挨着它）；
    柱形图把分类标签设成"低"（放到底部）"""
    p = new_pres(app, window=True)
    rows = [["", "系列 1", "系列 2"], ["类别 1", 4.3, -2.4], ["类别 2", -2.5, 4.4], ["类别 3", 3.5, -1.8], ["类别 4", -4.5, 2.8]]
    def chart(s, i, kind):
        ch = s.Shapes.AddChart2(-1, kind, 20 + i * 470, 40, 450, 440)
        _chart_values(ch, rows)
        return ch
    s = blank(p)
    _close_data(chart(s, 0, 51))
    _close_data(chart(s, 1, 57))
    s = blank(p)
    _close_data(chart(s, 0, 4))
    _close_data(chart(s, 1, 52))
    s = blank(p)
    c = chart(s, 0, 51)
    c.Chart.Axes(1).TickLabelPosition = -4134    # xlTickLabelPositionLow
    _close_data(c)
    return p


def charts_legend(app):
    """图例在右、左、上（老版 Office 默认在右边）：簇状柱形、带标记折线、饼图、簇状条形，默认示例数据"""
    p = new_pres(app, window=True)
    specs = [(51, -4152), (65, -4152), (5, -4152), (57, -4152), (51, -4131), (51, -4160)]
    for i, (kind, pos) in enumerate(specs):
        if i % 2 == 0:
            s = blank(p)
        ch = s.Shapes.AddChart2(-1, kind, 20 + (i % 2) * 470, 40, 450, 440)
        ch.Chart.HasLegend = True
        ch.Chart.Legend.Position = pos
        _close_data(ch)
    return p


def charts_ofpie(app):
    """复合饼图、复合条饼图（6 个数据点，默认把最后几个拆到右边）；第 2 页是股价图（盘高-盘低-收盘），默认示例数据"""
    p = new_pres(app, window=True)
    s = blank(p)
    rows = [["", "销售额"], ["一月", 8.2], ["二月", 3.2], ["三月", 1.4], ["四月", 1.2], ["五月", 0.8], ["六月", 0.6]]
    for i, kind in enumerate((68, 71)):
        ch = s.Shapes.AddChart2(-1, kind, 20 + i * 470, 40, 450, 440)
        _chart_values(ch, rows)
        _close_data(ch)
    s2 = blank(p)
    ch = s2.Shapes.AddChart2(-1, 88, 20, 40, 920, 440)
    _close_data(ch)
    return p


def charts_3d(app):
    """三维图表：三维饼图、三维簇状柱形图（老课件常见），默认示例数据"""
    p = new_pres(app, window=True)
    s = blank(p)
    for i, kind in enumerate((-4102, 54)):   # xl3DPie、xl3DColumnClustered
        ch = s.Shapes.AddChart2(-1, kind, 20 + i * 470, 40, 450, 440)
        _close_data(ch)
    return p


def charts_markers(app):
    """数据点标记的各种形状和大小：折线图（方形、菱形、三角形、X、星形、圆点、短横线、圆形、加号）"""
    p = new_pres(app, window=True)
    styles = [1, 2, 3, -4168, 5, -4118, -4115, 8, 9]   # xlMarkerStyle：方、菱、三角、X、星、点、横、圆、加号
    s = blank(p)
    for k in range(3):
        ch = s.Shapes.AddChart2(-1, 65, 20 + k * 310, 60, 300, 420).Chart
        for si in range(1, ch.SeriesCollection().Count + 1):
            ser = ch.SeriesCollection(si)
            ser.MarkerStyle = styles[k * 3 + si - 1]
            ser.MarkerSize = [5, 9, 13][si - 1]
        try:
            ch.ChartData.Workbook.Close()
        except Exception:
            pass
    return p


def hidden_slides(app):
    """隐藏的幻灯片：顺序放映时跳过；第 1 页的按钮通过超链接跳到隐藏的第 2 页（课件里的"查看答案"）"""
    p = new_pres(app)
    for i in range(4):
        s = blank(p)
        t = s.Shapes.AddTextbox(1, 100, 100, 760, 100)
        t.TextFrame.TextRange.Text = f"第 {i + 1} 页" + ("（隐藏）" if i == 1 else "")
        t.TextFrame.TextRange.Font.Size = 54
    p.Slides(2).SlideShowTransition.Hidden = -1
    btn = p.Slides(1).Shapes.AddShape(1, 100, 300, 240, 80)
    btn.TextFrame.TextRange.Text = "查看答案"
    act = btn.ActionSettings(1)
    act.Action = 7                  # ppActionHyperlink
    act.Hyperlink.SubAddress = f"{p.Slides(2).SlideID},{p.Slides(2).SlideIndex},"
    return p


def media_background(app):
    """背景音乐：跨 3 页播放、循环直到停止、剪裁掉开头 0.3 秒和结尾 0.2 秒，放映时隐藏图标"""
    tmp = TESTCASES.parent / ".cache" / "media"
    tmp.mkdir(parents=True, exist_ok=True)
    wav = tmp / "tone.wav"
    make_tone(wav)
    p = new_pres(app, window=True)
    s1 = blank(p)
    textbox(s1, 60, 60, 700, 60, "背景音乐从这页开始，跨 3 页播放", size=28)
    a = s1.Shapes.AddMediaObject2(str(wav.resolve()), 0, -1, 800, 420, 48, 48)
    ps = a.AnimationSettings.PlaySettings
    ps.PlayOnEntry = -1
    ps.HideWhileNotPlaying = -1
    ps.LoopUntilStopped = -1
    ps.StopAfterSlides = 3
    a.MediaFormat.StartPoint = 300          # 剪裁：从 0.3 秒开始，结尾剪掉 0.2 秒
    a.MediaFormat.EndPoint = a.MediaFormat.Length - 200
    for i in range(2, 5):
        s = blank(p)
        textbox(s, 60, 60, 600, 60, f"第 {i} 页", size=28)
    return p


def text_glow_reflection(app):
    """文字的发光、映像、内阴影（艺术字样式常用）"""
    p = new_pres(app)
    s = blank(p)
    rows = [("发光文字 Glow", "glow"), ("映像文字 Reflection", "refl"), ("发光加映像 Both", "both"), ("内阴影文字 Inner", "inner")]
    for i, (text, kind) in enumerate(rows):
        tb = s.Shapes.AddTextbox(1, 60, 30 + i * 125, 800, 100)
        tr = tb.TextFrame2.TextRange
        tr.Text = text
        f = tr.Font
        f.Size = 48
        f.Bold = -1
        f.Fill.ForeColor.RGB = RGB(31, 78, 121)
        if kind in ("glow", "both"):
            f.Glow.Radius = 8
            f.Glow.Color.RGB = RGB(255, 192, 0)
        if kind in ("refl", "both"):
            f.Reflection.Type = 2
        if kind == "inner":
            f.Shadow.Visible = -1
            f.Shadow.Style = 1
            f.Shadow.Blur = 4
            f.Shadow.OffsetX = 2
            f.Shadow.OffsetY = 2
    return p


def text_tabs(app):
    """制表位：默认制表位、自定义左对齐 / 居中 / 右对齐 / 小数点对齐制表位（目录、对齐的多列）"""
    T, P = chr(9), chr(13)
    p = new_pres(app)
    s = blank(p)
    tb = s.Shapes.AddTextbox(1, 60, 40, 840, 200)
    tb.TextFrame.TextRange.Text = P.join([f"默认{T}制表位{T}测试", f"第一章{T}概述{T}3", f"第二章{T}方法和步骤{T}12", f"合计{T}1234.5{T}67.89"])
    tb.TextFrame.TextRange.Font.Size = 24
    tb2 = s.Shapes.AddTextbox(1, 60, 280, 840, 220)
    tb2.TextFrame.TextRange.Text = P.join([f"左{T}居中{T}右对齐{T}12.5", f"Left{T}Center text{T}Right{T}1234.75", f"甲{T}乙丙丁{T}戊{T}3.1"])
    tb2.TextFrame.TextRange.Font.Size = 24
    r = tb2.TextFrame.Ruler.TabStops
    r.Add(1, 150)    # ppTabStopLeft
    r.Add(2, 400)    # ppTabStopCenter
    r.Add(3, 620)    # ppTabStopRight
    r.Add(4, 760)    # ppTabStopDecimal
    return p


def text_picture_bullets(app):
    """图片项目符号：两种大小（100%、150%）"""
    from PIL import Image, ImageDraw
    png = (CACHE / "make-case" / "bullet.png").resolve()
    png.parent.mkdir(parents=True, exist_ok=True)
    im = Image.new("RGBA", (64, 64), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    d.ellipse((4, 4, 60, 60), fill=(192, 0, 0, 255))
    d.rectangle((24, 24, 40, 40), fill=(255, 255, 255, 255))
    im.save(png)
    p = new_pres(app)
    s = blank(p)
    for k, pct in enumerate((1.0, 1.5)):
        tb = s.Shapes.AddTextbox(1, 60, 40 + k * 240, 800, 200)
        tr = tb.TextFrame.TextRange
        tr.Text = chr(13).join(["第一条要点", "第二条要点 Second item", "第三条要点"])
        tr.Font.Size = 28
        pf = tr.ParagraphFormat
        pf.Bullet.Visible = -1
        pf.Bullet.Picture(str(png))
        pf.Bullet.RelativeSize = pct
    return p


def fills_texture(app):
    """纹理填充（平铺图片）：PowerPoint 预设纹理用在形状上，以及缩放、偏移过的平铺；背景用纹理"""
    p = new_pres(app)
    s = blank(p)
    for k, tex in enumerate([1, 5, 9, 13, 17, 21]):     # msoPresetTexture 若干种
        sh = s.Shapes.AddShape(1, 40 + (k % 3) * 300, 40 + (k // 3) * 240, 260, 200)
        sh.Line.Visible = 0
        sh.Fill.PresetTextured(tex)
    s2 = blank(p)
    s2.FollowMasterBackground = 0
    s2.Background.Fill.PresetTextured(7)
    t = s2.Shapes.AddTextbox(1, 100, 200, 760, 80)
    t.TextFrame.TextRange.Text = "纹理背景上的文字"
    t.TextFrame.TextRange.Font.Size = 40
    return p


def transition_morph(app):
    """平滑切换：第 2 页里和第 1 页同名的形状移动、缩放、变色；各有一个只在本页出现的形状"""
    from win32com.client import gencache
    C = gencache.EnsureModule('{91493440-5A91-11CF-8700-00AA0060263B}', 0, 2, 12).constants
    p = new_pres(app)
    s1 = blank(p)
    a = s1.Shapes.AddShape(9, 80, 80, 160, 160); a.Name = "圆"
    b = s1.Shapes.AddShape(1, 600, 300, 200, 120); b.Name = "方块"
    b.Fill.ForeColor.RGB = RGB(192, 0, 0)
    t = s1.Shapes.AddTextbox(1, 80, 420, 500, 60); t.Name = "标题"
    t.TextFrame.TextRange.Text = "平滑切换 Morph"
    t.TextFrame.TextRange.Font.Size = 32
    x = s1.Shapes.AddShape(5, 400, 60, 120, 80); x.Name = "只在第一页"
    s2 = blank(p)
    a2 = s2.Shapes.AddShape(9, 600, 100, 260, 260); a2.Name = "圆"
    b2 = s2.Shapes.AddShape(1, 100, 320, 300, 160); b2.Name = "方块"
    b2.Fill.ForeColor.RGB = RGB(0, 112, 192)
    t2 = s2.Shapes.AddTextbox(1, 300, 40, 500, 60); t2.Name = "标题"
    t2.TextFrame.TextRange.Text = "平滑切换 Morph"
    t2.TextFrame.TextRange.Font.Size = 40
    y = s2.Shapes.AddShape(4, 420, 400, 120, 80); y.Name = "只在第二页"
    s2.SlideShowTransition.EntryEffect = C.ppEffectMorphByObject
    return p


def text_embedded_fonts(app):
    """嵌入字体：保存时把字体嵌进文件（PowerPoint 只存用到的字，MicroType Express 压缩）"""
    p = new_pres(app)
    s = blank(p)
    rows = [("华文行楷", "嵌入字体：华文行楷 春眠不觉晓", 40), ("Impact", "Embedded Font Impact 2024", 44),
            ("华文行楷", "处处闻啼鸟 Mixed 混排 123", 32)]
    for i, (font, text, size) in enumerate(rows):
        t = s.Shapes.AddTextbox(1, 60, 50 + i * 150, 840, 120)
        t.TextFrame.WordWrap = -1
        r = t.TextFrame.TextRange
        r.Text = text
        r.Font.Name = font
        r.Font.NameFarEast = font
        r.Font.Size = size
    return p


text_embedded_fonts.embed_fonts = True


def text_warp(app):
    """艺术字文字变形：包络类（波形、膨胀、三角、V 形、上弯、多行）和跟随路径类（拱形、下拱、圆形、按钮、倾泻、罐形）"""
    p = new_pres(app)
    CR = chr(13)

    def box(s, i, text, warp=None, effect=None, size=36, color=None):
        t = s.Shapes.AddTextbox(1, 20 + (i % 2) * 480, 15 + (i // 2) * 175, 440, 160)
        t.TextFrame.AutoSize = 0
        t.TextFrame.WordWrap = 0
        t.Width, t.Height = 440, 160
        r = t.TextFrame.TextRange
        r.Text = text
        r.Font.Size = size
        r.Font.Name = "Arial"
        r.Font.NameFarEast = "Microsoft YaHei"
        if color:
            r.Font.Color.RGB = color
        if warp is not None:
            t.TextFrame2.WarpFormat = warp
        if effect is not None:
            t.TextEffect.PresetShape = effect
        return t

    s1 = blank(p)
    box(s1, 0, "波形 Wave 文字", warp=16)
    box(s1, 1, "膨胀 Inflate", warp=20, color=RGB(0, 112, 192))
    box(s1, 2, "三角 Triangle", warp=2)
    box(s1, 3, "V 形 Chevron", warp=4, color=RGB(192, 0, 0))
    box(s1, 4, "上弯 Curve Up", warp=12)
    box(s1, 5, "上半行" + CR + "下半行 Two", warp=26)
    s2 = blank(p)
    box(s2, 0, "拱形文字 Arch Up", effect=9)
    box(s2, 1, "下拱文字 Arch Down", effect=10)
    box(s2, 2, "圆形排列的文字 Circle Text 环绕", effect=11, size=28)
    box(s2, 3, "按钮 Button", effect=12)
    box(s2, 4, "拱形倾泻" + CR + "Arch Pour", warp=8)
    box(s2, 5, "罐形 Can Up", warp=14, color=RGB(0, 128, 0))
    return p


def anim_repeat(app):
    """动画重复和自动翻转：进入重复 2 次、放大后自动翻转回原大小、旋转重复 3 次、正圆一直旋转到下一次单击"""
    p = new_pres(app)
    s = blank(p)
    seq = s.TimeLine.MainSequence
    specs = [(1, 2, 2, False), (1, 59, 1, True), (1, 61, 3, False), (9, 61, 9999, False)]
    for i, (kind, eff, rep, rev) in enumerate(specs):
        sh = s.Shapes.AddShape(kind, 60 + i * 220, 200, 140, 140 if kind == 9 else 100)
        if kind != 9:
            sh.TextFrame.TextRange.Text = f"重复 {i + 1}"
        e = seq.AddEffect(sh, eff, 0, 1)
        if rep > 1:
            e.Timing.RepeatCount = rep
        if rev:
            e.Timing.AutoReverse = -1
    return p


def _patch_until_click(path):
    """COM 只能设到重复 9999 次；改成 PowerPoint 界面里"直到下一次单击"写出的 indefinite"""
    import zipfile
    tmp = path.with_suffix(".tmp")
    with zipfile.ZipFile(path) as zin, zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as zout:
        for item in zin.infolist():
            data = zin.read(item.filename)
            if item.filename.startswith("ppt/slides/slide"):
                data = data.replace(b'repeatCount="9999000"', b'repeatCount="indefinite"')
            zout.writestr(item, data)
    tmp.replace(path)


anim_repeat.patch = _patch_until_click


def charts_sizes(app):
    """图表文字字号对布局的影响：9、20、28 磅下的簇状柱形图和簇状条形图（坐标轴标签、图例的间距都随字号变化）"""
    p = new_pres(app, window=True)
    for size in (9, 20, 28):
        s = blank(p)
        for i, kind in enumerate([51, 57]):
            ch = s.Shapes.AddChart2(-1, kind, 20 + i * 470, 40, 450, 440)
            ch.Chart.ChartArea.Format.TextFrame2.TextRange.Font.Size = size
            try:
                ch.Chart.ChartData.Workbook.Close()
            except Exception:
                pass
    return p


def slide_timings(app):
    """自动换片和循环放映：3 秒换片；2 秒换片且有两个单击动画（自动依次播放）；
    2 秒换片但动画要 2.5 秒才播完（等动画）；单击不换片；放映设置为循环放映"""
    p = new_pres(app)
    def page(title, after=None):
        s = blank(p)
        t = s.Shapes.AddTextbox(1, 60, 40, 800, 60)
        t.TextFrame.TextRange.Text = title
        t.TextFrame.TextRange.Font.Size = 32
        if after is not None:
            s.SlideShowTransition.AdvanceOnTime = -1
            s.SlideShowTransition.AdvanceTime = after
        return s
    page("第 1 页：3 秒后自动换片", 3)
    s2 = page("第 2 页：2 秒换片，两个单击动画自动播放", 2)
    for i in range(2):
        sh = s2.Shapes.AddShape(1, 100 + i * 250, 220, 200, 120)
        e = s2.TimeLine.MainSequence.AddEffect(sh, 10, 0, 1)
        e.Timing.Duration = 0.5
    s3 = page("第 3 页：动画 2.5 秒才播完", 2)
    sh = s3.Shapes.AddShape(9, 100, 220, 200, 200)
    e = s3.TimeLine.MainSequence.AddEffect(sh, 10, 0, 3)
    e.Timing.Duration = 1
    e.Timing.TriggerDelayTime = 1.5
    s4 = page("第 4 页：单击不换片")
    s4.SlideShowTransition.AdvanceOnClick = 0
    p.SlideShowSettings.LoopUntilStopped = -1
    return p


def lines_compound(app):
    """复合线型：单线、双线、外细内粗、外粗内细、三线（粗细两种宽度），椭圆和直线上的双线"""
    p = new_pres(app)
    s = blank(p)
    for row, weight in enumerate([12, 6]):
        for i, st in enumerate([1, 2, 3, 4, 5]):
            sh = s.Shapes.AddShape(1, 40 + i * 180, 40 + row * 190, 150, 150)
            sh.Fill.ForeColor.RGB = RGB(220, 230, 242)
            sh.Line.Weight = weight
            sh.Line.ForeColor.RGB = RGB(31, 78, 121)
            sh.Line.Style = st
    e = s.Shapes.AddShape(9, 60, 420, 200, 100)
    e.Fill.Visible = 0
    e.Line.Weight = 9
    e.Line.Style = 2
    ln = s.Shapes.AddLine(320, 470, 900, 470)
    ln.Line.Weight = 9
    ln.Line.Style = 2
    ln.Line.ForeColor.RGB = RGB(192, 0, 0)
    return p


def table_diagonal(app):
    """斜线表头：课表左上角单元格的左上到右下斜线，另一个单元格左下到右上斜线"""
    p = new_pres(app)
    s = blank(p)
    t = s.Shapes.AddTable(4, 5, 60, 60, 840, 320).Table
    heads = ["", "周一", "周二", "周三", "周四"]
    for c, h in enumerate(heads):
        t.Cell(1, c + 1).Shape.TextFrame.TextRange.Text = h
    for r in range(2, 5):
        t.Cell(r, 1).Shape.TextFrame.TextRange.Text = f"第 {r - 1} 节"
        for c in range(2, 6):
            t.Cell(r, c).Shape.TextFrame.TextRange.Text = "语文" if (r + c) % 2 else "数学"
    t.Cell(1, 1).Shape.TextFrame.TextRange.Text = "节次  星期"
    b = t.Cell(1, 1).Borders(5)
    b.Visible = -1
    b.Weight = 1.5
    b.ForeColor.RGB = RGB(0, 0, 0)
    b2 = t.Cell(3, 3).Borders(6)
    b2.Visible = -1
    b2.Weight = 2
    b2.ForeColor.RGB = RGB(192, 0, 0)
    return p


def lines_gradient(app):
    """渐变线条：矩形、椭圆的渐变边框（双色、三色），粗直线的渐变（COM 设不了线条渐变，保存后改 XML）"""
    p = new_pres(app)
    s = blank(p)
    marks = [RGB(1, 2, 3), RGB(4, 5, 6), RGB(7, 8, 9)]
    a = s.Shapes.AddShape(1, 60, 60, 260, 180)
    b = s.Shapes.AddShape(9, 380, 60, 260, 180)
    c = s.Shapes.AddShape(5, 700, 60, 200, 180)
    for sh, m in zip((a, b, c), marks):
        sh.Fill.ForeColor.RGB = RGB(242, 242, 242)
        sh.Line.Weight = 10
        sh.Line.ForeColor.RGB = m
    ln = s.Shapes.AddLine(80, 400, 880, 400)
    ln.Line.Weight = 14
    ln.Line.ForeColor.RGB = RGB(10, 11, 12)
    return p


def _patch_gradient_lines(path):
    """把标记颜色的线条换成渐变（PowerPoint 界面里"渐变线"写出的同样结构）"""
    import zipfile
    grads = {
        b"010203": b'<a:gradFill><a:gsLst><a:gs pos="0"><a:srgbClr val="FF0000"/></a:gs><a:gs pos="100000"><a:srgbClr val="0070C0"/></a:gs></a:gsLst><a:lin ang="0" scaled="0"/></a:gradFill>',
        b"040506": b'<a:gradFill><a:gsLst><a:gs pos="0"><a:srgbClr val="FFC000"/></a:gs><a:gs pos="50000"><a:srgbClr val="00B050"/></a:gs><a:gs pos="100000"><a:srgbClr val="7030A0"/></a:gs></a:gsLst><a:lin ang="5400000" scaled="0"/></a:gradFill>',
        b"070809": b'<a:gradFill><a:gsLst><a:gs pos="0"><a:srgbClr val="002060"/></a:gs><a:gs pos="100000"><a:srgbClr val="00B0F0"/></a:gs></a:gsLst><a:lin ang="2700000" scaled="0"/></a:gradFill>',
        b"0A0B0C": b'<a:gradFill><a:gsLst><a:gs pos="0"><a:srgbClr val="C00000"/></a:gs><a:gs pos="100000"><a:srgbClr val="FFC000"/></a:gs></a:gsLst><a:lin ang="0" scaled="0"/></a:gradFill>',
    }
    tmp = path.with_suffix(".tmp")
    with zipfile.ZipFile(path) as zin, zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as zout:
        for item in zin.infolist():
            data = zin.read(item.filename)
            if item.filename.startswith("ppt/slides/slide"):
                for k, v in grads.items():
                    data = data.replace(b'<a:solidFill><a:srgbClr val="' + k + b'"/></a:solidFill>', v)
            zout.writestr(item, data)
    tmp.replace(path)


lines_gradient.patch = _patch_gradient_lines


def fills_radial(app):
    """径向（路径）渐变：焦点在中心（正方形、2:1 矩形）、顶边中间、左上角、顶边一段（Gallery 主题背景那种）、
    右下角；两色、三色（COM 设不了焦点矩形，保存后改 XML）"""
    p = new_pres(app)
    s = blank(p)
    specs = [(30, 30, 200, 200), (260, 30, 400, 200), (700, 30, 200, 200), (30, 280, 200, 200), (260, 280, 400, 200), (700, 280, 200, 200)]
    for i, (x, y, w, h) in enumerate(specs):
        sh = s.Shapes.AddShape(1, x, y, w, h)
        sh.Line.Visible = 0
        sh.Fill.ForeColor.RGB = RGB(i + 21, i + 21, i + 21)
    return p


def _patch_radial(path, kind="circle"):
    import zipfile
    def g(stops, ftr):
        gs = "".join(f'<a:gs pos="{p}"><a:srgbClr val="{c}"/></a:gs>' for p, c in stops)
        return f'<a:gradFill rotWithShape="1"><a:gsLst>{gs}</a:gsLst><a:path path="{kind}"><a:fillToRect {ftr}/></a:path></a:gradFill>'.encode()
    wb = [(0, "FFFFFF"), (100000, "1F3864")]
    reps = {
        "151515": g(wb, 'l="50000" t="50000" r="50000" b="50000"'),
        "161616": g([(0, "FFF2CC"), (100000, "C55A11")], 'l="50000" t="50000" r="50000" b="50000"'),
        "171717": g(wb, 'l="50000" r="50000" b="100000"'),
        "181818": g([(0, "E2F0D9"), (100000, "385723")], 'r="100000" b="100000"'),
        "191919": g([(0, "FFFFFF"), (100000, "A6A6A6")], 'l="43000" r="43000" b="100000"'),
        "1A1A1A": g([(0, "FFFFFF"), (50000, "9DC3E6"), (100000, "1F4E79")], 'l="100000" t="100000"'),
    }
    tmp = path.with_suffix(".tmp")
    with zipfile.ZipFile(path) as zin, zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as zout:
        for item in zin.infolist():
            data = zin.read(item.filename)
            if item.filename.startswith("ppt/slides/slide"):
                for k, v in reps.items():
                    data = data.replace(b'<a:solidFill><a:srgbClr val="' + k.encode() + b'"/></a:solidFill>', v)
            zout.writestr(item, data)
    tmp.replace(path)


fills_radial.patch = _patch_radial


def fills_rect_gradient(app):
    """矩形（path=rect）渐变：和 fills-radial 同样的焦点布置，等值线是一圈圈矩形"""
    return fills_radial(app)


fills_rect_gradient.patch = lambda path: _patch_radial(path, "rect")


def shapes_3d(app):
    """三维形状：默认圆形棱台（三点灯光），10 种填充色，正面会被灯光照亮；第 2 页是带棱台的文字"""
    p = new_pres(app)
    s = blank(p)
    cols = [(192, 0, 0), (0, 176, 80), (0, 112, 192), (128, 128, 128), (255, 255, 255),
            (0, 0, 0), (31, 56, 100), (255, 192, 0), (200, 200, 255), (60, 60, 60)]
    for i, (r, g, b) in enumerate(cols):
        sh = s.Shapes.AddShape(1, 30 + (i % 5) * 185, 40 + (i // 5) * 240, 160, 200)
        sh.Fill.ForeColor.RGB = RGB(r, g, b)
        sh.Line.Visible = 0
        sh.ThreeD.BevelTopType = 3
    # 第 2 页：带棱台的文字（艺术字常见），文字颜色同样被灯光提亮
    s2 = blank(p)
    for i, (r, g, b) in enumerate([(192, 0, 0), (0, 112, 192), (128, 128, 128)]):
        t = s2.Shapes.AddTextbox(1, 40, 30 + i * 160, 880, 150)
        tr = t.TextFrame.TextRange
        tr.Text = "三维文字 Bevel 3D"
        tr.Font.Size = 72
        tr.Font.Name = "Arial"
        tr.Font.NameFarEast = "Microsoft YaHei"
        tr.Font.Bold = -1
        tr.Font.Color.RGB = RGB(r, g, b)
        t.TextFrame2.ThreeD.BevelTopType = 3
    return p


def shapes_bevel(app):
    """棱台的尺寸、形状和截面类型：第 1 页圆形棱台 4 种宽高（含主题"强烈效果"常见的 5×2 磅）× 椭圆、圆角矩形、星形；
    第 2 页其它截面类型（斜角、柔圆、凸起、角度、松散嵌入、十字）"""
    p = new_pres(app)
    s = blank(p)
    sizes = [(3, 3), (9, 9), (5, 2), (8, 4)]
    kinds = [1, 9, 5, 92]   # 矩形、椭圆、圆角矩形、五角星
    for i, (bw, bh) in enumerate(sizes):
        for j, kind in enumerate(kinds):
            sh = s.Shapes.AddShape(kind, 40 + j * 230, 30 + i * 125, 180, 105)
            sh.Fill.ForeColor.RGB = RGB(60, 120, 200) if i % 2 == 0 else RGB(220, 120, 40)
            sh.Line.Visible = 0
            sh.ThreeD.BevelTopType = 3
            sh.ThreeD.BevelTopInset = bw
            sh.ThreeD.BevelTopDepth = bh
    s2 = blank(p)
    # msoBevel：2 松散嵌入、4 斜角(coolSlant)、5 角度、6 柔圆、7 凸起、11 十字
    for i, t in enumerate([2, 4, 5, 6, 7, 11]):
        sh = s2.Shapes.AddShape(1, 40 + (i % 3) * 300, 60 + (i // 3) * 240, 240, 180)
        sh.Fill.ForeColor.RGB = RGB(80, 160, 90)
        sh.Line.Visible = 0
        sh.ThreeD.BevelTopType = t
    return p


def shapes_3d_rotation(app):
    """三维旋转：12 种相机预设（等轴测、轴外等轴测、透视）作用在带图案的矩形上；第 2 页是图片"""
    p = new_pres(app)
    img = str((TESTCASES / "shapes-basic" / "slide-001.png").resolve())
    presets = [20, 25, 26, 29, 31, 34, 48, 49, 51, 53, 57, 61]
    for page in range(2):
        s = blank(p)
        for i, cam in enumerate(presets):
            x, y = 40 + (i % 4) * 230, 30 + (i // 4) * 165
            if page == 0:
                sh = s.Shapes.AddShape(1, x, y, 170, 110)
                sh.Fill.TwoColorGradient(1, 1)
                sh.Fill.ForeColor.RGB = RGB(40, 90, 180)
                sh.Fill.BackColor.RGB = RGB(250, 200, 60)
                sh.Line.Weight = 3
                sh.Line.ForeColor.RGB = RGB(200, 30, 30)
                sh.TextFrame.TextRange.Text = "3D"
                sh.TextFrame.TextRange.Font.Size = 28
            else:
                sh = s.Shapes.AddPicture(img, 0, -1, x, y, 170, 96)
            sh.ThreeD.SetPresetCamera(cam)
    return p


def table_vertical(app):
    """表格单元格竖排文字：竖排（汉字正立）、向上旋转 90 度、向下旋转 90 度"""
    p = new_pres(app)
    s = blank(p)
    t = s.Shapes.AddTable(2, 4, 60, 60, 840, 400).Table
    t.Rows(2).Height = 320
    texts = ["竖排文字", "向上 Upward", "向下 Downward", "横排对照"]
    for c, (txt, orient) in enumerate(zip(texts, [5, 2, 3, 1])):
        t.Cell(1, c + 1).Shape.TextFrame.TextRange.Text = f"第 {c + 1} 列"
        cell = t.Cell(2, c + 1).Shape.TextFrame
        cell.TextRange.Text = txt
        cell.TextRange.Font.Size = 28
        cell.Orientation = orient
    return p


CASES = [shapes_all, text_sizes, text_align, text_spacing, text_bullets, text_missing_font, shapes_basic, fills_lines, table_basic, group_rotate, anim_basic, anim_auto, charts_basic, pictures, smartart, text_effects, text_layout, table_merge, links, emf_images, anim_advanced, charts_labels, freeform_icons, media_audio, anim_trigger, wmf_images, anim_iterate, picture_transparent, charts_more, shape_effects, equations, anim_path, anim_emphasis, transitions, fills_patterns, text_decoration, anim_entrance, svg_images, charts_markers, hidden_slides, media_background, text_glow_reflection, text_tabs, text_picture_bullets, fills_texture, transition_morph, text_embedded_fonts, text_warp, anim_repeat, charts_sizes, slide_timings, lines_compound, table_diagonal, lines_gradient, fills_radial, fills_rect_gradient, shapes_3d, table_vertical, transitions_more, anim_sound, anim_build, anim_after, anim_text_emphasis, charts_bubble, media_video, charts_options, charts_negative, shapes_bevel, charts_legend, shapes_3d_rotation, smartart_3d, charts_ofpie, charts_3d]


def main():
    names = sys.argv[1:]
    pythoncom.CoInitialize()
    app = win32com.client.DispatchEx("PowerPoint.Application")
    TESTCASES.mkdir(exist_ok=True)
    # PowerPoint 是单实例：记下运行前已经打开的演示文稿，结束时只关这次新建的
    before = {app.Presentations(i).FullName for i in range(1, app.Presentations.Count + 1)}
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
            # 需要嵌入字体的用例：SaveAs 第三个参数 EmbedTrueTypeFonts
            if getattr(fn, "embed_fonts", False):
                p.SaveAs(str(out.resolve()), 24, -1)
            else:
                p.SaveAs(str(out.resolve()))
            p.Close()
            # 有些设置 COM 做不到：保存后直接改 XML
            if getattr(fn, "patch", None):
                fn.patch(out)
            print("生成", out.name)
    finally:
        # 生成用例出错中断时，这次新建、还没关的演示文稿不保存直接关掉（运行前就打开的不动）
        for i in range(app.Presentations.Count, 0, -1):
            pr = app.Presentations(i)
            if pr.FullName not in before:
                pr.Saved = True
                pr.Close()
        if app.Presentations.Count == 0:
            app.Quit()


if __name__ == "__main__":
    main()
