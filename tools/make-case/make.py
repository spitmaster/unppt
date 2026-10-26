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


def table_latin_rows(app):
    """英文表格的最小行高：14 / 13 / 11 磅 Calibri 英文（lang en-US），行高设成很小让 PowerPoint 按文字撑开；
    左表默认，中表段落写了 lnSpc 100%、段前段后 0，右表文字写了主题字体 +mn-lt / +mn-ea / +mn-cs（主题东亚字体是空的，保存后改 XML）"""
    p = new_pres(app)
    s = blank(p)
    for k in range(3):
        t = s.Shapes.AddTable(6, 2, 20 + k * 310, 30, 290, 100)
        for r in range(1, 7):
            t.Table.Rows(r).Height = 5
            for c in range(1, 3):
                tr = t.Table.Cell(r, c).Shape.TextFrame.TextRange
                tr.Text = ["Low-Med", "QQTHEME Leader" if k == 2 else "Leader"][c - 1]
                tr.Font.Size = [14, 14, 13, 13, 11, 11][r - 1]
                tr.LanguageID = 1033
                if k == 1:
                    tr.ParagraphFormat.SpaceWithin = 1.0
                    tr.ParagraphFormat.SpaceBefore = 0
                    tr.ParagraphFormat.SpaceAfter = 0
    return p


def _patch_table_latin_rows(path):
    import re, zipfile
    tmp = path.with_suffix(".tmp")
    with zipfile.ZipFile(path) as zin, zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as zout:
        for item in zin.infolist():
            data = zin.read(item.filename)
            if item.filename.startswith("ppt/slides/slide"):
                x = data.decode("utf-8")
                fonts = '<a:latin typeface="+mn-lt"/><a:ea typeface="+mn-ea"/><a:cs typeface="+mn-cs"/>'
                def fix(m):
                    tbl = m.group(0)
                    if "QQTHEME" not in tbl:
                        return tbl
                    tbl = tbl.replace("QQTHEME ", "")
                    tbl = re.sub(r"<a:rPr([^>]*?)/>", lambda r: f"<a:rPr{r.group(1)}>{fonts}</a:rPr>", tbl)
                    return re.sub(r"<a:endParaRPr([^>]*?)/>", lambda r: f"<a:endParaRPr{r.group(1)}>{fonts}</a:endParaRPr>", tbl)
                x = re.sub(r"<a:tbl>.*?</a:tbl>", fix, x, flags=re.S)
                data = x.encode("utf-8")
            zout.writestr(item, data)
    tmp.replace(path)


table_latin_rows.patch = _patch_table_latin_rows


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


def smartart_colors(app):
    """SmartArt 的颜色方案（"更改颜色"）：同一个 6 项的基本列表，第 1 页彩色方案三种，第 2 页其它方案三种"""
    p = new_pres(app, window=True)
    layout = app.SmartArtLayouts(1)
    colors = app.SmartArtColors
    cats = [(i, colors(i).Category.lower()) for i in range(1, colors.Count + 1)]
    picks = [i for i, c in cats if c == 'colorful'][:3]
    # 第 2 页：主题色 2、4 的几种（单色的渐变、透明渐变等）
    grads = [i for i, c in cats if c == 'accent2'][2:4] + [i for i, c in cats if c == 'accent4'][2:3]
    for idxs in (picks, grads):
        s = blank(p)
        for k, idx in enumerate(idxs):
            sa = s.Shapes.AddSmartArt(layout, 20 + k * 315, 60, 300, 400)
            nodes = sa.SmartArt.AllNodes
            while nodes.Count < 6:
                nodes.Add()
            for j in range(1, nodes.Count + 1):
                nodes(j).TextFrame2.TextRange.Text = f"项目 {j}"
            sa.SmartArt.Color = colors(idx)
            print("颜色方案", idx, colors(idx).Category, colors(idx).Name)
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


def equations_rot_flip(app):
    """转动、翻转的公式（Office 数学公式 a14:m）：PowerPoint 另存时写的 Fallback 图片是公式在幻灯片上最终的样子
    （已经转好、翻好），铺满形状转动后的外接矩形。
    第 1 页：前两排是只有一个字的公式文本框（¬、斜体 F），第三排是普通文本框（Cambria Math 的 F¬g）；
    每排依次是 不转、转 90°、180°、270°、30°、水平翻转、垂直翻转、水平翻转 + 转 90°、垂直翻转 + 转 90°。
    第 2 页：带填充和 3 磅边框的形状里的公式（椭圆不转、矩形转 30°、矩形垂直翻转），水平 / 垂直翻转的组合里的公式文本框"""
    import re
    import zipfile
    combos = [(0, 0, 0), (90, 0, 0), (180, 0, 0), (270, 0, 0), (30, 0, 0), (0, 1, 0), (0, 0, 1), (90, 1, 0), (90, 0, 1)]
    tmp = (CACHE / "make-case" / "eqrot-src.pptx").resolve()
    tmp.parent.mkdir(parents=True, exist_ok=True)
    p = new_pres(app)

    def turn(sh, rot, fh, fv):
        if fh:
            sh.Flip(0)
        if fv:
            sh.Flip(1)
        sh.Rotation = rot

    def box(s, x, y, text, w=46, h=54):
        tb = s.Shapes.AddTextbox(1, x, y, w, h)
        tf = tb.TextFrame
        tf.WordWrap = 0
        tf.AutoSize = 0
        tf.MarginLeft = tf.MarginRight = tf.MarginTop = tf.MarginBottom = 0
        tf.TextRange.Text = text
        tf.TextRange.Font.Size = 44
        tb.Width, tb.Height = w, h
        return tb

    s = blank(p)
    for r in range(3):
        for k, (rot, fh, fv) in enumerate(combos):
            if r < 2:
                tb = box(s, 40 + k * 100, 40 + r * 140, f"EQ{r}{k}")
            else:
                tb = box(s, 25 + k * 100, 340, "F¬g", 80, 54)
                tb.TextFrame.TextRange.Font.Name = "Cambria Math"
                tb.TextFrame.TextRange.Font.Color.RGB = RGB(30, 60, 160)
            turn(tb, rot, fh, fv)
    s = blank(p)
    for k, (kind, rot, fv) in enumerate([(9, 0, 0), (1, 30, 0), (1, 0, 1)]):
        sh = s.Shapes.AddShape(kind, 60 + k * 300, 60, 180, 120)
        sh.Fill.ForeColor.RGB = RGB(160, 210, 240)
        sh.Line.ForeColor.RGB = RGB(0, 64, 128)
        sh.Line.Weight = 3
        sh.TextFrame.TextRange.Text = f"EQ2{k}"
        sh.TextFrame.TextRange.Font.Size = 44
        turn(sh, rot, 0, fv)
    for k, (fh, fv) in enumerate([(1, 0), (0, 1)]):
        tb = box(s, 120 + k * 400, 330, f"EQ3{k}")
        rc = s.Shapes.AddShape(1, 200 + k * 400, 320, 60, 100)
        rc.Fill.ForeColor.RGB = RGB(120, 160, 120)
        rc.Line.Visible = 0
        g = s.Shapes.Range([tb.Name, rc.Name]).Group()
        turn(g, 0, fh, fv)
    if tmp.exists():
        tmp.unlink()
    p.SaveAs(str(tmp))
    p.Close()
    M = 'xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"'

    def para(t):
        run = (f'<m:r><a:rPr lang="en-US" altLang="zh-CN" sz="4400" b="1" i="1"><a:solidFill><a:srgbClr val="C00000"/></a:solidFill>'
               '<a:latin typeface="Cambria Math" panose="02040503050406030204" pitchFamily="18" charset="0"/>'
               f'<a:ea typeface="Cambria Math" panose="02040503050406030204" pitchFamily="18" charset="0"/></a:rPr><m:t>{t}</m:t></m:r>')
        return (f'<a:p><a14:m xmlns:a14="http://schemas.microsoft.com/office/drawing/2010/main"><m:oMathPara {M}><m:oMathParaPr><m:jc m:val="centerGroup"/></m:oMathParaPr>'
                f'<m:oMath>{run}</m:oMath></m:oMathPara></a14:m><a:endParaRPr lang="en-US" sz="4400"/></a:p>')
    marks = {"ppt/slides/slide1.xml": [(f"EQ{r}{k}", "¬F"[r]) for r in range(2) for k in range(len(combos))],
             "ppt/slides/slide2.xml": [(f"EQ2{k}", "F") for k in range(3)] + [(f"EQ3{k}", "¬") for k in range(2)]}
    src = zipfile.ZipFile(tmp)
    out = tmp.with_name("eqrot-mid.pptx")
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        for item in src.infolist():
            data = src.read(item.filename)
            if item.filename in marks:
                x = data.decode("utf-8")
                for mark, t in marks[item.filename]:
                    x = re.sub(r'<a:p>(?:(?!</a:p>).)*%s(?:(?!</a:p>).)*</a:p>' % mark, lambda _m: para(t), x, count=1)
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


def charts_legend_manual(app):
    """手动摆放的图例（拖动、改大小，存成 c:legend 的 manualLayout）：柱形图图例框放右上角（宽框）、右侧（窄框，一项一行）、
    左下（一行放下），折线图图例框压在绘图区里；绘图区都是自动的"""
    p = new_pres(app, window=True)
    pos = {'r': -4152, 't': -4160, 'b': -4107}
    specs = [(51, 'b', (300, 50, 140, 50)), (51, 'r', (360, 120, 80, 120)), (51, 't', (20, 390, 300, 30)), (4, 'b', (120, 150, 150, 60))]
    for k, (kind, where, box) in enumerate(specs):
        if k % 2 == 0:
            s = blank(p)
        ch = s.Shapes.AddChart2(-1, kind, 20 + (k % 2) * 470, 40, 450, 440)
        _close_data(ch)
        c = ch.Chart
        c.HasTitle = False
        c.HasLegend = True
        c.Legend.Position = pos[where]
        lg = c.Legend
        lg.Left, lg.Top, lg.Width, lg.Height = box
    return p


def charts_long_cats(app):
    """很多分类、名称很长（竖排标签放不下时 PowerPoint 截断加省略号）：30 个分类 × 名称 4 / 10 / 20 个汉字，
    图表高 440 磅；第 4 个是 20 个汉字、图表高 250 磅"""
    p = new_pres(app, window=True)
    stem = '甲乙丙丁戊己庚辛壬癸子丑寅卯辰巳午未申酉'
    for k, (n, h) in enumerate([(4, 440), (10, 440), (20, 440), (20, 250)]):
        if k % 2 == 0:
            s = blank(p)
        ch = s.Shapes.AddChart2(-1, 51, 20 + (k % 2) * 470, 40, 450, h)
        rows = [['', '系列 1']] + [[f'{i + 1:02d}' + stem[:n - 2], (i * 7) % 10 + 2] for i in range(30)]
        _chart_values(ch, rows)
        _close_data(ch)
        c = ch.Chart
        c.HasTitle = False
        c.HasLegend = False
    return p


def charts_cat_vertical(app):
    """分类标签什么时候竖排、竖排放不下时截断：第 1、2 页 300×250 磅的柱形图分别 20/24/28、30/33/36 个"第 N 周"；
    第 3、4 页 20 个 20 字长名称，图表高 160/220/300、380/460 磅（宽 300 磅）"""
    p = new_pres(app, window=True)
    stem = '甲乙丙丁戊己庚辛壬癸子丑寅卯辰巳午未'
    specs = [(n, 250, False) for n in (20, 24, 28, 30, 33, 36)] + [(20, h, True) for h in (160, 220, 300, 380, 460)]
    per = [3, 3, 3, 2]
    k = 0
    for page, cnt in enumerate(per):
        s = blank(p)
        for j in range(cnt):
            if k >= len(specs):
                break
            n, h, long_ = specs[k]
            ch = s.Shapes.AddChart2(-1, 51, 10 + j * 315, 10, 300, h)
            cats = [f'{i + 1:02d}' + stem for i in range(n)] if long_ else [f'第{i + 1}周' for i in range(n)]
            _chart_values(ch, [['', '系列 1']] + [[c, (i * 7) % 10 + 2] for i, c in enumerate(cats)])
            _close_data(ch)
            c = ch.Chart
            c.HasTitle = False
            c.HasLegend = False
            k += 1
    return p


def charts_cat_rot_len(app):
    """分类标签斜排还是竖排（和名称长度有关）：300×250 磅的柱形图、8 个分类，名称 3/5/7/9/12/16 个汉字"""
    p = new_pres(app, window=True)
    stem = '甲乙丙丁戊己庚辛壬癸子丑寅卯辰巳'
    for k, n in enumerate([3, 5, 7, 9, 12, 16]):
        if k % 3 == 0:
            s = blank(p)
        ch = s.Shapes.AddChart2(-1, 51, 10 + (k % 3) * 315, 10, 300, 250)
        cats = [stem[i] + stem[:n - 1] for i in range(8)]
        _chart_values(ch, [['', '系列 1']] + [[c, (i * 7) % 10 + 2] for i, c in enumerate(cats)])
        _close_data(ch)
        c = ch.Chart
        c.HasTitle = False
        c.HasLegend = False
    return p


