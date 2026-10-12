"""生成超大测试文件（不进仓库）：几百页 + 一个超大视频，用来验证"大文件、小内存"转码。

用法：python tools/make-case/make_big.py [页数=300] [视频 MB=800]
输出：.cache/big/big.pptx
"""
from __future__ import annotations

import os
import sys
import zipfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from common import CACHE, TESTCASES  # noqa: E402

import pythoncom  # noqa: E402
import win32com.client  # noqa: E402

OUT = CACHE / "big"


def make_base(pages: int) -> Path:
    pythoncom.CoInitialize()
    app = win32com.client.DispatchEx("PowerPoint.Application")
    p = app.Presentations.Add(0)
    p.PageSetup.SlideWidth, p.PageSetup.SlideHeight = 960, 540
    img = str((TESTCASES / "shapes-basic" / "slide-001.png").resolve())
    for i in range(pages):
        s = p.Slides.Add(i + 1, 12)
        t = s.Shapes.AddTextbox(1, 40, 30, 880, 60)
        t.TextFrame.TextRange.Text = f"第 {i + 1} 页：大文件测试，图片和文字"
        t.TextFrame.TextRange.Font.Size = 28
        s.Shapes.AddPicture(img, 0, -1, 80, 120, 560, 315)
        sh = s.Shapes.AddShape(5, 680, 140, 220, 120)
        s.TimeLine.MainSequence.AddEffect(sh, 10, 0, 1)
    OUT.mkdir(parents=True, exist_ok=True)
    base = OUT / "base.pptx"
    if base.exists():
        base.unlink()
    p.SaveAs(str(base.resolve()))
    p.Close()
    app.Quit()
    return base


VIDEO_PIC = (
    '<p:pic><p:nvPicPr><p:cNvPr id="900" name="video"/><p:cNvPicPr/><p:nvPr>'
    '<a:videoFile r:link="rIdBigVideo"/></p:nvPr></p:nvPicPr>'
    '<p:blipFill><a:blip r:embed="rIdBigPoster"/><a:stretch><a:fillRect/></a:stretch></p:blipFill>'
    '<p:spPr><a:xfrm><a:off x="1016000" y="4064000"/><a:ext cx="4064000" cy="2286000"/></a:xfrm>'
    '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>'
)


def add_video(base: Path, video_mb: int) -> Path:
    big = OUT / "big.pptx"
    with zipfile.ZipFile(base) as src, zipfile.ZipFile(big, "w", zipfile.ZIP_DEFLATED, allowZip64=True) as dst:
        poster = next(n for n in src.namelist() if n.startswith("ppt/media/"))
        for item in src.infolist():
            data = src.read(item.filename)
            if item.filename == "ppt/slides/slide2.xml":
                data = data.replace(b"</p:spTree>", VIDEO_PIC.encode() + b"</p:spTree>")
            elif item.filename == "ppt/slides/_rels/slide2.xml.rels":
                data = data.replace(b"</Relationships>", (
                    '<Relationship Id="rIdBigVideo" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/video" Target="../media/bigvideo.mp4"/>'
                    f'<Relationship Id="rIdBigPoster" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../{poster[4:]}"/>'
                    '</Relationships>').encode())
            elif item.filename == "[Content_Types].xml":
                data = data.replace(b"</Types>", b'<Default Extension="mp4" ContentType="video/mp4"/></Types>')
            dst.writestr(item, data)
        # 超大视频：随机内容，不压缩（视频文件在 pptx 里通常就是不压缩存储的）
        info = zipfile.ZipInfo("ppt/media/bigvideo.mp4")
        info.compress_type = zipfile.ZIP_STORED
        with dst.open(info, "w", force_zip64=True) as f:
            chunk = os.urandom(1 << 20)
            for _ in range(video_mb):
                f.write(chunk)
    return big


if __name__ == "__main__":
    pages = int(sys.argv[1]) if len(sys.argv) > 1 else 300
    mb = int(sys.argv[2]) if len(sys.argv) > 2 else 800
    base = make_base(pages)
    big = add_video(base, mb)
    print(f"生成 {big}，{big.stat().st_size / 1024 / 1024:.0f} MB，{pages} 页")
