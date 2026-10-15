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
    if window:
        # 有窗口时立刻最小化，免得弹到用户面前抢焦点（ppWindowMinimized = 2）
        try:
            p.Windows(1).WindowState = 2
            app.WindowState = 2
        except Exception:
            pass
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


def anim_group_emphasis(app):
    """作用在组合上的强调动画：更改填充颜色、变暗、变淡、不饱和、对比色、更改线条颜色（组合里两个形状）。
    PowerPoint 放映实测这些效果作用在组合上都不变色，静态导出的参考图（不变色）正好和放映一致"""
    p = new_pres(app)
    s = blank(p)
    seq = s.TimeLine.MainSequence
    for i, eff in enumerate([54, 73, 78, 74, 70, 60]):
        x, y = 40 + (i % 3) * 300, 60 + (i // 3) * 230
        a = s.Shapes.AddShape(1, x, y, 120, 90)
        b = s.Shapes.AddShape(9, x + 130, y + 40, 110, 110)
        a.Fill.ForeColor.RGB = RGB(70, 120, 200)
        b.Fill.ForeColor.RGB = RGB(230, 140, 40)
        for sh in (a, b):
            sh.Line.Weight = 3
            sh.Line.ForeColor.RGB = RGB(40, 40, 40)
        g = s.Shapes.Range([a.Name, b.Name]).Group()
        e = seq.AddEffect(g, eff, 0, 1)
        if eff in (54, 60):
            try:
                e.EffectParameters.Color2.RGB = RGB(200, 30, 30)
            except Exception as ex:
                print("颜色参数", eff, ex)
    return p


def activex_controls(app):
    """ActiveX 控件（老课件里嵌 Flash 常用）：放映时显示控件保存的预览图，盖在其它形状上面。
    COM 建不了 ActiveX 控件（信任中心限制），先放两张图片，保存后改 XML 包成 PowerPoint 2010+ 的控件写法"""
    p = new_pres(app)
    s = blank(p)
    img = str((TESTCASES / "shapes-basic" / "slide-001.png").resolve())
    r = s.Shapes.AddShape(1, 300, 140, 360, 260)
    r.Fill.ForeColor.RGB = RGB(70, 120, 200)
    a = s.Shapes.AddPicture(img, 0, -1, 40, 60, 400, 225)
    a.Name = "ACTIVEX1"
    b = s.Shapes.AddPicture(img, 0, -1, 520, 260, 400, 225)
    b.Name = "ACTIVEX2"
    # 普通形状放在最上面：控件仍然盖在它上面
    r.ZOrder(0)
    return p


def _patch_activex(path):
    """名字是 ACTIVEX 开头的图片移到 p:controls 里，变成带预览图的控件（PowerPoint 2010+ 写在 Fallback 里的那种）；
    每个控件一个最简的 Forms.Label 控件部件"""
    import re
    import zipfile
    tmp = path.with_suffix(".tmp")
    with zipfile.ZipFile(path) as zin, zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as zout:
        names = zin.namelist()
        for item in zin.infolist():
            data = zin.read(item.filename)
            if item.filename == "ppt/slides/slide1.xml":
                s = data.decode("utf-8")
                pics = re.findall(r'<p:pic>(?:(?!</p:pic>).)*?name="ACTIVEX\d"(?:(?!</p:pic>).)*</p:pic>', s, re.S)
                controls = []
                for k, pic in enumerate(pics, 1):
                    s = s.replace(pic, "")
                    ext = re.search(r'<a:ext cx="(\d+)" cy="(\d+)"/>', pic)
                    controls.append(f'<p:control name="ACTIVEX{k}" r:id="rIdAx{k}" imgW="{ext.group(1)}" imgH="{ext.group(2)}">{pic}</p:control>')
                s = s.replace("</p:spTree>", "</p:spTree><p:controls>" + "".join(controls) + "</p:controls>", 1)
                data = s.encode("utf-8")
            elif item.filename == "ppt/slides/_rels/slide1.xml.rels":
                rel = "".join(f'<Relationship Id="rIdAx{k}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/control" Target="../activeX/activeX{k}.xml"/>' for k in (1, 2))
                data = data.replace(b"</Relationships>", rel.encode() + b"</Relationships>")
            elif item.filename == "[Content_Types].xml":
                data = data.replace(b"</Types>", b'<Override PartName="/ppt/activeX/activeX1.xml" ContentType="application/vnd.ms-office.activeX+xml"/><Override PartName="/ppt/activeX/activeX2.xml" ContentType="application/vnd.ms-office.activeX+xml"/></Types>')
            zout.writestr(item, data)
        for k in (1, 2):
            zout.writestr(f"ppt/activeX/activeX{k}.xml", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><ax:ocx ax:classid="{978C9E23-D4B0-11CE-BF2D-00AA003F40D0}" ax:persistence="persistPropertyBag" xmlns:ax="http://schemas.microsoft.com/office/2006/activeX" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><ax:ocxPr ax:name="Caption" ax:value="Label"/></ax:ocx>')
    tmp.replace(path)


activex_controls.patch = _patch_activex

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
    _hide_excel(cd)
    ws = cd.Workbook.Worksheets(1)
    for r, row in enumerate(rows, start=1):
        for c, v in enumerate(row, start=1):
            ws.Cells(r, c).Value = v
    ch.Chart.SetSourceData(f"Sheet1!$A$1:${chr(64 + len(rows[0]))}${len(rows)}")


def _hide_excel(cd):
    """图表数据打开的 Excel 窗口立刻藏起来（xlMinimized = -4140），不抢焦点"""
    import time
    for _ in range(20):
        try:
            xl = cd.Workbook.Application
            xl.WindowState = -4140
            xl.Visible = False
            return
        except Exception:
            time.sleep(0.3)


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


def charts_extras(app):
    """图表的其它常用设置：数据表（柱形图、折线图）；带空值的折线图按零、连线、留空显示；
    折线图的垂直线、高低点连线、涨跌柱（默认示例数据）"""
    p = new_pres(app, window=True)
    def chart(s, i, kind):
        return s.Shapes.AddChart2(-1, kind, 20 + i * 470, 40, 450, 440)
    s = blank(p)
    a = chart(s, 0, 51)
    a.Chart.HasDataTable = True
    _close_data(a)
    b = chart(s, 1, 65)
    b.Chart.HasDataTable = True
    _close_data(b)
    rows = [["", "系列 1", "系列 2"], ["类别 1", 4.3, 2.4], ["类别 2", None, 4.4], ["类别 3", 3.5, None], ["类别 4", 4.5, 2.8], ["类别 5", 2.0, 3.0]]
    s = blank(p)
    for i, mode in enumerate((2, 3)):        # xlZero、xlInterpolated
        c = chart(s, i, 65)
        _chart_values(c, rows)
        c.Chart.DisplayBlanksAs = mode
        _close_data(c)
    s = blank(p)
    e = chart(s, 0, 65)
    _chart_values(e, rows)
    e.Chart.DisplayBlanksAs = 1              # xlNotPlotted（留空）
    _close_data(e)
    f = chart(s, 1, 4)
    g = f.Chart.ChartGroups(1)
    g.HasDropLines = True
    g.HasHiLoLines = True
    g.HasUpDownBars = True
    _close_data(f)
    return p

def charts_axis_titles(app):
    """坐标轴标题（课件里常见的"时间 (s)""速度 (m/s)"）：柱形图、散点图都开两个标题；
    条形图的标题（分类轴在左）；折线图只开纵轴标题、图表文字 16 磅"""
    p = new_pres(app, window=True)
    def chart(s, i, kind, x=None, y=None, font=None):
        ch = s.Shapes.AddChart2(-1, kind, 20 + i * 470, 40, 450, 440)
        _close_data(ch)
        if font:
            ch.Chart.ChartArea.Format.TextFrame2.TextRange.Font.Size = font
        for k, t in ((1, x), (2, y)):
            if t:
                ax = ch.Chart.Axes(k)
                ax.HasTitle = True
                ax.AxisTitle.Text = t
        return ch
    s = blank(p)
    chart(s, 0, 51, "时间 (s)", "速度 (m/s)")
    chart(s, 1, -4169, "时间 (s)", "位移 (m)")
    s = blank(p)
    chart(s, 0, 57, "类别", "数量")
    chart(s, 1, 4, None, "温度 (°C)", 16)
    return p

def charts_fills(app):
    """图表区、绘图区的填充和边框：灰色绘图区加边框（Excel 2003 风格）的柱形图；
    渐变图表区、浅色绘图区的折线图；散点图的绘图区填充；系列的渐变填充（柱形图两个系列、饼图一块）"""
    p = new_pres(app, window=True)
    def chart(s, i, kind):
        ch = s.Shapes.AddChart2(-1, kind, 20 + i * 470, 40, 450, 440)
        _close_data(ch)
        return ch.Chart
    s = blank(p)
    a = chart(s, 0, 51)
    a.PlotArea.Format.Fill.Visible = -1
    a.PlotArea.Format.Fill.Solid()
    a.PlotArea.Format.Fill.ForeColor.RGB = RGB(192, 192, 192)
    a.PlotArea.Format.Line.Visible = -1
    a.PlotArea.Format.Line.ForeColor.RGB = RGB(128, 128, 128)
    a.ChartArea.Format.Line.Visible = -1
    a.ChartArea.Format.Line.ForeColor.RGB = RGB(0, 0, 0)
    b = chart(s, 1, 4)
    b.ChartArea.Format.Fill.TwoColorGradient(1, 1)
    b.ChartArea.Format.Fill.ForeColor.RGB = RGB(222, 235, 247)
    b.ChartArea.Format.Fill.BackColor.RGB = RGB(255, 255, 255)
    b.PlotArea.Format.Fill.Visible = -1
    b.PlotArea.Format.Fill.Solid()
    b.PlotArea.Format.Fill.ForeColor.RGB = RGB(255, 250, 230)
    s = blank(p)
    c = chart(s, 0, -4169)
    c.PlotArea.Format.Fill.Visible = -1
    c.PlotArea.Format.Fill.Solid()
    c.PlotArea.Format.Fill.ForeColor.RGB = RGB(235, 241, 222)
    # 系列的渐变填充：柱形图第 1 个系列竖向渐变、第 2 个横向渐变；饼图第 2 块渐变
    d = chart(s, 1, 51)
    f1 = d.SeriesCollection(1).Format.Fill
    f1.TwoColorGradient(1, 1)
    f1.ForeColor.RGB = RGB(30, 90, 160); f1.BackColor.RGB = RGB(160, 210, 250)
    f2 = d.SeriesCollection(2).Format.Fill
    f2.TwoColorGradient(2, 1)
    f2.ForeColor.RGB = RGB(200, 60, 30); f2.BackColor.RGB = RGB(255, 200, 120)
    s = blank(p)
    e = chart(s, 0, 5)
    g = e.SeriesCollection(1).Points(2).Format.Fill
    g.TwoColorGradient(1, 1)
    g.ForeColor.RGB = RGB(40, 140, 60); g.BackColor.RGB = RGB(200, 240, 200)
    return p

def charts_outlines(app):
    """系列的边框：柱形图三个系列加黑色边框（Excel 2003 风格）、条形图加粗的彩色边框；
    饼图扇区用深灰边框、另一个饼图去掉边框"""
    p = new_pres(app, window=True)
    def chart(s, i, kind):
        ch = s.Shapes.AddChart2(-1, kind, 20 + i * 470, 40, 450, 440)
        _close_data(ch)
        return ch.Chart
    s = blank(p)
    a = chart(s, 0, 51)
    for k in (1, 2, 3):
        ln = a.SeriesCollection(k).Format.Line
        ln.Visible = -1; ln.ForeColor.RGB = RGB(0, 0, 0); ln.Weight = 0.75
    b = chart(s, 1, 57)
    for k, col in ((1, RGB(200, 30, 30)), (2, RGB(30, 30, 200))):
        ln = b.SeriesCollection(k).Format.Line
        ln.Visible = -1; ln.ForeColor.RGB = col; ln.Weight = 2.5
    s = blank(p)
    c = chart(s, 0, 5)
    ln = c.SeriesCollection(1).Format.Line
    ln.Visible = -1; ln.ForeColor.RGB = RGB(64, 64, 64); ln.Weight = 1.5
    d = chart(s, 1, 5)
    d.SeriesCollection(1).Format.Line.Visible = 0
    return p

def charts_labels_more(app):
    """数据标签的位置和内容：柱形图标签在内侧末端、堆积柱形图在中间；饼图标签在外侧（类别名 + 百分比）、
    圆环图显示数值；条形图标签在内侧底部、折线图标签在上方（一位小数）"""
    p = new_pres(app, window=True)
    def chart(s, i, kind):
        ch = s.Shapes.AddChart2(-1, kind, 20 + i * 470, 40, 450, 440)
        _close_data(ch)
        return ch.Chart
    def labels(c, k, pos=None):
        sr = c.SeriesCollection(k)
        sr.HasDataLabels = True
        if pos is not None:
            sr.DataLabels().Position = pos
        return sr.DataLabels()
    s = blank(p)
    a = chart(s, 0, 51)
    for k in (1, 2, 3): labels(a, k, 3)          # xlLabelPositionInsideEnd
    b = chart(s, 1, 52)
    for k in (1, 2, 3): labels(b, k, -4108)      # xlLabelPositionCenter
    s = blank(p)
    c = chart(s, 0, 5)
    d = labels(c, 1, 2)                          # xlLabelPositionOutsideEnd
    d.ShowCategoryName = True; d.ShowPercentage = True; d.ShowValue = False
    e = chart(s, 1, -4120)                       # 圆环图
    labels(e, 1)
    s = blank(p)
    f = chart(s, 0, 57)
    for k in (1, 2, 3): labels(f, k, 4)          # xlLabelPositionInsideBase
    g = chart(s, 1, 65)
    d = labels(g, 1, 0)                          # xlLabelPositionAbove
    d.NumberFormat = "0.0"
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
    """三维图表：三维饼图、三维簇状柱形图（老课件常见）；第 2 页三维堆积柱形图、三维簇状条形图；
    第 3 页三维柱形图（系列沿深度排）、三维折线图，默认示例数据"""
    p = new_pres(app, window=True)
    # xl3DPie、xl3DColumnClustered、xl3DColumnStacked、xl3DBarClustered、xl3DColumn、xl3DLine
    for k, kind in enumerate((-4102, 54, 55, 60, -4100, -4101)):
        if k % 2 == 0:
            s = blank(p)
        ch = s.Shapes.AddChart2(-1, kind, 20 + (k % 2) * 470, 40, 450, 440)
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


def group_scale(app):
    """缩放过的组合：子元素的线宽、字号不随组合缩放，文字在新的框里重新换行（缩小一半、放大、只横向拉宽、
    组合里有转了 90° 的形状）；分散对齐：每两个字之间平均加间距（中英混排、纯字母、带空格）"""
    p = new_pres(app)
    s = blank(p)
    def grp(x0, y0, scale_w, scale_h, rotated=False):
        a = s.Shapes.AddShape(1, x0, y0, 120, 75)
        a.Fill.ForeColor.RGB = RGB(190, 205, 230); a.Line.ForeColor.RGB = RGB(40, 60, 100); a.Line.Weight = 4
        tr = a.TextFrame.TextRange
        tr.Text = "组合里的文字"; tr.Font.Size = 16; tr.Font.Color.RGB = RGB(20, 20, 20)
        tr.Font.Name = "Microsoft YaHei"; tr.Font.NameFarEast = "Microsoft YaHei"
        b = s.Shapes.AddShape(9, x0 + 130, y0, 75, 75)
        b.Fill.ForeColor.RGB = RGB(230, 200, 170); b.Line.ForeColor.RGB = RGB(120, 60, 20); b.Line.Weight = 3
        names = [a.Name, b.Name]
        if rotated:
            c = s.Shapes.AddShape(1, x0 + 40, y0 + 85, 90, 30)
            c.Rotation = 90
            c.Fill.ForeColor.RGB = RGB(200, 230, 200); c.Line.ForeColor.RGB = RGB(30, 90, 30); c.Line.Weight = 2
            names.append(c.Name)
        g = s.Shapes.Range(names).Group()
        g.LockAspectRatio = 0
        g.Width = g.Width * scale_w
        g.Height = g.Height * scale_h
        return g
    grp(20, 20, 1.0, 1.0)
    grp(280, 20, 0.6, 0.6)
    grp(20, 170, 1.8, 1.8)
    grp(500, 170, 1.4, 1.0, rotated=True)
    for i, t in enumerate(["分散对齐abc排版", "abcdefg", "测试 abc 文字", "Hello World"]):
        tb = textbox(s, 520, 20 + 34 * i, 400, 30, t, size=16)
        tb.TextFrame.TextRange.ParagraphFormat.Alignment = 5   # ppAlignDistribute
    return p


def group_flip(app):
    """翻转的组合：翻转下放到子元素（位置镜像），水平翻转时文字不镜像，垂直翻转时文字转 180°；
    组合里有转了角度的形状、组合套组合"""
    p = new_pres(app)
    s = blank(p)
    for k, flip in enumerate((None, "h", "v", "hv")):
        x0, y0 = 20 + 235 * k, 30
        a = s.Shapes.AddShape(1, x0, y0, 120, 70)
        a.Fill.ForeColor.RGB = RGB(190, 205, 230); a.Line.ForeColor.RGB = RGB(40, 60, 100); a.Line.Weight = 2
        tr = a.TextFrame.TextRange
        tr.Text = "左上文字 ABC"; tr.Font.Size = 14; tr.Font.Color.RGB = RGB(20, 20, 20)
        tr.Font.Name = "Microsoft YaHei"; tr.Font.NameFarEast = "Microsoft YaHei"
        a.TextFrame.TextRange.ParagraphFormat.Alignment = 1
        a.TextFrame.VerticalAnchor = 1
        b = s.Shapes.AddShape(7, x0 + 130, y0, 70, 50)
        b.Fill.ForeColor.RGB = RGB(230, 150, 90); b.Line.Visible = False
        c = s.Shapes.AddShape(13, x0 + 130, y0 + 60, 70, 40)     # 右箭头，转 30°
        c.Rotation = 30
        c.Fill.ForeColor.RGB = RGB(120, 180, 120); c.Line.Visible = False
        d = s.Shapes.AddShape(9, x0 + 10, y0 + 80, 40, 40)
        d.Fill.ForeColor.RGB = RGB(200, 120, 160); d.Line.Visible = False
        e = s.Shapes.AddShape(1, x0 + 60, y0 + 90, 50, 25)
        e.Fill.ForeColor.RGB = RGB(150, 150, 220); e.Line.Visible = False
        inner = s.Shapes.Range([d.Name, e.Name]).Group()
        g = s.Shapes.Range([a.Name, b.Name, c.Name, inner.Name]).Group()
        if flip and "h" in flip: g.Flip(0)
        if flip and "v" in flip: g.Flip(1)
    return p


def charts_3d_line(app):
    """透视的三维折线图、三维面积图（PowerPoint 默认不用直角坐标轴）：默认视角；转角 40°、俯角 30°；
    透视 0 和 60；三维面积图、三维堆积面积图；默认示例数据"""
    p = new_pres(app, window=True)
    specs = [(-4101, None), (-4101, (30, 40, 30)), (-4101, (15, 20, 0)), (-4101, (15, 20, 60)), (-4098, None), (78, None)]
    for k, (kind, view) in enumerate(specs):
        if k % 2 == 0:
            s = blank(p)
        ch = s.Shapes.AddChart2(-1, kind, 20 + (k % 2) * 470, 40, 450, 440)
        _close_data(ch)
        if view:
            c = ch.Chart
            c.Elevation, c.Rotation, c.Perspective = view
    return p


def charts_legend_pos(app):
    """图例的位置和间隔：有标题的饼图图例在右、左、上（饼和图例的上沿规则不同），柱形图图例在右；
    长短不一的中文、英文名称的横排图例（项间隔随平均项宽变化）"""
    p = new_pres(app, window=True)
    specs = [(5, 'r', None), (5, 'l', None), (5, 't', None), (51, 'r', None),
             (51, 'b', [['', '甲乙丙丁戊己庚辛', '甲', '甲乙'], ['类别 1', 4.3, 2.4, 2], ['类别 2', 2.5, 4.4, 2], ['类别 3', 3.5, 1.8, 3]]),
             (51, 't', [['', 'Alpha', 'Be', 'Gamma Delta'], ['类别 1', 4.3, 2.4, 2], ['类别 2', 2.5, 4.4, 2], ['类别 3', 3.5, 1.8, 3]])]
    pos = {'r': -4152, 'l': -4131, 't': -4160, 'b': -4107}
    for k, (kind, where, rows) in enumerate(specs):
        if k % 2 == 0:
            s = blank(p)
        ch = s.Shapes.AddChart2(-1, kind, 20 + (k % 2) * 470, 40, 450, 440)
        if rows:
            _chart_values(ch, rows)
        _close_data(ch)
        c = ch.Chart
        c.HasTitle = True
        c.HasLegend = True
        c.Legend.Position = pos[where]
    return p


def charts_crowded_labels(app):
    """分类标签放不下：中文转 −45°（柱形、折线、面积图、16 磅），英文按空格折行，刚好放得下的保持横排"""
    p = new_pres(app, window=True)
    cn = ['第一类别', '第二类别', '第三类别', '第四类别', '第五类别', '第六类别', '第七类别', '第八类别', '第九类别', '第十类别']
    qs = ['2019年第一季度', '2019年第二季度', '2019年第三季度', '2019年第四季度', '2020年第一季度', '2020年第二季度',
          '2020年第三季度', '2020年第四季度', '2021年第一季度', '2021年第二季度', '2021年第三季度', '2021年第四季度']
    en = ['Alpha one', 'Beta two', 'Gamma three', 'Delta four', 'Epsilon five', 'Zeta six']
    def rows(cats, k=1):
        head = [''] + [f'系列 {j + 1}' for j in range(k)]
        return [head] + [[c] + [3 + (i + j) % 3 for j in range(k)] for i, c in enumerate(cats)]
    specs = [(51, rows(cn)), (51, rows(en)), (4, rows(qs)), (51, rows(cn[:8])), (51, rows(cn), 16), (76, rows(cn))]
    for k, spec in enumerate(specs):
        if k % 2 == 0:
            s = blank(p)
        ch = s.Shapes.AddChart2(-1, spec[0], 20 + (k % 2) * 470, 40, 450, 440)
        _chart_values(ch, spec[1])
        _close_data(ch)
        if len(spec) > 2:
            ch.Chart.ChartArea.Format.TextFrame2.TextRange.Font.Size = spec[2]
    return p


def charts_label_skip(app):
    """分类很多时的标签：24 个竖排、40 个竖排隔一个显示、1~40 的数字横排隔一个显示、手动设的标签间隔 3 和刻度线间隔 2"""
    p = new_pres(app, window=True)
    wk = [f'第{i + 1}周' for i in range(40)]
    num = [str(i + 1) for i in range(40)]
    rows = lambda cats: [['', '系列 1']] + [[c, 3 + i % 3] for i, c in enumerate(cats)]
    specs = [(51, rows(wk[:24]), None), (51, rows(wk), None), (4, rows(num), None), (51, rows(wk[:12]), (3, 2))]
    for k, (kind, data, skip) in enumerate(specs):
        if k % 2 == 0:
            s = blank(p)
        ch = s.Shapes.AddChart2(-1, kind, 20 + (k % 2) * 470, 40, 450, 440)
        _chart_values(ch, data)
        _close_data(ch)
        if skip:
            ch.Chart.Axes(1).TickLabelSpacing, ch.Chart.Axes(1).TickMarkSpacing = skip
    return p


def charts_bar_long_names(app):
    """条形图的长分类名：超过（图表宽 − 留白）的一半就折行（中文按字、英文按词），窄图、宽图、英文"""
    p = new_pres(app, window=True)
    cn = ['这是一个比较长的分类名称一', '这是一个比较长的分类名称二', '短名称', '这是一个特别特别长的分类名称四']
    en = ['A fairly long category name', 'Another long category label', 'Short', 'Yet another very long category name here']
    rows = lambda cats: [['', '系列 1']] + [[c, v] for c, v in zip(cats, (3, 4, 5, 2))]
    specs = [(cn, 20, 300), (en, 340, 600), (cn, 20, 920)]
    for k, (cats, x, w) in enumerate(specs):
        if k % 2 == 0:
            s = blank(p)
            x = 20
        ch = s.Shapes.AddChart2(-1, 57, x, 40, w, 440)
        _chart_values(ch, rows(cats))
        _close_data(ch)
    return p


def _chart_sheet(ch, rows, rng):
    """把 rows 原样写进图表数据表（空串留空，可以写多级分类），再按 rng 设数据源"""
    cd = ch.Chart.ChartData
    cd.Activate()
    _hide_excel(cd)
    ws = cd.Workbook.Worksheets(1)
    ws.Range('A1:Z60').ClearContents()
    for r, row in enumerate(rows, start=1):
        for c, v in enumerate(row, start=1):
            if v != '':
                ws.Cells(r, c).Value = v
    try:
        ws.ListObjects(1).Unlist()
    except Exception:
        pass
    ch.Chart.SetSourceData(f"='Sheet1'!{rng}")


def charts_multilevel(app):
    """多级分类：两级的柱形图（中文年份 → 季度）、数字年份 → Q1~Q3 的柱形图、地区 → 城市的折线图、条形图（外层竖排在左）"""
    p = new_pres(app, window=True)
    q = ['一季度', '二季度', '三季度', '四季度']
    a = [['', '', '系列 1']] + [[y if i == 0 else '', q[i], v] for y, vs in (('第一年', (2, 5, 4, 3)), ('第二年', (3, 4, 5, 2))) for i, v in enumerate(vs)]
    b = [['', '', '系列 1']] + [[y if i == 0 else '', f'Q{i + 1}', v] for y, vs in (('2019', (2, 5, 4)), ('2020', (3, 2, 5)), ('2021', (4, 3, 2))) for i, v in enumerate(vs)]
    c = [['', '', '系列 1']] + [[g if i == 0 else '', t, v] for g, vs in (('甲区', (2, 5, 4)), ('乙区', (3, 2, 5))) for i, (t, v) in enumerate(zip(('东城', '西城', '南城'), vs))]
    specs = [(51, a, '$A$1:$C$9'), (51, b, '$A$1:$C$10'), (4, c, '$A$1:$C$7'), (57, c, '$A$1:$C$7')]
    for k, (kind, rows, rng) in enumerate(specs):
        if k % 2 == 0:
            s = blank(p)
        ch = s.Shapes.AddChart2(-1, kind, 20 + (k % 2) * 470, 40, 450, 440)
        _chart_sheet(ch, rows, rng)
        _close_data(ch)
        ch.Chart.HasLegend = False
    return p


def _color_image():
    """中性的彩色测试图：横向色相渐变、纵向从亮到暗，左上角一块灰阶条"""
    from PIL import Image
    import colorsys
    out = (CACHE / "make-case" / "color-grid.png").resolve()
    out.parent.mkdir(parents=True, exist_ok=True)
    w, h = 480, 270
    im = Image.new("RGB", (w, h))
    px = im.load()
    for x in range(w):
        for y in range(h):
            r, g, b = colorsys.hls_to_rgb(x / w, 0.9 - 0.8 * y / h, 0.85)
            px[x, y] = (round(r * 255), round(g * 255), round(b * 255))
    for k in range(8):
        for x in range(10 + k * 20, 30 + k * 20):
            for y in range(10, 40):
                px[x, y] = (k * 36,) * 3
    im.save(out)
    return str(out)


def picture_recolor(app):
    """图片重新着色和亮度对比度：灰度、黑白、冲蚀、亮度 +20%、对比度 −40%、亮度 −20% 对比度 +40%"""
    p = new_pres(app)
    img = _color_image()
    s = blank(p)
    pics = [s.Shapes.AddPicture(img, 0, -1, 20 + (k % 3) * 315, 40 + (k // 3) * 240, 300, 169) for k in range(6)]
    pics[0].PictureFormat.ColorType = 2
    pics[1].PictureFormat.ColorType = 3
    pics[2].PictureFormat.ColorType = 4
    pics[3].PictureFormat.Brightness = 0.7
    pics[4].PictureFormat.Contrast = 0.3
    pics[5].PictureFormat.Brightness = 0.3
    pics[5].PictureFormat.Contrast = 0.7
    return p


def text_symbols(app):
    """符号字体：用"插入符号"插的 Wingdings、Webdings、Symbol 字符（存成 a:sym），字体直接设成 Wingdings 的普通字母，
    以及 Wingdings 项目符号"""
    p = new_pres(app)
    s = blank(p)
    rows = [("Wingdings", [252, 251, 216, 74, 40, 254]), ("Webdings", [97, 52, 89, 105]), ("Symbol", [97, 98, 112, 165, 222])]
    for k, (font, codes) in enumerate(rows):
        t = s.Shapes.AddTextbox(1, 40, 40 + k * 70, 600, 60)
        tr = t.TextFrame.TextRange
        tr.Text = f"{font}："
        tr.Font.Size = 28
        for c in codes:
            tr.InsertAfter(" ").InsertSymbol(font, c, 0)
    t = s.Shapes.AddTextbox(1, 40, 260, 600, 60)
    t.TextFrame.TextRange.Text = "abcdJKL"
    t.TextFrame.TextRange.Font.Name = "Wingdings"
    t.TextFrame.TextRange.Font.Size = 28
    t = s.Shapes.AddTextbox(1, 40, 340, 600, 160)
    t.TextFrame.TextRange.Text = "第一项\r第二项\r第三项"
    t.TextFrame.TextRange.Font.Size = 24
    pf = t.TextFrame.TextRange.ParagraphFormat
    pf.Bullet.Visible = -1
    pf.Bullet.Font.Name = "Wingdings"
    pf.Bullet.Character = 216
    return p


def text_numbering(app):
    """自动编号的各种样式（PowerPoint 的 ppBulletStyle 0~22、26~29、38）：每个文本框 12 段，看到第 12 个编号"""
    p = new_pres(app)
    styles = list(range(0, 23)) + [26, 27, 28, 29, 38]
    for k, st in enumerate(styles):
        if k % 6 == 0:
            s = blank(p)
        t = s.Shapes.AddTextbox(1, 20 + (k % 3) * 310, 20 + (k // 3 % 2) * 255, 300, 250)
        tr = t.TextFrame.TextRange
        tr.Text = "\r".join(f"第{i + 1}项" for i in range(12))
        tr.Font.Size = 12
        pf = tr.ParagraphFormat
        pf.Bullet.Visible = -1
        pf.Bullet.Type = 2
        pf.Bullet.Style = st
    return p


def lines_arrows(app):
    """线条箭头：5 种箭头（三角、开放、燕尾、菱形、圆）× 3 种线宽（1、3、6 磅），两端都有；
    第 2 页三角箭头 3 × 3 种宽度、长度组合（3 磅线），再加斜线、折线连接符"""
    p = new_pres(app)
    s = blank(p)
    for i, style in enumerate((2, 3, 4, 5, 6)):
        for j, w in enumerate((1, 3, 6)):
            ln = s.Shapes.AddLine(40 + j * 300, 50 + i * 95, 280 + j * 300, 50 + i * 95)
            ln.Line.Weight = w
            ln.Line.ForeColor.RGB = RGB(40, 60, 120)
            ln.Line.BeginArrowheadStyle = style
            ln.Line.EndArrowheadStyle = style
    s = blank(p)
    for i, length in enumerate((1, 2, 3)):
        for j, width in enumerate((1, 2, 3)):
            ln = s.Shapes.AddLine(40 + j * 300, 50 + i * 95, 280 + j * 300, 50 + i * 95)
            ln.Line.Weight = 3
            ln.Line.ForeColor.RGB = RGB(40, 60, 120)
            ln.Line.EndArrowheadStyle = 2
            ln.Line.EndArrowheadLength = length
            ln.Line.EndArrowheadWidth = width
            ln.Line.BeginArrowheadStyle = 2
            ln.Line.BeginArrowheadLength = length
            ln.Line.BeginArrowheadWidth = width
    ln = s.Shapes.AddLine(60, 340, 400, 500)
    ln.Line.Weight = 2
    ln.Line.EndArrowheadStyle = 2
    ln.Line.BeginArrowheadStyle = 6
    c = s.Shapes.AddConnector(2, 480, 340, 880, 500)
    c.Line.Weight = 2
    c.Line.EndArrowheadStyle = 4
    return p


def table_styles(app):
    """内置表格样式：浅色、中度、深色、主题样式各几种（GUID 是 Office 内置样式的编号），
    每张表再打开不同的首列、末行、末列、镶边列开关"""
    p = new_pres(app)
    ids = ["{2D5ABB26-0587-4C30-8999-92F81FD0307C}", "{5940675A-B579-460E-94D1-54222C63F5DA}", "{3C2FFA5D-87B4-456A-9821-1D502468CF0F}",
           "{D113A9D2-9D6B-4929-AA2D-F23B5EE8CBE7}", "{9D7B26C5-4107-4FEC-AEDC-1716B250EE53}", "{3B4B98B0-60AC-42C2-AFA5-B58CD77FA1E5}",
           "{69012ECD-51FC-41F1-AA8D-1B2483CD663E}", "{BC89EF96-8CEA-46FF-86C4-4CE0E7609802}", "{B301B821-A1FF-4177-AEE7-76D212191A09}",
           "{073A0DAA-6AF3-43AB-8588-CEC1D06C72B9}", "{F5AB1C69-6EDB-4FF4-983F-18BD219EF322}", "{8EC20E35-A176-4012-BC5E-935CFFF8708E}",
           "{6E25E649-3F16-4E02-A733-19D2CDBF48F0}", "{D7AC3CCA-C797-4891-BE02-D94E43425B78}", "{69CF1AB2-1976-4502-BF36-3FF5EA218861}",
           "{E8034E78-7F5D-4C2E-B375-FC64B27BC917}", "{125E5076-3810-47DD-B79F-674D7AD40C01}", "{93296810-A885-4BE3-A3E7-6D5BEEA58F35}"]
    for k, sid in enumerate(ids):
        if k % 6 == 0:
            s = blank(p)
        sh = s.Shapes.AddTable(4, 4, 20 + (k % 3) * 315, 30 + (k // 3 % 2) * 250, 300, 160)
        tb = sh.Table
        for r in range(1, 5):
            for c in range(1, 5):
                tf = tb.Cell(r, c).Shape.TextFrame
                tf.TextRange.Text = "表头" if r == 1 else f"{r}{c}"
                tf.TextRange.Font.Size = 12
        try:
            tb.ApplyStyle(sid, False)
        except Exception:
            pass
        tb.FirstCol = k % 2 == 1
        tb.LastRow = k % 3 == 1
        tb.LastCol = k % 4 == 2
        tb.VertBanding = k % 5 == 3
        tb.HorizBanding = k % 6 != 4
    return p


def shapes_styles(app):
    """形状样式库（"主题样式"1~42 和"预设"43~77）：圆角矩形套上每一种样式，带文字"""
    p = new_pres(app)
    for k in range(77):
        if k % 42 == 0:
            s = blank(p)
        j = k % 42
        sh = s.Shapes.AddShape(5, 15 + (j % 7) * 135, 15 + (j // 7) * 88, 120, 70)
        try:
            sh.ShapeStyle = k + 1
        except Exception:
            pass
        sh.TextFrame.TextRange.Text = f"样式{k + 1}"
        sh.TextFrame.TextRange.Font.Size = 14
    return p


def charts_styles(app):
    """图表快速样式：簇状柱形图套 ChartStyle 201~212（深色背景、渐变、数据标签、无网格线等），
    每页 4 个 450×250 的图表，默认示例数据"""
    p = new_pres(app, window=True)
    for k, style in enumerate(range(201, 213)):
        if k % 4 == 0:
            s = blank(p)
        ch = s.Shapes.AddChart2(style, 51, 20 + (k % 2) * 470, 15 + (k // 2 % 2) * 265, 450, 250)
        _close_data(ch)
    return p


def placeholders_inherit(app):
    """占位符继承的两种边界：
    第 1 页：没写形状（无 prstGeom / custGeom）、版式里也没有对应占位符的占位符，和没写形状的普通文本框，都带填充和边框（保存后改 XML）；
    第 2 页：只设了填充的标题占位符（形状从版式、母版继承）；
    第 3 页：版式的正文占位符用图片项目符号，幻灯片只写文字（图片在版式的关系表里）"""
    from PIL import Image, ImageDraw
    png = (CACHE / "make-case" / "bullet-square.png").resolve()
    png.parent.mkdir(parents=True, exist_ok=True)
    im = Image.new("RGBA", (64, 64), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    d.rectangle((6, 6, 58, 58), fill=(0, 112, 192, 255))
    d.rectangle((22, 22, 42, 42), fill=(255, 255, 255, 255))
    im.save(png)
    p = new_pres(app)
    blank(p)
    s2 = p.Slides.Add(2, 11)                     # ppLayoutTitleOnly
    t = s2.Shapes.Placeholders(1)
    t.TextFrame.TextRange.Text = "标题占位符只设填充"
    t.Fill.Visible = -1
    t.Fill.Solid()
    t.Fill.ForeColor.RGB = RGB(255, 230, 153)
    s3 = p.Slides.Add(3, LAYOUT_TITLE_CONTENT)
    lay = s3.CustomLayout
    for i in range(1, lay.Shapes.Placeholders.Count + 1):
        ph = lay.Shapes.Placeholders(i)
        if ph.PlaceholderFormat.Type == 7:        # ppPlaceholderObject（正文）
            pf = ph.TextFrame.TextRange.Paragraphs(1).ParagraphFormat
            pf.Bullet.Visible = -1
            pf.Bullet.Picture(str(png))
    s3.Shapes.Placeholders(1).TextFrame.TextRange.Text = "版式里的图片项目符号"
    s3.Shapes.Placeholders(2).TextFrame.TextRange.Text = chr(13).join(["第一条要点", "第二条要点 Second item", "第三条要点"])
    return p


def _patch_no_geometry(path):
    import zipfile
    def sp(i, x, y, nv, text):
        off = f'<a:xfrm><a:off x="{x}" y="{y}"/><a:ext cx="3600000" cy="2400000"/></a:xfrm>'
        fill = '<a:solidFill><a:srgbClr val="D9D9D9"/></a:solidFill><a:ln w="38100"><a:solidFill><a:srgbClr val="C00000"/></a:solidFill></a:ln>'
        return (f'<p:sp><p:nvSpPr><p:cNvPr id="{i}" name="NoGeom {i}"/>{nv}</p:nvSpPr><p:spPr>{off}{fill}</p:spPr>'
                f'<p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="zh-CN" altLang="en-US" sz="2400"/><a:t>{text}</a:t></a:r></a:p></p:txBody></p:sp>')
    extra = (sp(101, 600000, 600000, '<p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph idx="77"/></p:nvPr>', "版式里没有的占位符")
             + sp(102, 4800000, 600000, '<p:cNvSpPr txBox="1"/><p:nvPr/>', "没写形状的文本框")).encode()
    tmp = path.with_suffix(".tmp")
    with zipfile.ZipFile(path) as zin, zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as zout:
        for item in zin.infolist():
            data = zin.read(item.filename)
            if item.filename == "ppt/slides/slide1.xml":
                data = data.replace(b"</p:spTree>", extra + b"</p:spTree>")
            zout.writestr(item, data)
    tmp.replace(path)


placeholders_inherit.patch = _patch_no_geometry


def text_bold_light(app):
    """细体字体标粗体：微软雅黑 Light、等线 Light、Calibri Light、Segoe UI Light / Semilight 的常规和粗体；
    对照：没有粗体字形的黑体、宋体（会不会人工加粗）、有粗体字形的微软雅黑"""
    p = new_pres(app)
    s = blank(p)
    fonts = ["微软雅黑 Light", "等线 Light", "Calibri Light", "Segoe UI Light", "Segoe UI Semilight", "黑体", "宋体", "微软雅黑"]
    for k, font in enumerate(fonts):
        for b in (0, 1):
            tb = s.Shapes.AddTextbox(1, 30 + b * 460, 20 + k * 64, 440, 60)
            tf = tb.TextFrame
            tf.WordWrap = 0
            tr = tf.TextRange
            tr.Text = "细体加粗 Light Bold 123"
            tr.Font.Name = font
            tr.Font.NameFarEast = font
            tr.Font.Size = 24
            tr.Font.Bold = b
    return p


def ole_objects(app):
    """嵌入对象（OLE）：嵌入一个文件显示成图标（PowerPoint 存 Choice 里的 p:embed 和 Fallback 里的预览图），旁边写说明"""
    txt = (CACHE / "make-case" / "ole-note.txt").resolve()
    txt.parent.mkdir(parents=True, exist_ok=True)
    txt.write_text("neutral ole sample", encoding="utf8")
    p = new_pres(app)
    s = blank(p)
    s.Shapes.AddOLEObject(80, 80, -1, -1, "", str(txt), 0, "", 0, "", 0)
    s.Shapes.AddOLEObject(400, 80, -1, -1, "", str(txt), -1, "", 0, "", 0)
    textbox(s, 80, 400, 800, 60, "嵌入对象：左边按内容显示，右边显示成图标")
    return p


def text_hanging_punct(app):
    """标点悬挂：文本框正好放下 10 个汉字，第 11 个字是各种标点；左两列开"允许标点溢出边界"，右列关掉对照"""
    p = new_pres(app)
    s = blank(p)
    puncts = "，。、；：！？）」』”’》】,.;:!?)"
    items = [(c, True) for c in puncts] + [(c, False) for c in "，。）！：、"]
    for k, (c, hang) in enumerate(items):
        col, row = k // 9, k % 9
        tb = s.Shapes.AddTextbox(1, 20 + col * 310, 10 + row * 58, 240.5, 56)
        tf = tb.TextFrame
        tf.MarginLeft = tf.MarginRight = tf.MarginTop = tf.MarginBottom = 0
        tf.WordWrap = -1
        tf.AutoSize = 0
        tr = tf.TextRange
        tr.Text = "一二三四五六七八九十" + c + "后续文字"
        tr.Font.Name = "Microsoft YaHei"
        tr.Font.NameFarEast = "Microsoft YaHei"
        tr.Font.Size = 24
        tr.ParagraphFormat.HangingPunctuation = -1 if hang else 0
        tb.Line.Visible = -1
        tb.Line.ForeColor.RGB = RGB(200, 200, 200)
    return p


def text_ea_line_break(app):
    """按中文习惯控制首尾字符（a:pPr eaLnBrk，COM FarEastLineBreakControl）× 允许标点溢出边界（hangingPunct）：
    正好放下 10 个汉字的框，第 11 个字是行首禁则标点，第 3 列第 10 个字是行尾禁则的左括号"""
    p = new_pres(app)
    s = blank(p)
    texts = ["一二三四五六七八九十，后续", "一二三四五六七八九十。后续", "一二三四五六七八九（十后续"]
    for k, (ea, hang) in enumerate([(-1, 0), (0, 0), (-1, -1), (0, -1)]):
        for j, t in enumerate(texts):
            tb = s.Shapes.AddTextbox(1, 20 + j * 310, 20 + k * 120, 240.5, 100)
            tf = tb.TextFrame
            tf.MarginLeft = tf.MarginRight = tf.MarginTop = tf.MarginBottom = 0
            tf.WordWrap = -1
            tf.AutoSize = 0
            tr = tf.TextRange
            tr.Text = t
            tr.Font.Name = "Microsoft YaHei"
            tr.Font.NameFarEast = "Microsoft YaHei"
            tr.Font.Size = 24
            tr.ParagraphFormat.FarEastLineBreakControl = ea
            tr.ParagraphFormat.HangingPunctuation = hang
            tb.Line.Visible = -1
            tb.Line.ForeColor.RGB = RGB(200, 200, 200)
    return p


def text_ambiguous_punct(app):
    """宽度不定的标点（“”‘’—…·）：文字语言是中文时用中文字体、按全角排，英文时用西文字体；
    西文 Arial、中文宋体好区分。前两个框整段改成 zh-CN / en-US（保存后改 XML），后两个窄框看 —— 和引号处的断行"""
    p = new_pres(app)
    s = blank(p)
    items = [("他说“你好”‘是’——对的…·；AB“x”—y…", 900, "zh-CN"), ("他说“你好”‘是’——对的…·；AB“x”—y…", 900, "en-US"),
             ("就原谅了自己的失败——失败者", 205, "zh-CN"), ("老师就去问总经理：“在学校，他们的成绩都差不多”", 300, "zh-CN")]
    for k, (text, w, lang) in enumerate(items):
        tb = s.Shapes.AddTextbox(1, 30, 30 + k * 110, w, 90)
        tb.Name = f"LANG{k}_{lang}"
        tf = tb.TextFrame
        tf.WordWrap = -1
        tr = tf.TextRange
        tr.Text = text
        tr.Font.Name = "Arial"
        tr.Font.NameFarEast = "SimSun"
        tr.Font.Size = 24
        tb.Line.Visible = -1
        tb.Line.ForeColor.RGB = RGB(200, 200, 200)
    return p


def _patch_lang(path):
    import re
    import zipfile
    tmp = path.with_suffix(".tmp")
    with zipfile.ZipFile(path) as zin, zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as zout:
        for item in zin.infolist():
            data = zin.read(item.filename)
            if item.filename == "ppt/slides/slide1.xml":
                xml = data.decode("utf8")

                def fix(m):
                    lang = re.search(r'name="LANG\d+_([^"]+)"', m.group(0)).group(1)
                    alt = "en-US" if lang != "en-US" else "zh-CN"
                    return re.sub(r'lang="[^"]*" altLang="[^"]*"', f'lang="{lang}" altLang="{alt}"', m.group(0))
                xml = re.sub(r"<p:sp>(?:(?!</p:sp>).)*name=\"LANG.*?</p:sp>", fix, xml, flags=re.S)
                data = xml.encode("utf8")
            zout.writestr(item, data)
    tmp.replace(path)


text_ambiguous_punct.patch = _patch_lang


def table_rowspan_tall(app):
    """跨行合并的单元格文字放不下：多出的高度加到它跨的最后一行。左表合并第 1~2 行（8 行字），
    中表合并第 1~2 行且第 1 行右格 3 行字，右表合并第 2~3 行"""
    p = new_pres(app)
    s = blank(p)
    for k, (span, other) in enumerate([((1, 2), {}), ((1, 2), {1: 3}), ((2, 3), {})]):
        t = s.Shapes.AddTable(4, 2, 30 + k * 310, 40, 290, 120).Table
        for r in range(1, 5):
            t.Rows(r).Height = 30
            for c in (1, 2):
                t.Cell(r, c).Shape.TextFrame.TextRange.Font.Size = 14
        t.Cell(span[0], 1).Merge(t.Cell(span[1], 1))
        t.Cell(span[0], 1).Shape.TextFrame.TextRange.Text = "\r".join(f"第{i + 1}行" for i in range(8))
        for r, n in other.items():
            t.Cell(r, 2).Shape.TextFrame.TextRange.Text = "\r".join(["右格"] * n)
    return p


def shapes_3d_contour(app):
    """三维轮廓（ThreeD.ContourWidth / ContourColor）：没有棱台和边线、更宽的轮廓、有棱台、有边线、椭圆；灰底上白色轮廓"""
    p = new_pres(app)
    s = blank(p)
    s.FollowMasterBackground = 0
    s.Background.Fill.ForeColor.RGB = RGB(128, 128, 128)
    for k, (shp, cw, bevel, line) in enumerate([(1, 3.5, 0, False), (1, 7, 0, False), (1, 3.5, 6, False), (1, 3.5, 0, True), (9, 5, 0, False), (5, 4, 8, False)]):
        r = s.Shapes.AddShape(shp, 60 + (k % 3) * 300, 80 + (k // 3) * 220, 240, 140)
        r.Fill.ForeColor.RGB = RGB(0, 50, 150)
        r.Line.Visible = -1 if line else 0
        if line:
            r.Line.Weight = 4
            r.Line.ForeColor.RGB = RGB(0, 200, 0)
        t = r.ThreeD
        t.ContourWidth = cw
        t.ContourColor.RGB = RGB(255, 255, 255)
        if bevel:
            t.BevelTopType = 2
            t.BevelTopInset = bevel
            t.BevelTopDepth = bevel
    return p


AUTOFIT_CASES = [(28, 92500, 0), (18, 92500, 0), (14, 90000, 0), (20, 77500, 20000)]


def text_autofit_round(app):
    """自动缩小（normAutofit fontScale / lnSpcReduction，保存后改 XML）：缩放后的字号四舍五入到整数磅
    （28×92.5%→26、18×92.5%→17、14×90%→13、20×77.5%→16 且行距减 20%）"""
    p = new_pres(app)
    s = blank(p)
    for k, (size, _fs, _lr) in enumerate(AUTOFIT_CASES):
        tb = s.Shapes.AddTextbox(1, 20 + k * 235, 20, 225, 500)
        tb.Name = f"AUTOFIT{k}"
        tf = tb.TextFrame2
        tf.WordWrap = -1
        tf.AutoSize = 0
        tr = tf.TextRange
        tr.Text = "\r".join(f"第{i + 1}行文字" for i in range(10))
        tr.Font.Size = size
        tr.Font.Name = "Microsoft YaHei"
        tr.Font.NameFarEast = "Microsoft YaHei"
    return p


def _patch_autofit(path):
    import re
    import zipfile
    tmp = path.with_suffix(".tmp")
    with zipfile.ZipFile(path) as zin, zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as zout:
        for item in zin.infolist():
            data = zin.read(item.filename)
            if item.filename == "ppt/slides/slide1.xml":
                xml = data.decode("utf8")

                def fix(m):
                    k = int(re.search(r'name="AUTOFIT(\d+)"', m.group(0)).group(1))
                    _size, fs, lr = AUTOFIT_CASES[k]
                    fit = f'<a:normAutofit fontScale="{fs}"' + (f' lnSpcReduction="{lr}"' if lr else "") + "/>"
                    sp = re.sub(r"<a:bodyPr([^>]*)/>", rf"<a:bodyPr\1>{fit}</a:bodyPr>", m.group(0), count=1)
                    return re.sub(r"<a:bodyPr([^>]*)>(?:<a:spAutoFit/>|<a:noAutofit/>)?</a:bodyPr>", rf"<a:bodyPr\1>{fit}</a:bodyPr>", sp, count=1)
                xml = re.sub(r"<p:sp>(?:(?!</p:sp>).)*name=\"AUTOFIT.*?</p:sp>", fix, xml, flags=re.S)
                data = xml.encode("utf8")
            zout.writestr(item, data)
    tmp.replace(path)


text_autofit_round.patch = _patch_autofit


CHARSET_SLIDES = ['-122', '', '', '-128', '']


def text_charset_slides(app):
    """缺失字体的字符集跨页：同一个字体名第 1 页标中文、第 4 页标日文、其余页不写；PowerPoint 按页加载，
    第 1~3 页用雅黑、第 4~5 页用 Yu Gothic（保存后改 XML）"""
    p = new_pres(app)
    for k in range(len(CHARSET_SLIDES)):
        s = blank(p)
        tb = s.Shapes.AddTextbox(1, 30, 30, 900, 80)
        tr = tb.TextFrame.TextRange
        tr.Text = f"第 {k + 1} 页 客户提供数字化企业大学解决方案的建设和运营服务"
        tr.Font.Size = 28
        tr.Font.Name = f"MarkerFont{k}"
    return p


def _patch_charset_slides(path):
    import re
    import zipfile
    tmp = path.with_suffix(".tmp")
    with zipfile.ZipFile(path) as zin, zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as zout:
        for item in zin.infolist():
            data = zin.read(item.filename)
            m = re.match(r"ppt/slides/slide(\d+)\.xml$", item.filename)
            if m:
                k = int(m.group(1)) - 1
                cs = CHARSET_SLIDES[k]
                a = f' pitchFamily="34" charset="{cs}"' if cs else ""
                xml = data.decode("utf8")
                xml = re.sub(rf'<a:latin typeface="MarkerFont{k}"[^>]*/>', f'<a:latin typeface="Unppt Missing Paged"{a}/><a:ea typeface="Unppt Missing Paged"{a}/>', xml)
                xml = re.sub(rf'<a:(ea|cs) typeface="MarkerFont{k}"[^>]*/>', "", xml)
                data = xml.encode("utf8")
            zout.writestr(item, data)
    tmp.replace(path)


text_charset_slides.patch = _patch_charset_slides


def speaker_notes(app):
    """演讲者备注（prop.json 的 note）：第 1 页两段、第二段里有段内换行和 < & 这类字符；第 2 页没有备注；第 3 页隐藏且有备注"""
    p = new_pres(app)
    notes = ["第一段备注" + chr(13) + "第二段：A < B & C" + chr(11) + "段内换行", "", "隐藏页的备注"]
    for k, n in enumerate(notes):
        s = blank(p)
        textbox(s, 80, 200, 800, 80, f"第 {k + 1} 页", size=40)
        if n:
            s.NotesPage.Shapes.Placeholders(2).TextFrame.TextRange.Text = n
    p.Slides(3).SlideShowTransition.Hidden = -1
    return p


def pictures_tiff(app):
    """TIFF 图片（浏览器不能直接显示，要转成 PNG）：LZW 压缩的彩色、Deflate 压缩带透明、PackBits 灰度、无压缩"""
    from PIL import Image, ImageDraw
    d = (CACHE / "make-case").resolve()
    d.mkdir(parents=True, exist_ok=True)
    specs = [("tiff_lzw", "RGB", "tiff_lzw"), ("tiff_deflate_rgba", "RGBA", "tiff_adobe_deflate"),
             ("tiff_packbits_gray", "L", "packbits"), ("tiff_raw", "RGB", None)]
    paths = []
    for name, mode, comp in specs:
        im = Image.new(mode, (240, 160), 0 if mode != "RGBA" else (0, 0, 0, 0))
        dr = ImageDraw.Draw(im)
        for x in range(240):
            c = int(x * 255 / 239)
            dr.line([(x, 0), (x, 79)], fill=c if mode == "L" else ((c, 80, 255 - c) if mode == "RGB" else (c, 80, 255 - c, 255)))
        dr.rectangle((20, 95, 110, 150), fill=200 if mode == "L" else ((0, 160, 80) if mode == "RGB" else (0, 160, 80, 255)))
        dr.ellipse((130, 90, 220, 155), fill=60 if mode == "L" else ((220, 60, 40) if mode == "RGB" else (220, 60, 40, 160)))
        p = d / f"{name}.tif"
        im.save(p, compression=comp) if comp else im.save(p)
        paths.append(p)
    p = new_pres(app)
    s = blank(p)
    for k, path in enumerate(paths):
        s.Shapes.AddPicture(str(path), 0, -1, 40 + (k % 2) * 460, 30 + (k // 2) * 250, 420, 280)
    return p


def placeholders_picture(app):
    """图片占位符的形状继承（保存后改 XML）：
    第 1 页：版式里的图片占位符没写形状（无 prstGeom），幻灯片上的图片挂在这个占位符上、自己也不写形状和位置；
    第 2 页对照：普通图片、去掉形状的普通图片"""
    from PIL import Image, ImageDraw
    png = (CACHE / "make-case" / "ph-picture.png").resolve()
    png.parent.mkdir(parents=True, exist_ok=True)
    im = Image.new("RGB", (320, 200), (40, 120, 200))
    dr = ImageDraw.Draw(im)
    dr.rectangle((30, 30, 150, 170), fill=(250, 200, 40))
    dr.ellipse((170, 40, 290, 160), fill=(230, 60, 60))
    im.save(png)
    p = new_pres(app)
    lay = None
    for i in range(1, p.SlideMaster.CustomLayouts.Count + 1):
        cl = p.SlideMaster.CustomLayouts(i)
        if any(cl.Shapes(k).Type == 14 and cl.Shapes(k).PlaceholderFormat.Type == 18 for k in range(1, cl.Shapes.Count + 1)):
            lay = cl
            break
    s1 = p.Slides.AddSlide(1, lay)
    s1.Shapes.Placeholders(1).TextFrame.TextRange.Text = "图片占位符"
    a = s1.Shapes.AddPicture(str(png), 0, -1, 100, 100, 320, 200)
    a.Name = "PhPic"
    s2 = blank(p)
    s2.Shapes.AddPicture(str(png), 0, -1, 60, 120, 384, 240)
    b = s2.Shapes.AddPicture(str(png), 0, -1, 500, 120, 384, 240)
    b.Name = "NoGeomPic"
    return p


def _patch_picture_placeholder(path):
    import re
    import zipfile
    with zipfile.ZipFile(path) as z:
        files = {i.filename: z.read(i.filename) for i in z.infolist()}
        infos = z.infolist()
    rels = files["ppt/slides/_rels/slide1.xml.rels"].decode("utf8")
    layout = "ppt/slideLayouts/" + re.search(r"slideLayouts/([^\"]+)", rels).group(1)
    lx = files[layout].decode("utf8")
    sp = next(m.group(0) for m in re.finditer(r"<p:sp>.*?</p:sp>", lx, re.S) if 'type="pic"' in m.group(0))
    idx = re.search(r'type="pic"[^>]*idx="(\d+)"', sp).group(1)
    files[layout] = lx.replace(sp, re.sub(r"<a:prstGeom .*?</a:prstGeom>", "", sp, flags=re.S)).encode("utf8")
    sx = files["ppt/slides/slide1.xml"].decode("utf8")
    sx = re.sub(r'<p:sp>(?:(?!</p:sp>).)*?type="pic".*?</p:sp>', "", sx, flags=re.S)       # 空的图片占位符
    pic = next(m.group(0) for m in re.finditer(r"<p:pic>.*?</p:pic>", sx, re.S) if 'name="PhPic"' in m.group(0))
    ph = f'<p:ph type="pic" idx="{idx}"/>'
    # PowerPoint 往有空图片占位符的页上插图时会自己把图放进占位符；没放进去时补上
    new = pic if "<p:ph " in pic else pic.replace("<p:nvPr/>", f"<p:nvPr>{ph}</p:nvPr>", 1) if "<p:nvPr/>" in pic else pic.replace("<p:nvPr>", f"<p:nvPr>{ph}", 1)
    new = re.sub(r"<p:spPr>.*?</p:spPr>", "<p:spPr/>", new, flags=re.S)
    files["ppt/slides/slide1.xml"] = sx.replace(pic, new).encode("utf8")
    s2 = files["ppt/slides/slide2.xml"].decode("utf8")
    pic2 = next(m.group(0) for m in re.finditer(r"<p:pic>.*?</p:pic>", s2, re.S) if 'name="NoGeomPic"' in m.group(0))
    files["ppt/slides/slide2.xml"] = s2.replace(pic2, re.sub(r"<a:prstGeom .*?</a:prstGeom>", "", pic2, flags=re.S)).encode("utf8")
    tmp = path.with_suffix(".tmp")
    with zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as zout:
        for item in infos:
            zout.writestr(item, files[item.filename])
    tmp.replace(path)


placeholders_picture.patch = _patch_picture_placeholder


def placeholders_picture_geom(app):
    """图片占位符的形状沿继承链找（保存后改 XML）：第 1 页版式占位符是 V 形自定义形状，图片按它裁剪；
    第 2 页挂在版式里另一个编号对不上母版、也没写形状的图片占位符上，母版正文占位符也去掉形状，PowerPoint 不画"""
    png = (CACHE / "make-case" / "ph-picture.png").resolve()
    if not png.exists():
        placeholders_picture(app).Close()
    p = new_pres(app)
    lay = None
    for i in range(1, p.SlideMaster.CustomLayouts.Count + 1):
        cl = p.SlideMaster.CustomLayouts(i)
        if any(cl.Shapes(k).Type == 14 and cl.Shapes(k).PlaceholderFormat.Type == 18 for k in range(1, cl.Shapes.Count + 1)):
            lay = cl
            break
    for k in range(2):
        s = p.Slides.AddSlide(k + 1, lay)
        s.Shapes.Placeholders(1).TextFrame.TextRange.Text = ["V 形图片占位符", "没有形状的图片占位符"][k]
        s.Shapes.AddPicture(str(png), 0, -1, 100, 100, 320, 200).Name = f"PhPic{k}"
    return p


_CHEVRON = ('<a:custGeom><a:avLst/><a:gdLst/><a:ahLst/><a:cxnLst/><a:rect l="0" t="0" r="r" b="b"/><a:pathLst><a:path w="100" h="100">'
            '<a:moveTo><a:pt x="0" y="0"/></a:moveTo><a:lnTo><a:pt x="100" y="0"/></a:lnTo><a:lnTo><a:pt x="100" y="60"/></a:lnTo>'
            '<a:lnTo><a:pt x="50" y="100"/></a:lnTo><a:lnTo><a:pt x="0" y="60"/></a:lnTo><a:close/></a:path></a:pathLst></a:custGeom>')


def _patch_picture_geom(path):
    import re
    import zipfile
    with zipfile.ZipFile(path) as z:
        files = {i.filename: z.read(i.filename) for i in z.infolist()}
        infos = z.infolist()
    rels = files["ppt/slides/_rels/slide1.xml.rels"].decode("utf8")
    layout = "ppt/slideLayouts/" + re.search(r"slideLayouts/([^\"]+)", rels).group(1)
    lx = files[layout].decode("utf8")
    sp = next(m.group(0) for m in re.finditer(r"<p:sp>.*?</p:sp>", lx, re.S) if 'type="pic"' in m.group(0))
    idx = re.search(r'type="pic"[^>]*idx="(\d+)"', sp).group(1)
    sp1 = re.sub(r"<a:prstGeom .*?</a:prstGeom>", "", sp, flags=re.S).replace("</a:xfrm>", "</a:xfrm>" + _CHEVRON, 1)
    sp2 = re.sub(r"<a:prstGeom .*?</a:prstGeom>", "", sp, flags=re.S).replace(f'idx="{idx}"', 'idx="77"', 1)
    sp2 = re.sub(r'<p:cNvPr id="\d+"', '<p:cNvPr id="977"', sp2, count=1)
    files[layout] = lx.replace(sp, sp1 + sp2).encode("utf8")
    # 母版正文占位符也去掉形状：第 2 页的图片在继承链上哪里都没有形状
    mx = files["ppt/slideMasters/slideMaster1.xml"].decode("utf8")
    body = next(m.group(0) for m in re.finditer(r"<p:sp>.*?</p:sp>", mx, re.S) if 'type="body"' in m.group(0))
    files["ppt/slideMasters/slideMaster1.xml"] = mx.replace(body, re.sub(r"<a:prstGeom .*?</a:prstGeom>", "", body, flags=re.S)).encode("utf8")
    for k, ix in enumerate((idx, "77")):
        name = f"ppt/slides/slide{k + 1}.xml"
        sx = files[name].decode("utf8")
        sx = re.sub(r'<p:sp>(?:(?!</p:sp>).)*?type="pic".*?</p:sp>', "", sx, flags=re.S)
        pic = next(m.group(0) for m in re.finditer(r"<p:pic>.*?</p:pic>", sx, re.S) if f'name="PhPic{k}"' in m.group(0))
        new = re.sub(r"<p:ph [^>]*/>", "", pic)
        ph = f'<p:ph type="pic" idx="{ix}"/>'
        new = new.replace("<p:nvPr/>", f"<p:nvPr>{ph}</p:nvPr>", 1) if "<p:nvPr/>" in new else new.replace("<p:nvPr>", f"<p:nvPr>{ph}", 1)
        new = re.sub(r"<p:spPr>.*?</p:spPr>", "<p:spPr/>", new, flags=re.S)
        files[name] = sx.replace(pic, new).encode("utf8")
    tmp = path.with_suffix(".tmp")
    with zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as zout:
        for item in infos:
            zout.writestr(item, files[item.filename])
    tmp.replace(path)


placeholders_picture_geom.patch = _patch_picture_geom


def pictures_exif(app):
    """JPEG 带 EXIF 方向标记（相机竖拍）：PowerPoint 按原始像素画、给形状加旋转，浏览器默认会按标记再转一次。
    方向 6（顺时针 90°）、3（180°）、8（逆时针 90°）和 1（不转）各一张"""
    from PIL import Image, ImageDraw
    d = (CACHE / "make-case").resolve()
    d.mkdir(parents=True, exist_ok=True)
    paths = []
    for o in (1, 6, 3, 8):
        im = Image.new("RGB", (300, 200), (230, 230, 230))
        dr = ImageDraw.Draw(im)
        dr.rectangle((0, 0, 299, 40), fill=(200, 40, 40))       # 上边一条红
        dr.rectangle((0, 0, 40, 199), fill=(40, 90, 200))       # 左边一条蓝
        dr.ellipse((200, 120, 280, 190), fill=(40, 160, 70))    # 右下角绿圆
        exif = Image.Exif()
        exif[274] = o
        p = d / f"exif-{o}.jpg"
        im.save(p, quality=92, exif=exif.tobytes())
        paths.append(p)
    p = new_pres(app)
    s = blank(p)
    for k, path in enumerate(paths):
        s.Shapes.AddPicture(str(path), 0, -1, 40 + k * 225, 160, -1, -1)
    return p


def text_picture_fill(app):
    """文字用图片填充（a:rPr 里的 a:blipFill）：四色象限图，看图片怎么铺到文字上——单行大字、两行字、居中的一行、艺术字"纯文本"变形"""
    from PIL import Image, ImageDraw
    png = (CACHE / "make-case" / "quadrants.png").resolve()
    png.parent.mkdir(parents=True, exist_ok=True)
    im = Image.new("RGB", (400, 200))
    dr = ImageDraw.Draw(im)
    dr.rectangle((0, 0, 199, 99), fill=(220, 40, 40)); dr.rectangle((200, 0, 399, 99), fill=(40, 160, 60))
    dr.rectangle((0, 100, 199, 199), fill=(40, 80, 220)); dr.rectangle((200, 100, 399, 199), fill=(240, 200, 30))
    im.save(png)
    p = new_pres(app)
    s = blank(p)
    specs = [(30, 20, 900, 110, "图片填充文字 PICTURE", "l"), (30, 150, 600, 200, "两行文字第一行|第二行 TEXT", "l"), (30, 380, 900, 110, "居中一行", "c")]
    for x, y, w, h, text, al in specs:
        tb = s.Shapes.AddTextbox(1, x, y, w, h)
        tf = tb.TextFrame
        tf.WordWrap = -1
        tf.AutoSize = 0
        tr = tf.TextRange
        tr.Text = text.replace("|", chr(13))
        tr.Font.Name = "Microsoft YaHei"
        tr.Font.NameFarEast = "Microsoft YaHei"
        tr.Font.Size = 66
        tr.Font.Bold = -1
        tr.ParagraphFormat.Alignment = 2 if al == "c" else 1
        tb.TextFrame2.TextRange.Font.Fill.UserPicture(str(png))
        tb.Line.Visible = -1
        tb.Line.ForeColor.RGB = RGB(200, 200, 200)
    s2 = blank(p)
    wa = s2.Shapes.AddTextEffect(0, "艺术字图片填充", "Microsoft YaHei", 80, -1, 0, 60, 120)
    wa.TextFrame2.TextRange.Font.Fill.UserPicture(str(png))
    return p


def pictures_mislabeled(app):
    """图片的扩展名和内容不符（保存后改名）：内容是 TIFF 叫 .png、内容是 PNG 叫 .emf、内容是 JPEG 叫 .png。
    PowerPoint 按内容显示；还有一张扩展名正确的 PNG 对照"""
    from PIL import Image, ImageDraw
    d = (CACHE / "make-case").resolve()
    d.mkdir(parents=True, exist_ok=True)
    paths = []
    for k, (fmt, col) in enumerate([("tif", (200, 60, 60)), ("png", (60, 140, 200)), ("jpg", (60, 170, 90)), ("png", (230, 180, 40))]):
        im = Image.new("RGB", (240, 160), col)
        dr = ImageDraw.Draw(im)
        dr.rectangle((20, 20, 120, 140), fill=(250, 250, 250))
        dr.ellipse((140, 50, 220, 130), fill=(30, 30, 30))
        p = d / f"mislabel-{k}.{fmt}"
        im.save(p, quality=92) if fmt == "jpg" else im.save(p)
        paths.append(p)
    p = new_pres(app)
    s = blank(p)
    for k, path in enumerate(paths):
        sh = s.Shapes.AddPicture(str(path), 0, -1, 40 + (k % 2) * 460, 30 + (k // 2) * 250, 360, 240)
        sh.Name = f"Pic{k}"
    return p


def _patch_mislabeled(path):
    import re
    import zipfile
    with zipfile.ZipFile(path) as z:
        files = {i.filename: z.read(i.filename) for i in z.infolist()}
        infos = z.infolist()
    rels_name = "ppt/slides/_rels/slide1.xml.rels"
    rels = files[rels_name].decode("utf8")
    want = {"tif": "png", "tiff": "png", "png": "emf", "jpeg": "png", "jpg": "png"}
    renames = {}
    slide = files["ppt/slides/slide1.xml"].decode("utf8")
    # 按图片顺序取关系：第 0、1、2 张改名，第 3 张（对照）不动
    for k in range(3):
        pic = next(m.group(0) for m in re.finditer(r"<p:pic>.*?</p:pic>", slide, re.S) if f'name="Pic{k}"' in m.group(0))
        rid = re.search(r'r:embed="([^"]+)"', pic).group(1)
        target = re.search(rf'Id="{rid}"[^>]*Target="([^"]+)"', rels) or re.search(rf'Target="([^"]+)"[^>]*Id="{rid}"', rels)
        old = target.group(1)
        ext = old.rsplit(".", 1)[-1].lower()
        new = old.rsplit(".", 1)[0] + "-x." + want[ext]
        renames["ppt/media/" + old.split("/")[-1]] = "ppt/media/" + new.split("/")[-1]
        rels = rels.replace(f'Target="{old}"', f'Target="{new}"')
    files[rels_name] = rels.encode("utf8")
    ct = files["[Content_Types].xml"].decode("utf8")
    for e, mime in (("png", "image/png"), ("emf", "image/x-emf")):
        if f'Extension="{e}"' not in ct:
            ct = ct.replace("<Default ", f'<Default Extension="{e}" ContentType="{mime}"/><Default ', 1)
    files["[Content_Types].xml"] = ct.encode("utf8")
    tmp = path.with_suffix(".tmp")
    with zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as zout:
        for item in infos:
            data = files[item.filename]
            name = renames.get(item.filename, item.filename)
            zout.writestr(name, data)
    tmp.replace(path)


pictures_mislabeled.patch = _patch_mislabeled


def emf_alphablend(app):
    """EMF 里用 AlphaBlend 贴的位图（114 号记录，截图类 EMF 常见）：逐像素透明的红色圆点（圆内透明度从左到右渐变）、
    整体 50% 透明的绿色方块，底下是浅蓝色矩形"""
    import subprocess
    emf = (CACHE / "make-case" / "alpha-test.emf").resolve()
    emf.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run([sys.executable, str(Path(__file__).with_name("emf_alpha.py")), str(emf)], check=True)
    p = new_pres(app)
    s = blank(p)
    s.Shapes.AddPicture(str(emf), 0, -1, 80, 80, 800, 400)
    return p


def emf_clip_modes(app):
    """EMF 里的裁剪路径按区域模式组合（67 号记录，图标类 EMF 常见）：圆形裁剪再和矩形 求交 / 求并 / 求差，整块填白色"""
    import subprocess
    emf = (CACHE / "make-case" / "clip-test.emf").resolve()
    emf.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run([sys.executable, str(Path(__file__).with_name("emf_clip.py")), str(emf)], check=True)
    p = new_pres(app)
    s = blank(p)
    s.Shapes.AddPicture(str(emf), 0, -1, 60, 120, 840, 280)
    return p


def placeholders_orphan(app):
    """版式里找不到对应项的占位符（保存后改 XML），都带填充、没写形状：
    副标题 + 编号 4294967295（老 .ppt 转换常见）、正文 + 编号 77、不写类型 + 编号 4294967295、副标题 + 编号 88"""
    p = new_pres(app)
    blank(p)
    return p


def _patch_orphan(path):
    import zipfile
    specs = [('type="subTitle" idx="4294967295"', "C00000", 300000, 300000), ('type="body" idx="77"', "00B050", 4800000, 300000),
             ('idx="4294967295"', "0070C0", 300000, 3200000), ('type="subTitle" idx="88"', "FFC000", 4800000, 3200000)]
    sps = []
    for k, (ph, col, x, y) in enumerate(specs):
        sps.append(f'<p:sp><p:nvSpPr><p:cNvPr id="{200 + k}" name="Orphan {k}"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph {ph}/></p:nvPr></p:nvSpPr>'
                   f'<p:spPr><a:xfrm><a:off x="{x}" y="{y}"/><a:ext cx="4000000" cy="2400000"/></a:xfrm><a:solidFill><a:srgbClr val="{col}"/></a:solidFill></p:spPr>'
                   f'<p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="zh-CN" altLang="en-US" sz="2000"/><a:t>孤立占位符 {k + 1}</a:t></a:r></a:p></p:txBody></p:sp>')
    extra = "".join(sps).encode("utf8")
    tmp = path.with_suffix(".tmp")
    with zipfile.ZipFile(path) as zin, zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as zout:
        for item in zin.infolist():
            data = zin.read(item.filename)
            if item.filename == "ppt/slides/slide1.xml":
                data = data.replace(b"</p:spTree>", extra + b"</p:spTree>")
            zout.writestr(item, data)
    tmp.replace(path)


placeholders_orphan.patch = _patch_orphan


def picture_fill_rect(app):
    """图片拉伸时的目标矩形（a:stretch/a:fillRect 的内边距，保存后改 XML）：四色象限图，
    形状图片填充：负内边距（图片伸出形状）、正内边距（图片缩在形状里）、左右不对称；普通图片：负内边距"""
    png = (CACHE / "make-case" / "quadrants.png").resolve()
    if not png.exists():
        from PIL import Image, ImageDraw
        png.parent.mkdir(parents=True, exist_ok=True)
        im = Image.new("RGB", (400, 200))
        dr = ImageDraw.Draw(im)
        dr.rectangle((0, 0, 199, 99), fill=(220, 40, 40)); dr.rectangle((200, 0, 399, 99), fill=(40, 160, 60))
        dr.rectangle((0, 100, 199, 199), fill=(40, 80, 220)); dr.rectangle((200, 100, 399, 199), fill=(240, 200, 30))
        im.save(png)
    p = new_pres(app)
    s = blank(p)
    for k, (x, y, shp) in enumerate([(40, 40, 1), (500, 40, 9), (40, 290, 1)]):
        sh = s.Shapes.AddShape(shp, x, y, 400, 200)
        sh.Fill.UserPicture(str(png))
        sh.Line.Visible = 0
        sh.Name = f"FR{k}"
    pic = s.Shapes.AddPicture(str(png), 0, -1, 500, 290, 400, 200)
    pic.Name = "FR3"
    return p


def _patch_fill_rect(path):
    import re
    import zipfile
    rects = ['l="-20000" t="-20000" r="-20000" b="-20000"', 'l="15000" t="10000" r="15000" b="10000"',
             'l="-5000" t="0" r="-40000" b="0"', 'l="-25000" t="-25000" r="0" b="0"']
    tmp = path.with_suffix(".tmp")
    with zipfile.ZipFile(path) as zin, zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as zout:
        for item in zin.infolist():
            data = zin.read(item.filename)
            if item.filename == "ppt/slides/slide1.xml":
                xml = data.decode("utf8")
                for k, rect in enumerate(rects):
                    m = next(m for m in re.finditer(r"<p:(sp|pic)>.*?</p:\1>", xml, re.S) if f'name="FR{k}"' in m.group(0))
                    el = m.group(0)
                    new = re.sub(r"<a:fillRect\s*/>", f"<a:fillRect {rect}/>", el, count=1)
                    xml = xml.replace(el, new)
                data = xml.encode("utf8")
            zout.writestr(item, data)
    tmp.replace(path)


picture_fill_rect.patch = _patch_fill_rect


def slide_number_fields(app):
    """页码字段：母版上普通文本框里插的页码（每页显示自己的页码）、每页自带的页码占位符；起始页码设成 5，共 3 页"""
    p = new_pres(app)
    p.PageSetup.FirstSlideNumber = 5
    tb = p.SlideMaster.Shapes.AddTextbox(1, 600, 20, 300, 50)
    tr = tb.TextFrame.TextRange
    tr.Text = "第  页"
    tr.Font.Size = 28
    tr.Characters(3, 0).InsertSlideNumber()
    for k in range(3):
        s = blank(p)
        s.HeadersFooters.SlideNumber.Visible = -1
        textbox(s, 80, 220, 600, 80, f"页码字段 {k + 1}", size=36)
    return p


def table_builtin_styles(app):
    """引用内置表格样式、但 tableStyles.xml 里没存定义的表格（保存后删掉定义）：PowerPoint 照样按内置样式显示。
    中度 2-强调 1、浅色 1-强调 2、深色 1、主题 1-强调 5、中度 4-强调 6、浅色 3"""
    p = new_pres(app)
    s = blank(p)
    for k, gid in enumerate(['{5C22544A-7EE6-4342-B048-85BDC9FD1C3A}', '{0E3FDE45-AF77-4B5C-9715-49D594BDF05E}', '{E8034E78-7F5D-4C2E-B375-FC64B27BC917}', '{35758FB7-9AC5-4552-8A53-C91805E547FA}', '{16D9F66E-5EB9-4882-86FB-DCBF35E3C3E4}', '{616DA210-FB5B-4158-B5E0-FEB733F419BA}']):
        t = s.Shapes.AddTable(3, 3, 30 + (k % 3) * 310, 40 + (k // 3) * 250, 290, 150).Table
        t.ApplyStyle(gid, False)
        for r in range(1, 4):
            for c in range(1, 4):
                t.Cell(r, c).Shape.TextFrame.TextRange.Text = f"单元格{r}{c}"
                t.Cell(r, c).Shape.TextFrame.TextRange.Font.Size = 14
    return p


def _patch_drop_table_styles(path):
    import re
    import zipfile
    tmp = path.with_suffix(".tmp")
    with zipfile.ZipFile(path) as zin, zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as zout:
        for item in zin.infolist():
            data = zin.read(item.filename)
            if item.filename == "ppt/tableStyles.xml":
                data = re.sub(rb"<a:tblStyle .*?</a:tblStyle>", b"", data, flags=re.S)
            zout.writestr(item, data)
    tmp.replace(path)


table_builtin_styles.patch = _patch_drop_table_styles


def smartart_matrix(app):
    """SmartArt 矩阵图（matrix1）：四个象限的形状转了 90°/180°/270°，文字框反向转，文字要保持横排"""
    p = new_pres(app, window=True)
    s = blank(p)
    lay = next(app.SmartArtLayouts(i) for i in range(1, app.SmartArtLayouts.Count + 1) if app.SmartArtLayouts(i).Id.endswith("layout/matrix1"))
    sa = s.Shapes.AddSmartArt(lay, 80, 40, 800, 460)
    nodes = sa.SmartArt.AllNodes
    for k in range(1, nodes.Count + 1):
        nodes(k).TextFrame2.TextRange.Text = f"象限 {k}"
    return p


def text_layout_unit(app):
    """排版单位 1/8 磅：第 1 页不换行的长西文行（每个字宽取整后的累积位移在行尾最明显）；
    第 2 页断行边界：文本框（内边距 0）、表格单元格的宽度正好等于或略大于文字宽度"""
    p = new_pres(app)
    s = blank(p)
    lines = [("m" * 60 + "|", "Calibri", 11), ("i" * 60 + "|", "Calibri", 23), ("The quick brown fox jumps over the lazy dog. " * 2 + "|", "Arial", 13),
             ("Sphinx of black quartz, judge my vow; " * 2 + "|", "Calibri", 14), ("Pack my box with five dozen liquor jugs. " * 2 + "|", "Times New Roman", 15)]
    for k, (text, font, size) in enumerate(lines):
        tb = s.Shapes.AddTextbox(1, 20, 20 + k * 90, 900, 40)
        tf = tb.TextFrame
        tf.MarginLeft = tf.MarginRight = 0
        tf.WordWrap = 0
        tr = tf.TextRange
        tr.Text = text
        tr.Font.Name = font
        tr.Font.Size = size
    s = blank(p)
    # (文字, 字体, 字号, 加粗, 字间距, 框宽)：一二 19 磅加粗、字间距 1.3 磅要 40.6 磅，正好等宽时 PowerPoint 换行；10 个 m 原宽 87.87 磅、取整后 87.5 磅
    boxes = [("一二", 19, True, 1.3, 40.6), ("一二", 19, True, 1.3, 40.65), ("一二", 17, False, 1.01, 36.02), ("一二", 17, False, 1.01, 36.13),
             ("一二三", 17, False, 0, 51), ("m" * 10, 11, False, 0, 87.6), ("m" * 10, 11, False, 0, 87.45)]
    for k, (text, size, bold, spc, w) in enumerate(boxes):
        tb = s.Shapes.AddTextbox(1, 30 + (k % 4) * 200, 30 + (k // 4) * 110, w, 60)
        tf = tb.TextFrame2
        tf.MarginLeft = tf.MarginRight = tf.MarginTop = tf.MarginBottom = 0
        tf.WordWrap = -1
        tf.AutoSize = 0
        tb.Width = w
        tr = tf.TextRange
        tr.Text = text
        tr.Font.Name = "Microsoft YaHei" if text[0] != "m" else "Calibri"
        tr.Font.NameFarEast = "Microsoft YaHei"
        tr.Font.Size = size
        tr.Font.Bold = -1 if bold else 0
        tr.Font.Spacing = spc
        tb.Line.Visible = -1
        tb.Line.ForeColor.RGB = RGB(200, 200, 200)
    # 表格：第一列宽 74.6 磅、左右边距各 17 磅，可用 40.6 磅
    t = s.Shapes.AddTable(2, 3, 30, 300, 400, 120).Table
    t.Columns(1).Width = 74.6
    for r in range(1, 3):
        for c in range(1, 4):
            cell = t.Cell(r, c).Shape.TextFrame
            cell.MarginLeft = cell.MarginRight = 17
            tr = cell.TextRange
            tr.Text = "一二" if c == 1 else f"单元格{r}{c}"
            tr.Font.Size = 19
            tr.Font.Bold = -1
            tr.Font.Name = "Microsoft YaHei"
            tr.Font.NameFarEast = "Microsoft YaHei"
            if c == 1:
                cell.Parent.TextFrame2.TextRange.Font.Spacing = 1.3
    return p


GAMMA_COLORS = [
    '<a:srgbClr val="FEEC94"><a:shade val="46275"/></a:srgbClr>',
    '<a:srgbClr val="FEEC94"><a:gamma/><a:shade val="46275"/><a:invGamma/></a:srgbClr>',
    '<a:srgbClr val="FEEC94"><a:tint val="40000"/></a:srgbClr>',
    '<a:srgbClr val="FEEC94"><a:gamma/><a:tint val="40000"/><a:invGamma/></a:srgbClr>',
    '<a:srgbClr val="4472C4"><a:shade val="50000"/></a:srgbClr>',
    '<a:srgbClr val="4472C4"><a:gamma/><a:shade val="50000"/><a:invGamma/></a:srgbClr>',
    '<a:srgbClr val="4472C4"><a:gamma/><a:lumMod val="50000"/><a:invGamma/></a:srgbClr>',
    '<a:srgbClr val="4472C4"><a:gamma/><a:invGamma/></a:srgbClr>',
]


def colors_gamma(app):
    """颜色变换里的 gamma / invGamma（老 .ppt 转换来的文件常见）：同一个颜色的 shade、tint、lumMod 带和不带 gamma 包裹对照
    （保存后改 XML，每个矩形先填一个记号颜色）"""
    p = new_pres(app)
    s = blank(p)
    for k in range(len(GAMMA_COLORS)):
        sh = s.Shapes.AddShape(1, 40 + (k % 4) * 225, 60 + (k // 4) * 240, 200, 200)
        sh.Fill.ForeColor.RGB = RGB(10, 11, k + 1)
        sh.Line.Visible = 0
    return p


def _patch_gamma(path):
    import zipfile
    tmp = path.with_suffix(".tmp")
    with zipfile.ZipFile(path) as zin, zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as zout:
        for item in zin.infolist():
            data = zin.read(item.filename)
            if item.filename == "ppt/slides/slide1.xml":
                xml = data.decode("utf8")
                for k, c in enumerate(GAMMA_COLORS):
                    xml = xml.replace(f'<a:srgbClr val="0A0B{k + 1:02X}"/>', c)
                data = xml.encode("utf8")
            zout.writestr(item, data)
    tmp.replace(path)


colors_gamma.patch = _patch_gamma


LATIN_CJK_FONTS = [
    '<a:latin typeface="楷体" pitchFamily="49" charset="-122"/>',
    '<a:latin typeface="楷体_GB2312" pitchFamily="49" charset="-122"/>',
    '<a:latin typeface="楷体"/>',
    '<a:latin typeface="Arial"/>',
    '<a:latin typeface="黑体" pitchFamily="49" charset="-122"/><a:ea typeface="楷体" pitchFamily="49" charset="-122"/>',
    '<a:latin typeface="楷体_GB2312" pitchFamily="49" charset="-122"/><a:ea typeface="宋体" pitchFamily="2" charset="-122"/>',
]


def text_latin_cjk_font(app):
    """只写了西文字体、没写中文字体的文字（老 .ppt 转换来的文件常见）：西文字体标了中文字符集 / 没标 / 缺失，
    中文字用哪个字体；对照组写了中文字体（保存后改 XML，先用记号字体名）"""
    p = new_pres(app)
    s = blank(p)
    for k in range(len(LATIN_CJK_FONTS)):
        tb = s.Shapes.AddTextbox(1, 40, 20 + k * 85, 880, 70)
        tr = tb.TextFrame.TextRange
        tr.Text = "汉字排版测试 Font ABC 123"
        tr.Font.Size = 32
        tr.Font.Bold = -1 if k == 1 else 0
        tr.Font.Name = f"MarkerFont{k}"
    return p


def _patch_latin_cjk(path):
    import re
    import zipfile
    tmp = path.with_suffix(".tmp")
    with zipfile.ZipFile(path) as zin, zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as zout:
        for item in zin.infolist():
            data = zin.read(item.filename)
            if item.filename == "ppt/slides/slide1.xml":
                xml = data.decode("utf8")
                for k, f in enumerate(LATIN_CJK_FONTS):
                    xml = re.sub(rf'<a:latin typeface="MarkerFont{k}"[^>]*/>', f, xml)
                    xml = re.sub(rf'<a:(ea|cs) typeface="MarkerFont{k}"[^>]*/>', "", xml)
                data = xml.encode("utf8")
            zout.writestr(item, data)
    tmp.replace(path)


text_latin_cjk_font.patch = _patch_latin_cjk


def text_default_style(app):
    """非占位符文字的默认样式：演示文稿默认样式（presentation.xml 的 defaultTextStyle）和母版 otherStyle 写成不同的
    字号、颜色、字体（保存后改 XML），看文本框、形状、表格里没写格式的文字跟哪个"""
    p = new_pres(app)
    s = blank(p)
    tb = s.Shapes.AddTextbox(1, 40, 40, 860, 80)
    tb.TextFrame.TextRange.Text = "文本框 Text Box"
    sh = s.Shapes.AddShape(1, 40, 160, 420, 140)
    sh.TextFrame.TextRange.Text = "形状 Shape"
    t = s.Shapes.AddTable(2, 2, 40, 340, 600, 120).Table
    for r in range(1, 3):
        for c in range(1, 3):
            t.Cell(r, c).Shape.TextFrame.TextRange.Text = f"表格 Cell{r}{c}"
    return p


def _patch_default_style(path):
    import re
    import zipfile
    tmp = path.with_suffix(".tmp")

    def lvl1(xml, block, attrs, body):
        m = re.search(rf"<{block}>.*?</{block}>", xml, re.S)
        part = m.group(0)
        new = re.sub(r"(<a:lvl1pPr[^>]*>.*?)<a:defRPr[^>]*?(/>|>.*?</a:defRPr>)", lambda mm: mm.group(1) + f"<a:defRPr {attrs}>{body}</a:defRPr>", part, count=1, flags=re.S)
        return xml.replace(part, new)
    with zipfile.ZipFile(path) as zin, zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as zout:
        for item in zin.infolist():
            data = zin.read(item.filename)
            if item.filename == "ppt/presentation.xml":
                data = lvl1(data.decode("utf8"), "p:defaultTextStyle", 'sz="2000" kern="1200"',
                            '<a:solidFill><a:srgbClr val="C00000"/></a:solidFill><a:latin typeface="Courier New"/><a:ea typeface="楷体"/><a:cs typeface="+mn-cs"/>').encode("utf8")
            elif item.filename == "ppt/slideMasters/slideMaster1.xml":
                data = lvl1(data.decode("utf8"), "p:otherStyle", 'sz="4000" kern="1200"',
                            '<a:solidFill><a:srgbClr val="0070C0"/></a:solidFill><a:latin typeface="Arial Black"/><a:ea typeface="黑体"/><a:cs typeface="+mn-cs"/>').encode("utf8")
            zout.writestr(item, data)
    tmp.replace(path)


text_default_style.patch = _patch_default_style


MISSING_JP_FONTS = [
    '<a:latin typeface="Unppt Missing JP" panose="020B0500000000000000" pitchFamily="34" charset="-128"/><a:ea typeface="Unppt Missing JP" panose="020B0500000000000000" pitchFamily="34" charset="-128"/>',
    '<a:latin typeface="Unppt Missing JP Light" panose="020B0300000000000000" pitchFamily="34" charset="-128"/><a:ea typeface="Unppt Missing JP Light" panose="020B0300000000000000" pitchFamily="34" charset="-128"/>',
    '<a:latin typeface="Unppt Missing Mixed" pitchFamily="34" charset="-128"/><a:ea typeface="Unppt Missing Mixed" pitchFamily="34" charset="-128"/>',
    '<a:latin typeface="Unppt Missing Mixed" pitchFamily="34" charset="-122"/><a:ea typeface="Unppt Missing Mixed" pitchFamily="34" charset="-122"/>',
    '<a:latin typeface="Yu Gothic"/><a:ea typeface="Yu Gothic"/>',
    '<a:latin typeface="Yu Gothic Light"/><a:ea typeface="Yu Gothic Light"/>',
    '<a:latin typeface="Microsoft YaHei"/><a:ea typeface="Microsoft YaHei"/>',
]


def text_missing_font_jp(app):
    """缺失字体标了日文字符集（charset=-128）：PowerPoint 用 Yu Gothic 替代（和 PANOSE 字重无关），它没有的简体字用雅黑补；
    同一个字体名先标日文、后标中文时整个文档按最后一次（中文，用雅黑）；后 3 行是对照字体（保存后改 XML）"""
    p = new_pres(app)
    s = blank(p)
    for k in range(len(MISSING_JP_FONTS)):
        tb = s.Shapes.AddTextbox(1, 30, 15 + k * 74, 900, 60)
        tr = tb.TextFrame.TextRange
        tr.Text = "客户提供数字化企业大学解决方案的建设和运营服务 SAAS 123 ひらがな"
        tr.Font.Size = 24
        tr.Font.Name = f"MarkerFont{k}"
    return p


def _patch_missing_jp(path):
    import re
    import zipfile
    tmp = path.with_suffix(".tmp")
    with zipfile.ZipFile(path) as zin, zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as zout:
        for item in zin.infolist():
            data = zin.read(item.filename)
            if item.filename == "ppt/slides/slide1.xml":
                xml = data.decode("utf8")
                for k, f in enumerate(MISSING_JP_FONTS):
                    xml = re.sub(rf'<a:latin typeface="MarkerFont{k}"[^>]*/>', f, xml)
                    xml = re.sub(rf'<a:(ea|cs) typeface="MarkerFont{k}"[^>]*/>', "", xml)
                data = xml.encode("utf8")
            zout.writestr(item, data)
    tmp.replace(path)


text_missing_font_jp.patch = _patch_missing_jp


CASES = [shapes_all, text_sizes, text_align, text_spacing, text_bullets, text_missing_font, shapes_basic, fills_lines, table_basic, group_rotate, anim_basic, anim_auto, charts_basic, pictures, smartart, text_effects, text_layout, table_merge, links, emf_images, anim_advanced, charts_labels, freeform_icons, media_audio, anim_trigger, wmf_images, anim_iterate, picture_transparent, charts_more, shape_effects, equations, anim_path, anim_emphasis, transitions, fills_patterns, text_decoration, anim_entrance, svg_images, charts_markers, hidden_slides, media_background, text_glow_reflection, text_tabs, text_picture_bullets, fills_texture, transition_morph, text_embedded_fonts, text_warp, anim_repeat, charts_sizes, slide_timings, lines_compound, table_diagonal, lines_gradient, fills_radial, fills_rect_gradient, shapes_3d, table_vertical, transitions_more, anim_sound, anim_build, anim_after, anim_text_emphasis, charts_bubble, media_video, charts_options, charts_negative, shapes_bevel, charts_legend, shapes_3d_rotation, smartart_3d, charts_ofpie, charts_3d, anim_group_emphasis, activex_controls, charts_extras, charts_axis_titles, charts_fills, charts_outlines, charts_labels_more, group_scale, group_flip, charts_3d_line, charts_legend_pos, charts_crowded_labels, charts_label_skip, charts_bar_long_names, charts_multilevel, picture_recolor, text_symbols, text_numbering, lines_arrows, table_styles, shapes_styles, charts_styles, placeholders_inherit, text_bold_light, ole_objects, text_hanging_punct, speaker_notes, pictures_tiff, placeholders_picture, pictures_exif, text_picture_fill, pictures_mislabeled, emf_alphablend, placeholders_orphan, picture_fill_rect, slide_number_fields, table_builtin_styles, smartart_matrix, text_layout_unit, colors_gamma, text_latin_cjk_font, text_default_style, text_missing_font_jp, text_ea_line_break, text_ambiguous_punct, text_charset_slides, table_rowspan_tall, text_autofit_round, shapes_3d_contour, emf_clip_modes, placeholders_picture_geom]


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