def charts_cat_rot_short(app):
    """矮图表里斜排的分类标签（335×206 磅的簇状柱形图，6 个分类、名称 3~6 个汉字，标签 11 磅）：
    有标题和上方图例、两个系列带数值标签 / 没有标题图例 / 9 个分类 / 绘图区内框手动摆放；看标签带有多高、会不会截断"""
    p = new_pres(app, window=True)
    s = blank(p)
    names6 = ["甲乙丙丁戊己", "庚辛壬癸子丑", "寅卯辰", "巳午未申酉", "戌亥甲乙丙", "丁戊己庚辛"]
    names9 = names6 + ["壬癸子丑寅", "卯辰巳", "午未申酉戌亥"]
    specs = [(names6, True), (names6, False), (names9, True), (names6, True)]
    for k, (names, deco) in enumerate(specs):
        ch = s.Shapes.AddChart2(-1, 51, 10 + (k % 2) * 470, 10 + (k // 2) * 260, 335, 206)
        _chart_values(ch, [["", "系列 1", "系列 2"]] + [[c, (i * 37) % 100 + 5, (i * 23) % 90 + 3] for i, c in enumerate(names)])
        _close_data(ch)
        c = ch.Chart
        c.HasTitle = deco
        c.HasLegend = deco
        if deco:
            c.ChartTitle.Text = "图表标题"
            c.Legend.Position = -4160         # xlLegendPositionTop
            for i in (1, 2):
                c.SeriesCollection(i).HasDataLabels = True
        c.Axes(1).TickLabels.Font.Size = 11
        if k == 3:
            # 绘图区内框手动摆放（写成 layoutTarget="inner"）：比自动的高，下面留给斜标签的地方不够
            c.PlotArea.InsideLeft, c.PlotArea.InsideTop, c.PlotArea.InsideWidth, c.PlotArea.InsideHeight = 36, 60, 288, 100
    return p


def charts_inner_titles(app):
    """绘图区内框手动摆放（layoutTarget="inner"）时坐标轴标题的位置：柱形图两根轴都有标题，内框偏右 / 偏左 / 数值标签 18 磅；
    条形图（分类轴标题在左）"""
    p = new_pres(app, window=True)
    s = blank(p)
    specs = [(51, (90, 30, 300, 150), 0), (51, (50, 20, 340, 180), 0), (51, (110, 30, 280, 160), 18), (57, (110, 25, 280, 160), 0)]
    for k, (kind, box, big) in enumerate(specs):
        ch = s.Shapes.AddChart2(-1, kind, 10 + (k % 2) * 470, 10 + (k // 2) * 260, 440, 250)
        _chart_values(ch, [["", "系列 1"]] + [[c, (i * 37) % 100 + 5] for i, c in enumerate(["甲乙", "丙丁", "戊己", "庚辛"])])
        _close_data(ch)
        c = ch.Chart
        c.HasTitle = False
        c.HasLegend = False
        for ax in (1, 2):
            c.Axes(ax).HasTitle = True
            c.Axes(ax).AxisTitle.Text = "坐标轴标题"
        if big:
            c.Axes(2).TickLabels.Font.Size = big
        pa = c.PlotArea
        # 先缩小再挪位置，避免中间状态超出图表报错
        pa.InsideWidth, pa.InsideHeight = 150, 80
        pa.InsideLeft, pa.InsideTop = box[0], box[1]
        pa.InsideWidth, pa.InsideHeight = box[2], box[3]
    return p


def charts_line_dash(app):
    """折线图、散点图的系列线是虚线（圆点、方点、短划、划点、长划）：线和图例里的线都按虚线画；线宽 2.25 / 4 磅"""
    p = new_pres(app, window=True)
    s = blank(p)
    styles = [11, 10, 4, 5, 7]   # msoLineSysDot、msoLineSysDash、msoLineDash、msoLineDashDot、msoLineLongDash
    for k, kind in enumerate([4, 74]):    # xlLine、xlXYScatterLinesNoMarkers
        ch = s.Shapes.AddChart2(-1, kind, 10 + k * 470, 40, 450, 300)
        _chart_values(ch, [["", "系列 1", "系列 2", "系列 3", "系列 4", "系列 5"]] + [[i + 1] + [(i * (7 + j * 3)) % 20 + j * 12 for j in range(5)] for i in range(6)])
        _close_data(ch)
        c = ch.Chart
        c.HasTitle = False
        c.HasLegend = True
        c.Legend.Position = -4152           # xlLegendPositionRight
        for i, st in enumerate(styles):
            ln = c.SeriesCollection(i + 1).Format.Line
            ln.DashStyle = st
            ln.Weight = 4 if i % 2 else 2.25
    return p


# 图表标题 / 坐标轴标题的 rich 文字段落（保存后替换）：标记 -> <a:p>
CHART_RICH_TITLES = {
    "CTMARK1": '<a:p><a:pPr><a:defRPr sz="1400" b="0"/></a:pPr><a:r><a:rPr lang="zh-CN" altLang="en-US" sz="1200" b="1"/><a:t>run 写粗体 12 磅</a:t></a:r></a:p>',
    "CTMARK2": '<a:p><a:pPr><a:defRPr sz="1320" b="1"><a:solidFill><a:srgbClr val="C00000"/></a:solidFill></a:defRPr></a:pPr><a:r><a:rPr lang="zh-CN" altLang="en-US"/><a:t>段落写 13.2 磅粗体红色</a:t></a:r></a:p>',
    "CTMARK3": '<a:p><a:pPr><a:defRPr sz="1000" b="0"/></a:pPr><a:r><a:rPr lang="zh-CN" altLang="en-US" sz="1400" b="1"><a:solidFill><a:srgbClr val="0070C0"/></a:solidFill></a:rPr><a:t>轴标题</a:t></a:r></a:p>',
    "CTMARK4": '<a:p><a:pPr><a:defRPr sz="1400" b="0"/></a:pPr><a:r><a:rPr lang="zh-CN" altLang="en-US" sz="2000" b="0"><a:latin typeface="KaiTi"/><a:ea typeface="KaiTi"/></a:rPr><a:t>楷体 20 磅标题</a:t></a:r></a:p>',
    "CTMARK5": '<a:p><a:pPr><a:defRPr/></a:pPr><a:r><a:rPr lang="zh-CN" altLang="en-US"/><a:t>什么都没写</a:t></a:r></a:p>',
    "CTMARK6": '<a:p><a:pPr><a:defRPr/></a:pPr><a:r><a:rPr lang="zh-CN" altLang="en-US"/><a:t>图表文字 8 磅绿色</a:t></a:r></a:p>',
}
# CTMARK6 所在图表的图表级文字属性（c:chartSpace/c:txPr）
CHART_RICH_SPACE = '<c:txPr><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="800"><a:solidFill><a:srgbClr val="00B050"/></a:solidFill></a:defRPr></a:pPr><a:endParaRPr lang="zh-CN"/></a:p></c:txPr>'


def charts_rich_title(app):
    """图表标题、坐标轴标题写成 rich 文字时的字号、粗细、颜色、字体：run 的 rPr 盖过段落 defRPr，标题自己的 txPr 不用；
    rich 里什么都没写时 18 磅粗体黑色、图表文字 8 磅绿色时 9.6 磅粗体绿色（保存后改 XML）"""
    p = new_pres(app, window=True)
    s = blank(p)
    for k in range(6):
        ch = s.Shapes.AddChart2(-1, 51, 10 + (k % 3) * 315, 10 + (k // 3) * 265, 300, 250)
        _chart_values(ch, [["", "系列 1"]] + [[c, (i * 37) % 100 + 5] for i, c in enumerate(["甲乙", "丙丁", "戊己", "庚辛"])])
        _close_data(ch)
        c = ch.Chart
        c.HasLegend = False
        c.HasTitle = True
        c.ChartTitle.Text = {1: "CTMARK2", 3: "CTMARK4", 4: "CTMARK5", 5: "CTMARK6"}.get(k, "CTMARK1")
        if k == 2:
            c.Axes(2).HasTitle = True
            c.Axes(2).AxisTitle.Text = "CTMARK3"
    return p


def _patch_rich_title(path):
    import re
    import zipfile
    tmp = path.with_suffix(".tmp")
    with zipfile.ZipFile(path) as zin, zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as zout:
        for item in zin.infolist():
            data = zin.read(item.filename)
            if item.filename.startswith("ppt/charts/chart") and item.filename.endswith(".xml"):
                xml = data.decode("utf8")
                if "CTMARK6" in xml:
                    xml = re.sub(r"<c:txPr>(?:(?!</c:txPr>).)*</c:txPr>(<c:externalData)", lambda m: CHART_RICH_SPACE + m.group(1), xml, count=1, flags=re.S)
                for mark, para in CHART_RICH_TITLES.items():
                    xml = re.sub(rf"<a:p>(?:(?!</a:p>).)*?{mark}(?:(?!</a:p>).)*?</a:p>", lambda m, para=para: para, xml, flags=re.S)
                data = xml.encode("utf8")
            zout.writestr(item, data)
    tmp.replace(path)


charts_rich_title.patch = _patch_rich_title


def charts_date_extra_vals(app):
    """日期轴的折线 / 柱形图，第一个系列的数值缓存比日期多 6 个（保存后改 XML，数值很大）：PowerPoint 只画有日期的点，
    多出来的不画、也不参与坐标轴范围"""
    import datetime
    p = new_pres(app, window=True)
    s = blank(p)
    for k, kind in enumerate([4, 51]):    # xlLine、xlColumnClustered
        ch = s.Shapes.AddChart2(-1, kind, 10 + k * 470, 60, 450, 300)
        base = datetime.date(2020, 1, 1)
        rows = [["", "系列 1", "系列 2"]] + [[(base.replace(month=1 + i % 12, year=2020 + i // 12) - datetime.date(1899, 12, 30)).days, 10 + (i * 7) % 15, 5 + (i * 3) % 9] for i in range(12)]
        _chart_values(ch, rows)
        cd = ch.Chart.ChartData
        ws = cd.Workbook.Worksheets(1)
        ws.Range("A2:A13").NumberFormat = "yyyy/m"
        _close_data(ch)
        c = ch.Chart
        c.HasTitle = False
        c.Axes(1).CategoryType = 3          # xlTimeScale
    return p


def _patch_date_extra_vals(path):
    import re
    import zipfile
    tmp = path.with_suffix(".tmp")
    with zipfile.ZipFile(path) as zin, zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as zout:
        for item in zin.infolist():
            data = zin.read(item.filename)
            if item.filename.startswith("ppt/charts/chart") and item.filename.endswith(".xml"):
                xml = data.decode("utf8")

                def extend(m):
                    cache = m.group(0)
                    n = int(re.search(r'<c:ptCount val="(\d+)"/>', cache).group(1))
                    extra = "".join(f'<c:pt idx="{n + i}"><c:v>{200 + i * 40}</c:v></c:pt>' for i in range(6))
                    cache = cache.replace(f'<c:ptCount val="{n}"/>', f'<c:ptCount val="{n + 6}"/>')
                    return cache.replace("</c:numCache>", extra + "</c:numCache>")
                # 只改第一个系列的数值缓存
                xml = re.sub(r"<c:val><c:numRef>.*?</c:numCache>", extend, xml, count=1, flags=re.S)
                data = xml.encode("utf8")
            zout.writestr(item, data)
    tmp.replace(path)


charts_date_extra_vals.patch = _patch_date_extra_vals


def shape_shadow_nofill_text(app):
    """形状自己的外阴影（形状效果，不是文字效果）× 填充：无填充无线条 / 无填充有线条 / 50% 透明填充 / 95% 透明填充 / 实心填充，
    框里有 28 磅文字：看阴影画在文字上还是形状上"""
    p = new_pres(app)
    s = p.Slides.Add(1, 12)
    specs = [("none", False), ("none", True), (0.5, False), (0.95, False), (0.0, False)]
    for k, (fill, line) in enumerate(specs):
        sh = s.Shapes.AddShape(1, 30 + (k % 3) * 310, 40 + (k // 3) * 240, 280, 180)
        if fill == "none":
            sh.Fill.Visible = 0
        else:
            sh.Fill.Visible = -1
            sh.Fill.ForeColor.RGB = RGB(91, 155, 213)
            sh.Fill.Transparency = fill
        sh.Line.Visible = -1 if line else 0
        if line:
            sh.Line.ForeColor.RGB = RGB(0, 0, 0)
            sh.Line.Weight = 2
        tr = sh.TextFrame.TextRange
        tr.Text = "阴影文字 Shadow"
        tr.Font.Size = 28
        tr.Font.Color.RGB = RGB(192, 0, 0)
        sd = sh.Shadow
        sd.Visible = -1
        sd.Style = 2                       # 外阴影
        sd.OffsetX, sd.OffsetY = 6, 6
        sd.Blur = 4
        sd.ForeColor.RGB = RGB(0, 0, 0)
        sd.Transparency = 0.3
    return p


def charts_legend_overflow(app):
    """手动摆放的图例框放不下所有图例项：5 个系列，框是一行高、能放 3 项宽 / 两行高、能放 2 项宽 / 一行高放得下 5 项 /
    窄高框只放得下 3 行"""
    import time
    p = new_pres(app, window=True)
    s = blank(p)
    boxes = [(60, 205, 230, 22), (60, 195, 160, 40), (20, 205, 400, 22), (340, 40, 90, 60)]
    for k, (l, t, w, h) in enumerate(boxes):
        ch = s.Shapes.AddChart2(-1, 51, 10 + (k % 2) * 470, 10 + (k // 2) * 260, 440, 250)
        _chart_values(ch, [["", "系列甲", "系列乙", "系列丙", "系列丁", "系列戊"]] + [[c] + [(i * 7 + j * 5) % 20 + 3 for j in range(5)] for i, c in enumerate(["甲", "乙", "丙"])])
        _close_data(ch)
        c = ch.Chart
        c.HasTitle = False
        c.HasLegend = True
        time.sleep(1)                        # 刚关掉数据表就改图例偶尔让 PowerPoint 崩溃
        lg = c.Legend
        lg.Left, lg.Top = l, t
        lg.Width, lg.Height = w, h
    # 有时某张图表保存时没写数据缓存：重新打开一次数据表再关掉
    for sh in s.Shapes:
        sh.Chart.ChartData.Activate()
        _hide_excel(sh.Chart.ChartData)
        time.sleep(0.5)
        sh.Chart.ChartData.Workbook.Close()
    return p


def charts_legend_truncate(app):
    """图例项比图表高度放得下的多：饼图 150 磅高、右侧自动图例、9 磅字，6 / 8 / 10 / 14 项；
    第 2 页同样的饼图图例手动摆成占满右边的高框，10 / 15 项"""
    import time
    p = new_pres(app, window=True)
    s = blank(p)
    for k, n in enumerate([6, 8, 10, 14]):
        ch = s.Shapes.AddChart2(-1, 5, 10 + (k % 2) * 470, 10 + (k // 2) * 260, 300, 150)
        _chart_values(ch, [["", "系列 1"]] + [[f"类别{i + 1}", 20 - i] for i in range(n)])
        _close_data(ch)
        c = ch.Chart
        time.sleep(1)
        c.HasTitle = False
        c.HasLegend = True
        c.Legend.Position = -4152
        c.Legend.Format.TextFrame2.TextRange.Font.Size = 9
    s = blank(p)
    for k, n in enumerate([10, 15]):
        ch = s.Shapes.AddChart2(-1, 5, 10 + k * 470, 10, 300, 150)
        _chart_values(ch, [["", "系列 1"]] + [[f"类别{i + 1}", 20 - i] for i in range(n)])
        _close_data(ch)
        c = ch.Chart
        time.sleep(1)
        c.HasTitle = False
        c.HasLegend = True
        c.Legend.Position = -4152
        c.Legend.Format.TextFrame2.TextRange.Font.Size = 9
        time.sleep(0.5)
        lg = c.Legend
        lg.Left, lg.Top, lg.Width, lg.Height = 200, 3, 95, 144
    return p


GROUP_EFFECTS = [
    '<a:effectLst><a:outerShdw blurRad="76200" dist="114300" dir="2700000" algn="tl" rotWithShape="0"><a:prstClr val="black"><a:alpha val="60000"/></a:prstClr></a:outerShdw></a:effectLst>',
    '<a:effectLst><a:glow rad="139700"><a:srgbClr val="FFC000"><a:alpha val="60000"/></a:srgbClr></a:glow></a:effectLst>',
    '<a:effectLst><a:outerShdw blurRad="0" dist="190500" dir="5400000" algn="t" rotWithShape="0"><a:srgbClr val="7030A0"><a:alpha val="50000"/></a:srgbClr></a:outerShdw></a:effectLst>',
]


def group_effects(app):
    """组合自己的效果（写在 grpSpPr 里，保存后改 XML）：重叠的矩形 + 圆的外阴影（子元素之间不互相投影）、两个分开的圆的发光、
    带文字的两个形状的硬阴影"""
    p = new_pres(app)
    s = p.Slides.Add(1, 12)
    for k in range(3):
        x = 40 + k * 310
        a = s.Shapes.AddShape(1, x, 120, 180, 120)
        b = s.Shapes.AddShape(9, x + 100, 180, 140, 140)
        a.Fill.ForeColor.RGB = RGB(91, 155, 213)
        b.Fill.ForeColor.RGB = RGB(237, 125, 49)
        if k == 2:
            a.TextFrame.TextRange.Text = "组合"
            b.TextFrame.TextRange.Text = "阴影"
        if k == 1:
            b.Left = x + 200
        g = s.Shapes.Range([a.Name, b.Name]).Group()
        g.Name = f"GRPFX{k}"
    return p


def _patch_group_effects(path):
    import re
    import zipfile
    tmp = path.with_suffix(".tmp")
    with zipfile.ZipFile(path) as zin, zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as zout:
        for item in zin.infolist():
            data = zin.read(item.filename)
            if item.filename == "ppt/slides/slide1.xml":
                xml = data.decode("utf8")

                def fix(m):
                    k = int(m.group(1))
                    return m.group(0).replace("</p:grpSpPr>", GROUP_EFFECTS[k] + "</p:grpSpPr>", 1)
                xml = re.sub(r'name="GRPFX(\d)"(?:(?!</p:grpSpPr>).)*</p:grpSpPr>', fix, xml, flags=re.S)
                data = xml.encode("utf8")
            zout.writestr(item, data)
    tmp.replace(path)


group_effects.patch = _patch_group_effects


def charts_point_labels(app):
    """单个数据点的数据标签（c:dLbl）：柱形图里拖开一个、改成自定义文字一个（含值字段）、删掉一个、单独放到内侧底部一个；
    饼图拖开一块的标签；折线图只给一个点加标签（系列本身没有标签）"""
    import time
    p = new_pres(app, window=True)
    s = blank(p)
    for k, kind in enumerate([51, 5, 4]):        # 簇状柱形、饼图、折线
        ch = s.Shapes.AddChart2(-1, kind, 10 + k * 315, 60, 300, 280)
        _chart_values(ch, [["", "系列 1"]] + [[c, v] for c, v in zip(["甲乙", "丙丁", "戊己", "庚辛", "壬癸"], [12, 25, 18, 30, 15])])
        _close_data(ch)
        c = ch.Chart
        c.HasTitle = False
        time.sleep(1)
        ser = c.SeriesCollection(1)
        if k < 2:
            ser.HasDataLabels = True
            pt = ser.Points(2).DataLabel
            pt.Left, pt.Top = pt.Left + 25, pt.Top - 20
        if k == 0:
            ser.Points(3).DataLabel.Text = "自定义"
            ser.Points(4).DataLabel.Delete()
            ser.Points(5).DataLabel.Position = 4      # xlLabelPositionInsideBase
        if k == 2:
            ser.Points(3).HasDataLabel = True
    for sh in s.Shapes:
        sh.Chart.ChartData.Activate()
        _hide_excel(sh.Chart.ChartData)
        time.sleep(0.5)
        sh.Chart.ChartData.Workbook.Close()
    return p


def charts_title_moved(app):
    """手动挪过位置的图表标题（存成 manualLayout edge）：挪到左上、图表中间、左边 14 磅；自动位置对照。绘图区不跟着变"""
    import time
    p = new_pres(app, window=True)
    s = blank(p)
    specs = [(10, 5, 0), (200, 130, 0), (30, 100, 14), (None, None, 0)]
    for k, (l, t, sz) in enumerate(specs):
        ch = s.Shapes.AddChart2(-1, 51, 10 + (k % 2) * 470, 10 + (k // 2) * 260, 440, 250)
        _chart_values(ch, [["", "系列 1"]] + [[c, (i * 37) % 100 + 5] for i, c in enumerate(["甲乙", "丙丁", "戊己", "庚辛"])])
        _close_data(ch)
        c = ch.Chart
        c.HasLegend = False
        c.HasTitle = True
        time.sleep(0.5)
        c.ChartTitle.Text = "标题文字测试"
        if sz:
            c.ChartTitle.Format.TextFrame2.TextRange.Font.Size = sz
        if l is not None:
            c.ChartTitle.Left, c.ChartTitle.Top = l, t
    return p


def charts_dtable_fonts(app):
    """数据表的行高随东亚字体变：图表文字设成 微软雅黑 / 等线 / 宋体 / 西文东亚都写 Calibri（东亚按雅黑），10 磅，3 个系列"""
    import time
    p = new_pres(app, window=True)
    s = blank(p)
    for k, font in enumerate(["Microsoft YaHei", "DengXian", "SimSun", "Calibri"]):
        ch = s.Shapes.AddChart2(-1, 51, 10 + (k % 2) * 470, 10 + (k // 2) * 260, 440, 250)
        _close_data(ch)
        c = ch.Chart
        c.HasTitle = False
        c.HasLegend = False
        time.sleep(0.5)
        c.HasDataTable = True
        f = c.ChartArea.Format.TextFrame2.TextRange.Font
        f.Name = font
        f.NameFarEast = font
        f.Size = 10
    return p


def charts_dtable_manual(app):
    """带数据表的柱形图、绘图区手动摆放（内框）：左边自动对照；中间、右边把内框设成图表高的 45% / 60%，
    看 PowerPoint 的绘图区（不含数据表）和数据表放在哪"""
    import time
    p = new_pres(app, window=True)
    s = blank(p)
    for k, hf in enumerate([None, 0.45, 0.6]):
        ch = s.Shapes.AddChart2(-1, 51, 10 + k * 315, 60, 300, 280)
        _close_data(ch)
        c = ch.Chart
        c.HasTitle = False
        c.HasLegend = False
        time.sleep(0.5)
        c.HasDataTable = True
        if hf:
            time.sleep(0.5)
            pa = c.PlotArea
            pa.InsideLeft = 300 * 0.2
            pa.InsideTop = 280 * 0.08
            pa.InsideWidth = 300 * 0.75
            pa.InsideHeight = 280 * hf
    return p


def charts_pie_manual_labels(app):
    """带数据标签的饼图、绘图区手动摆放：饼铺满手动的框，不给标签缩小（对照：自动绘图区缩小）"""
    import time
    p = new_pres(app, window=True)
    s = blank(p)
    for k in range(2):
        ch = s.Shapes.AddChart2(-1, 5, 10 + k * 470, 40, 440, 400)
        _chart_values(ch, [["", "系列 1"]] + [[c, v] for c, v in zip(["甲乙", "丙丁", "戊己", "庚辛"], [40, 25, 20, 15])])
        _close_data(ch)
        c = ch.Chart
        c.HasTitle = False
        c.HasLegend = False
        time.sleep(0.5)
        c.SeriesCollection(1).HasDataLabels = True
        c.SeriesCollection(1).DataLabels().Position = 2      # xlLabelPositionOutsideEnd
        if k == 0:
            pa = c.PlotArea
            pa.InsideWidth, pa.InsideHeight = 150, 150
            pa.InsideLeft, pa.InsideTop = 100, 80
            pa.InsideWidth, pa.InsideHeight = 240, 240
    return p


def charts_axis_title_moved(app):
    """手动挪过位置的坐标轴标题（manualLayout edge）：竖着的数值轴标题挪到左上、分类轴标题挪到右下；自动位置对照"""
    import time
    p = new_pres(app, window=True)
    s = blank(p)
    for k in range(2):
        ch = s.Shapes.AddChart2(-1, 51, 10 + k * 470, 40, 440, 300)
        _chart_values(ch, [["", "系列 1"]] + [[c, (i * 37) % 100 + 5] for i, c in enumerate(["甲乙", "丙丁", "戊己", "庚辛"])])
        _close_data(ch)
        c = ch.Chart
        c.HasTitle = False
        c.HasLegend = False
        time.sleep(0.5)
        for ax in (1, 2):
            c.Axes(ax).HasTitle = True
            c.Axes(ax).AxisTitle.Text = "坐标轴标题"
        if k == 0:
            c.Axes(2).AxisTitle.Left, c.Axes(2).AxisTitle.Top = 6, 20
            c.Axes(1).AxisTitle.Left, c.Axes(1).AxisTitle.Top = 300, 270
    return p


def charts_pie_bestfit(app):
    """饼图数据标签"最佳位置"：6 块大小递减（40/25/15/10/6/4），标签显示值 9 磅 / 类别名 + 值 9 磅 / 类别名 + 值 12 磅（最小的一块放不下）"""
    import time
    p = new_pres(app, window=True)
    s = blank(p)
    for k, (cat, fsz) in enumerate([(False, 9), (True, 9), (True, 12)]):
        ch = s.Shapes.AddChart2(-1, 5, 10 + k * 315, 60, 300, 300)
        _chart_values(ch, [["", "系列 1"]] + [[f"类别{i + 1}", v] for i, v in enumerate([40, 25, 15, 10, 6, 4])])
        _close_data(ch)
        c = ch.Chart
        time.sleep(1)
        c.HasTitle = False
        c.HasLegend = False
        ser = c.SeriesCollection(1)
        ser.HasDataLabels = True
        dl = ser.DataLabels()
        dl.ShowValue = True
        dl.ShowCategoryName = cat
        dl.Position = 5                     # xlLabelPositionBestFit
        dl.Format.TextFrame2.TextRange.Font.Size = fsz
    return p


def charts_pie_label_pos(app):
    """饼图数据标签位置和饼的大小：数据标签内（inEnd）/ 居中（ctr）/ 最佳位置（bestFit）/ 数据标签外（outEnd），类别名 + 百分比 9 磅；
    第 1 页没有图例，第 2 页图例在下方，第 3 页没有图例、显示引导线（showLeaderLines）"""
    import time
    p = new_pres(app, window=True)
    for legend, leader in ((False, False), (True, False), (False, True)):
        s = blank(p)
        for k, pos in enumerate([3, -4108, 5, 2]):
            ch = s.Shapes.AddChart2(-1, 5, 10 + (k % 2) * 470, 10 + (k // 2) * 265, 300, 255)
            _chart_values(ch, [["", "系列 1"]] + [[f"类别{i + 1}", v] for i, v in enumerate([40, 30, 20, 10])])
            _close_data(ch)
            c = ch.Chart
            time.sleep(1)
            c.HasTitle = False
            c.HasLegend = legend
            if legend:
                c.Legend.Position = -4107
            ser = c.SeriesCollection(1)
            ser.HasDataLabels = True
            dl = ser.DataLabels()
            dl.ShowValue = False
            dl.ShowCategoryName = True
            dl.ShowPercentage = True
            dl.Position = pos
            dl.Format.TextFrame2.TextRange.Font.Size = 9
            if leader:
                ser.HasLeaderLines = True
    return p

def charts_legend_bottom_wrap(app):
    """下方图例一行放不下：饼图 300 × 220 磅，9 磅图例，4 项长名称 / 6 项长短不一 / 9 项短名称 / 3 项正好放下；
    第 2 页同样的数据做成簇状柱形图（每个分类一个系列）"""
    import time
    p = new_pres(app, window=True)
    sets = [["知情同意过程记录不规范", "知情同意书签署保存不合规", "知情同意书填写不完整", "未提供给受试者"],
            ["华东区域", "华南", "西北区域公司", "东北", "华中区域公司本部", "西南"],
            [f"项目{i + 1}" for i in range(9)],
            ["第一类项目", "第二类项目", "第三类项目"]]
    for kind in (5, 51):
        s = blank(p)
        for k, names in enumerate(sets):
            ch = s.Shapes.AddChart2(-1, kind, 10 + (k % 2) * 470, 10 + (k // 2) * 260, 300, 220)
            if kind == 5:
                _chart_values(ch, [["", "系列 1"]] + [[n, 10 + i * 3] for i, n in enumerate(names)])
            else:
                _chart_values(ch, [[""] + names, ["分类"] + [10 + i * 3 for i in range(len(names))]])
            _close_data(ch)
            c = ch.Chart
            time.sleep(1)
            c.HasTitle = False
            c.HasLegend = True
            c.Legend.Position = -4107
            c.Legend.Format.TextFrame2.TextRange.Font.Size = 9
    return p


def charts_dtable_wrap(app):
    """数据表的表头分类名比列宽长：8 个分类、名称 2 / 4 / 7 个汉字（7 个字折成两三行，表头行变高），10 磅"""
    import time
    p = new_pres(app, window=True)
    s = blank(p)
    stem = "甲乙丙丁戊己庚辛壬癸子丑寅卯辰巳"
    for k, n in enumerate([2, 4, 7]):
        ch = s.Shapes.AddChart2(-1, 51, 10 + k * 315, 60, 300, 300)
        _chart_values(ch, [["", "系列 1", "系列 2"]] + [[(stem[i:] + stem)[:n], (i * 7) % 10 + 2, (i * 3) % 8 + 1] for i in range(8)])
        _close_data(ch)
        c = ch.Chart
        time.sleep(1.5)
        c.HasTitle = False
        c.HasLegend = False
        c.HasDataTable = True
        f = c.ChartArea.Format.TextFrame2.TextRange.Font
        f.Size = 10
    return p


def charts_axis_min_offset(app):
    """数值轴固定的最小值不是刻度单位的整数倍：最小 25 最大 40（自动单位 2）、最小 3 最大 18、最小 0.5 单位 1，刻度从最小值起按单位加"""
    import time
    p = new_pres(app, window=True)
    s = blank(p)
    for k, (lo, hi, unit) in enumerate([(25, 40, None), (3, 18, None), (0.5, 6, 1)]):
        ch = s.Shapes.AddChart2(-1, 51, 10 + k * 315, 60, 300, 300)
        _chart_values(ch, [["", "系列 1"]] + [[c, v] for c, v in zip(["甲", "乙", "丙", "丁"], [hi - 2, (lo + hi) / 2, hi - 5, lo + 3])])
        _close_data(ch)
        c = ch.Chart
        time.sleep(1)
        c.HasTitle = False
        c.HasLegend = False
        ax = c.Axes(2)
        ax.MinimumScale, ax.MaximumScale = lo, hi
        if unit:
            ax.MajorUnit = unit
    return p


def charts_na_values(app):
    """数值缓存里有 Excel 错误值 #N/A（保存后改 XML）：柱形图、折线图第一个系列的第 3 个点写成 #N/A"""
    import time
    p = new_pres(app, window=True)
    s = blank(p)
    for k, kind in enumerate([51, 65]):         # 簇状柱形、带标记的折线
        ch = s.Shapes.AddChart2(-1, kind, 10 + k * 470, 60, 450, 300)
        _chart_values(ch, [["", "系列 1", "系列 2"]] + [[c, (i * 7) % 10 + 3, (i * 3) % 8 + 2] for i, c in enumerate(["甲", "乙", "丙", "丁", "戊"])])
        _close_data(ch)
        time.sleep(1)
        ch.Chart.HasTitle = False
    return p


def _patch_na_values(path):
    import re
    import zipfile
    tmp = path.with_suffix(".tmp")
    with zipfile.ZipFile(path) as zin, zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as zout:
        for item in zin.infolist():
            data = zin.read(item.filename)
            if re.match(r"ppt/charts/chart\d+\.xml$", item.filename):
                xml = data.decode("utf8")
                # 第一个系列数值缓存里 idx=2 的点
                xml = re.sub(r'(<c:val><c:numRef>(?:(?!</c:numCache>).)*?<c:pt idx="2"><c:v>)[^<]*(</c:v>)', r"\g<1>#N/A\g<2>", xml, count=1, flags=re.S)
                data = xml.encode("utf8")
            zout.writestr(item, data)
    tmp.replace(path)


charts_na_values.patch = _patch_na_values


def fills_blip_no_mode(app):
    """图片填充既没写 a:stretch 也没写 a:tile（保存后删掉 stretch）：表格 2×2 的单元格、普通矩形；看是拉伸还是按原尺寸平铺、
    表格从哪里开始铺；第 2 页写了 a:tile 居中 50%"""
    from PIL import Image, ImageDraw
    img = TESTCASES / "_tile_src.png"
    im = Image.new("RGB", (64, 64), (240, 200, 120))
    d = ImageDraw.Draw(im)
    d.rectangle([0, 0, 31, 31], fill=(70, 120, 200))
    d.ellipse([36, 36, 60, 60], fill=(200, 60, 60))
    im.save(img, dpi=(96, 96))
    p = new_pres(app)
    s = p.Slides.Add(1, 12)
    t = s.Shapes.AddTable(2, 2, 40, 60, 400, 300).Table
    for r in (1, 2):
        for c in (1, 2):
            t.Cell(r, c).Shape.Fill.UserPicture(str(img.resolve()))
    rc = s.Shapes.AddShape(1, 500, 60, 400, 300)
    rc.Fill.UserPicture(str(img.resolve()))
    # 第 2 页：写了 a:tile（居中、50%），看表格单元格的平铺对齐按单元格还是按整个表格
    s2 = p.Slides.Add(2, 12)
    t2 = s2.Shapes.AddTable(2, 2, 40, 60, 400, 300).Table
    for r in (1, 2):
        for c in (1, 2):
            t2.Cell(r, c).Shape.Fill.UserPicture(str(img.resolve()))
    rc2 = s2.Shapes.AddShape(1, 500, 60, 400, 300)
    rc2.Fill.UserPicture(str(img.resolve()))
    img.unlink()
    return p


def _patch_blip_no_mode(path):
    import re
    import zipfile
    tmp = path.with_suffix(".tmp")
    with zipfile.ZipFile(path) as zin, zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as zout:
        for item in zin.infolist():
            data = zin.read(item.filename)
            if item.filename in ("ppt/slides/slide1.xml", "ppt/slides/slide2.xml"):
                xml = data.decode("utf8")
                tile = '<a:tile tx="0" ty="0" sx="50000" sy="50000" flip="none" algn="ctr"/>' if "slide2" in item.filename else ""
                xml = re.sub(r"<a:stretch>(?:(?!</a:stretch>).)*</a:stretch>|<a:stretch/>", tile, xml, flags=re.S)
                data = xml.encode("utf8")
            zout.writestr(item, data)
    tmp.replace(path)


fills_blip_no_mode.patch = _patch_blip_no_mode


def text_link_kinds(app):
    """文字上的各种超链接动作是不是都画成超链接颜色加下划线：网址、本文档的幻灯片、下一张、文件、结束放映、无动作"""
    p = new_pres(app)
    s = p.Slides.Add(1, 12)
    p.Slides.Add(2, 12)
    kinds = ["url", "slide", "next", "file", "end", "none"]
    for k, kind in enumerate(kinds):
        tb = s.Shapes.AddTextbox(1, 40, 30 + k * 75, 800, 60)
        tr = tb.TextFrame.TextRange
        tr.Text = f"链接文字 Link {k + 1}"
        tr.Font.Size = 24
        act = tr.ActionSettings(1)                 # ppMouseClick
        if kind == "url":
            act.Hyperlink.Address = "https://example.com/"
        elif kind == "slide":
            act.Hyperlink.SubAddress = "257,2,幻灯片 2"
        elif kind == "next":
            act.Action = 1                         # ppActionNextSlide
        elif kind == "file":
            act.Hyperlink.Address = "说明文档.docx"
        elif kind == "end":
            act.Action = 6                         # ppActionEndShow
        else:
            act.Action = 0                         # ppActionNone
    return p


def custgeom_no_wh(app):
    """自定义形状的路径没写 w / h（保存后改 XML：去掉 w / h，坐标换成形状自己的 EMU）：坐标就是形状里的 EMU 位置；
    左边对照（保留 w / h）"""
    p = new_pres(app)
    s = p.Slides.Add(1, 12)
    for k in range(2):
        ff = s.Shapes.BuildFreeform(0, 100 + k * 400, 400)        # msoEditingAuto
        ff.AddNodes(0, 0, 300 + k * 400, 400)                      # msoSegmentLine, msoEditingAuto
        ff.AddNodes(0, 0, 200 + k * 400, 120)
        ff.AddNodes(1, 0, 150 + k * 400, 150)                      # msoSegmentCurve
        ff.AddNodes(0, 0, 100 + k * 400, 400)
        sh = ff.ConvertToShape()
        sh.Fill.ForeColor.RGB = RGB(91, 155, 213)
        sh.Line.Weight = 3
        sh.Name = f"CGWH{k}"
    return p


def _patch_custgeom_no_wh(path):
    import re
    import zipfile
    tmp = path.with_suffix(".tmp")
    with zipfile.ZipFile(path) as zin, zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as zout:
        for item in zin.infolist():
            data = zin.read(item.filename)
            if item.filename == "ppt/slides/slide1.xml":
                xml = data.decode("utf8")

                def fix(m):
                    sp = m.group(0)
                    ext = re.search(r'<a:ext cx="(\d+)" cy="(\d+)"/>', sp)
                    cx, cy = int(ext.group(1)), int(ext.group(2))
                    pm = re.search(r'<a:path w="(\d+)" h="(\d+)"', sp)
                    pw, ph = int(pm.group(1)), int(pm.group(2))
                    sp = re.sub(r'<a:pt x="(-?\d+)" y="(-?\d+)"/>', lambda q: f'<a:pt x="{round(int(q.group(1)) * cx / pw)}" y="{round(int(q.group(2)) * cy / ph)}"/>', sp)
                    return re.sub(r'<a:path w="\d+" h="\d+"', "<a:path", sp)
                xml = re.sub(r'name="CGWH1"(?:(?!</p:sp>).)*</p:sp>', fix, xml, flags=re.S)
                data = xml.encode("utf8")
            zout.writestr(item, data)
    tmp.replace(path)


custgeom_no_wh.patch = _patch_custgeom_no_wh


def text_anchor_ctr(app):
    """文本框"水平居中"（bodyPr anchorCtr="1"）：先按全宽折行，再把整块文字居中——左对齐 / 右对齐 / 段落各自对齐混排 / 两端对齐，
    和不居中对照；20 磅微软雅黑"""
    p = new_pres(app)
    s = p.Slides.Add(1, 12)
    texts = ["第一行文字\n第二行稍微长一点的文字\n短", "左对齐的一段文字放不下一行时会折成两行看看居中的效果"]
    for k in range(6):
        tb = s.Shapes.AddTextbox(1, 20 + (k % 3) * 315, 30 + (k // 3) * 250, 300, 220)
        tf = tb.TextFrame
        tf.WordWrap = -1
        tf.AutoSize = 0
        tb.Line.Visible = -1
        tb.Line.ForeColor.RGB = RGB(200, 200, 200)
        tf.TextRange.Text = texts[1 if k in (2, 5) else 0].replace("\n", chr(13))
        tf.TextRange.Font.Name = "Microsoft YaHei"
        tf.TextRange.Font.NameFarEast = "Microsoft YaHei"
        tf.TextRange.Font.Size = 20
        if k in (1, 4):
            tf.TextRange.ParagraphFormat.Alignment = 3          # 右对齐
        if k == 5:
            tf.TextRange.ParagraphFormat.Alignment = 4          # 两端对齐
        if k >= 3:
            tb.TextFrame2.HorizontalAnchor = 2                  # msoAnchorCenter
    return p


# 线条虚线 × 线端：(prstDash, cap)
DASH_CAPS = [("dot", "flat"), ("dot", "rnd"), ("sysDot", "rnd"), ("sysDash", "rnd"), ("dash", "rnd"), ("dash", "flat"), ("lgDashDot", "rnd"), ("sysDashDot", "sq")]


def lines_dash_caps(app):
    """虚线和线端（保存后改 XML）：dot（1:3）/ sysDot / sysDash / dash / lgDashDot / sysDashDot × 平头 / 圆头 / 方头，6 磅线；
    圆头时 PowerPoint 的短划长度包含圆头"""
    p = new_pres(app)
    s = p.Slides.Add(1, 12)
    for k in range(len(DASH_CAPS)):
        ln = s.Shapes.AddLine(60, 40 + k * 60, 900, 40 + k * 60)
        ln.Line.Weight = 6
        ln.Line.ForeColor.RGB = RGB(46, 117, 182)
        ln.Name = f"DASHCAP{k}"
    return p


def _patch_dash_caps(path):
    import re
    import zipfile
    tmp = path.with_suffix(".tmp")
    with zipfile.ZipFile(path) as zin, zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as zout:
        for item in zin.infolist():
            data = zin.read(item.filename)
            if item.filename == "ppt/slides/slide1.xml":
                xml = data.decode("utf8")

                def fix(m):
                    k = int(m.group(1))
                    dash, cap = DASH_CAPS[k]
                    sp = m.group(0)
                    sp = re.sub(r"<a:ln\b([^>]*?)(/?)>", lambda a: "<a:ln" + re.sub(r'\scap="[^"]*"', "", a.group(1)) + f' cap="{cap}"' + a.group(2) + ">", sp, count=1)
                    sp = re.sub(r"<a:prstDash [^>]*/>", "", sp)
                    return sp.replace("</a:ln>", f'<a:prstDash val="{dash}"/></a:ln>', 1)
                xml = re.sub(r'name="DASHCAP(\d)"(?:(?!</p:cxnSp>).)*</p:cxnSp>', fix, xml, flags=re.S)
                data = xml.encode("utf8")
            zout.writestr(item, data)
    tmp.replace(path)


lines_dash_caps.patch = _patch_dash_caps


def charts_cat_rot_threshold(app):
    """分类标签斜排 / 竖排的分界（600×300 磅柱形图、4 字名称）：14 磅 20 个分类（分类宽约 1.9 倍字号，斜排）、22 个（约 1.82 倍，竖排）；
    9 磅 32 个（约 1.95 倍）、34 个（约 1.83 倍）"""
    p = new_pres(app, window=True)
    stem = '甲乙丙丁戊己庚辛壬癸子丑寅卯辰巳午未申酉戌亥'
    for k, (n, fs) in enumerate([(20, 14), (22, 14), (32, 9), (34, 9)]):
        s = blank(p)
        ch = s.Shapes.AddChart2(-1, 51, 20, 20, 600, 300)
        _chart_values(ch, [['', '系列 1']] + [[(stem[i % len(stem)] + stem * 2)[:4], (i * 7) % 10 + 2] for i in range(n)])
        _close_data(ch)
        c = ch.Chart
        c.HasTitle = False
        c.HasLegend = False
        c.Axes(1).TickLabels.Font.Size = fs
    return p


def charts_pie_label_sep(app):
    """饼图数据标签几项内容之间的分隔（没写 c:separator 时）：类别名 + 值、类别名 + 百分比 × 最佳位置 / 数据标签外 / 居中"""
    p = new_pres(app, window=True)
    specs = [(True, False, 5), (True, False, 2), (True, False, -4108), (False, True, 5), (False, True, 2), (False, True, -4108)]
    for k, (val, pct, pos) in enumerate(specs):
        if k % 3 == 0:
            s = blank(p)
        ch = s.Shapes.AddChart2(-1, 5, 10 + (k % 3) * 315, 40, 300, 300)
        _close_data(ch)
        c = ch.Chart
        c.HasTitle = False
        c.HasLegend = False
        ser = c.SeriesCollection(1)
        ser.HasDataLabels = True
        dl = ser.DataLabels()
        dl.ShowCategoryName = True
        dl.ShowValue = val
        dl.ShowPercentage = pct
        dl.Position = pos
    return p


def text_slash_break(app):
    """斜杠、连字符处能不能断行（文本框宽 130 磅，18 磅雅黑）：短词/长词、很长的网址、中文/英文、连字符、空格 + 斜杠；
    右边一列同样的文字用 Calibri"""
    p = new_pres(app)
    s = blank(p)
    texts = ["short/longerword", "http://example.com/abcdefghijklmnopqrstuvwxyz0123456789",
             "中文内容/English", "abcde-fghijklmnop", "aaa bbbbbb/cccccc"]
    for k, t in enumerate(texts):
        textbox(s, 30, 20 + k * 100, 130, 90, t)
        textbox(s, 330, 20 + k * 100, 130, 90, t, font="Calibri")
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


def text_autonum_symbol_font(app):
    """自动编号的字体：母版正文样式第一级改成 Wingdings 项目符号；正文占位符里三组编号段落：
    只写 buAutoNum（字体从母版继承到 Wingdings）/ 同一个 pPr 里写了 buFont Wingdings / buFont +mj-lt（保存后改 XML）"""
    p = new_pres(app)
    s = p.Slides.Add(1, 2)
    s.Shapes(1).TextFrame.TextRange.Text = "编号字体"
    s.Shapes(2).TextFrame.TextRange.Text = "QQBODY"
    return p


def _patch_autonum_symbol_font(path):
    import re, zipfile
    num = '<a:buAutoNum type="arabicPeriod"/>'
    groups = [("", "继承"), ('<a:buFont typeface="Wingdings" pitchFamily="2" charset="2"/>', "自己写符号字体"), ('<a:buFont typeface="+mj-lt"/>', "标题字体")]
    paras = []
    for k, (font, name) in enumerate(groups):
        for i in range(2):
            start = f' startAt="{k * 2 + 1}"' if i == 0 and k else ""
            paras.append(f'<a:p><a:pPr marL="342900" indent="-342900">{font}{num.replace("/>", start + "/>")}</a:pPr>'
                         f'<a:r><a:rPr lang="zh-CN" altLang="en-US"/><a:t>{name}第{i + 1}段文字</a:t></a:r></a:p>')
    body = '<p:txBody><a:bodyPr/><a:lstStyle/>' + ''.join(paras) + '</p:txBody>'
    tmp = path.with_suffix(".tmp")
    with zipfile.ZipFile(path) as zin, zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as zout:
        for item in zin.infolist():
            data = zin.read(item.filename)
            if item.filename.startswith("ppt/slides/slide"):
                x = data.decode("utf-8")
                x = re.sub(r"<p:txBody>(?:(?!</p:txBody>).)*QQBODY.*?</p:txBody>", lambda m: body, x, flags=re.S)
                data = x.encode("utf-8")
            elif item.filename == "ppt/slideMasters/slideMaster1.xml":
                x = data.decode("utf-8")
                i = x.index("<p:bodyStyle>")
                j = x.index("</a:lvl1pPr>", i)
                seg = re.sub(r"<a:buFont [^>]*/>", '<a:buFont typeface="Wingdings" pitchFamily="2" charset="2"/>', x[i:j])
                seg = re.sub(r"<a:buChar [^>]*/>", '<a:buChar char="&#167;"/>', seg)
                x = x[:i] + seg + x[j:]
                data = x.encode("utf-8")
            zout.writestr(item, data)
    tmp.replace(path)


text_autonum_symbol_font.patch = _patch_autonum_symbol_font


def text_kern_zero(app):
    """字距调整阈值：Calibri 大写（AV、TA、LT、WA 这类有字距对的组合）kern=0 / 1200 / 100，24 磅，看行宽"""
    p = new_pres(app)
    s = blank(p)
    for i, kern in enumerate([0, 12, 1]):
        t = s.Shapes.AddTextbox(1, 30, 30 + i * 150, 900, 140)
        t.TextFrame.WordWrap = -1
        tr = t.TextFrame2.TextRange
        tr.Text = "AVATAR TAVERN WAVY LT VALLEY TOYOTA AWAY YAWN VAT AVE " * 2
        tr.Font.Name = "Calibri"
        tr.Font.Size = 24
        tr.Font.Kerning = kern
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


def text_fontref_ph(app):
    """占位符带形状样式（p:style 的 fontRef：主题次要字体、白字）时，字体、颜色听谁的（保存后改 XML，各级字体不同好区分）：
    主题次要字体 Times New Roman / 东亚字体空着（中文按"汉字"脚本字体），主要字体 Georgia / 宋体；
    母版正文样式 Courier New / 楷体、绿字；母版正文占位符自己的列表样式第 2 级 Comic Sans MS / 仿宋、紫字；
    版式 2 的正文占位符 Arial Black / 黑体、红字。
    第 1 页：版式 2 的正文占位符（fontRef 次要字体）；第 2 页：两栏内容版式（没写字体）的左栏占位符（fontRef 改成主要字体，
    第二段是第 2 级）；
    两页都有一个形状样式相同（fontRef 次要字体）的文本框对照"""
    p = new_pres(app)
    for k, lay in enumerate([2, 4]):          # 母版的第 2 个版式（标题和内容，slideLayout2）、第 4 个（两栏内容）
        sl = p.Slides.AddSlide(k + 1, p.SlideMaster.CustomLayouts(lay))
        sl.Shapes.Placeholders(1).TextFrame.TextRange.Text = "fontRef 和占位符"
        ph = sl.Shapes.Placeholders(2)
        ph.TextFrame.TextRange.Text = "占位符 Style 文字" + chr(13) + "第二段 Second"
        ph.ShapeStyle = 2                   # 线框样式：fontRef idx=minor + dk1
        if lay == 4:
            sl.Shapes.Placeholders(3).Delete()
            ph.TextFrame.TextRange.Paragraphs(2).IndentLevel = 2
        tb = sl.Shapes.AddTextbox(1, 520, 150, 380, 120)
        tb.TextFrame.TextRange.Text = "文本框 Style 文字"
        tb.TextFrame.TextRange.Font.Size = 28
        tb.ShapeStyle = 2
    return p


def _patch_fontref_ph(path):
    import re
    import zipfile
    def fonts(latin, ea, color):
        return f'<a:solidFill><a:srgbClr val="{color}"/></a:solidFill><a:latin typeface="{latin}"/><a:ea typeface="{ea}"/>'
    tmp = path.with_suffix(".tmp")
    with zipfile.ZipFile(path) as zin, zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as zout:
        for item in zin.infolist():
            data = zin.read(item.filename)
            if item.filename == "ppt/theme/theme1.xml":
                x = data.decode("utf8")
                x = re.sub(r'(<a:minorFont><a:latin typeface=")[^"]*(".*?<a:ea typeface=")[^"]*"', r'\1Times New Roman\2"', x, count=1, flags=re.S)
                x = re.sub(r'(<a:majorFont><a:latin typeface=")[^"]*(".*?<a:ea typeface=")[^"]*"', r'\1Georgia\2宋体"', x, count=1, flags=re.S)
                data = x.encode("utf8")
            elif item.filename == "ppt/slideMasters/slideMaster1.xml":
                x = data.decode("utf8")
                # 母版正文样式第 1 级：<a:defRPr ...>颜色、字体</a:defRPr> 的内容换掉
                i = x.index("<p:bodyStyle>")
                e = x.index(">", x.index("<a:defRPr", i)) + 1
                x = x[:e] + fonts("Courier New", "楷体", "00B050") + x[x.index("</a:defRPr>", i):]
                # 母版正文占位符自己的列表样式（第 2 级）
                j = x.index("<a:lstStyle/>", x.index('<p:ph type="body"'))
                x = x[:j] + f'<a:lstStyle><a:lvl2pPr><a:defRPr>{fonts("Comic Sans MS", "仿宋", "7030A0")}</a:defRPr></a:lvl2pPr></a:lstStyle>' + x[j + len("<a:lstStyle/>"):]
                data = x.encode("utf8")
            elif item.filename == "ppt/slides/slide2.xml":
                data = data.replace(b'<a:fontRef idx="minor">', b'<a:fontRef idx="major">', 1)
            elif item.filename == "ppt/slideLayouts/slideLayout2.xml":
                x = data.decode("utf8")
                i = x.index('<p:ph idx="1"')
                j = x.index("<a:lstStyle/>", i)
                x = x[:j] + f'<a:lstStyle><a:lvl1pPr><a:defRPr>{fonts("Arial Black", "黑体", "FF0000")}</a:defRPr></a:lvl1pPr></a:lstStyle>' + x[j + len("<a:lstStyle/>"):]
                data = x.encode("utf8")
            zout.writestr(item, data)
    tmp.replace(path)


text_fontref_ph.patch = _patch_fontref_ph


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


def text_hanging_unset(app):
    """哪里都没写"允许标点溢出边界"（hangingPunct）时：保存后把演示文稿默认样式、母版里的 hangingPunct 删掉（老 .ppt 转来的课件常见）；
    正好放下 10 个汉字的文本框，第 11 个字是标点；左列文本框，右列正文占位符"""
    p = new_pres(app)
    s = p.Slides.AddSlide(1, p.SlideMaster.CustomLayouts(2))
    s.Shapes.Placeholders(1).Delete()
    ph = s.Shapes.Placeholders(1)
    ph.Left, ph.Top, ph.Width, ph.Height = 480, 20, 240.5 + 18, 400
    ph.TextFrame.MarginLeft = ph.TextFrame.MarginRight = 0
    ph.TextFrame.TextRange.Text = chr(13).join("一二三四五六七八九十" + c + "后续" for c in "，。；）")
    ph.TextFrame.TextRange.Font.Name = "Microsoft YaHei"
    ph.TextFrame.TextRange.Font.Size = 24
    ph.TextFrame.TextRange.ParagraphFormat.Bullet.Visible = 0
    ph.TextFrame.TextRange.IndentLevel = 1
    for k, c in enumerate("，。；）"):
        tb = s.Shapes.AddTextbox(1, 20, 20 + k * 80, 240.5, 70)
        tf = tb.TextFrame
        tf.MarginLeft = tf.MarginRight = tf.MarginTop = tf.MarginBottom = 0
        tf.WordWrap = -1
        tf.AutoSize = 0
        tf.TextRange.Text = "一二三四五六七八九十" + c + "后续文字"
        tf.TextRange.Font.Name = "Microsoft YaHei"
        tf.TextRange.Font.Size = 24
        tb.Line.Visible = -1
        tb.Line.ForeColor.RGB = RGB(200, 200, 200)
    return p


def _patch_hanging_unset(path):
    import re
    import zipfile
    tmp = path.with_suffix(".tmp")
    with zipfile.ZipFile(path) as zin, zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as zout:
        for item in zin.infolist():
            data = zin.read(item.filename)
            if item.filename in ("ppt/presentation.xml", "ppt/slideMasters/slideMaster1.xml") or item.filename.startswith("ppt/slides/slide"):
                data = re.sub(rb' hangingPunct="[01]"', b"", data)
            zout.writestr(item, data)
    tmp.replace(path)


text_hanging_unset.patch = _patch_hanging_unset

# 段落字体对齐：字体 × 行距 × fontAlgn，每格两行
FONTALGN_CASES = [(f, sp, a) for f in ("微软雅黑", "宋体", "等线", "Calibri") for sp in (100000, 150000) for a in ("auto", "ctr", "t", "b")]


def text_fontalgn(app):
    """段落字体对齐（fontAlgn auto / ctr / t / b）时字在行里的纵向位置：微软雅黑、宋体、等线、Calibri × 单倍、1.5 倍行距，
    18 磅两行（保存后改 XML）"""
    p = new_pres(app)
    s = p.Slides.Add(1, 12)
    for k in range(len(FONTALGN_CASES)):
        tb = s.Shapes.AddTextbox(1, 10 + (k % 8) * 118, 10 + (k // 8) * 130, 112, 120)
        tb.TextFrame.WordWrap = 0
        tb.TextFrame.AutoSize = 0
        tb.Line.Visible = -1
        tb.Line.ForeColor.RGB = RGB(220, 220, 220)
        tb.TextFrame.TextRange.Text = f"FAMARK{k}"
    return p


def _patch_fontalgn(path):
    import re
    import zipfile
    tmp = path.with_suffix(".tmp")
    with zipfile.ZipFile(path) as zin, zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as zout:
        for item in zin.infolist():
            data = zin.read(item.filename)
            if item.filename == "ppt/slides/slide1.xml":
                xml = data.decode("utf8")
                for k, (f, sp, a) in enumerate(FONTALGN_CASES):
                    rpr = f'<a:rPr lang="zh-CN" altLang="en-US" sz="1800"><a:latin typeface="{f}"/><a:ea typeface="{f}"/></a:rPr>'
                    para = f'<a:p><a:pPr fontAlgn="{a}"><a:lnSpc><a:spcPct val="{sp}"/></a:lnSpc></a:pPr><a:r>{rpr}<a:t>文字 Hg</a:t></a:r></a:p>'
                    xml = re.sub(rf"<a:p>(?:(?!</a:p>).)*?FAMARK{k}(?:(?!</a:p>).)*?</a:p>", lambda m, para=para: para + para, xml, count=1, flags=re.S)
                data = xml.encode("utf8")
            zout.writestr(item, data)
    tmp.replace(path)


text_fontalgn.patch = _patch_fontalgn


# 宽度不定的符号：前一半不管语言都用东亚字体，后一半用西文字体
EA_SLOT_TEXT = "§¨°±×÷™↔①②■□▲△◆●○★☆♀♂♪|·–—…←→≤≥√∞αΩ©½"
EA_SLOT_ROWS = [("zh-CN", "Arial", "微软雅黑"), ("en-US", "Arial", "微软雅黑"), ("zh-CN", "Calibri", "宋体"), ("en-US", "Calibri", "宋体"),
                ("zh-CN", "Times New Roman", "楷体"), ("en-US", "Arial", "黑体")]


def text_ea_slot_symbols(app):
    """宽度不定的符号用哪个字体排：§ ¨ ° ± × ÷ ™ ↔、带圈数字、几何图形、杂项符号不管 lang 都用东亚字体（西文字体里有字形也不用），
    · – — … 箭头 数学符号 希腊字母等用西文字体；每行一种 lang × 西文 / 东亚字体组合（保存后改 XML）"""
    p = new_pres(app)
    s = p.Slides.Add(1, 12)
    for k in range(len(EA_SLOT_ROWS)):
        tb = s.Shapes.AddTextbox(1, 20, 20 + k * 80, 920, 60)
        tb.TextFrame.WordWrap = 0
        tb.TextFrame.TextRange.Text = f"EASLOT{k}"
    return p


def _patch_ea_slot_symbols(path):
    import re
    import zipfile
    tmp = path.with_suffix(".tmp")
    with zipfile.ZipFile(path) as zin, zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as zout:
        for item in zin.infolist():
            data = zin.read(item.filename)
            if item.filename == "ppt/slides/slide1.xml":
                xml = data.decode("utf8")
                for k, (lang, lat, ea) in enumerate(EA_SLOT_ROWS):
                    rpr = f'<a:rPr lang="{lang}" sz="2000" dirty="0"><a:latin typeface="{lat}"/><a:ea typeface="{ea}"/></a:rPr>'
                    xml = re.sub(rf"<a:p>(?:(?!</a:p>).)*?EASLOT{k}(?:(?!</a:p>).)*?</a:p>",
                                 lambda m, rpr=rpr: f"<a:p><a:r>{rpr}<a:t>{EA_SLOT_TEXT}</a:t></a:r></a:p>", xml, count=1, flags=re.S)
                data = xml.encode("utf8")
            zout.writestr(item, data)
    tmp.replace(path)


text_ea_slot_symbols.patch = _patch_ea_slot_symbols


# 主题东亚字体为空（默认主题）时：(字体, 语言) 写进文字属性
THEME_EA_ALTLANG = [
    ('<a:latin typeface="+mn-ea"/>', 'lang="en-US"'),
    ('<a:latin typeface="+mn-ea"/>', 'lang="en-US" altLang="zh-CN"'),
    ('<a:latin typeface="+mn-ea"/>', 'lang="zh-CN" altLang="en-US"'),
    ('<a:latin typeface="+mn-ea"/>', ''),
    ('<a:latin typeface="+mn-ea"/>', 'lang="ja-JP"'),
    ('<a:latin typeface="Arial"/><a:ea typeface="+mn-ea"/>', 'lang="en-US" altLang="zh-CN"'),
    ('<a:latin typeface="Arial"/><a:ea typeface="+mn-ea"/>', 'lang="en-US"'),
    ('<a:latin typeface="+mj-ea"/><a:ea typeface="+mj-ea"/>', 'lang="en-US" altLang="zh-CN"'),
]


def text_theme_ea_altlang(app):
    """主题东亚字体为空时西文槽写 +mn-ea、东亚槽写 +mn-ea：按 lang、再按 altLang 选主题里的脚本字体（Hans 等线、Jpan 游ゴシック），
    都不是中日韩时西文用 Arial、中文用雅黑（保存后改 XML）"""
    p = new_pres(app)
    s = p.Slides.Add(1, 12)
    for k in range(len(THEME_EA_ALTLANG)):
        tb = s.Shapes.AddTextbox(1, 20, 10 + k * 64, 900, 50)
        tb.TextFrame.WordWrap = 0
        tb.TextFrame.TextRange.Text = f"TEAMARK{k}"
    return p


def _patch_theme_ea_altlang(path):
    import re
    import zipfile
    tmp = path.with_suffix(".tmp")
    with zipfile.ZipFile(path) as zin, zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as zout:
        for item in zin.infolist():
            data = zin.read(item.filename)
            if item.filename == "ppt/slides/slide1.xml":
                xml = data.decode("utf8")
                for k, (fonts, lang) in enumerate(THEME_EA_ALTLANG):
                    rpr = f'<a:rPr {lang} sz="2800" dirty="0">{fonts}</a:rPr>'
                    xml = re.sub(rf"<a:p>(?:(?!</a:p>).)*?TEAMARK{k}(?:(?!</a:p>).)*?</a:p>",
                                 lambda m, rpr=rpr: f"<a:p><a:r>{rpr}<a:t>ABCDEFabcdef0123 测试示例文字 {k + 1}</a:t></a:r></a:p>", xml, count=1, flags=re.S)
                data = xml.encode("utf8")
            zout.writestr(item, data)
    tmp.replace(path)


text_theme_ea_altlang.patch = _patch_theme_ea_altlang


def text_mix_wrap_lines(app):
    """混排行高只管段末一行、换行符结尾的行：东亚宋体 / 黑体 / 楷体配西文 Arial、Calibri，24 磅一段"口"字折成七八行，
    第二列中间有换行符（a:br）；最右一列微软雅黑对照（不混排）"""
    p = new_pres(app)
    s = p.Slides.Add(1, 12)
    for k, (ea, latin, br) in enumerate([("SimSun", "Arial", False), ("SimSun", "Arial", True), ("SimSun", "Calibri", False),
                                         ("SimHei", "Arial", False), ("KaiTi", "Times New Roman", False), ("Microsoft YaHei", "Arial", False)]):
        tb = s.Shapes.AddTextbox(1, 10 + k * 158, 20, 155, 500)
        tf = tb.TextFrame
        tf.WordWrap = -1
        tf.AutoSize = 0
        tf.MarginLeft = tf.MarginRight = 0
        tf.TextRange.Text = "口" * 15 + (chr(11) if br else "") + "口" * 15
        tf.TextRange.Font.Name = latin
        tf.TextRange.Font.NameFarEast = ea
        tf.TextRange.Font.Size = 24
        tb.Line.Visible = -1
        tb.Line.ForeColor.RGB = RGB(200, 200, 200)
    return p


# 固定行距 / 段前距（spcPts，百分之一磅）
SPCPTS_LN = [1350, 2138, 1625, 1250, 1975, 1449]
SPCPTS_BEF = [70, 150, 250, 49, 51]


def text_spcpts_round(app):
    """固定的行距、段前距（spcPts）按整磅四舍五入：行距 13.5 / 21.38 / 16.25 / 12.5 / 19.75 / 14.49 磅，段前 0.7 / 1.5 / 2.5 / 0.49 / 0.51 磅；
    12 磅微软雅黑（保存后改 XML）"""
    p = new_pres(app)
    s = p.Slides.Add(1, 12)
    for k in range(len(SPCPTS_LN) + len(SPCPTS_BEF)):
        tb = s.Shapes.AddTextbox(1, 10 + k * 85, 10, 80, 300)
        tb.TextFrame.WordWrap = -1
        tb.TextFrame.TextRange.Text = f"SPMARK{k}"
    return p


def _patch_spcpts_round(path):
    import re
    import zipfile
    tmp = path.with_suffix(".tmp")
    with zipfile.ZipFile(path) as zin, zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as zout:
        for item in zin.infolist():
            data = zin.read(item.filename)
            if item.filename == "ppt/slides/slide1.xml":
                xml = data.decode("utf8")
                rpr = '<a:rPr lang="zh-CN" sz="1200"><a:latin typeface="微软雅黑"/><a:ea typeface="微软雅黑"/></a:rPr>'
                for k in range(len(SPCPTS_LN) + len(SPCPTS_BEF)):
                    if k < len(SPCPTS_LN):
                        body = f'<a:p><a:pPr><a:lnSpc><a:spcPts val="{SPCPTS_LN[k]}"/></a:lnSpc></a:pPr><a:r>{rpr}<a:t>{"口" * 40}</a:t></a:r></a:p>'
                    else:
                        ppr = f'<a:pPr><a:spcBef><a:spcPts val="{SPCPTS_BEF[k - len(SPCPTS_LN)]}"/></a:spcBef></a:pPr>'
                        body = "".join(f"<a:p>{ppr}<a:r>{rpr}<a:t>口口</a:t></a:r></a:p>" for _ in range(6))
                    xml = re.sub(rf"<a:p>(?:(?!</a:p>).)*?SPMARK{k}(?:(?!</a:p>).)*?</a:p>", lambda m, body=body: body, xml, count=1, flags=re.S)
                data = xml.encode("utf8")
            zout.writestr(item, data)
    tmp.replace(path)


text_spcpts_round.patch = _patch_spcpts_round


# 正的首行缩进 + 项目符号：(marL, indent) EMU、项目符号
POS_INDENT_BU = [(0, 228600, "bu"), (342900, 228600, "bu"), (0, 457200, "num"), (228600, 114300, "bu"), (0, 76200, "bu"), (342900, 0, "bu")]


def text_bullet_pos_indent(app):
    """首行缩进是正数又有项目符号：符号在 marL、第一行文字在 marL + indent（缩进比符号窄时文字紧跟符号）；
    300 磅宽的文本框，14 磅微软雅黑（保存后改 XML）"""
    p = new_pres(app)
    s = p.Slides.Add(1, 12)
    for k in range(len(POS_INDENT_BU)):
        tb = s.Shapes.AddTextbox(1, 40 + (k // 3) * 450, 30 + (k % 3) * 150, 300, 130)
        tf = tb.TextFrame
        tf.WordWrap = -1
        tf.AutoSize = 0
        tf.TextRange.Text = f"POSIND{k}" + "一二三四五六七八九十" * 3
        tf.TextRange.Font.Name = "Microsoft YaHei"
        tf.TextRange.Font.NameFarEast = "Microsoft YaHei"
        tf.TextRange.Font.Size = 14
        tb.Line.Visible = -1
        tb.Line.ForeColor.RGB = RGB(200, 200, 200)
    return p


def _patch_bullet_pos_indent(path):
    import re
    import zipfile
    tmp = path.with_suffix(".tmp")
    with zipfile.ZipFile(path) as zin, zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as zout:
        for item in zin.infolist():
            data = zin.read(item.filename)
            if item.filename == "ppt/slides/slide1.xml":
                for k, (marl, ind, bu) in enumerate(POS_INDENT_BU):
                    mark = f"POSIND{k}".encode()

                    def fix(m, mark=mark, marl=marl, ind=ind, bu=NEG_INDENT_BU[bu].encode()):
                        seg = m.group(0).replace(mark, b"")
                        seg = re.sub(rb"^<a:p><a:pPr[^>]*/>", b"<a:p>", seg)
                        seg = re.sub(rb"^<a:p><a:pPr[^>]*>(?:(?!</a:pPr>).)*</a:pPr>", b"<a:p>", seg, flags=re.S)
                        return f'<a:p><a:pPr marL="{marl}" indent="{ind}">'.encode() + bu + b"</a:pPr>" + seg[5:]
                    data = re.sub(rb"<a:p>(?:(?!</a:p>).)*?" + mark, fix, data, count=1, flags=re.S)
            zout.writestr(item, data)
    tmp.replace(path)


text_bullet_pos_indent.patch = _patch_bullet_pos_indent


# 负首行缩进：(marL, indent) EMU、项目符号（"" 没有、"bu" 圆点、"num" 编号）；第一行左端算出来在文本框内边距以左的、在里面的、不缩进的对照
NEG_INDENT = [(0, -476250, ""), (228600, -476250, ""), (571500, -476250, ""), (0, 0, ""), (0, -228600, ""),
              (228600, -590550, "bu"), (0, -285750, "num"), (571500, -285750, "bu")]
NEG_INDENT_BU = {"": "", "bu": '<a:buFont typeface="Arial"/><a:buChar char="&#8226;"/>', "num": '<a:buFont typeface="+mj-lt"/><a:buAutoNum type="arabicPeriod"/>'}


def text_neg_indent(app):
    """首行缩进是负数（保存后改 XML，界面里设不出 marL 0 + 负 indent）：第一行从哪里排、能放几个字；左列没有项目符号，
    右列有项目符号、编号。300 磅宽的文本框，14 磅微软雅黑三十个汉字"""
    p = new_pres(app)
    s = p.Slides.Add(1, 12)
    for k in range(len(NEG_INDENT)):
        tb = s.Shapes.AddTextbox(1, 40 + (k // 5) * 450, 30 + (k % 5) * 95, 300, 80)
        tf = tb.TextFrame
        tf.WordWrap = -1
        tf.AutoSize = 0
        tf.TextRange.Text = f"NEGIND{k}" + "一二三四五六七八九十" * 3
        tf.TextRange.Font.Name = "Microsoft YaHei"
        tf.TextRange.Font.NameFarEast = "Microsoft YaHei"
        tf.TextRange.Font.Size = 14
        tf.TextRange.ParagraphFormat.Bullet.Visible = 0
        tb.Line.Visible = -1
        tb.Line.ForeColor.RGB = RGB(200, 200, 200)
    return p


def _patch_neg_indent(path):
    import re
    import zipfile
    tmp = path.with_suffix(".tmp")
    with zipfile.ZipFile(path) as zin, zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as zout:
        for item in zin.infolist():
            data = zin.read(item.filename)
            if item.filename == "ppt/slides/slide1.xml":
                for k, (marl, ind, bu) in enumerate(NEG_INDENT):
                    mark = f"NEGIND{k}".encode()

                    def fix(m, mark=mark, marl=marl, ind=ind, bu=NEG_INDENT_BU[bu].encode()):
                        seg = m.group(0).replace(mark, b"")
                        seg = re.sub(rb"^<a:p><a:pPr[^>]*/>", b"<a:p>", seg)
                        seg = re.sub(rb"^<a:p><a:pPr[^>]*>(?:(?!</a:pPr>).)*</a:pPr>", b"<a:p>", seg, flags=re.S)
                        return f'<a:p><a:pPr marL="{marl}" indent="{ind}">'.encode() + (bu or b"<a:buNone/>") + b"</a:pPr>" + seg[5:]
                    data = re.sub(rb"<a:p>(?:(?!</a:p>).)*?" + mark, fix, data, count=1, flags=re.S)
            zout.writestr(item, data)
    tmp.replace(path)


text_neg_indent.patch = _patch_neg_indent


def text_fakebold_width(app):
    """人工加粗的字宽：没有粗体字形的宋体、黑体标粗体，框宽正好放下 N 个字再多 1 磅（不加粗时放得下，人工加粗后每字变宽、
    最后一个字换到下一行）；对照：有粗体字形的微软雅黑、不加粗的宋体、每 em 1000 单位的华文细黑（27 磅不加宽）。字号 18 / 27 / 54 磅，
    右列倒数第二行是西文字母"""
    p = new_pres(app)
    s = blank(p)
    rows = [("宋体", True, 18, 20), ("宋体", True, 27, 14), ("黑体", True, 27, 14), ("宋体", False, 27, 14),
            ("宋体", True, 54, 7), ("微软雅黑", True, 27, 14), ("宋体", True, 27, 28), ("华文细黑", True, 27, 14)]
    y = [10, 10]
    for k, (font, bold, size, n) in enumerate(rows):
        col = 0 if k < 4 else 1
        latin = n == 28
        tb = s.Shapes.AddTextbox(1, 20 + col * 470, y[col], size * n / (2 if latin else 1) + 1 + 14.4, size * 2.6)
        tf = tb.TextFrame
        tf.WordWrap = -1
        tf.AutoSize = 0
        tf.TextRange.Text = "a" * (n + 3) if latin else ("一二三四五六七八九十" * 3)[:n + 3]
        tf.TextRange.Font.Name = font
        tf.TextRange.Font.NameFarEast = font
        tf.TextRange.Font.Size = size
        tf.TextRange.Font.Bold = -1 if bold else 0
        tb.Line.Visible = -1
        tb.Line.ForeColor.RGB = RGB(200, 200, 200)
        y[col] += size * 2.6 + 8
    return p


BR_LINE_PARAS = [
    # 两个换行之间的空行：换行（a:br）各自写了字号，段末 endParaRPr 18 磅
    ('<a:r><a:rPr lang="zh-CN" sz="1000"/><a:t>第一行十磅</a:t></a:r><a:br><a:rPr lang="zh-CN" sz="1000"/></a:br>'
     '<a:br><a:rPr lang="zh-CN" sz="4000"/></a:br><a:r><a:rPr lang="zh-CN" sz="1000"/><a:t>第三行十磅</a:t></a:r>'
     '<a:endParaRPr lang="zh-CN" sz="1800"/>'),
    ('<a:r><a:rPr lang="zh-CN" sz="1000"/><a:t>第一行十磅</a:t></a:r><a:br><a:rPr lang="zh-CN" sz="4000"/></a:br>'
     '<a:br><a:rPr lang="zh-CN" sz="1000"/></a:br><a:r><a:rPr lang="zh-CN" sz="1000"/><a:t>第三行十磅</a:t></a:r>'
     '<a:endParaRPr lang="zh-CN" sz="1800"/>'),
    # 样本里的写法：空行里还有一个空的文字段，都是 8 磅
    ('<a:r><a:rPr lang="zh-CN" sz="800"/><a:t>第一行八磅</a:t></a:r><a:br><a:rPr lang="zh-CN" sz="800"/></a:br>'
     '<a:r><a:rPr lang="zh-CN" sz="800"/><a:t/></a:r><a:br><a:rPr lang="zh-CN" sz="800"/></a:br>'
     '<a:r><a:rPr lang="zh-CN" sz="800"/><a:t>第三行八磅</a:t></a:r><a:endParaRPr lang="zh-CN" sz="1800"/>'),
    # 段末的空行（最后一个换行后面没有字）：按段末字号
    ('<a:r><a:rPr lang="zh-CN" sz="1000"/><a:t>第一行十磅</a:t></a:r><a:br><a:rPr lang="zh-CN" sz="1000"/></a:br>'
     '<a:endParaRPr lang="zh-CN" sz="4000"/>'),
]


def text_br_empty_line(app):
    """只有换行的空行有多高：段落里两个换行（a:br）之间没有字，换行写了不同的字号（保存后改 XML）；每个框下面接一段 10 磅文字看位置"""
    p = new_pres(app)
    s = blank(p)
    for k in range(len(BR_LINE_PARAS)):
        tb = s.Shapes.AddTextbox(1, 20 + k * 235, 40, 220, 300)
        tb.TextFrame.WordWrap = -1
        tb.TextFrame.AutoSize = 0
        tb.TextFrame.TextRange.Text = f"BRMARK{k}" + chr(13) + "后面一段"
        tb.TextFrame.TextRange.Font.Size = 10
        tb.Line.Visible = -1
        tb.Line.ForeColor.RGB = RGB(200, 200, 200)
    return p


def _patch_br_empty_line(path):
    import re
    import zipfile
    tmp = path.with_suffix(".tmp")
    with zipfile.ZipFile(path) as zin, zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as zout:
        for item in zin.infolist():
            data = zin.read(item.filename)
            if item.filename == "ppt/slides/slide1.xml":
                x = data.decode("utf8")
                for k, para in enumerate(BR_LINE_PARAS):
                    x = re.sub(rf"<a:p>(?:(?!</a:p>).)*?BRMARK{k}(?:(?!</a:p>).)*?</a:p>", lambda m: f"<a:p>{para}</a:p>", x, count=1, flags=re.S)
                data = x.encode("utf8")
            zout.writestr(item, data)
    tmp.replace(path)


text_br_empty_line.patch = _patch_br_empty_line


def text_ea_lang(app):
    """行首禁则、标点悬挂和文字语言（rPr lang）：正好放下 10 个汉字的框，第 11 个字是标点；每行一个框，
    整段的 lang 依次是 zh-CN、en-US、没写、en-US 加 altLang="zh-CN"（保存后改 XML）；左列第 11 个字是"、"，右列是"）" """
    p = new_pres(app)
    s = blank(p)
    for k in range(8):
        col, row = k // 4, k % 4
        tb = s.Shapes.AddTextbox(1, 30 + col * 460, 20 + row * 125, 240.5, 110)
        tf = tb.TextFrame
        tf.MarginLeft = tf.MarginRight = 0
        tf.WordWrap = -1
        tf.AutoSize = 0
        tf.TextRange.Text = "一二三四五六七八九十" + ("、" if col == 0 else "）") + f"LANGMARK{row}后续文字后续"
        tf.TextRange.Font.Name = "Microsoft YaHei"
        tf.TextRange.Font.NameFarEast = "Microsoft YaHei"
        tf.TextRange.Font.Size = 24
        tb.Line.Visible = -1
        tb.Line.ForeColor.RGB = RGB(200, 200, 200)
    return p


def _patch_ea_lang(path):
    import re
    import zipfile
    tmp = path.with_suffix(".tmp")
    with zipfile.ZipFile(path) as zin, zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as zout:
        for item in zin.infolist():
            data = zin.read(item.filename)
            if item.filename == "ppt/slides/slide1.xml":
                x = data.decode("utf8")
                for row, lang in enumerate(['lang="zh-CN"', 'lang="en-US"', '', 'lang="en-US" altLang="zh-CN"']):
                    def fix(m):
                        body = re.sub(r'<a:rPr\b[^>]*?(/?)>', lambda r: f'<a:rPr{" " + lang if lang else ""} sz="2400"{r.group(1)}>', m.group(0))
                        body = re.sub(r'<a:endParaRPr\b[^>]*?(/?)>', lambda r: f'<a:endParaRPr{" " + lang if lang else ""} sz="2400"{r.group(1)}>', body)
                        return body.replace(f"LANGMARK{row}", "")
                    x = re.sub(rf"<a:p>(?:(?!</a:p>).)*?LANGMARK{row}(?:(?!</a:p>).)*?</a:p>", fix, x, flags=re.S)
                data = x.encode("utf8")
            zout.writestr(item, data)
    tmp.replace(path)


text_ea_lang.patch = _patch_ea_lang


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


def text_latin_break(app):
    """允许西文在单词中间换行（a:pPr latinLnBrk="1"，保存后改 XML）：左列不允许、右列允许；
    中文后面跟长英文单词 / 数字时间 / 英文句子，24 磅雅黑，框宽只够放一部分"""
    p = new_pres(app)
    s = blank(p)
    texts = ["这是一段中文后面跟着Internationalization的长单词", "会议时间定在下午12:30，请准时参加会议讨论", "Mixed English words wrapping inside narrow boxes here"]
    for j, t in enumerate(texts):
        for k in range(2):
            tb = s.Shapes.AddTextbox(1, 20 + k * 470, 20 + j * 170, 300.5, 150)
            tf = tb.TextFrame
            tf.MarginLeft = tf.MarginRight = tf.MarginTop = tf.MarginBottom = 0
            tf.WordWrap = -1
            tf.AutoSize = 0
            tr = tf.TextRange
            tr.Text = ("QQL" if k else "") + t
            tr.Font.Name = "Microsoft YaHei"
            tr.Font.NameFarEast = "Microsoft YaHei"
            tr.Font.Size = 24
            tb.Line.Visible = -1
            tb.Line.ForeColor.RGB = RGB(200, 200, 200)
    return p


def _patch_latin_break(path):
    import re, zipfile
    tmp = path.with_suffix(".tmp")
    with zipfile.ZipFile(path) as zin, zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as zout:
        for item in zin.infolist():
            data = zin.read(item.filename)
            if item.filename.startswith("ppt/slides/slide"):
                x = data.decode("utf-8")
                def fix(m):
                    para = m.group(0)
                    if "QQL" not in para:
                        return para
                    para = para.replace("QQL", "")
                    if "<a:pPr" in para:
                        return re.sub(r"<a:pPr", '<a:pPr latinLnBrk="1"', para, count=1)
                    return para.replace("<a:p>", '<a:p><a:pPr latinLnBrk="1"/>', 1)
                x = re.sub(r"<a:p>.*?</a:p>", fix, x, flags=re.S)
                data = x.encode("utf-8")
            zout.writestr(item, data)
    tmp.replace(path)


text_latin_break.patch = _patch_latin_break


def fonts_showcase(app):
    """默认字体包效果演示（SPEC D3）：常见课件字体的标题、正文、中英数混排、项目符号、表格。
    第 1 页微软雅黑 / 等线；第 2 页宋体 / 楷体 / 仿宋 / 黑体；第 3 页西文字体 Calibri / Arial / Times New Roman / Cambria"""
    nl = chr(10)
    p = new_pres(app)
    s = blank(p)
    textbox(s, 40, 20, 880, 50, "第三章  2024 年 Q3 经营分析报告", "Microsoft YaHei", 32)
    textbox(s, 40, 90, 430, 200, "本季度营收同比增长 18.6%，其中线上渠道贡献 62%。用户规模突破 1,250 万，ARPU 提升至 ¥36.8，客户满意度（NPS）达到 47 分。", "Microsoft YaHei", 18)
    b = textbox(s, 490, 90, 430, 200, nl.join(["核心指标全面达成", "新产品线 AI Assistant 上线", "华东、华南区域增长超过 25%", "下季度重点：海外市场拓展"]), "Microsoft YaHei", 18)
    b.TextFrame.TextRange.ParagraphFormat.Bullet.Visible = -1
    b.TextFrame.TextRange.ParagraphFormat.Bullet.Character = 8226
    textbox(s, 40, 310, 880, 60, "等线：数据驱动决策，用 Python + SQL 搭建 BI 看板，每日 08:30 自动推送。", "DengXian", 20)
    t = s.Shapes.AddTable(4, 4, 40, 390, 880, 120)
    rows = [["区域", "营收（万元）", "同比", "备注"], ["华东", "12,580", "+21.3%", "Top 1"], ["华南", "9,860", "+25.7%", "增长最快"], ["西北", "2,130", "-3.2%", "需关注"]]
    for r in range(4):
        for c in range(4):
            tr = t.Table.Cell(r + 1, c + 1).Shape.TextFrame.TextRange
            tr.Text = rows[r][c]
            tr.Font.Size = 16
            tr.Font.Name = "Microsoft YaHei"
            tr.Font.NameFarEast = "Microsoft YaHei"
    s = blank(p)
    for k, (font, label) in enumerate([("SimSun", "宋体"), ("KaiTi", "楷体"), ("FangSong", "仿宋"), ("SimHei", "黑体")]):
        textbox(s, 40 + (k % 2) * 450, 20 + (k // 2) * 260, 430, 240,
                label + "标题示例" + nl + "学而时习之，不亦说乎？有朋自远方来，不亦乐乎？人不知而不愠，不亦君子乎？2024 年第 3 课，共 45 分钟。", font, 20)
    s = blank(p)
    for k, font in enumerate(["Calibri", "Arial", "Times New Roman", "Cambria"]):
        textbox(s, 40 + (k % 2) * 450, 20 + (k // 2) * 260, 430, 240,
                font + " Heading" + nl + "The quick brown fox jumps over the lazy dog. Revenue grew 18.6% year over year, reaching $12.58M in Q3 2024 (AVATAR, WAVE, Typography).", font, 20)
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


def text_anchor_linespacing(app):
    """多倍行距 + 居中 / 底端对齐：最后一行只算到基线加单倍行框里的下伸（下面多出的空白不计入总高度）；
    1.5 倍、2 倍行距 × 居中、底端，中间有一个空段落"""
    p = new_pres(app)
    s = blank(p)
    for k, (sp, anchor) in enumerate([(1.5, 3), (2.0, 3), (1.5, 4), (2.0, 4)]):
        tb = s.Shapes.AddTextbox(1, 30 + k * 230, 40, 210, 460)
        tf = tb.TextFrame
        tf.AutoSize = 0
        tb.Height = 460
        tf.VerticalAnchor = anchor
        tr = tf.TextRange
        tr.Text = "第一行文字\r第二行文字\r\r第四行文字"
        tr.Font.Name = "Microsoft YaHei"
        tr.Font.NameFarEast = "Microsoft YaHei"
        tr.Font.Size = 20
        pf = tb.TextFrame2.TextRange.ParagraphFormat
        pf.LineRuleWithin = -1
        pf.SpaceWithin = sp
        tb.Line.Visible = -1
        tb.Line.ForeColor.RGB = RGB(200, 200, 200)
    return p


def table_linespacing(app):
    """表格行高由多倍行距的文字撑开：最后一行下方多出的空白不计入（1.5 倍、2 倍行距，每格 3~4 行字）"""
    p = new_pres(app)
    s = blank(p)
    for k, sp in enumerate((1.5, 2.0)):
        t = s.Shapes.AddTable(3, 2, 40 + k * 450, 40, 400, 90).Table
        for r in range(1, 4):
            t.Rows(r).Height = 20
            for c in (1, 2):
                tf = t.Cell(r, c).Shape.TextFrame
                tf.TextRange.Text = "\r".join(f"第{i + 1}行" for i in range(2 + r))
                tf.TextRange.Font.Size = 12
                tf.TextRange.Font.Name = "Microsoft YaHei"
                tf.TextRange.Font.NameFarEast = "Microsoft YaHei"
                pf = t.Cell(r, c).Shape.TextFrame2.TextRange.ParagraphFormat
                pf.LineRuleWithin = -1
                pf.SpaceWithin = sp
    return p


TABLE_FONT_ALGNS = [None, "ctr", "base", "t"]


def table_fontalgn(app):
    """表格行高由 1.5 倍行距文字撑开时，段落的字体对齐（fontAlgn）决定最后一行下方的空白算不算：
    默认 / base 不算，ctr、t 按完整行高（保存后改 XML）"""
    p = new_pres(app)
    s = blank(p)
    for k in range(len(TABLE_FONT_ALGNS)):
        sh = s.Shapes.AddTable(2, 1, 40 + k * 220, 60, 160, 20)
        sh.Name = f"FA{k}"
        t = sh.Table
        for r in (1, 2):
            t.Rows(r).Height = 10
            tf = t.Cell(r, 1).Shape.TextFrame
            tf.MarginTop = tf.MarginBottom = 0
            tf.TextRange.Text = "一二三四五六七八九十一二三四"
            tf.TextRange.Font.Size = 14
            tf.TextRange.Font.Name = "Microsoft YaHei"
            tf.TextRange.Font.NameFarEast = "Microsoft YaHei"
            pf = t.Cell(r, 1).Shape.TextFrame2.TextRange.ParagraphFormat
            pf.LineRuleWithin = -1
            pf.SpaceWithin = 1.5
    return p


def _patch_fontalgn(path):
    import re
    import zipfile
    tmp = path.with_suffix(".tmp")
    with zipfile.ZipFile(path) as zin, zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as zout:
        for item in zin.infolist():
            data = zin.read(item.filename)
            if item.filename == "ppt/slides/slide1.xml":
                xml = data.decode("utf8")
                for k, al in enumerate(TABLE_FONT_ALGNS):
                    if not al:
                        continue
                    g = re.search(rf'<p:graphicFrame>(?:(?!</p:graphicFrame>).)*name="FA{k}".*?</p:graphicFrame>', xml, re.S).group(0)
                    xml = xml.replace(g, re.sub(r"<a:pPr([^>]*)>", rf'<a:pPr\1 fontAlgn="{al}">', g))
                data = xml.encode("utf8")
            zout.writestr(item, data)
    tmp.replace(path)


table_fontalgn.patch = _patch_fontalgn


THEME_FONT_LANGS = ['zh-CN', 'ja-JP', 'zh-TW', 'ko-KR', 'en-US', None]


def text_theme_font_lang(app):
    """主题东亚字体为空（Office 默认主题）时按文字语言选主题里对应脚本的字体：zh-CN 等线、ja-JP 游ゴシック、zh-TW 新細明體、
    ko-KR 맑은 고딕；en-US 和不写语言用默认东亚字体（雅黑）。每行一种语言，文字不写东亚字体（保存后改 XML）"""
    p = new_pres(app)
    s = blank(p)
    for k in range(len(THEME_FONT_LANGS)):
        tb = s.Shapes.AddTextbox(1, 30, 10 + k * 80, 900, 70)
        tb.Name = f"LANGFONT{k}"
        tr = tb.TextFrame.TextRange
        tr.Text = f"第{k + 1}行 虽然能够保证触发更新的组件 ABC"
        tr.Font.Size = 28
        tr.Font.Name = "Arial"
    return p


def _patch_theme_font_lang(path):
    import re
    import zipfile
    tmp = path.with_suffix(".tmp")
    with zipfile.ZipFile(path) as zin, zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as zout:
        for item in zin.infolist():
            data = zin.read(item.filename)
            if item.filename == "ppt/slides/slide1.xml":
                xml = data.decode("utf8")

                def fix(m):
                    k = int(re.search(r'name="LANGFONT(\d+)"', m.group(0)).group(1))
                    sp = re.sub(r'<a:(ea|cs) typeface="[^"]*"[^>]*/>', "", m.group(0))
                    sp = re.sub(r' (lang|altLang)="[^"]*"', "", sp)
                    return sp.replace("<a:rPr", f'<a:rPr lang="{THEME_FONT_LANGS[k]}"') if THEME_FONT_LANGS[k] else sp
                xml = re.sub(r"<p:sp>(?:(?!</p:sp>).)*name=\"LANGFONT.*?</p:sp>", fix, xml, flags=re.S)
                data = xml.encode("utf8")
            zout.writestr(item, data)
    tmp.replace(path)


text_theme_font_lang.patch = _patch_theme_font_lang


MARGIN_RIGHT = [('l', 914400), ('ctr', 914400), ('r', 914400), ('just', 457200), ('l', 0)]


def text_margin_right(app):
    """段落右缩进（a:pPr marR）：左、居中、右、两端对齐都在扣掉右缩进后的宽度里换行和对齐；最后一个不缩进作对照。
    PowerPoint 界面里没有右缩进，PDF 转换来的课件常见（保存后改 XML）"""
    p = new_pres(app)
    s = blank(p)
    for k, (algn, mar) in enumerate(MARGIN_RIGHT):
        tb = s.Shapes.AddTextbox(1, 40, 10 + k * 105, 600, 90)
        tb.Name = f"MARR{k}"
        tb.TextFrame.WordWrap = True
        tr = tb.TextFrame.TextRange
        tr.Text = f"第{k + 1}段 虽然能够保证触发更新的组件按时完成渲染，但还需要考虑更多情况 ABC def"
        tr.Font.Size = 20
        tr.Font.Name = "Microsoft YaHei"
        tb.Line.Visible = True
    return p


def _patch_margin_right(path):
    import re
    import zipfile
    tmp = path.with_suffix(".tmp")
    with zipfile.ZipFile(path) as zin, zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as zout:
        for item in zin.infolist():
            data = zin.read(item.filename)
            if item.filename == "ppt/slides/slide1.xml":
                xml = data.decode("utf8")

                def fix(m):
                    k = int(re.search(r'name="MARR(\d+)"', m.group(0)).group(1))
                    algn, mar = MARGIN_RIGHT[k]
                    sp = re.sub(r"<a:pPr[^>]*/>|<a:pPr[^>]*>.*?</a:pPr>", "", m.group(0), flags=re.S)
                    return sp.replace("<a:p><a:r>", f'<a:p><a:pPr marR="{mar}" algn="{algn}"/><a:r>')
                xml = re.sub(r"<p:sp>(?:(?!</p:sp>).)*name=\"MARR.*?</p:sp>", fix, xml, flags=re.S)
                data = xml.encode("utf8")
            zout.writestr(item, data)
    tmp.replace(path)


text_margin_right.patch = _patch_margin_right


THEME_FONT_LATINS = ['KaiTi', 'SimSun', 'Yu Gothic', 'Arial', 'Microsoft YaHei', 'KaiTi']


def text_theme_font_latin(app):
    """主题东亚字体为空、文字不写语言（或 en-US）时，中文用西文字体自己的字形（楷体、宋体、Yu Gothic、雅黑），
    西文字体没有的字用雅黑补（Arial 全是雅黑，Yu Gothic 缺的简体字）；最后一行写 en-US。文字只写西文字体（保存后改 XML）"""
    p = new_pres(app)
    s = blank(p)
    for k, f in enumerate(THEME_FONT_LATINS):
        tb = s.Shapes.AddTextbox(1, 30, 10 + k * 80, 900, 70)
        tb.Name = f"LATINFONT{k}"
        tr = tb.TextFrame.TextRange
        tr.Text = f"第{k + 1}行 虽然能够保证触发更新的组件 ABC"
        tr.Font.Size = 28
        tr.Font.Name = f
    return p


def _patch_theme_font_latin(path):
    import re
    import zipfile
    tmp = path.with_suffix(".tmp")
    with zipfile.ZipFile(path) as zin, zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as zout:
        for item in zin.infolist():
            data = zin.read(item.filename)
            if item.filename == "ppt/slides/slide1.xml":
                xml = data.decode("utf8")

                def fix(m):
                    k = int(re.search(r'name="LATINFONT(\d+)"', m.group(0)).group(1))
                    sp = re.sub(r'<a:(ea|cs) typeface="[^"]*"[^>]*/>', "", m.group(0))
                    sp = re.sub(r' (lang|altLang)="[^"]*"', "", sp)
                    return sp.replace("<a:rPr", '<a:rPr lang="en-US"') if k == len(THEME_FONT_LATINS) - 1 else sp
                xml = re.sub(r"<p:sp>(?:(?!</p:sp>).)*name=\"LATINFONT.*?</p:sp>", fix, xml, flags=re.S)
                data = xml.encode("utf8")
            zout.writestr(item, data)
    tmp.replace(path)


text_theme_font_latin.patch = _patch_theme_font_latin


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


GAP_SLIDES = [("Unppt Missing Gap", "-128"), ("Unppt Missing Other", ""), ("Unppt Missing Gap", ""), ("Unppt Missing Gap", "-128"), ("Unppt Missing Gap", "")]


def text_charset_gap(app):
    """缺失字体的字符集跨页沿用、中间隔一页：第 1 页标日文，第 2 页不用这个字体（用另一个缺失字体），第 3 页不写字符集
    仍沿用日文（Yu Gothic）；第 4 页再标日文、第 5 页不写也沿用（保存后改 XML）。样本里有隔一页就清掉的情况，规律未明（见 docs/todo）"""
    p = new_pres(app)
    for k in range(len(GAP_SLIDES)):
        s = blank(p)
        tb = s.Shapes.AddTextbox(1, 30, 30, 900, 80)
        tr = tb.TextFrame.TextRange
        tr.Text = f"第 {k + 1} 页 客户提供数字化企业大学解决方案的建设和运营服务"
        tr.Font.Size = 28
        tr.Font.Name = f"MarkerFont{k}"
    return p


def _patch_charset_gap(path):
    import re
    import zipfile
    tmp = path.with_suffix(".tmp")
    with zipfile.ZipFile(path) as zin, zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as zout:
        for item in zin.infolist():
            data = zin.read(item.filename)
            m = re.match(r"ppt/slides/slide(\d+)\.xml$", item.filename)
            if m:
                k = int(m.group(1)) - 1
                name, cs = GAP_SLIDES[k]
                a = f' pitchFamily="34" charset="{cs}"' if cs else ""
                xml = data.decode("utf8")
                xml = re.sub(rf'<a:latin typeface="MarkerFont{k}"[^>]*/>', f'<a:latin typeface="{name}"{a}/><a:ea typeface="{name}"{a}/>', xml)
                xml = re.sub(rf'<a:(ea|cs) typeface="MarkerFont{k}"[^>]*/>', "", xml)
                data = xml.encode("utf8")
            zout.writestr(item, data)
    tmp.replace(path)


text_charset_gap.patch = _patch_charset_gap


def slide_size_repair(app):
    """页面尺寸超出 PowerPoint 允许的 1~56 英寸：文件里把高度写成约 77 英寸，PowerPoint 打开时修复成 7.5 英寸（宽不变），
    下面的内容被裁掉（保存后改 XML；导出参考图走"打开并修复"）"""
    p = new_pres(app)
    s = blank(p)
    for k, color in enumerate((0x3050C0, 0x30A050, 0xC05030, 0x808080)):
        sh = s.Shapes.AddShape(1, 60 + k * 200, 60 + k * 140, 180, 120)
        sh.Fill.ForeColor.RGB = color
        sh.TextFrame.TextRange.Text = f"第 {k + 1} 块"
    return p


def _patch_slide_size_repair(path):
    import re
    import zipfile
    tmp = path.with_suffix(".tmp")
    with zipfile.ZipFile(path) as zin, zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as zout:
        for item in zin.infolist():
            data = zin.read(item.filename)
            if item.filename == "ppt/presentation.xml":
                data = re.sub(rb'<p:sldSz cx="(\d+)" cy="\d+"', rb'<p:sldSz cx="\1" cy="70294500"', data)
            zout.writestr(item, data)
    tmp.replace(path)


slide_size_repair.patch = _patch_slide_size_repair


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


def emf_gradient_fill(app):
    """EMF 里的渐变填充（118 号记录 GRADIENTFILL，图表、图示导出的 EMF 常见）：水平、垂直渐变矩形，顶点着色三角形，竖条拼出的渐变"""
    import subprocess
    emf = (CACHE / "make-case" / "gradient-test.emf").resolve()
    emf.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run([sys.executable, str(Path(__file__).with_name("emf_gradient.py")), str(emf)], check=True)
    p = new_pres(app)
    s = blank(p)
    s.Shapes.AddPicture(str(emf), 0, -1, 60, 140, 840, 210)
    return p


def emf_bitmap_src(app):
    """EMF 位图记录的源框和光栅操作（emf_bitmap_src.py 用 GDI 生成）：上排四色位图按源框取一部分（从下往上 / 从上往下存的 DIB、
    StretchBlt、带偏移的 BitBlt、源框比位图宽），下排深青色底上用黑白掩码 SRCAND + 彩色图 SRCINVERT / SRCPAINT 画的圆形图标"""
    import subprocess
    emf = (CACHE / "make-case" / "bitmap-src.emf").resolve()
    emf.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run([sys.executable, str(Path(__file__).with_name("emf_bitmap_src.py")), str(emf)], check=True)
    p = new_pres(app)
    s = blank(p)
    s.Shapes.AddPicture(str(emf), 0, -1, 30, 60, 900, 390)
    return p


def fills_group(app):
    """组合填充（子元素选"组合填充"，保存后改 XML）：每组三个子元素（矩形、水平翻转的平行四边形、转了 30° 的椭圆）共用组合的
    图片填充 / 线性渐变填充；第三组是水平翻转的组合 + 图片填充"""
    img = str((TESTCASES / "shapes-basic" / "slide-001.png").resolve())
    p = new_pres(app)
    s = blank(p)
    for g in range(3):
        x0 = 20 + g * 315
        a = s.Shapes.AddShape(1, x0, 60, 120, 220)
        b = s.Shapes.AddShape(2, x0 + 110, 60, 170, 220)
        b.Flip(0)
        c = s.Shapes.AddShape(9, x0 + 40, 300, 210, 130)
        c.Rotation = 30
        for sh in (b, c):
            sh.Fill.Solid()
            sh.Fill.ForeColor.RGB = RGB(255, 0, 0)
        if g == 1:
            a.Fill.TwoColorGradient(1, 1)
            a.Fill.ForeColor.RGB = RGB(30, 80, 200)
            a.Fill.BackColor.RGB = RGB(250, 220, 40)
        else:
            a.Fill.UserPicture(img)
        for sh in (a, b, c):
            sh.Line.Visible = 0
        a.Name, b.Name, c.Name = f"G{g}A", f"G{g}B", f"G{g}C"
        grp = s.Shapes.Range([a.Name, b.Name, c.Name]).Group()
        if g == 2:
            grp.Flip(0)
    return p


def _patch_fills_group(path):
    """每个组合：子元素 A 的填充挪到组合上，三个子元素都改成组合填充"""
    import re
    import zipfile
    with zipfile.ZipFile(path) as z:
        files = {i.filename: z.read(i.filename) for i in z.infolist()}
        infos = z.infolist()
    name = "ppt/slides/slide1.xml"
    x = files[name].decode("utf8")
    fill_re = re.compile(r"(</a:prstGeom>)(<a:(solidFill|gradFill|blipFill)\b.*?</a:\3>)", re.S)

    def fix_group(m):
        g = m.group(0)
        own = None
        for sp in re.findall(r"<p:sp>.*?</p:sp>", g, re.S):
            if re.search(r'name="G\dA"', sp):
                own = fill_re.search(sp).group(2)
        g = fill_re.sub(lambda f: f.group(1) + "<a:grpFill/>", g)
        return re.sub(r"(<p:grpSpPr>.*?</a:xfrm>)", lambda k: k.group(1) + own, g, count=1, flags=re.S)

    x = re.sub(r"<p:grpSp>.*?</p:grpSp>", fix_group, x, flags=re.S)
    files[name] = x.encode("utf8")
    tmp = path.with_suffix(".tmp")
    with zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as zout:
        for item in infos:
            zout.writestr(item.filename, files[item.filename])
    tmp.replace(path)


fills_group.patch = _patch_fills_group


def fills_rot_with_shape(app):
    """填充跟不跟着形状转（rotWithShape / RotateWithObject）：上排图片填充、下排线性渐变（左→右），
    每排依次是 转 30° 跟着转、转 30° 不跟着转、转 90° 的长方形不跟着转"""
    img = str((TESTCASES / "shapes-basic" / "slide-001.png").resolve())
    p = new_pres(app)
    s = blank(p)
    for row in range(2):
        for k, (rot, follow, w, h) in enumerate([(30, -1, 220, 160), (30, 0, 220, 160), (90, 0, 240, 120)]):
            sh = s.Shapes.AddShape(1, 50 + k * 310, 50 + row * 250, w, h)
            sh.Line.Visible = 0
            if row == 0:
                sh.Fill.UserPicture(img)
            else:
                sh.Fill.TwoColorGradient(2, 1)
                sh.Fill.ForeColor.RGB = RGB(30, 80, 200)
                sh.Fill.BackColor.RGB = RGB(250, 220, 40)
            sh.Fill.RotateWithObject = follow
            sh.Rotation = rot
    return p


def fills_rot_cut(app):
    """不跟着形状转的填充铺在哪：轮廓不占满形状框的形状转动后，上排图片填充、下排线性渐变（左→右），
    依次是 切掉一角的矩形转 45°、切掉一角的自由曲线（自定义形状）转 45°、等腰三角形转 30°（这个还左右翻转）"""
    img = str((TESTCASES / "shapes-basic" / "slide-001.png").resolve())
    p = new_pres(app)
    s = blank(p)
    for row in range(2):
        for k in range(3):
            x, y, w, h = 70 + k * 300, 40 + row * 260, 210, 200
            if k == 0:
                sh = s.Shapes.AddShape(155, x, y, w, h)       # msoShapeSnip1Rectangle
                sh.Adjustments.SetItem(1, 0.45)
            elif k == 1:
                fb = s.Shapes.BuildFreeform(1, x, y + h * 0.7)
                for px, py in [(x + w * 0.7, y), (x + w, y + h * 0.3), (x + w, y + h), (x, y + h), (x, y + h * 0.7)]:
                    fb.AddNodes(0, 0, px, py)
                sh = fb.ConvertToShape()
            else:
                sh = s.Shapes.AddShape(7, x, y, w, h)         # msoShapeIsoscelesTriangle
                sh.Flip(0)                                    # msoFlipHorizontal
            sh.Line.Visible = 0
            if row == 0:
                sh.Fill.UserPicture(img)
            else:
                sh.Fill.TwoColorGradient(2, 1)
                sh.Fill.ForeColor.RGB = RGB(30, 80, 200)
                sh.Fill.BackColor.RGB = RGB(250, 220, 40)
            sh.Fill.RotateWithObject = 0
            sh.Rotation = 30 if k == 2 else 45
    return p


def charts_pct_stacked(app):
    """百分比堆积图（PowerPoint 默认示例数据，图例在右）：柱形、条形、面积；第 2 页同样三种，图例在下。
    看数值轴范围（0~100%）、图例项的顺序"""
    p = new_pres(app, window=True)
    for pos in (-4152, -4107):            # 图例在右、在下
        s = blank(p)
        for k, kind in enumerate([53, 59, 77]):  # xlColumnStacked100、xlBarStacked100、xlAreaStacked100
            ch = s.Shapes.AddChart2(-1, kind, 10 + k * 315, 60, 300, 400)
            try:
                ch.Chart.ChartData.Workbook.Close()
            except Exception:
                pass
            ch.Chart.HasLegend = True
            ch.Chart.Legend.Position = pos
    return p


def picture_bg_fill(app):
    """图片自己的填充（设置图片格式 → 填充）：半透明、带透明圆孔的 PNG，下面分别垫 无填充 / 深灰纯色 / 蓝黄渐变（白底幻灯片上）"""
    from PIL import Image, ImageDraw
    png = (CACHE / "make-case" / "semi-hole.png").resolve()
    png.parent.mkdir(parents=True, exist_ok=True)
    im = Image.new("RGBA", (300, 200), (200, 40, 40, 128))
    d = ImageDraw.Draw(im)
    d.rectangle([20, 20, 120, 180], fill=(20, 20, 20, 255))
    d.ellipse([170, 50, 270, 150], fill=(0, 0, 0, 0))
    im.save(png)
    p = new_pres(app)
    s = blank(p)
    for k in range(3):
        pic = s.Shapes.AddPicture(str(png), 0, -1, 30 + k * 310, 150, 290, 193)
        if k == 1:
            pic.Fill.Visible = -1
            pic.Fill.Solid()
            pic.Fill.ForeColor.RGB = RGB(40, 40, 40)
        elif k == 2:
            pic.Fill.Visible = -1
            pic.Fill.TwoColorGradient(2, 1)
            pic.Fill.ForeColor.RGB = RGB(30, 80, 200)
            pic.Fill.BackColor.RGB = RGB(250, 220, 40)
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


def slide_number_bare_field(app):
    """幻灯片上的页码占位符，页码字段里没有 <a:t>（只有 <a:fld type="slidenum"><a:rPr/></a:fld>，保存后改 XML）：PowerPoint 照样显示页码；
    版式的页码占位符字号放大到 54 磅；共 2 页"""
    p = new_pres(app)
    for k in range(2):
        s = blank(p)
        s.HeadersFooters.SlideNumber.Visible = -1
        textbox(s, 80, 220, 600, 80, f"空页码字段 {k + 1}", size=36)
    for i in range(1, s.CustomLayout.Shapes.Count + 1):
        sh = s.CustomLayout.Shapes(i)
        if sh.Type == 14 and sh.PlaceholderFormat.Type == 13:   # ppPlaceholderSlideNumber
            sh.TextFrame.TextRange.Font.Size = 54
    return p


def _patch_bare_field(path):
    import re
    import zipfile
    tmp = path.with_suffix(".tmp")
    with zipfile.ZipFile(path) as zin, zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as zout:
        for item in zin.infolist():
            data = zin.read(item.filename)
            if re.match(r"ppt/slides/slide\d+\.xml$", item.filename):
                data = re.sub(rb'(<a:fld [^>]*type="slidenum"[^>]*>.*?)<a:t>[^<]*</a:t>', rb"\1", data, flags=re.S)
            zout.writestr(item, data)
    tmp.replace(path)


slide_number_bare_field.patch = _patch_bare_field


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


def table_default_bold(app):
    """演示文稿默认样式写了粗体、斜体（b="1" i="1"，老 .ppt 转来的课件常见；保存后改 XML），母版 otherStyle 没写：
    文本框、默认样式的表格、无样式的表格里没写格式的文字是不是粗斜体"""
    p = new_pres(app)
    s = blank(p)
    tb = s.Shapes.AddTextbox(1, 40, 40, 860, 60)
    tb.TextFrame.TextRange.Text = "文本框 Text Box 2021.1.12"
    for k, style in enumerate([None, "{2D5ABB26-0587-4C30-8999-92F81FD0307C}"]):   # 默认样式、无样式无网格
        t = s.Shapes.AddTable(2, 2, 40 + k * 450, 160, 420, 120).Table
        if style:
            t.ApplyStyle(style)
        for r in range(1, 3):
            for c in range(1, 3):
                t.Cell(r, c).Shape.TextFrame.TextRange.Text = f"表格 Cell{r}{c} 2021.{r}.{c}"
    return p


def _patch_default_bold(path):
    import zipfile
    tmp = path.with_suffix(".tmp")
    with zipfile.ZipFile(path) as zin, zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as zout:
        for item in zin.infolist():
            data = zin.read(item.filename)
            if item.filename == "ppt/presentation.xml":
                x = data.decode("utf8")
                i = x.index("<p:defaultTextStyle>")
                j = x.index("<a:defRPr", x.index("<a:lvl1pPr", i)) + len("<a:defRPr")
                data = (x[:j] + ' b="1" i="1"' + x[j:]).encode("utf8")
            zout.writestr(item, data)
    tmp.replace(path)


table_default_bold.patch = _patch_default_bold


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



def fills_shape_gradient(app):
    """按形状的路径渐变（path="shape"，焦点在正中）：椭圆、四角星、圆角矩形、矩形、等腰三角形、心形；第 1 行白到深蓝，
    第 2 行从半透明白到全透明、叠在深蓝底上（样本里常见的高光用法）。COM 设不了，保存后改 XML（同 fills-radial）"""
    p = new_pres(app)
    s = blank(p)
    for i, k in enumerate([9, 91, 5, 1, 7, 21]):
        x = 30 + i * 155
        a = s.Shapes.AddShape(k, x, 40, 140, 200)
        a.Line.Visible = 0
        a.Fill.ForeColor.RGB = RGB(0x21, 0x21, 0x21)
        bg = s.Shapes.AddShape(1, x - 5, 290, 150, 210)
        bg.Line.Visible = 0
        bg.Fill.ForeColor.RGB = RGB(31, 56, 100)
        b = s.Shapes.AddShape(k, x, 295, 140, 200)
        b.Line.Visible = 0
        b.Fill.ForeColor.RGB = RGB(0x22, 0x22, 0x22)
    return p


def _patch_shape_gradient(path):
    import zipfile
    def g(c0, c1):
        return (f'<a:gradFill rotWithShape="1"><a:gsLst><a:gs pos="0">{c0}</a:gs><a:gs pos="100000">{c1}</a:gs></a:gsLst>'
                '<a:path path="shape"><a:fillToRect l="50000" t="50000" r="50000" b="50000"/></a:path></a:gradFill>').encode()
    reps = {
        "212121": g('<a:srgbClr val="FFFFFF"/>', '<a:srgbClr val="1F3864"/>'),
        "222222": g('<a:srgbClr val="FFFFFF"><a:alpha val="60000"/></a:srgbClr>', '<a:srgbClr val="FFFFFF"><a:alpha val="0"/></a:srgbClr>'),
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


fills_shape_gradient.patch = _patch_shape_gradient


def text_shadow_runs(app):
    """文字阴影跨字的叠放：阴影往左偏、不模糊（后一个字的阴影伸到前一个字上），看阴影是整体在所有字下面还是逐字叠。
    两端对齐的中文段落（第一行每个字之间加了间距）、分散对齐的一行、每个字一个 run 交替两种颜色的一行、普通左对齐（对照）"""
    p = new_pres(app)
    s = blank(p)
    specs = [("阴影叠放测试文字两端对齐阴影叠放测试文字两端对齐阴影叠放", 4, False, 30, 170),
             ("分散对齐阴影叠放", 5, False, 210, 80), ("逐字交替颜色阴影叠放", 1, True, 310, 80), ("普通左对齐阴影叠放", 1, False, 410, 80)]
    for text, algn, alternate, y, h in specs:
        t = s.Shapes.AddTextbox(1, 40, y, 880, h)
        tr = t.TextFrame.TextRange
        tr.Text = text
        tr.Font.Size = 54
        tr.Font.Name = "Microsoft YaHei"
        tr.Font.Color.RGB = RGB(30, 30, 30)
        tr.ParagraphFormat.Alignment = algn
        if alternate:
            for i in range(len(text)):
                tr.Characters(i + 1, 1).Font.Color.RGB = RGB(30, 30, 30) if i % 2 == 0 else RGB(40, 90, 200)
        sh = t.TextFrame2.TextRange.Font.Shadow
        sh.Visible = -1
        sh.OffsetX = -14
        sh.OffsetY = 4
        sh.Blur = 0
        sh.Transparency = 0
        sh.ForeColor.RGB = RGB(230, 60, 60)
    return p


def text_shadow_dist(app):
    """文字阴影的距离：外部阴影不模糊、红色，距离 4/8/16/32 磅，方向向右（第 1 行）和向下（第 2 行）；
    第 3 行同样距离的矩形（对照：形状阴影）"""
    p = new_pres(app)
    s = blank(p)
    for i, d in enumerate([4, 8, 16, 32]):
        for row, (ox, oy) in enumerate([(d, 0), (0, d)]):
            t = s.Shapes.AddTextbox(1, 30 + i * 230, 20 + row * 150, 200, 110)
            tr = t.TextFrame.TextRange
            tr.Text = "工H"
            tr.Font.Size = 60
            tr.Font.Name = "Microsoft YaHei"
            tr.Font.Color.RGB = RGB(20, 20, 20)
            sh = t.TextFrame2.TextRange.Font.Shadow
            sh.Visible = -1
            sh.OffsetX, sh.OffsetY = ox, oy
            sh.Blur = 0
            sh.Transparency = 0
            sh.ForeColor.RGB = RGB(230, 60, 60)
        r = s.Shapes.AddShape(1, 40 + i * 230, 340, 120, 120)
        r.Fill.ForeColor.RGB = RGB(20, 20, 20)
        r.Line.Visible = 0
        sd = r.Shadow
        sd.Visible = -1
        sd.OffsetX, sd.OffsetY = d, d
        sd.Blur = 0
        sd.Transparency = 0
        sd.ForeColor.RGB = RGB(230, 60, 60)
    return p


def text_shadow_size(app):
    """文字阴影的距离和字号的关系：距离都是 16 磅向右、不模糊，字号 12/24/48/96 磅（第 1 行文本框，第 2 行矩形里的文字）"""
    p = new_pres(app)
    s = blank(p)
    for i, size in enumerate([12, 24, 48, 96]):
        for row in range(2):
            if row == 0:
                t = s.Shapes.AddTextbox(1, 20 + i * 235, 30, 220, 200)
            else:
                t = s.Shapes.AddShape(1, 20 + i * 235, 290, 220, 200)
                t.Fill.Visible = 0
                t.Line.Visible = 0
            tr = t.TextFrame.TextRange
            tr.Text = "工H"
            tr.Font.Size = size
            tr.Font.Name = "Microsoft YaHei"
            tr.Font.Color.RGB = RGB(20, 20, 20)
            sh = t.TextFrame2.TextRange.Font.Shadow
            sh.Visible = -1
            sh.OffsetX, sh.OffsetY = 16, 0
            sh.Blur = 0
            sh.Transparency = 0
            sh.ForeColor.RGB = RGB(230, 60, 60)
    return p


def text_shadow_scale(app):
    """文字阴影随字号缩放的规律：第 1 页距离 8 磅（上行）、32 磅（下行）向右、不模糊，字号 8/16/32/64/128 磅；
    第 2 页 200 磅、距离 16 磅；第 3 页模糊 10 磅、距离 0（看模糊是否也随字号变），字号 16/64/128 磅"""
    p = new_pres(app)

    def box(s, x, y, w, h, size, ox, blur):
        t = s.Shapes.AddTextbox(1, x, y, w, h)
        t.TextFrame.WordWrap = 0
        tr = t.TextFrame.TextRange
        tr.Text = "H"
        tr.Font.Size = size
        tr.Font.Name = "Arial"
        tr.Font.Color.RGB = RGB(20, 20, 20)
        sh = t.TextFrame2.TextRange.Font.Shadow
        sh.Visible = -1
        sh.OffsetX, sh.OffsetY = ox, 0
        sh.Blur = blur
        sh.Transparency = 0
        sh.ForeColor.RGB = RGB(230, 60, 60)

    s = blank(p)
    xs = [20, 80, 160, 300, 560]
    for row, d in enumerate([8, 32]):
        for x, size in zip(xs, [8, 16, 32, 64, 128]):
            box(s, x, 20 + row * 260, 300, 200, size, d, 0)
    s2 = blank(p)
    box(s2, 100, 60, 800, 400, 200, 16, 0)
    s3 = blank(p)
    for x, size in zip([40, 240, 520], [16, 64, 128]):
        box(s3, x, 150, 400, 300, size, 0, 10)
    return p


def text_shadow_blur(app):
    """文字阴影的模糊随字号怎么变：距离 0、红色。第 1 页模糊 20 磅，字号 16/32/64/128 磅，右边同样模糊的矩形（对照）；
    第 2 页 64 磅的字模糊 5/10/20/40 磅，下面同样模糊的矩形"""
    p = new_pres(app)

    def text(s, x, y, size, blur):
        t = s.Shapes.AddTextbox(1, x, y, 300, 200)
        t.TextFrame.WordWrap = 0
        tr = t.TextFrame.TextRange
        tr.Text = "H"
        tr.Font.Size = size
        tr.Font.Name = "Arial"
        tr.Font.Color.RGB = RGB(20, 20, 20)
        sh = t.TextFrame2.TextRange.Font.Shadow
        sh.Visible = -1
        sh.OffsetX, sh.OffsetY = 0, 0
        sh.Blur = blur
        sh.Transparency = 0
        sh.ForeColor.RGB = RGB(230, 60, 60)

    def rect(s, x, y, blur):
        r = s.Shapes.AddShape(1, x, y, 40, 120)
        r.Fill.ForeColor.RGB = RGB(20, 20, 20)
        r.Line.Visible = 0
        sd = r.Shadow
        sd.Visible = -1
        sd.OffsetX, sd.OffsetY = 0, 0
        sd.Blur = blur
        sd.Transparency = 0
        sd.ForeColor.RGB = RGB(230, 60, 60)

    s = blank(p)
    for x, size in zip([30, 130, 260, 470], [16, 32, 64, 128]):
        text(s, x, 150, size, 20)
    rect(s, 820, 150, 20)
    s2 = blank(p)
    for i, b in enumerate([5, 10, 20, 40]):
        text(s2, 40 + i * 230, 40, 64, b)
        rect(s2, 60 + i * 230, 300, b)
    return p


def text_glow_scale(app):
    """文字发光、映像随字号怎么变：第 1 页发光 10 磅红色，字号 16/32/64/128 磅；第 2 页映像（距离 10 磅、全映像），
    字号 32/96 磅"""
    p = new_pres(app)
    s = blank(p)
    for x, size in zip([30, 130, 260, 470], [16, 32, 64, 128]):
        t = s.Shapes.AddTextbox(1, x, 150, 300, 200)
        t.TextFrame.WordWrap = 0
        tr = t.TextFrame.TextRange
        tr.Text = "H"
        tr.Font.Size = size
        tr.Font.Name = "Arial"
        tr.Font.Color.RGB = RGB(20, 20, 20)
        g = t.TextFrame2.TextRange.Font.Glow
        g.Radius = 10
        g.Color.RGB = RGB(230, 60, 60)
        g.Transparency = 0
    s2 = blank(p)
    for x, size in zip([60, 400], [32, 96]):
        t = s2.Shapes.AddTextbox(1, x, 60, 300, 200)
        t.TextFrame.WordWrap = 0
        tr = t.TextFrame.TextRange
        tr.Text = "H"
        tr.Font.Size = size
        tr.Font.Name = "Arial"
        tr.Font.Color.RGB = RGB(20, 20, 20)
        rf = t.TextFrame2.TextRange.Font.Reflection
        rf.Type = 9            # msoReflectionType9：全映像、紧贴（后面改距离）
        rf.Offset = 10
        rf.Size = 100
        rf.Transparency = 0
        rf.Blur = 0
    return p


def text_reflection_dist(app):
    """文字映像的距离随字号怎么变：Arial "H"，紧贴全映像（不透明到 50%），距离 0 / 5 / 20 磅（三行），字号 16/32/64/128 磅"""
    p = new_pres(app)
    s = blank(p)
    for row, d in enumerate([0, 5, 20]):
        for x, size in zip([30, 120, 260, 480], [16, 32, 64, 128]):
            t = s.Shapes.AddTextbox(1, x, 10 + row * 175, 300, 150)
            t.TextFrame.WordWrap = 0
            tr = t.TextFrame.TextRange
            tr.Text = "H"
            tr.Font.Size = size
            tr.Font.Name = "Arial"
            tr.Font.Color.RGB = RGB(20, 20, 20)
            rf = t.TextFrame2.TextRange.Font.Reflection
            rf.Type = 9
            rf.Offset = d
            rf.Size = 100
            rf.Transparency = 0
            rf.Blur = 0
    return p


def shapes_bg_fill(app):
    """用幻灯片背景填充的形状（填充 → 幻灯片背景填充，XML 是 p:sp useBgFill="1"）：背景是横向渐变，下面垫着彩色色块，
    上面盖矩形、椭圆（带边框）、转 30° 的矩形，和缩小一半的组合里的一个矩形；形状里应当透出背景、盖住下面的色块"""
    p = new_pres(app)
    s = blank(p)
    s.FollowMasterBackground = 0
    s.Background.Fill.TwoColorGradient(2, 1)           # 纵向条纹 = 横向渐变
    s.Background.Fill.ForeColor.RGB = RGB(30, 60, 120)
    s.Background.Fill.BackColor.RGB = RGB(240, 200, 80)
    for i, c in enumerate([(200, 40, 40), (40, 160, 70), (120, 60, 180), (230, 120, 30)]):
        r = s.Shapes.AddShape(1, 60 + i * 220, 120, 180, 300)
        r.Fill.ForeColor.RGB = RGB(*c)
        r.Line.Visible = 0
    a = s.Shapes.AddShape(1, 30, 200, 300, 120)
    a.Fill.Background()
    a.Line.ForeColor.RGB = RGB(255, 255, 255)
    a.Line.Weight = 2
    b = s.Shapes.AddShape(9, 330, 160, 200, 200)
    b.Fill.Background()
    b.Line.Visible = 0
    c = s.Shapes.AddShape(1, 560, 220, 200, 100)
    c.Fill.Background()
    c.Line.Visible = 0
    c.Rotation = 30
    g1 = s.Shapes.AddShape(1, 780, 150, 150, 120)
    g1.Fill.Background()
    g1.Line.Visible = 0
    g2 = s.Shapes.AddShape(1, 780, 300, 150, 80)
    g2.Fill.ForeColor.RGB = RGB(255, 255, 255)
    grp = s.Shapes.Range([g1.Name, g2.Name]).Group()
    grp.ScaleWidth(0.6, 0)
    grp.ScaleHeight(0.8, 0)
    return p


def text_control_chars(app):
    """文字里直接写的控制字符（PPT 转换、程序生成的课件常见，保存后改 XML）：回车 &#13;、换行符 &#10;、竖直制表符 _x000B_
    夹在一段文字中间，各一个文本框；对照：a:br 软回车"""
    p = new_pres(app)
    s = blank(p)
    for i, mark in enumerate(["QQCR", "QQLF", "QQVT", "QQBR"]):
        t = s.Shapes.AddTextbox(1, 40 + (i % 2) * 450, 40 + (i // 2) * 240, 420, 200)
        tr = t.TextFrame.TextRange
        tr.Text = f"第一段开头{mark}第二部分文字"
        tr.Font.Size = 28
        tr.Font.Name = "Microsoft YaHei"
    return p


def _patch_control_chars(path):
    import zipfile
    reps = {b"QQCR": b"&#13;", b"QQLF": b"&#10;", b"QQVT": b"_x000B_",
            b"QQBR": b"</a:t></a:r><a:br><a:rPr lang=\"zh-CN\" altLang=\"en-US\"/></a:br><a:r><a:rPr lang=\"zh-CN\" altLang=\"en-US\"/><a:t>"}
    tmp = path.with_suffix(".tmp")
    with zipfile.ZipFile(path) as zin, zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as zout:
        for item in zin.infolist():
            data = zin.read(item.filename)
            if item.filename.startswith("ppt/slides/slide"):
                for k, v in reps.items():
                    data = data.replace(k, v)
            zout.writestr(item, data)
    tmp.replace(path)


text_control_chars.patch = _patch_control_chars


def text_cr_paragraph(app):
    """a:t 里的回车 &#13; 是不是分段：段后间距、段前间距、项目符号、首行缩进各一个文本框，
    回车、换行符 &#10; 对照（文字之间夹控制字符，保存后改 XML）"""
    p = new_pres(app)
    s = blank(p)
    boxes = [("QQCR", "after"), ("QQLF", "after"), ("QQCR", "bullet"), ("QQCR", "before")]
    for i, (mark, kind) in enumerate(boxes):
        t = s.Shapes.AddTextbox(1, 40 + (i % 2) * 450, 30 + (i // 2) * 250, 420, 230)
        tr = t.TextFrame.TextRange
        tr.Text = f"第一段{mark}第二段文字较长一些会折行显示出来{mark}第三段"
        tr.Font.Size = 20
        tr.Font.Name = "Microsoft YaHei"
        pf = tr.ParagraphFormat
        if kind == "after":
            pf.SpaceAfter = 18
        elif kind == "before":
            pf.SpaceBefore = 18
        else:
            pf.Bullet.Visible = True
            pf.Bullet.Character = 8226
            t.TextFrame.Ruler.Levels(1).FirstMargin = 0
            t.TextFrame.Ruler.Levels(1).LeftMargin = 30
    return p


text_cr_paragraph.patch = _patch_control_chars


def placeholders_no_index(app):
    """编号是 4294967295（"没有编号"，老 .ppt 转换常见）的占位符继承谁：第 1 页"标题幻灯片"版式的标题（版式里居中、
    位置在页面中部，母版标题靠左、在顶部），第 2 页"标题和内容"版式的正文；保存后把这两个占位符的编号改成 4294967295。
    第 3 页同样的版式、编号不改（对照）"""
    p = new_pres(app)
    for layout_idx, texts in ((1, ["没有编号的标题 Title"]), (2, ["没有编号的正文", "第二段 Second"]), (1, ["对照标题 Control"])):
        s = p.Slides.AddSlide(p.Slides.Count + 1, p.SlideMaster.CustomLayouts(layout_idx))
        s.Shapes(1).TextFrame.TextRange.Text = texts[0]
        if layout_idx == 2:
            s.Shapes(2).TextFrame.TextRange.Text = "\r".join(texts)
    return p


def _patch_no_index(path):
    import re
    import zipfile
    tmp = path.with_suffix(".tmp")
    with zipfile.ZipFile(path) as zin, zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as zout:
        for item in zin.infolist():
            data = zin.read(item.filename)
            if item.filename == "ppt/slides/slide1.xml":
                data = re.sub(rb'<p:ph type="ctrTitle"/>', b'<p:ph type="ctrTitle" idx="4294967295"/>', data)
            elif item.filename == "ppt/slides/slide2.xml":
                data = re.sub(rb'<p:ph idx="1"/>', b'<p:ph idx="4294967295"/>', data)
                data = re.sub(rb'<p:ph type="title"/>', b'<p:ph type="title" idx="4294967295"/>', data)
            zout.writestr(item, data)
    tmp.replace(path)


placeholders_no_index.patch = _patch_no_index


def text_ambiguous_missing_ea(app):
    """宽度不定的标点（“”‘’——…）在中文字体缺失时用谁的字形和宽度：文字语言都是中文、西文 Arial，
    中文字体分别是：没有的字体（标了 GB2312 字符集）、没有的字体（没标字符集）、宋体、微软雅黑（对照）。保存后改 XML"""
    p = new_pres(app)
    s = blank(p)
    for k, ea in enumerate(["MissEaA", "MissEaB", "SimSun", "Microsoft YaHei"]):
        tb = s.Shapes.AddTextbox(1, 30, 30 + k * 120, 900, 100)
        tr = tb.TextFrame.TextRange
        tr.Text = "捐赠“爱心图书室”，每年“六一”‘带领’——学生…开展"
        tr.Font.Name = "Arial"
        tr.Font.NameFarEast = ea
        tr.Font.Size = 28
    return p


def _patch_ambiguous_missing(path):
    import re
    import zipfile
    tmp = path.with_suffix(".tmp")
    with zipfile.ZipFile(path) as zin, zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as zout:
        for item in zin.infolist():
            data = zin.read(item.filename)
            if item.filename == "ppt/slides/slide1.xml":
                x = data.decode("utf8")
                x = re.sub(r'(<a:rPr\b[^>]*?) lang="[^"]*"', r'\1 lang="zh-CN"', x)
                # COM 设的东亚字体名不一定写进去：按文本框顺序直接写 a:ea（没有就加在 a:latin 后面）
                eas = ['<a:ea typeface="不存在的中文字体甲" panose="02010600030101010101" charset="-122"/>', '<a:ea typeface="不存在的中文字体乙"/>',
                       '<a:ea typeface="宋体" panose="02010600030101010101" charset="-122"/>', '<a:ea typeface="微软雅黑" panose="020B0503020204020204" charset="-122"/>']
                parts = re.split(r'(<p:sp>)', x)
                k = -1
                for i, part in enumerate(parts):
                    if part == "<p:sp>":
                        k += 1
                        continue
                    if 0 <= k < len(eas):
                        part = re.sub(r'<a:ea [^>]*/>', "", part)
                        parts[i] = re.sub(r'(<a:latin [^>]*/>)', lambda m: m.group(1) + eas[k], part)
                data = "".join(parts).encode("utf8")
            zout.writestr(item, data)
    tmp.replace(path)


text_ambiguous_missing_ea.patch = _patch_ambiguous_missing


MISSING_PANOSE_FONTS = [
    ("Unppt Missing PanA", ' panose="020B0800000000000000" charset="-122"'),   # 样本里思源黑体写的 PANOSE
    ("Unppt Missing PanB", ' panose="020B0503020204020204" charset="-122"'),   # 微软雅黑的 PANOSE
    ("Unppt Missing PanC", ' panose="02010600030101010101" charset="-122"'),   # 宋体的 PANOSE
    ("Unppt Missing PanD", ' charset="-122"'),                                  # 没写 PANOSE（对照：以前实测用雅黑）
    ("Unppt Missing PanE", ' panose="020B0800000000000000"'),                   # 有 PANOSE、没写字符集
    ("Source Han Sans CN Regular", ' panose="020B0800000000000000" charset="-122"'),
]


MISSING_CJK_NAME_FONTS = [
    ("缺失测试黑体_GBK", ' panose="02000000000000000000" charset="-122"'),   # 中文名、PANOSE 只写了大类
    ("Unppt Missing PanZ", ' panose="02000000000000000000" charset="-122"'),  # 同样的 PANOSE、英文名
    ("缺失测试黑体", ' charset="-122"'),                                       # 中文名、没写 PANOSE
    ("缺失测试黑体", ''),                                                       # 中文名、什么都没写（同名共用字符集，见 SPEC：前面写过 -122）
    ("缺失测试宋体乙", ''),                                                     # 另一个中文名、什么都没写
    ("Unppt Missing PanY", ''),                                                # 英文名、什么都没写（对照）
]


def text_missing_cjk_name(app):
    """缺失字体的名字是中文时替代字体是什么（以前实测的缺失字体都是英文名，中文用雅黑）：同样的中文加数字，
    分别写不同的名字、PANOSE、字符集（保存后改 XML）"""
    p = new_pres(app)
    s = blank(p)
    for k in range(len(MISSING_CJK_NAME_FONTS)):
        tb = s.Shapes.AddTextbox(1, 30, 20 + k * 85, 900, 70)
        tr = tb.TextFrame.TextRange
        tr.Text = "1979年前，只有单一的中国人民银行 Bank"
        tr.Font.Size = 28
        tr.Font.Name = f"CjkMarker{k}"
    return p


def _patch_missing_cjk_name(path):
    import re
    import zipfile
    tmp = path.with_suffix(".tmp")
    with zipfile.ZipFile(path) as zin, zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as zout:
        for item in zin.infolist():
            data = zin.read(item.filename)
            if item.filename == "ppt/slides/slide1.xml":
                x = data.decode("utf8")
                x = re.sub(r'(<a:rPr\b[^>]*?) lang="[^"]*"', r'\1 lang="zh-CN"', x)
                for k, (name, attrs) in enumerate(MISSING_CJK_NAME_FONTS):
                    x = re.sub(rf'<a:(latin|ea|cs) typeface="CjkMarker{k}"[^>]*/>', lambda m: f'<a:{m.group(1)} typeface="{name}"{attrs}/>', x)
                    x = re.sub(rf'(<a:latin typeface="{name}"[^>]*/>)(?!<a:ea)', lambda m: m.group(1) + m.group(1).replace("<a:latin", "<a:ea"), x)
                data = x.encode("utf8")
            zout.writestr(item, data)
    tmp.replace(path)


text_missing_cjk_name.patch = _patch_missing_cjk_name


def text_missing_panose(app):
    """缺失字体按 PANOSE 选替代字体吗：同样的中文加数字，字体都是没有的，分别写不同的 PANOSE、字符集（保存后改 XML）。
    看 PowerPoint 用雅黑（无衬线）还是宋体（衬线）"""
    p = new_pres(app)
    s = blank(p)
    for k in range(len(MISSING_PANOSE_FONTS)):
        tb = s.Shapes.AddTextbox(1, 30, 20 + k * 85, 900, 70)
        tr = tb.TextFrame.TextRange
        tr.Text = "1979年前，只有单一的中国人民银行 Bank"
        tr.Font.Size = 28
        tr.Font.Name = f"PanMarker{k}"
    return p


def _patch_missing_panose(path):
    import re
    import zipfile
    tmp = path.with_suffix(".tmp")
    with zipfile.ZipFile(path) as zin, zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as zout:
        for item in zin.infolist():
            data = zin.read(item.filename)
            if item.filename == "ppt/slides/slide1.xml":
                x = data.decode("utf8")
                x = re.sub(r'(<a:rPr\b[^>]*?) lang="[^"]*"', r'\1 lang="zh-CN"', x)
                for k, (name, attrs) in enumerate(MISSING_PANOSE_FONTS):
                    x = re.sub(rf'<a:(latin|ea|cs) typeface="PanMarker{k}"[^>]*/>', lambda m: f'<a:{m.group(1)} typeface="{name}"{attrs}/>', x)
                    if f'<a:ea typeface="{name}"' not in x:
                        x = x.replace(f'<a:latin typeface="{name}"{attrs}/>', f'<a:latin typeface="{name}"{attrs}/><a:ea typeface="{name}"{attrs}/>')
                data = x.encode("utf8")
            zout.writestr(item, data)
    tmp.replace(path)


text_missing_panose.patch = _patch_missing_panose


def picture_3d_shadow(app):
    """透视旋转的图片带效果：外部阴影（大模糊）、调亮度、两者都有、都没有（对照）；看阴影是投影前画（跟着图片一起变形）
    还是投影后画（平铺在页面上）"""
    p = new_pres(app)
    s = blank(p)
    img = str((TESTCASES / "shapes-basic" / "slide-001.png").resolve())
    for i in range(4):
        x, y = 60 + (i % 2) * 450, 40 + (i // 2) * 250
        sh = s.Shapes.AddPicture(img, 0, -1, x, y, 340, 191)
        sh.ThreeD.SetPresetCamera(51)
        if i in (0, 2):
            sd = sh.Shadow
            sd.Visible = -1
            sd.OffsetX = 12
            sd.OffsetY = 12
            sd.Blur = 20
            sd.Transparency = 0.4
            sd.ForeColor.RGB = RGB(0, 0, 0)
        if i in (1, 2):
            sh.PictureFormat.Brightness = 0.7
    return p


def picture_bevel_border(app):
    """带边框的图片加三维棱台（正面朝前，没有转动）：边框 6 磅 × 无棱台 / 圆形棱台 2 磅宽 1.5 磅高 / 圆形棱台 8 磅宽 / 只有棱台没有边框；
    看边框是全画在图片外面（平面图片的规则）还是骑在边上，图片会不会内缩"""
    p = new_pres(app)
    s = blank(p)
    img = str((TESTCASES / "shapes-basic" / "slide-001.png").resolve())
    specs = [(6, None), (6, (2, 1.5)), (6, (8, 6)), (0, (8, 6))]
    for i, (lw, bevel) in enumerate(specs):
        x, y = 60 + (i % 2) * 450, 40 + (i // 2) * 250
        sh = s.Shapes.AddPicture(img, 0, -1, x, y, 340, 191)
        if lw:
            sh.Line.Visible = -1
            sh.Line.Weight = lw
            sh.Line.ForeColor.RGB = RGB(192, 0, 0)
        if bevel:
            sh.ThreeD.BevelTopType = 3          # msoBevelCircle
            sh.ThreeD.BevelTopInset, sh.ThreeD.BevelTopDepth = bevel
    return p


def text_outline_fakebold(app):
    """没有粗体字形的字体（宋体、楷体）标粗体又加文字轮廓：人工加粗和轮廓都要有；对照：不加轮廓、有粗体字形的微软雅黑加轮廓"""
    p = new_pres(app)
    s = blank(p)
    bg = s.Shapes.AddShape(1, 0, 0, 960, 540)
    bg.Fill.ForeColor.RGB = RGB(40, 60, 100)
    bg.Line.Visible = 0
    specs = [("SimSun", 1.0), ("KaiTi", 1.5), ("SimSun", 0), ("Microsoft YaHei", 1.0)]
    for k, (font, ow) in enumerate(specs):
        tb = s.Shapes.AddTextbox(1, 40, 30 + k * 120, 880, 100)
        tr = tb.TextFrame2.TextRange
        tr.Text = "粗体轮廓文字 Bold 123"
        tr.Font.Name = font
        tr.Font.NameFarEast = font
        tr.Font.Size = 48
        tr.Font.Bold = -1
        tr.Font.Fill.ForeColor.RGB = RGB(255, 192, 0)
        if ow:
            tr.Font.Line.Visible = -1
            tr.Font.Line.Weight = ow
            tr.Font.Line.ForeColor.RGB = RGB(255, 255, 255)
    return p


JUST_SPACE_ROWS = [
    ('lang="zh-CN" altLang="en-US"', "一二三四五六七八九十甲乙丙丁戊己庚辛壬癸子丑寅卯辰巳午未申酉", 310),
    ('lang="en-US" altLang="zh-CN"', "一二三四五六七八九十甲乙丙丁戊己庚辛壬癸子丑寅卯辰巳午未申酉", 310),
    ('lang="zh-CN" altLang="en-US"', "一二三 四五六七 八九十甲乙丙丁戊己庚辛壬癸子丑寅卯辰", 310),
    ('lang="zh-CN" altLang="en-US"', "一二三 四五六七 八九十甲乙丙丁戊己庚辛壬癸子丑寅卯辰", 300),
    ('lang="zh-CN" altLang="en-US"', "    一二三 四五六七 八九十甲乙丙丁戊己庚辛壬癸子丑寅卯辰", 300),
    ('lang="zh-CN" altLang="en-US"', "一二三四五六七八九十甲乙丙丁 AB CD EF GH IJ", 310),
]


def text_just_spaces(app):
    """两端对齐时多出的宽度分到哪里：没有空格的中文（zh-CN 拉开、en-US 不拉开）、夹两个空格（空格先补到半个字号，
    剩下的平均分）、行首空格（不拉开）、行尾空格前的最后一个字（不拉开）；20 磅雅黑（保存后改 XML）"""
    p = new_pres(app)
    s = p.Slides.Add(1, 12)
    for k, (_lang, _t, w) in enumerate(JUST_SPACE_ROWS):
        tb = s.Shapes.AddTextbox(1, 20 + (k % 2) * 470, 20 + (k // 2) * 170, w, 150)
        tb.TextFrame.MarginLeft = tb.TextFrame.MarginRight = 0
        tb.TextFrame.WordWrap = -1
        tb.Line.Visible = -1
        tb.Line.ForeColor.RGB = RGB(200, 200, 200)
        tb.TextFrame.TextRange.Text = f"JSMARK{k}"
    return p


def _patch_just_spaces(path):
    import re
    import zipfile
    tmp = path.with_suffix(".tmp")
    with zipfile.ZipFile(path) as zin, zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as zout:
        for item in zin.infolist():
            data = zin.read(item.filename)
            if item.filename == "ppt/slides/slide1.xml":
                xml = data.decode("utf8")
                for k, (lang, t, _w) in enumerate(JUST_SPACE_ROWS):
                    rpr = f'<a:rPr {lang} sz="2000"><a:latin typeface="微软雅黑"/><a:ea typeface="微软雅黑"/></a:rPr>'
                    xml = re.sub(rf"<a:p>(?:(?!</a:p>).)*?JSMARK{k}(?:(?!</a:p>).)*?</a:p>",
                                 lambda m, t=t, rpr=rpr: f'<a:p><a:pPr algn="just"/><a:r>{rpr}<a:t>{t}</a:t></a:r></a:p>', xml, count=1, flags=re.S)
                data = xml.encode("utf8")
            zout.writestr(item, data)
    tmp.replace(path)


text_just_spaces.patch = _patch_just_spaces


JUST_HANG_TEXTS = ["一二三四五六七八九十" + "甲乙丙丁戊己庚辛壬。", "一二三四五六七八九十" + "甲乙丙丁戊己庚辛壬癸。",
                   "一二三四五六七八九十" + "甲乙丙丁戊己。", "一二三四五六七八九十" + "甲乙丙丁戊己庚辛壬癸，" + "子丑寅卯辰巳午未申酉，戌亥"]


def text_just_hang(app):
    """两端对齐的段落，行尾标点悬挂在框外：段末行 10 字 + 句号悬挂（拉开）、9 字 + 句号放得下（不拉开）、段末行不满（不拉开）、
    中间行悬挂逗号；框宽正好放 10 个 24 磅雅黑汉字多一点（保存后改 XML）"""
    p = new_pres(app)
    s = p.Slides.Add(1, 12)
    for k in range(len(JUST_HANG_TEXTS)):
        tb = s.Shapes.AddTextbox(1, 20 + (k % 2) * 470, 20 + (k // 2) * 200, 245, 150)
        tb.TextFrame.MarginLeft = tb.TextFrame.MarginRight = 0
        tb.TextFrame.WordWrap = -1
        tb.Line.Visible = -1
        tb.Line.ForeColor.RGB = RGB(200, 200, 200)
        tb.TextFrame.TextRange.Text = f"JHMARK{k}"
    return p


def _patch_just_hang(path):
    import re
    import zipfile
    tmp = path.with_suffix(".tmp")
    with zipfile.ZipFile(path) as zin, zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as zout:
        for item in zin.infolist():
            data = zin.read(item.filename)
            if item.filename == "ppt/slides/slide1.xml":
                xml = data.decode("utf8")
                for k, t in enumerate(JUST_HANG_TEXTS):
                    rpr = '<a:rPr lang="zh-CN" altLang="en-US" sz="2400"><a:latin typeface="微软雅黑"/><a:ea typeface="微软雅黑"/></a:rPr>'
                    xml = re.sub(rf"<a:p>(?:(?!</a:p>).)*?JHMARK{k}(?:(?!</a:p>).)*?</a:p>",
                                 lambda m, t=t, rpr=rpr: f'<a:p><a:pPr algn="just" hangingPunct="1"/><a:r>{rpr}<a:t>{t}</a:t></a:r></a:p>', xml, count=1, flags=re.S)
                data = xml.encode("utf8")
            zout.writestr(item, data)
    tmp.replace(path)


text_just_hang.patch = _patch_just_hang


def charts_axis_ea_vert(app):
    """图表坐标轴文字东亚竖排（bodyPr vert="eaVert"，COM 设不了，保存后改 XML）：柱形图分类标签两字、四字、六字，
    条形图数值轴也竖排（对照：第 2 张图横排）"""
    p = new_pres(app, window=True)
    s = blank(p)
    rows = [['', '系列 1'], ['一月', 3], ['第二季度', 5], ['六个字的分类', 4], ['四', 2]]
    for k in range(2):
        ch = s.Shapes.AddChart2(-1, 51, 20 + k * 470, 40, 450, 440)
        _chart_values(ch, rows)
        _close_data(ch)
    return p


def _patch_axis_ea_vert(path):
    import re
    import zipfile
    tmp = path.with_suffix(".tmp")
    with zipfile.ZipFile(path) as zin, zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as zout:
        charts = sorted(n for n in zin.namelist() if re.match(r"ppt/charts/chart\d+\.xml$", n))
        for item in zin.infolist():
            data = zin.read(item.filename)
            # 只改第一张图的分类轴和数值轴
            if charts and item.filename == charts[0]:
                x = data.decode("utf-8")
                def vert(m):
                    ax = m.group(0)
                    if "<c:txPr>" in ax:
                        return re.sub(r"<a:bodyPr\b([^>]*?)(/?)>", lambda b: "<a:bodyPr" + re.sub(r'\s(rot|vert)="[^"]*"', "", b.group(1)) + ' rot="0" vert="eaVert"' + b.group(2) + ">", ax, count=1)
                    return ax.replace("<c:crossAx", '<c:txPr><a:bodyPr rot="0" vert="eaVert"/><a:lstStyle/><a:p><a:pPr><a:defRPr/></a:pPr><a:endParaRPr lang="zh-CN"/></a:p></c:txPr><c:crossAx', 1)
                x = re.sub(r"<c:(catAx|valAx)>.*?</c:\1>", vert, x, flags=re.S)
                data = x.encode("utf-8")
            zout.writestr(item, data)
    tmp.replace(path)


charts_axis_ea_vert.patch = _patch_axis_ea_vert


def charts_axis_ea_vert_latin(app):
    """分类标签东亚竖排（eaVert，保存后改 XML）里夹着西文、数字：汉字正立往下排，西文段顺时针转 90° 躺着排；
    第 2 张图同样的标签横排对照"""
    p = new_pres(app, window=True)
    s = blank(p)
    rows = [['', '系列 1'], ['2020年', 3], ['Q1季度', 5], ['ABC', 4], ['第3组', 2], ['iPhone用户', 6]]
    for k in range(2):
        ch = s.Shapes.AddChart2(-1, 51, 20 + k * 470, 40, 450, 440)
        _chart_values(ch, rows)
        _close_data(ch)
        ch.Chart.HasTitle = False
    return p


def _patch_axis_ea_vert_latin(path):
    import re
    import zipfile
    tmp = path.with_suffix(".tmp")
    with zipfile.ZipFile(path) as zin, zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as zout:
        charts = sorted(n for n in zin.namelist() if re.match(r"ppt/charts/chart\d+\.xml$", n))
        for item in zin.infolist():
            data = zin.read(item.filename)
            # 只改第一张图的分类轴
            if charts and item.filename == charts[0]:
                x = data.decode("utf-8")

                def vert(m):
                    ax = m.group(0)
                    if "<c:txPr>" in ax:
                        return re.sub(r"<a:bodyPr\b([^>]*?)(/?)>", lambda b: "<a:bodyPr" + re.sub(r'\s(rot|vert)="[^"]*"', "", b.group(1)) + ' rot="0" vert="eaVert"' + b.group(2) + ">", ax, count=1)
                    return ax.replace("<c:crossAx", '<c:txPr><a:bodyPr rot="0" vert="eaVert"/><a:lstStyle/><a:p><a:pPr><a:defRPr/></a:pPr><a:endParaRPr lang="zh-CN"/></a:p></c:txPr><c:crossAx', 1)
                x = re.sub(r"<c:catAx>.*?</c:catAx>", vert, x, flags=re.S)
                data = x.encode("utf-8")
            zout.writestr(item, data)
    tmp.replace(path)


charts_axis_ea_vert_latin.patch = _patch_axis_ea_vert_latin


def fills_tile_resample(app):
    """平铺图片填充缩放时怎么取样：31×31 的细斜纹（1 像素宽的线，白线和很暗的线两种），图片 DPI 分别是 150、96、72、48
    （缩到 0.64 倍、原大、放大 1.33 倍、2 倍）；第 2 页很暗的那种当背景（样本里深色纹理背景常见）"""
    from PIL import Image as PImage
    out = CACHE / "make-case"
    out.mkdir(parents=True, exist_ok=True)

    def tile(dpi, fg):
        im = PImage.new("RGB", (31, 31), (0, 0, 0))
        for y in range(31):
            for x in range(31):
                if (x + y) % 8 == 0 or (x - y) % 8 == 0:
                    im.putpixel((x, y), fg)
        f = out / f"tile-{dpi}-{fg[0]}.png"
        im.save(f, dpi=(dpi, dpi))
        return str(f.resolve())

    p = new_pres(app)
    s = blank(p)
    for i, dpi in enumerate([150, 96, 72, 48]):
        for j, fg in enumerate([(255, 255, 255), (17, 17, 17)]):
            sh = s.Shapes.AddShape(1, 30 + i * 230, 40 + j * 250, 210, 220)
            sh.Line.Visible = 0
            sh.Fill.UserTextured(tile(dpi, fg))
    s2 = blank(p)
    s2.FollowMasterBackground = 0
    s2.Background.Fill.UserTextured(tile(150, (17, 17, 17)))
    return p

# 多字符的项目符号（buChar char 写了几个字）：符号文字、字体
BUCHAR_MULTI = [("••", "Arial"), ("ab", "Arial"), ("→•", "Arial"), ("•", "Arial"), ("§§§", "Wingdings"),
                ("aa", "Arial"), ("•••", "Arial"), ("•a", "Arial"), ("a•", "Arial"), ("··", "Arial"), ("§a", "Wingdings"), ("••", "Wingdings")]


def text_buchar_multi(app):
    """项目符号写了多个字符（保存后改 XML，buChar char="••" 等）：PowerPoint 画几个；对照单个 •"""
    p = new_pres(app)
    s = p.Slides.Add(1, 12)
    for k in range(len(BUCHAR_MULTI)):
        tb = s.Shapes.AddTextbox(1, 10 + (k % 4) * 237, 20 + (k // 4) * 170, 230, 160)
        tb.TextFrame.WordWrap = -1
        tb.TextFrame.TextRange.Text = f"BUMARK{k}"
    return p


def _patch_buchar_multi(path):
    import re
    import zipfile
    from xml.sax.saxutils import quoteattr
    tmp = path.with_suffix(".tmp")
    with zipfile.ZipFile(path) as zin, zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as zout:
        for item in zin.infolist():
            data = zin.read(item.filename)
            if item.filename == "ppt/slides/slide1.xml":
                xml = data.decode("utf8")
                rpr = '<a:rPr lang="zh-CN" altLang="en-US" sz="2000"><a:latin typeface="微软雅黑"/><a:ea typeface="微软雅黑"/></a:rPr>'
                for k, (ch, font) in enumerate(BUCHAR_MULTI):
                    ppr = f'<a:pPr marL="342900" indent="-342900"><a:buFont typeface="{font}"/><a:buChar char={quoteattr(ch)}/></a:pPr>'
                    body = "".join(f"<a:p>{ppr}<a:r>{rpr}<a:t>{t}</a:t></a:r></a:p>" for t in ("项目符号测试文字", "Bullet two 二", "第三行比较长的文字会折行"))
                    xml = re.sub(rf"<a:p>(?:(?!</a:p>).)*?BUMARK{k}(?:(?!</a:p>).)*?</a:p>", lambda m, body=body: body, xml, count=1, flags=re.S)
                data = xml.encode("utf8")
            zout.writestr(item, data)
    tmp.replace(path)


text_buchar_multi.patch = _patch_buchar_multi

# 缺失字体的替代：Windows 的 FontSubstitutes 有的名字（Helvetica、Times……）和没有的（Helvetica Neue、楷体_GB2312……），对照装了的字体
FONT_SUBS = ["Helvetica", "Helvetica Neue", "Times", "Tms Rmn", "Helv", "Courier", "楷体_GB2312", "仿宋_GB2312", "KaiTi_GB2312",
             "FangSong_GB2312", "Arial", "Calibri", "楷体", "仿宋", "NoSuchFontXyz"]


def text_font_substitutes(app):
    """没装的字体按什么替代（保存后改 XML，西文和东亚字体都写同一个名字）：FontSubstitutes 里的 Helvetica、Times、楷体_GB2312 的英文名，
    不在里面的 Helvetica Neue、楷体_GB2312；对照 Arial、Calibri、楷体、仿宋和一个不存在的名字"""
    p = new_pres(app)
    s = p.Slides.Add(1, 12)
    for k in range(len(FONT_SUBS)):
        tb = s.Shapes.AddTextbox(1, 10 + (k % 3) * 315, 10 + (k // 3) * 105, 305, 95)
        tb.TextFrame.WordWrap = -1
        tb.TextFrame.TextRange.Text = f"FSMARK{k}"
    return p


def _patch_font_substitutes(path):
    import re
    import zipfile
    tmp = path.with_suffix(".tmp")
    with zipfile.ZipFile(path) as zin, zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as zout:
        for item in zin.infolist():
            data = zin.read(item.filename)
            if item.filename == "ppt/slides/slide1.xml":
                xml = data.decode("utf8")
                for k, f in enumerate(FONT_SUBS):
                    rpr = f'<a:rPr lang="zh-CN" altLang="en-US" sz="2000"><a:latin typeface="{f}"/><a:ea typeface="{f}"/></a:rPr>'
                    body = f"<a:p><a:r>{rpr}<a:t>汉字永和 ABCDabcd 0123 (WMQ)</a:t></a:r></a:p><a:p><a:r>{rpr}<a:t>Hamburgefonstiv 测试</a:t></a:r></a:p>"
                    xml = re.sub(rf"<a:p>(?:(?!</a:p>).)*?FSMARK{k}(?:(?!</a:p>).)*?</a:p>", lambda m, body=body: body, xml, count=1, flags=re.S)
                data = xml.encode("utf8")
            zout.writestr(item, data)
    tmp.replace(path)


text_font_substitutes.patch = _patch_font_substitutes


def charts_empty_series_name(app):
    """系列名的缓存是空的（strCache 只有 ptCount 没有 pt，保存后改 XML）：单系列柱形图的自动标题、图例；两个系列其中一个名字空"""
    import time
    p = new_pres(app, window=True)
    s = blank(p)
    for k, names in enumerate([["系列 1"], ["系列 1", "系列 2"]]):
        ch = s.Shapes.AddChart2(-1, 51, 20 + k * 470, 60, 450, 380)
        _chart_values(ch, [[""] + names] + [[c] + [(i * 5 + j * 3) % 9 + 2 for j in range(len(names))] for i, c in enumerate(["甲", "乙", "丙", "丁"])])
        _close_data(ch)
        time.sleep(1)
        ch.Chart.HasTitle = True
        ch.Chart.HasLegend = True
        ch.Chart.Legend.Position = -4107       # 底部
    return p


def _patch_empty_series_name(path):
    import re
    import zipfile
    tmp = path.with_suffix(".tmp")
    with zipfile.ZipFile(path) as zin, zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as zout:
        for item in zin.infolist():
            data = zin.read(item.filename)
            if re.match(r"ppt/charts/chart\d+\.xml$", item.filename):
                xml = data.decode("utf8")
                # 第一个系列的名字缓存清空；自动标题（c:title 里没有 c:tx）保持
                xml = re.sub(r"(<c:ser>(?:(?!</c:ser>).)*?<c:tx><c:strRef><c:f>[^<]*</c:f>)<c:strCache>(?:(?!</c:strCache>).)*</c:strCache>",
                             r'\1<c:strCache><c:ptCount val="1"/></c:strCache>', xml, count=1, flags=re.S)
                data = xml.encode("utf8")
            zout.writestr(item, data)
    tmp.replace(path)


charts_empty_series_name.patch = _patch_empty_series_name


def charts_cat_custom_rot(app):
    """分类轴标签设了自定义角度（TickLabels.Orientation 64° / -30° / 20°）：12 个分类的柱形图"""
    import time
    p = new_pres(app, window=True)
    s = blank(p)
    for k, deg in enumerate([64, -30, 20]):
        ch = s.Shapes.AddChart2(-1, 51, 10 + k * 315, 60, 300, 380)
        _chart_values(ch, [["", "系列 1"]] + [[f"分类{i + 1}", (i * 7) % 10 + 2] for i in range(12)])
        _close_data(ch)
        time.sleep(1)
        ch.Chart.HasTitle = False
        ch.Chart.HasLegend = False
        ch.Chart.Axes(1).TickLabels.Orientation = deg
    return p


# 东亚字体写成西文字体时汉字用什么补：衬线体、无衬线体、等宽各几种
EA_LATIN_FONTS = ["Times New Roman", "Georgia", "Cambria", "Courier New", "Verdana", "Calibri", "Arial", "Segoe UI", "Tahoma",
                  "Consolas", "Palatino Linotype", "Book Antiqua", "Century", "Comic Sans MS", "Garamond"]


def text_ea_latin_cjk(app):
    """东亚字体槽写的是西文字体（保存后改 XML，西文、东亚都写同一个名字，lang zh-CN）：汉字按宋体还是雅黑补"""
    p = new_pres(app)
    s = p.Slides.Add(1, 12)
    for k in range(len(EA_LATIN_FONTS)):
        tb = s.Shapes.AddTextbox(1, 10 + (k % 3) * 315, 10 + (k // 3) * 105, 305, 95)
        tb.TextFrame.WordWrap = -1
        tb.TextFrame.TextRange.Text = f"ELMARK{k}"
    return p


def _patch_ea_latin_cjk(path):
    import re
    import zipfile
    tmp = path.with_suffix(".tmp")
    with zipfile.ZipFile(path) as zin, zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as zout:
        for item in zin.infolist():
            data = zin.read(item.filename)
            if item.filename == "ppt/slides/slide1.xml":
                xml = data.decode("utf8")
                for k, f in enumerate(EA_LATIN_FONTS):
                    rpr = f'<a:rPr lang="zh-CN" altLang="en-US" sz="2000"><a:latin typeface="{f}"/><a:ea typeface="{f}"/></a:rPr>'
                    body = f"<a:p><a:r>{rpr}<a:t>汉字永和测试 ABC</a:t></a:r></a:p><a:p><a:r>{rpr}<a:t>国家园圆图书馆</a:t></a:r></a:p>"
                    xml = re.sub(rf"<a:p>(?:(?!</a:p>).)*?ELMARK{k}(?:(?!</a:p>).)*?</a:p>", lambda m, body=body: body, xml, count=1, flags=re.S)
                data = xml.encode("utf8")
            zout.writestr(item, data)
    tmp.replace(path)


text_ea_latin_cjk.patch = _patch_ea_latin_cjk


def placeholders_footer_base(app):
    """页码、页脚、日期占位符的基础样式（保存后改 XML）：母版里这三个占位符不写字号，母版 otherStyle 一级 40 磅，演示文稿默认样式一级 24 磅，
    母版正文样式一级保持默认；对照一个文本框（默认样式）和一个表格（otherStyle）"""
    p = new_pres(app)
    s = blank(p)
    hf = s.HeadersFooters
    hf.SlideNumber.Visible = -1
    hf.Footer.Visible = -1
    hf.Footer.Text = "页脚 Footer"
    hf.DateAndTime.Visible = -1
    hf.DateAndTime.UseFormat = 0
    hf.DateAndTime.Text = "日期 Date"
    textbox(s, 60, 60, 400, 60, "文本框 Textbox")
    t = s.Shapes.AddTable(1, 2, 520, 60, 380, 80).Table
    t.Cell(1, 1).Shape.TextFrame.TextRange.Text = "表格"
    t.Cell(1, 2).Shape.TextFrame.TextRange.Text = "Table"
    return p


def _patch_footer_base(path):
    import re
    import zipfile
    tmp = path.with_suffix(".tmp")
    with zipfile.ZipFile(path) as zin, zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as zout:
        for item in zin.infolist():
            data = zin.read(item.filename)
            if re.match(r"ppt/(slideMasters/slideMaster|slideLayouts/slideLayout|slides/slide)\d+\.xml$", item.filename):
                xml = data.decode("utf8")
                # 页码、页脚、日期占位符里写的字号都去掉
                xml = re.sub(r'<p:sp>(?:(?!</p:sp>).)*?<p:ph type="(?:dt|ftr|sldNum)"(?:(?!</p:sp>).)*</p:sp>',
                             lambda m: re.sub(r' sz="\d+"', "", m.group(0)), xml, flags=re.S)
                xml = re.sub(r"(<p:otherStyle>(?:(?!</p:otherStyle>).)*?<a:lvl1pPr(?:(?!</a:lvl1pPr>).)*?<a:defRPr)( sz=\"\d+\")?",
                             r'\1 sz="4000"', xml, count=1, flags=re.S)
                data = xml.encode("utf8")
            elif item.filename == "ppt/presentation.xml":
                xml = data.decode("utf8")
                xml = re.sub(r"(<p:defaultTextStyle>(?:(?!</p:defaultTextStyle>).)*?<a:lvl1pPr(?:(?!</a:lvl1pPr>).)*?<a:defRPr)( sz=\"\d+\")?",
                             r'\1 sz="2400"', xml, count=1, flags=re.S)
                data = xml.encode("utf8")
            zout.writestr(item, data)
    tmp.replace(path)


placeholders_footer_base.patch = _patch_footer_base


def table_no_style_other(app):
    """没有表格样式的表格（保存后删掉 tableStyleId，tblPr 留空）和母版 otherStyle：otherStyle 一级写了加粗、红色、28 磅，
    看表格文字用了其中哪些；对照一个用了中度样式 2 的表格"""
    p = new_pres(app)
    s = blank(p)
    for k in range(2):
        t = s.Shapes.AddTable(2, 2, 40 + k * 460, 80, 420, 160).Table
        for r in (1, 2):
            for c in (1, 2):
                t.Cell(r, c).Shape.TextFrame.TextRange.Text = f"单元格 {r}{c} Cell"
    return p


def _patch_no_style_other(path):
    import re
    import zipfile
    tmp = path.with_suffix(".tmp")
    with zipfile.ZipFile(path) as zin, zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as zout:
        for item in zin.infolist():
            data = zin.read(item.filename)
            if item.filename == "ppt/slides/slide1.xml":
                xml = data.decode("utf8")
                # 第一个表格：去掉样式和 firstRow / bandRow 标记
                xml = re.sub(r"<a:tblPr[^>]*>(?:(?!</a:tblPr>).)*</a:tblPr>", "<a:tblPr/>", xml, count=1, flags=re.S)
                data = xml.encode("utf8")
            elif item.filename == "ppt/slideMasters/slideMaster1.xml":
                xml = data.decode("utf8")
                xml = re.sub(r"(<p:otherStyle>(?:(?!</p:otherStyle>).)*?<a:lvl1pPr(?:(?!</a:lvl1pPr>).)*?)<a:defRPr[^>]*>(?:(?!</a:defRPr>).)*?<a:solidFill>(?:(?!</a:solidFill>).)*</a:solidFill>",
                             r'\1<a:defRPr sz="2800" b="1" kern="1200"><a:solidFill><a:srgbClr val="FF0000"/></a:solidFill>', xml, count=1, flags=re.S)
                data = xml.encode("utf8")
            zout.writestr(item, data)
    tmp.replace(path)


table_no_style_other.patch = _patch_no_style_other


def lines_thin_dash(app):
    """细虚线的段长按真实线宽还是取整后的线宽：0.5 / 0.75 / 1 磅 × dot、dash、sysDash、sysDot 的横线；
    一个 0.5 磅圆点虚线边框的表格"""
    p = new_pres(app)
    s = blank(p)
    dashes = [(3, "sysDot"), (4, "sysDash"), (2, "roundDot"), (7, "dash")]   # msoLineDash 常数：3 圆点、4 方点、2 sysDash?、7 长划
    for i, w in enumerate([0.5, 0.75, 1.0]):
        for j, (st, _) in enumerate(dashes):
            ln = s.Shapes.AddLine(30 + j * 230, 40 + i * 50, 230 + j * 230, 40 + i * 50)
            ln.Line.Weight = w
            ln.Line.DashStyle = st
            ln.Line.ForeColor.RGB = 0
    t = s.Shapes.AddTable(3, 4, 40, 220, 880, 240).Table
    for r in range(1, 4):
        for c in range(1, 5):
            cell = t.Cell(r, c)
            cell.Shape.TextFrame.TextRange.Text = ""
            for b in (1, 2, 3, 4):        # 上、左、下、右
                bd = cell.Borders(b)
                bd.Visible = -1
                bd.Weight = 0.5
                bd.ForeColor.RGB = 0
                bd.DashStyle = 3
            cell.Shape.Fill.Visible = 0
    return p


def text_super_spc(app):
    """上标、下标文字的字间距是否跟着缩到 0.67 倍（保存后改 XML）：36 磅"口 口 口"，空格写 spc −300 / +600，
    baseline 0 / 30000 / −25000 三行，看每行宽度"""
    p = new_pres(app)
    s = p.Slides.Add(1, 12)
    for k in range(6):
        tb = s.Shapes.AddTextbox(1, 20 + (k % 2) * 470, 20 + (k // 2) * 170, 450, 150)
        tb.TextFrame.WordWrap = 0
        tb.TextFrame.TextRange.Text = f"SSMARK{k}"
    return p


def _patch_super_spc(path):
    import re
    import zipfile
    tmp = path.with_suffix(".tmp")
    with zipfile.ZipFile(path) as zin, zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as zout:
        for item in zin.infolist():
            data = zin.read(item.filename)
            if item.filename == "ppt/slides/slide1.xml":
                xml = data.decode("utf8")
                for k in range(6):
                    spc = [-300, 600][k % 2]
                    base = [0, 30000, -25000][k // 2]
                    b = f' baseline="{base}"' if base else ""
                    r = lambda t, extra="": f'<a:r><a:rPr lang="zh-CN" sz="3600"{b}{extra}><a:latin typeface="微软雅黑"/><a:ea typeface="微软雅黑"/></a:rPr><a:t>{t}</a:t></a:r>'
                    body = "<a:p>" + "".join(r("口") + r(" ", f' spc="{spc}"') for _ in range(5)) + r("口") + "</a:p>"
                    xml = re.sub(rf"<a:p>(?:(?!</a:p>).)*?SSMARK{k}(?:(?!</a:p>).)*?</a:p>", lambda m, body=body: body, xml, count=1, flags=re.S)
                data = xml.encode("utf8")
            zout.writestr(item, data)
    tmp.replace(path)


text_super_spc.patch = _patch_super_spc


def text_pua_nosym(app):
    """私用区字符（U+F06C、U+F0A7、U+F0D8、U+E000）没有 a:sym、字体里也没有字形（保存后改 XML）：PowerPoint 画什么、占多宽；
    雅黑、Arial、宋体、Calibri 各一行，后面跟"文字"看起点"""
    p = new_pres(app)
    s = p.Slides.Add(1, 12)
    for k in range(4):
        tb = s.Shapes.AddTextbox(1, 20, 20 + k * 120, 900, 110)
        tb.TextFrame.WordWrap = 0
        tb.TextFrame.TextRange.Text = f"PUMARK{k}"
    return p


def _patch_pua_nosym(path):
    import re
    import zipfile
    tmp = path.with_suffix(".tmp")
    with zipfile.ZipFile(path) as zin, zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as zout:
        for item in zin.infolist():
            data = zin.read(item.filename)
            if item.filename == "ppt/slides/slide1.xml":
                xml = data.decode("utf8")
                for k, f in enumerate(["微软雅黑", "Arial", "宋体", "Calibri"]):
                    rpr = f'<a:rPr lang="zh-CN" altLang="en-US" sz="2800"><a:latin typeface="{f}"/><a:ea typeface="{f}"/></a:rPr>'
                    t = "".join(chr(c) + " 文字 " for c in (0xF06C, 0xF0A7, 0xF0D8, 0xE000))
                    body = f"<a:p><a:r>{rpr}<a:t>|{t}|</a:t></a:r></a:p>"
                    xml = re.sub(rf"<a:p>(?:(?!</a:p>).)*?PUMARK{k}(?:(?!</a:p>).)*?</a:p>", lambda m, body=body: body, xml, count=1, flags=re.S)
                data = xml.encode("utf8")
            zout.writestr(item, data)
    tmp.replace(path)


text_pua_nosym.patch = _patch_pua_nosym


# 竖排方式 × 两种内边距（左、上、右、下，EMU）
VERT_INSETS = ["eaVert", "vert", "vert270", "mongolianVert", "wordArtVert"]


def text_vert_insets(app):
    """竖排文字的内边距落在哪条边（保存后改 XML）：五种竖排方式，内边距 左 36 磅、上 18 磅、右 6 磅、下 0，带边框；
    每个框两段"竖排文字测试 AB12"，40 磅雅黑；第二行同样的框不写内边距（默认）"""
    p = new_pres(app)
    s = p.Slides.Add(1, 12)
    for k in range(10):
        tb = s.Shapes.AddTextbox(1, 20 + (k % 5) * 188, 20 + (k // 5) * 260, 170, 240)
        tb.TextFrame.WordWrap = -1
        tb.TextFrame.AutoSize = 0
        tb.Line.Visible = -1
        tb.Line.ForeColor.RGB = 0xA0A0A0
        tb.TextFrame.TextRange.Text = f"VIMARK{k}"
        tb.TextFrame.AutoSize = 0
        tb.Height = 240
    return p


def _patch_vert_insets(path):
    import re
    import zipfile
    tmp = path.with_suffix(".tmp")
    with zipfile.ZipFile(path) as zin, zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as zout:
        for item in zin.infolist():
            data = zin.read(item.filename)
            if item.filename == "ppt/slides/slide1.xml":
                xml = data.decode("utf8")
                sps = re.findall(r"<p:sp>.*?</p:sp>", xml, flags=re.S)
                for sp in sps:
                    m = re.search(r"VIMARK(\d+)", sp)
                    if not m:
                        continue
                    k = int(m.group(1))
                    ins = ' lIns="457200" tIns="228600" rIns="76200" bIns="0"' if k < 5 else ""
                    body = f'<a:bodyPr vert="{VERT_INSETS[k % 5]}" wrap="square"{ins} anchor="t"><a:noAutofit/></a:bodyPr>'
                    rpr = '<a:rPr lang="zh-CN" altLang="en-US" sz="2800"><a:latin typeface="微软雅黑"/><a:ea typeface="微软雅黑"/></a:rPr>'
                    new = re.sub(r"<a:bodyPr[^>]*/>|<a:bodyPr[^>]*>.*?</a:bodyPr>", lambda _: body, sp, count=1, flags=re.S)
                    new = re.sub(r"<a:p>.*</a:p>", lambda _: f"<a:p><a:r>{rpr}<a:t>竖排文字AB12</a:t></a:r></a:p>", new, count=1, flags=re.S)
                    xml = xml.replace(sp, new)
                data = xml.encode("utf8")
            zout.writestr(item, data)
    tmp.replace(path)


text_vert_insets.patch = _patch_vert_insets


def table_fontalgn_tall(app):
    """表格行高 × 字体对齐（保存后改 XML）：fontAlgn b / 不写 / t × 行距 150%，单元格两行字（换行符），10 磅、20 磅雅黑；
    行高设得很小，由文字撑开"""
    p = new_pres(app)
    s = blank(p)
    for k in range(6):
        t = s.Shapes.AddTable(3, 1, 20 + (k % 3) * 315, 20 + (k // 3) * 260, 290, 30).Table
        for r in (1, 2, 3):
            t.Rows(r).Height = 10
            t.Cell(r, 1).Shape.TextFrame.TextRange.Text = f"FAMARK{k}"
    return p


def _patch_fontalgn_tall(path):
    import re
    import zipfile
    tmp = path.with_suffix(".tmp")
    with zipfile.ZipFile(path) as zin, zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as zout:
        for item in zin.infolist():
            data = zin.read(item.filename)
            if item.filename == "ppt/slides/slide1.xml":
                xml = data.decode("utf8")
                for k in range(6):
                    fa = ["b", None, "t"][k % 3]
                    sz = [1000, 2000][k // 3]
                    ppr = f'<a:pPr{f" fontAlgn={chr(34)}{fa}{chr(34)}" if fa else ""}><a:lnSpc><a:spcPct val="150000"/></a:lnSpc></a:pPr>'
                    rpr = f'<a:rPr lang="zh-CN" altLang="en-US" sz="{sz}"><a:latin typeface="微软雅黑"/><a:ea typeface="微软雅黑"/></a:rPr>'
                    body = f"<a:p>{ppr}<a:r>{rpr}<a:t>表格文字第一行</a:t></a:r><a:br>{rpr}</a:br><a:r>{rpr}<a:t>第二行 Text</a:t></a:r></a:p>"
                    xml = re.sub(rf"<a:p>(?:(?!</a:p>).)*?FAMARK{k}(?:(?!</a:p>).)*?</a:p>", lambda m, body=body: body, xml, flags=re.S)
                data = xml.encode("utf8")
            zout.writestr(item, data)
    tmp.replace(path)


table_fontalgn_tall.patch = _patch_fontalgn_tall


def charts_dlbl_numfmt(app):
    """数据标签的数字格式：1 数值轴设成 "0.0"（不链接源）、标签默认；2 部分单元格格式 "0.00"、标签默认；3 标签设 "0%"；
    4 数值轴删掉（85、62、40、77，看刻度单位）；5 折线系列在次坐标轴上、次坐标轴删掉（看折线按哪个刻度画）"""
    import time
    p = new_pres(app, window=True)
    s = blank(p)
    vals = [85, 62.5, 40, 77]
    for k in range(5):
        ch = s.Shapes.AddChart2(-1, 51, 10 + (k % 3) * 315, 20 + (k // 3) * 260, 300, 240)
        rows = [["", "系列 1"] + (["系列 2"] if k == 4 else [])] + [[c, v] + ([0.3] if k == 4 else []) for c, v in zip(["甲", "乙", "丙", "丁"], vals)]
        _chart_values(ch, rows)
        if k == 1:
            ws = ch.Chart.ChartData.Workbook.Worksheets(1)
            ws.Cells(2, 2).NumberFormat = "0.00"
            ws.Cells(4, 2).NumberFormat = "0.00"
        _close_data(ch)
        time.sleep(1)
        c = ch.Chart
        c.HasTitle = False
        c.HasLegend = False
        if k < 3:
            c.SeriesCollection(1).HasDataLabels = True
        if k == 0:
            c.Axes(2).TickLabels.NumberFormat = "0.0"
        if k == 2:
            c.SeriesCollection(1).DataLabels().NumberFormat = "0%"
        if k == 3:
            c.Axes(2).Format.Line.Visible = True
        if k == 4:
            sr = c.SeriesCollection(2)
            sr.ChartType = 65
            sr.AxisGroup = 2
    return p


def _patch_dlbl_numfmt(path):
    """没有数据标签、只有一根数值轴的图删掉数值轴；有两根数值轴的删掉次坐标轴"""
    import re
    import zipfile
    tmp = path.with_suffix(".tmp")
    with zipfile.ZipFile(path) as zin, zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as zout:
        for item in zin.infolist():
            data = zin.read(item.filename)
            if re.match(r"ppt/charts/chart\d+\.xml$", item.filename):
                xml = data.decode("utf8")
                axes = re.findall(r"<c:valAx>.*?</c:valAx>", xml, flags=re.S)
                target = axes[1] if len(axes) == 2 else axes[0] if len(axes) == 1 and "<c:showVal val=\"1\"/>" not in xml else None
                if target:
                    xml = xml.replace(target, target.replace('<c:delete val="0"/>', '<c:delete val="1"/>', 1))
                data = xml.encode("utf8")
            zout.writestr(item, data)
    tmp.replace(path)


charts_dlbl_numfmt.patch = _patch_dlbl_numfmt


def charts_user_shapes(app):
    """图表里画的形状（保存后加 c:userShapes 和绘图部件，PowerPoint 的 COM 加不了）：相对锚点的文本框、半透明矩形、箭头线，
    绝对锚点的一个圆角矩形"""
    import time
    p = new_pres(app, window=True)
    s = blank(p)
    ch = s.Shapes.AddChart2(-1, 51, 60, 40, 600, 420)
    _close_data(ch)
    time.sleep(1)
    ch.Chart.HasTitle = False
    return p


_USER_SHAPES = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<c:userShapes xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:cdr="http://schemas.openxmlformats.org/drawingml/2006/chartDrawing">
<cdr:relSizeAnchor><cdr:from><cdr:x>0.05</cdr:x><cdr:y>0.02</cdr:y></cdr:from><cdr:to><cdr:x>0.35</cdr:x><cdr:y>0.10</cdr:y></cdr:to>
<cdr:sp macro="" textlink=""><cdr:nvSpPr><cdr:cNvPr id="2" name="TextBox 1"/><cdr:cNvSpPr txBox="1"/></cdr:nvSpPr><cdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></cdr:spPr>
<cdr:txBody><a:bodyPr wrap="square" rtlCol="0"/><a:lstStyle/><a:p><a:r><a:rPr lang="zh-CN" altLang="en-US" sz="1400"/><a:t>单位：万元</a:t></a:r></a:p></cdr:txBody></cdr:sp></cdr:relSizeAnchor>
<cdr:relSizeAnchor><cdr:from><cdr:x>0.5</cdr:x><cdr:y>0.2</cdr:y></cdr:from><cdr:to><cdr:x>0.75</cdr:x><cdr:y>0.7</cdr:y></cdr:to>
<cdr:sp macro="" textlink=""><cdr:nvSpPr><cdr:cNvPr id="3" name="Rect 2"/><cdr:cNvSpPr/></cdr:nvSpPr><cdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:solidFill><a:srgbClr val="F06060"><a:alpha val="40000"/></a:srgbClr></a:solidFill><a:ln><a:noFill/></a:ln></cdr:spPr></cdr:sp></cdr:relSizeAnchor>
<cdr:relSizeAnchor><cdr:from><cdr:x>0.75</cdr:x><cdr:y>0.15</cdr:y></cdr:from><cdr:to><cdr:x>0.87</cdr:x><cdr:y>0.35</cdr:y></cdr:to>
<cdr:cxnSp macro=""><cdr:nvCxnSpPr><cdr:cNvPr id="4" name="Arrow 3"/><cdr:cNvCxnSpPr/></cdr:nvCxnSpPr><cdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></a:xfrm><a:prstGeom prst="straightConnector1"><a:avLst/></a:prstGeom><a:ln w="31750"><a:solidFill><a:srgbClr val="C00000"/></a:solidFill><a:tailEnd type="triangle"/></a:ln></cdr:spPr></cdr:cxnSp></cdr:relSizeAnchor>
<cdr:absSizeAnchor><cdr:from><cdr:x>0.1</cdr:x><cdr:y>0.75</cdr:y></cdr:from><cdr:ext cx="1270000" cy="381000"/>
<cdr:sp macro="" textlink=""><cdr:nvSpPr><cdr:cNvPr id="5" name="RoundRect 4"/><cdr:cNvSpPr/></cdr:nvSpPr><cdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></a:xfrm><a:prstGeom prst="roundRect"><a:avLst/></a:prstGeom><a:solidFill><a:srgbClr val="70AD47"/></a:solidFill></cdr:spPr>
<cdr:txBody><a:bodyPr anchor="ctr"/><a:lstStyle/><a:p><a:pPr algn="ctr"/><a:r><a:rPr lang="zh-CN" altLang="en-US" sz="1200"><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill></a:rPr><a:t>标注</a:t></a:r></a:p></cdr:txBody></cdr:sp></cdr:absSizeAnchor>
</c:userShapes>"""


def _patch_user_shapes(path):
    import re
    import zipfile
    tmp = path.with_suffix(".tmp")
    with zipfile.ZipFile(path) as zin, zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as zout:
        for item in zin.infolist():
            data = zin.read(item.filename)
            if item.filename == "ppt/charts/chart1.xml":
                xml = data.decode("utf8")
                xml = xml.replace("</c:chartSpace>", '<c:userShapes r:id="rIdUS1"/></c:chartSpace>')
                data = xml.encode("utf8")
            elif item.filename == "ppt/charts/_rels/chart1.xml.rels":
                xml = data.decode("utf8")
                xml = xml.replace("</Relationships>", '<Relationship Id="rIdUS1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chartUserShapes" Target="../drawings/drawing1.xml"/></Relationships>')
                data = xml.encode("utf8")
            elif item.filename == "[Content_Types].xml":
                xml = data.decode("utf8")
                xml = xml.replace("</Types>", '<Override PartName="/ppt/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chartshapes+xml"/></Types>')
                data = xml.encode("utf8")
            zout.writestr(item, data)
        zout.writestr("ppt/drawings/drawing1.xml", _USER_SHAPES.encode("utf8"))
    tmp.replace(path)


charts_user_shapes.patch = _patch_user_shapes


def charts_dlbl_clamp(app):
    """拖开的数据标签移到图表外面（保存后改 manualLayout：第 1 个点 x −0.5、第 4 个点 x +0.5、第 2 个点 y −0.6）：
    PowerPoint 是不是把标签夹回图表里、画不画引导线；折线图和柱形图"""
    import time
    p = new_pres(app, window=True)
    s = blank(p)
    for k, kind in enumerate([65, 51]):
        ch = s.Shapes.AddChart2(-1, kind, 40 + k * 450, 80, 400, 300)
        _chart_values(ch, [["", "系列 1"]] + [[c, v] for c, v in zip(["甲", "乙", "丙", "丁"], [76.1, 60, 45, 70])])
        _close_data(ch)
        time.sleep(1)
        c = ch.Chart
        c.HasTitle = False
        c.HasLegend = False
        c.SeriesCollection(1).HasDataLabels = True
    return p


def _patch_dlbl_clamp(path):
    import re
    import zipfile
    tmp = path.with_suffix(".tmp")
    moves = {0: (-0.5, 0), 3: (0.5, 0), 1: (0, -0.6)}
    def dlbl(i, x, y):
        return (f'<c:dLbl><c:idx val="{i}"/><c:layout><c:manualLayout><c:x val="{x}"/><c:y val="{y}"/></c:manualLayout></c:layout>'
                '<c:showLegendKey val="0"/><c:showVal val="1"/><c:showCatName val="0"/><c:showSerName val="0"/><c:showPercent val="0"/><c:showBubbleSize val="0"/></c:dLbl>')
    with zipfile.ZipFile(path) as zin, zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as zout:
        for item in zin.infolist():
            data = zin.read(item.filename)
            if re.match(r"ppt/charts/chart\d+\.xml$", item.filename):
                xml = data.decode("utf8")
                xml = xml.replace("<c:dLbls>", "<c:dLbls>" + "".join(dlbl(i, x, y) for i, (x, y) in moves.items()), 1)
                data = xml.encode("utf8")
            zout.writestr(item, data)
    tmp.replace(path)


charts_dlbl_clamp.patch = _patch_dlbl_clamp


def charts_axis_no_sppr(app):
    """坐标轴没写 c:spPr（老版本 Office 做的图表常见，保存后删掉）：1 分类轴的删掉；2 分类轴、数值轴（轴线和网格线）都删掉；3 再把图表样式改成 c:style 6；
    看 PowerPoint 默认画不画轴线、刻度线，什么颜色、多粗"""
    import time
    p = new_pres(app, window=True)
    s = blank(p)
    for k in range(3):
        ch = s.Shapes.AddChart2(-1, 51, 10 + k * 315, 60, 300, 300)
        _close_data(ch)
        time.sleep(1)
        c = ch.Chart
        c.HasTitle = False
        c.HasLegend = False
        c.Axes(1).MajorTickMark = 3      # xlTickMarkOutside
        c.Axes(2).MajorTickMark = 3
    return p


def _patch_axis_no_sppr(path):
    import re
    import zipfile
    tmp = path.with_suffix(".tmp")
    with zipfile.ZipFile(path) as zin, zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as zout:
        for item in zin.infolist():
            data = zin.read(item.filename)
            mm = re.match(r"ppt/charts/chart(\d+)\.xml$", item.filename)
            if mm:
                n = int(mm.group(1))
                xml = data.decode("utf8")
                def strip(tag, x):
                    return re.sub(rf"(<c:{tag}>(?:(?!</c:{tag}>).)*?)<c:spPr>(?:(?!</c:spPr>).)*?</c:spPr>", r"\1", x, count=1, flags=re.S)
                xml = strip("catAx", xml)
                if n >= 2:
                    # 数值轴：网格线的和轴线自己的 c:spPr 都删掉
                    xml = re.sub(r"(<c:majorGridlines>)<c:spPr>(?:(?!</c:spPr>).)*?</c:spPr>", r"\1", xml, count=1, flags=re.S)
                    xml = re.sub(r'(<c:valAx>(?:(?!</c:valAx>).)*?<c:tickLblPos val="[^"]*"/>)<c:spPr>(?:(?!</c:spPr>).)*?</c:spPr>', r"\1", xml, count=1, flags=re.S)
                if n == 3:
                    xml = re.sub(r'<c:style val="\d+"/>', '<c:style val="6"/>', xml)
                    xml = re.sub(r"<mc:AlternateContent(?:(?!</mc:AlternateContent>).)*c14:style(?:(?!</mc:AlternateContent>).)*</mc:AlternateContent>", '<c:style val="6"/>', xml, count=1, flags=re.S)
                data = xml.encode("utf8")
            zout.writestr(item, data)
    tmp.replace(path)


charts_axis_no_sppr.patch = _patch_axis_no_sppr


# 老式图表样式编号（c:style）：轴线、网格线没写 c:spPr 时的默认颜色随样式变
AXIS_STYLE_IDS = [1, 2, 3, 6, 9, 17, 25, 33, 41, 42, 45, 48]


def charts_axis_style_defaults(app):
    """12 个小柱形图分别设成 c:style 1/2/3/6/9/17/25/33/41/42/45/48，分类轴、网格线的 c:spPr 删掉（保存后改 XML）"""
    import time
    p = new_pres(app, window=True)
    s = blank(p)
    for k in range(len(AXIS_STYLE_IDS)):
        ch = s.Shapes.AddChart2(-1, 51, 5 + (k % 4) * 238, 5 + (k // 4) * 178, 230, 170)
        _close_data(ch)
        time.sleep(1)
        c = ch.Chart
        c.HasTitle = False
        c.HasLegend = False
        c.Axes(1).MajorTickMark = 3
    return p


def _patch_axis_style_defaults(path):
    import re
    import zipfile
    tmp = path.with_suffix(".tmp")
    with zipfile.ZipFile(path) as zin, zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as zout:
        for item in zin.infolist():
            data = zin.read(item.filename)
            mm = re.match(r"ppt/charts/chart(\d+)\.xml$", item.filename)
            if mm:
                n = int(mm.group(1))
                xml = data.decode("utf8")
                xml = re.sub(r"(<c:catAx>(?:(?!</c:catAx>).)*?)<c:spPr>(?:(?!</c:spPr>).)*?</c:spPr>", r"\1", xml, count=1, flags=re.S)
                xml = re.sub(r"(<c:majorGridlines>)<c:spPr>(?:(?!</c:spPr>).)*?</c:spPr>", r"\1", xml, count=1, flags=re.S)
                st = AXIS_STYLE_IDS[(n - 1) % len(AXIS_STYLE_IDS)]
                xml = re.sub(r"<mc:AlternateContent(?:(?!</mc:AlternateContent>).)*c14:style(?:(?!</mc:AlternateContent>).)*</mc:AlternateContent>", f'<c:style val="{st}"/>', xml, count=1, flags=re.S)
                xml = re.sub(r'<c:style val="\d+"/>', f'<c:style val="{st}"/>', xml)
                data = xml.encode("utf8")
            zout.writestr(item, data)
    tmp.replace(path)


charts_axis_style_defaults.patch = _patch_axis_style_defaults


def table_anchor_ctr(app):
    """表格单元格"水平居中"（tcPr anchorCtr="1"，单元格的 TextFrame2.HorizontalAnchor）：和文本框一样，整块文字（最宽一行）在单元格里居中、
    各段的对齐在块里——左对齐的一行短字、长短不一的两段、放不下折行的一段、右对齐；上面一张不居中对照。16 磅微软雅黑"""
    p = new_pres(app)
    s = blank(p)
    texts = ["短文字", "第一段" + chr(13) + "第二段长一点", "左对齐放不下一行的文字会折行", "右对齐"]
    for k in range(2):
        sh = s.Shapes.AddTable(2, 4, 40, 40 + k * 230, 880, 160)
        sh.Name = f"TAC{k}"
        t = sh.Table
        for r in (1, 2):
            for c in range(1, 5):
                cell = t.Cell(r, c)
                tf = cell.Shape.TextFrame
                tf.TextRange.Text = texts[c - 1]
                tf.TextRange.Font.Size = 16
                tf.TextRange.Font.Name = "Microsoft YaHei"
                tf.TextRange.Font.NameFarEast = "Microsoft YaHei"
                tf.TextRange.ParagraphFormat.Alignment = 3 if c == 4 else 1
                tf.VerticalAnchor = 3
                if k == 1:
                    cell.Shape.TextFrame2.HorizontalAnchor = 2      # msoAnchorCenter
    return p


def text_noto_weights(app):
    """本机装的可变字体 Noto Sans SC / Noto Serif SC（Windows 自带的 VF，默认实例是 Thin / ExtraLight）：常规、粗体各一行，
    18 / 32 / 54 磅，中文、字母、数字混排；下面两个窄框放会折行的英文段落（字母字宽不对时折行位置会变）；
    最后一行 Noto Sans SC Light（命名实例单独成一个字体名）。PowerPoint 常规用 Regular 实例、粗体用 Bold 实例（COM 实测）"""
    p = new_pres(app)
    s = blank(p)
    rows = [("Noto Sans SC", 0, 18), ("Noto Sans SC", 1, 18), ("Noto Serif SC", 0, 18), ("Noto Serif SC", 1, 18),
            ("Noto Sans SC", 0, 32), ("Noto Sans SC", 1, 32), ("Noto Serif SC", 0, 32), ("Noto Serif SC", 1, 32)]
    ys = [10, 10, 44, 44, 90, 90, 150, 150]
    for k, (font, b, size) in enumerate(rows):
        tb = s.Shapes.AddTextbox(1, 20 + (k % 2) * 470, ys[k], 460, 40)
        tf = tb.TextFrame
        tf.WordWrap = 0
        tr = tf.TextRange
        tr.Text = "字重测试 Weight 2468"
        tr.Font.Name = font
        tr.Font.NameFarEast = font
        tr.Font.Size = size
        tr.Font.Bold = -1 if b else 0
    for k, (font, b) in enumerate([("Noto Sans SC", 0), ("Noto Sans SC", 1), ("Noto Serif SC", 0), ("Noto Serif SC", 1)]):
        tb = s.Shapes.AddTextbox(1, 20 + k * 235, 250, 225, 200)
        tf = tb.TextFrame
        tf.WordWrap = -1
        tr = tf.TextRange
        tr.Text = EN
        tr.Font.Name = font
        tr.Font.NameFarEast = font
        tr.Font.Size = 16
        tr.Font.Bold = -1 if b else 0
    for k, (font, b) in enumerate([("Noto Sans SC", 1), ("Noto Sans SC Light", 0)]):
        tb = s.Shapes.AddTextbox(1, 20 + k * 470, 455, 460, 70)
        tf = tb.TextFrame
        tf.WordWrap = 0
        tr = tf.TextRange
        tr.Text = "粗细 Ag 90"
        tr.Font.Name = font
        tr.Font.NameFarEast = font
        tr.Font.Size = 54 if k == 0 else 40
        tr.Font.Bold = -1 if b else 0
    return p


# ---------------------------------------------------------------- 缩进和水平居中（保存后整段重写 txBody）

def _para_xml(algn="l", marL=0, marR=0, indent=0, runs=(("", 0),), size=14, bold=False, bu=False):
    """一段：缩进是 EMU，runs 是 (文字, 字间距 1/100 磅)，项目符号是 Arial 圆点，微软雅黑"""
    attrs = f' marL="{marL}" marR="{marR}" indent="{indent}" algn="{algn}"'
    bux = '<a:buFont typeface="Arial"/><a:buChar char="&#8226;"/>' if bu else "<a:buNone/>"
    rattr = f' lang="zh-CN" altLang="en-US" sz="{size * 100}"' + (' b="1"' if bold else "")
    font = '<a:latin typeface="Microsoft YaHei"/><a:ea typeface="Microsoft YaHei"/>'
    spcs = [f' spc="{spc}"' if spc else "" for _t, spc in runs]
    rx = "".join(f"<a:r><a:rPr{rattr}{sp}>{font}</a:rPr><a:t>{t}</a:t></a:r>" for (t, _), sp in zip(runs, spcs))
    return f"<a:p><a:pPr{attrs}>{bux}</a:pPr>{rx}<a:endParaRPr{rattr}/></a:p>"


def _patch_txbodies(path, bodies, cells=None, widths=None):
    """把记号文字所在形状的 txBody 换成 bodies[记号]、表格单元格 <a:tc> 换成 cells[记号]；widths[记号] 改形状宽度（EMU）"""
    import re
    import zipfile
    tmp = path.with_suffix(".tmp")
    with zipfile.ZipFile(path) as zin, zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as zout:
        for item in zin.infolist():
            data = zin.read(item.filename)
            if re.match(r"ppt/slides/slide\d+\.xml$", item.filename):
                xml = data.decode("utf8")
                for mark, body in bodies.items():
                    if mark not in xml:
                        continue
                    if widths and mark in widths:
                        xml = re.sub(r'(<p:sp>(?:(?!</p:sp>).)*?<a:ext cx=")\d+("(?:(?!</p:sp>).)*?' + mark + ")",
                                     lambda m: m.group(1) + str(widths[mark]) + m.group(2), xml, count=1, flags=re.S)
                    xml = re.sub(r"<p:txBody>(?:(?!</p:txBody>).)*?" + mark + r".*?</p:txBody>", lambda m: body, xml, count=1, flags=re.S)
                for mark, tc in (cells or {}).items():
                    xml = re.sub(r"<a:tc>(?:(?!</a:tc>).)*?" + mark + r".*?</a:tc>", lambda m: tc, xml, count=1, flags=re.S)
                data = xml.encode("utf8")
            zout.writestr(item, data)
    tmp.replace(path)


PT = 12700
TEN = "一二三四五六七八九十"
S5, S8, LONG_CN = TEN[:5], TEN[:8], TEN * 4
# 水平居中的文本框：每个框若干段 (对齐, 左缩进, 右缩进, 首行缩进（磅）, 文字)
ANCHOR_CTR_INDENT = [
    [("ctr", 0, 30, 0, S5)],
    [("ctr", 20, 40, 0, S5)],
    [("l", 20, 40, 0, S5)],
    [("r", 20, 40, 0, S5)],
    [("ctr", 0, 40, 0, S5), ("l", 10, 0, 0, S8)],
    [("l", 30, 10, 0, S8), ("r", 0, 50, 0, S5)],
    [("l", 30, 0, -30, LONG_CN), ("ctr", 0, 60, 0, S5)],
    [("ctr", 20, 40, 0, LONG_CN)],
]
# 水平居中的表格单元格：每行四个单元格的段落，各列右缩进不同
ANCHOR_CTR_CELLS = [
    [[("ctr", 0, 0, 0, S5)], [("ctr", 0, 10, 0, S5)], [("ctr", 0, 20, 0, S5)], [("ctr", 0, 30, 0, S5)]],
    [[("ctr", 0, 0, 0, S5), ("l", 10, 0, 0, S8)], [("ctr", 0, 10, 0, TEN[:3]), ("l", 0, 0, 0, S8)], [("l", 20, 20, 0, S5)], [("r", 0, 30, 0, S5), ("r", 15, 0, 0, TEN[:3])]],
    [[("ctr", 10, 25, 0, LONG_CN[:20])], [("ctr", 0, 10, 0, LONG_CN[:18])], [("l", 15, 15, 0, LONG_CN[:20])], [("ctr", 0, 30, 0, S8)]],
]


def _paras(ps, size):
    return "".join(_para_xml(a, mL * PT, mR * PT, ind * PT, ((t, 0),), size) for a, mL, mR, ind, t in ps)


def text_anchor_ctr_indent(app):
    """水平居中（anchorCtr）+ 段落左右缩进：第 1 页文本框（左 / 中 / 右对齐、各段缩进不同的一段和几段、悬挂缩进、折行），第 2 页表格
    单元格（上面一张单元格水平居中、各列右缩进 0/10/20/30 磅，下面一张不居中对照）。PowerPoint 先照常排每一行，再把所有行占的范围
    （行首让出缩进起点、行尾加上右缩进）居中。14 磅微软雅黑（保存后改 XML）"""
    p = new_pres(app)
    s = blank(p)
    for k in range(len(ANCHOR_CTR_INDENT)):
        tb = s.Shapes.AddTextbox(1, 15 + (k % 4) * 236, 20 + (k // 4) * 260, 220, 230)
        tb.TextFrame.WordWrap = -1
        tb.TextFrame.AutoSize = 0
        tb.TextFrame.TextRange.Text = f"ACINDK{k}Q"
        tb.Line.Visible = -1
        tb.Line.ForeColor.RGB = RGB(200, 200, 200)
    s = blank(p)
    for t in range(2):
        sh = s.Shapes.AddTable(3, 4, 30, 20 + t * 260, 900, 220)
        for r in range(3):
            for c in range(4):
                sh.Table.Cell(r + 1, c + 1).Shape.TextFrame.TextRange.Text = f"ACTCK{t}{r}{c}Q"
    return p


def _patch_anchor_ctr_indent(path):
    bodies = {f"ACINDK{k}Q": '<p:txBody><a:bodyPr wrap="square" rtlCol="0" anchorCtr="1"><a:noAutofit/></a:bodyPr><a:lstStyle/>'
              + _paras(ps, 14) + "</p:txBody>" for k, ps in enumerate(ANCHOR_CTR_INDENT)}
    cells = {}
    for t in range(2):
        for r, row in enumerate(ANCHOR_CTR_CELLS):
            for c, ps in enumerate(row):
                ctr = ' anchorCtr="1"' if t == 0 else ""
                cells[f"ACTCK{t}{r}{c}Q"] = f'<a:tc><a:txBody><a:bodyPr/><a:lstStyle/>{_paras(ps, 14)}</a:txBody><a:tcPr anchor="ctr"{ctr}/></a:tc>'
    _patch_txbodies(path, bodies, cells)


text_anchor_ctr_indent.patch = _patch_anchor_ctr_indent

# 缩进取整、行尾取整：每个框 (记号, x, y, 宽（EMU）, 高, 左右内边距（EMU）, 段落 XML)。框宽按实测的规则算到第一行"刚好放得下"：
# 起点、右缩进按 1/20 磅取整，起点 + 行宽 + 右缩进向上取整到 1/8 磅后不超过内容区
INDENT_ROUND = [
    # 悬挂缩进 25.95 / -25 磅带项目符号，20 磅，前两个字字间距 0.02 磅：一行 20 个字 400.04 磅，25.95 + 400.04 取整 426，内容区 426.08
    ("IRNDK0Q", 10, 10, 5411216, 110, 0, _para_xml("l", 329565, 0, -317500, ((TEN[:2], 2), (TEN[2:] + TEN * 3, 0)), 20, bu=True)),
    # 悬挂缩进 19.49 / -9.46 磅带项目符号，11 磅：正文从 19.5 磅排，一行 23 个字 253 磅，内容区 272.55
    ("IRNDK1Q", 450, 10, 3644265, 110, 91440, _para_xml("l", 247547, 0, -120079, ((TEN * 5, 0),), 11, bu=True)),
    # 左缩进 0、首行缩进 -29.87 磅带项目符号，16 磅粗体两端对齐：后面的行从 0 排，一行 20 个字 320 磅，内容区 320.05
    ("IRNDK2Q", 10, 150, 4247515, 170, 91440, _para_xml("just", 0, 0, -379297, ((TEN * 5, 0),), 16, bold=True, bu=True)),
    # 左缩进 16.8 磅，14 磅、字间距 0.01 磅：一行 15 个字 210.15 磅，16.8 + 210.15 取整 227，内容区 227.02
    ("IRNDK3Q", 380, 150, 2883154, 80, 0, _para_xml("l", 213360, 0, 0, ((TEN * 3, 1),), 14)),
    # 右缩进 16.8 磅，同上
    ("IRNDK4Q", 640, 150, 2883154, 80, 0, _para_xml("l", 0, 213360, 0, ((TEN * 3, 1),), 14)),
]


def text_indent_round(app):
    """段落缩进的取整和行尾取整（保存后改 XML）：缩进先四舍五入到 1/20 磅（首行起点、首行缩进各自取整，左缩进是两者之差），
    断行时起点 + 行宽 + 右缩进向上取整到 1/8 磅后不超过内容区才放得下。五个文本框和一个表格单元格的第一行都"刚好放得下"：
    悬挂缩进 25.95 / -25 磅、19.49 / -9.46 磅带项目符号，左缩进 0 + 首行缩进 -29.87 磅，左缩进 16.8 磅 + 字间距，右缩进 16.8 磅 + 字间距；
    表格单元格左缩进 39.65、右缩进 66.55 磅，列宽 256.27 磅、边距 0，10 磅 15 个字"""
    p = new_pres(app)
    s = blank(p)
    for mark, x, y, w, h, _ins, _para in INDENT_ROUND:
        tb = s.Shapes.AddTextbox(1, x, y, w / PT, h)
        tb.TextFrame.WordWrap = -1
        tb.TextFrame.AutoSize = 0
        tb.TextFrame.TextRange.Text = mark
        tb.Line.Visible = -1
        tb.Line.ForeColor.RGB = RGB(200, 200, 200)
    sh = s.Shapes.AddTable(2, 1, 10, 360, 256.27, 80)
    sh.Table.Columns(1).Width = 256.27
    sh.Table.Cell(1, 1).Shape.TextFrame.TextRange.Text = "IRNDCELL0Q"
    sh.Table.Cell(2, 1).Shape.TextFrame.TextRange.Text = "IRNDCELL1Q"
    return p


def _patch_indent_round(path):
    bodies, widths = {}, {}
    for mark, _x, _y, w, _h, ins, para in INDENT_ROUND:
        bodies[mark] = f'<p:txBody><a:bodyPr wrap="square" lIns="{ins}" rIns="{ins}" rtlCol="0"><a:noAutofit/></a:bodyPr><a:lstStyle/>{para}</p:txBody>'
        widths[mark] = w
    cell = '<a:tc><a:txBody><a:bodyPr/><a:lstStyle/>{}</a:txBody><a:tcPr marL="0" marR="0"/></a:tc>'
    cells = {"IRNDCELL0Q": cell.format(_para_xml("l", 503555, 845185, 0, ((TEN * 3, 0),), 10)),
             "IRNDCELL1Q": cell.format(_para_xml("l", 0, 0, 0, ((TEN, 0),), 10))}
    _patch_txbodies(path, bodies, cells, widths)


text_indent_round.patch = _patch_indent_round


CASES = [shapes_all, text_sizes, text_align, text_spacing, text_bullets, text_missing_font, shapes_basic, fills_lines, table_basic, group_rotate, anim_basic, anim_auto, charts_basic, pictures, smartart, text_effects, text_layout, table_merge, links, emf_images, anim_advanced, charts_labels, freeform_icons, media_audio, anim_trigger, wmf_images, anim_iterate, picture_transparent, charts_more, shape_effects, equations, anim_path, anim_emphasis, transitions, fills_patterns, text_decoration, anim_entrance, svg_images, charts_markers, hidden_slides, media_background, text_glow_reflection, text_tabs, text_picture_bullets, fills_texture, transition_morph, text_embedded_fonts, text_warp, anim_repeat, charts_sizes, slide_timings, lines_compound, table_diagonal, lines_gradient, fills_radial, fills_rect_gradient, shapes_3d, table_vertical, transitions_more, anim_sound, anim_build, anim_after, anim_text_emphasis, charts_bubble, media_video, charts_options, charts_negative, shapes_bevel, charts_legend, shapes_3d_rotation, smartart_3d, charts_ofpie, charts_3d, anim_group_emphasis, activex_controls, charts_extras, charts_axis_titles, charts_fills, charts_outlines, charts_labels_more, group_scale, group_flip, charts_3d_line, charts_legend_pos, charts_crowded_labels, charts_label_skip, charts_bar_long_names, charts_multilevel, picture_recolor, text_symbols, text_numbering, lines_arrows, table_styles, shapes_styles, charts_styles, placeholders_inherit, text_bold_light, ole_objects, text_hanging_punct, speaker_notes, pictures_tiff, placeholders_picture, pictures_exif, text_picture_fill, pictures_mislabeled, emf_alphablend, placeholders_orphan, picture_fill_rect, slide_number_fields, table_builtin_styles, smartart_matrix, text_layout_unit, colors_gamma, text_latin_cjk_font, text_default_style, text_missing_font_jp, text_ea_line_break, text_ambiguous_punct, text_charset_slides, table_rowspan_tall, text_autofit_round, shapes_3d_contour, emf_clip_modes, placeholders_picture_geom, emf_gradient_fill, text_theme_font_lang, text_anchor_linespacing, table_linespacing, table_fontalgn, text_theme_font_latin, text_margin_right, text_charset_gap, slide_size_repair, fills_shape_gradient, text_shadow_runs, picture_3d_shadow, charts_axis_ea_vert, fills_tile_resample, text_shadow_dist, text_shadow_size, text_shadow_scale, text_shadow_blur, text_glow_scale, text_reflection_dist, shapes_bg_fill, text_control_chars, placeholders_no_index, text_ambiguous_missing_ea, text_missing_panose, emf_bitmap_src, fills_group, fills_rot_with_shape, fills_rot_cut, charts_pct_stacked, picture_bg_fill, charts_legend_manual, charts_long_cats, charts_cat_vertical, charts_cat_rot_len, charts_cat_rot_short, charts_cat_rot_threshold, charts_pie_label_sep, text_slash_break, smartart_colors, text_fontref_ph, text_hanging_unset, table_default_bold, text_missing_cjk_name, text_fakebold_width, text_br_empty_line, text_ea_lang, slide_number_bare_field, text_neg_indent, text_mix_wrap_lines, text_theme_ea_altlang, charts_inner_titles, charts_line_dash, charts_rich_title, text_ea_slot_symbols, charts_date_extra_vals, shape_shadow_nofill_text, text_fontalgn, charts_legend_overflow, group_effects, charts_point_labels, picture_bevel_border, text_outline_fakebold, text_just_hang, text_just_spaces, charts_axis_ea_vert_latin, charts_title_moved, charts_dtable_fonts, charts_pie_manual_labels, charts_axis_title_moved, charts_pie_bestfit, charts_dtable_wrap, charts_axis_min_offset, text_bullet_pos_indent, text_spcpts_round, charts_na_values, lines_dash_caps, text_anchor_ctr, custgeom_no_wh, text_link_kinds, fills_blip_no_mode, text_buchar_multi, text_font_substitutes, charts_empty_series_name, charts_cat_custom_rot, text_ea_latin_cjk, placeholders_footer_base, table_no_style_other, lines_thin_dash, text_super_spc, text_pua_nosym, text_vert_insets, table_fontalgn_tall, charts_dlbl_numfmt, charts_user_shapes, charts_dlbl_clamp, charts_axis_no_sppr, charts_axis_style_defaults, text_cr_paragraph, charts_pie_label_pos, text_autonum_symbol_font, text_kern_zero, charts_legend_truncate, table_latin_rows, text_latin_break, charts_legend_bottom_wrap, charts_dtable_manual, fonts_showcase, table_anchor_ctr, text_noto_weights, equations_rot_flip, text_anchor_ctr_indent, text_indent_round]


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
