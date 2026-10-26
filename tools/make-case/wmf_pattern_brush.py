"""生成中性的 WMF / EMF，测图案画刷（剪贴画常用 8×8 的抖动图案填色），给 make.py 的 wmf_pattern_brush 用例：
wmf_pattern_brush.py 输出.wmf 输出.emf
WMF（手工拼字节，带可放置头）：先选一个黑色实心画刷，再用 DIBCREATEPATTERNBRUSH 建图案画刷、选进来画多边形 / 椭圆
  1）8 位 DIB，红白棋盘格  2）8 位 DIB，3/4 蓝 1/4 白  3）1 位 DIB（颜色表绿 / 黄），隔行条纹  4）8 位 DIB 三色混合
EMF（GDI 生成）：浅灰底上
  1）CreateDIBPatternBrushPt，8 位红白棋盘格  2）同上，3/4 蓝 1/4 白
  3）CreatePatternBrush（单色位图，录成 CREATEMONOBRUSH）：文字色蓝、背景色黄，每 4 行 1 行是 1  4）同 3，文字色、背景色换成绿、白
"""
import ctypes
import struct
import sys
from ctypes import wintypes as W

RED, WHITE, BLUE, GREEN, YELLOW, BLACK, PURPLE = (220, 40, 40), (255, 255, 255), (40, 80, 220), (40, 170, 60), (240, 200, 30), (0, 0, 0), (130, 50, 160)


def packed_dib(pixel, palette, bpp=8):
    """8×8 的 DIB（BITMAPINFOHEADER + 颜色表 + 像素，从下往上存）；pixel(x, y) 返回颜色表下标，y 从上往下数"""
    bih = struct.pack("<IiiHHIIiiII", 40, 8, 8, 1, bpp, 0, 0, 0, 0, len(palette), 0)
    pal = b"".join(struct.pack("<BBBB", b, g, r, 0) for r, g, b in palette)
    stride = ((8 * bpp + 31) // 32) * 4
    rows = []
    for row in range(8):
        y = 7 - row
        if bpp == 8:
            line = bytes(pixel(x, y) for x in range(8))
        else:
            v = 0
            for x in range(8):
                v |= (pixel(x, y) & 1) << (7 - x)
            line = bytes([v])
        rows.append(line + b"\0" * (stride - len(line)))
    return bih + pal + b"".join(rows)


CHECKER = packed_dib(lambda x, y: (x + y) % 2, [RED, WHITE])
BLUE34 = packed_dib(lambda x, y: 1 if x % 2 == 0 and y % 2 == 0 else 0, [BLUE, WHITE])
STRIPES1 = packed_dib(lambda x, y: y % 2, [GREEN, YELLOW], bpp=1)
MIX3 = packed_dib(lambda x, y: (x + 2 * y) % 3, [PURPLE, WHITE, YELLOW])


def colorref(c):
    return c[0] | c[1] << 8 | c[2] << 16


# ---------------------------------------------------------------- WMF
def wmf_bytes():
    recs = []

    def rec(fn, params=b""):
        recs.append(struct.pack("<IH", (6 + len(params)) // 2, fn) + params)

    rec(0x0103, struct.pack("<h", 8))                          # SETMAPMODE MM_ANISOTROPIC
    rec(0x020B, struct.pack("<hh", 0, 0))                      # SETWINDOWORG（y, x）
    rec(0x020C, struct.pack("<hh", 300, 800))                  # SETWINDOWEXT（y, x）
    # 0：黑色实心画刷（选进来当"上一个画刷"），1：空笔
    rec(0x02FC, struct.pack("<HIH", 0, colorref(BLACK), 0))
    rec(0x012D, struct.pack("<H", 0))
    rec(0x02FA, struct.pack("<HhhI", 5, 0, 0, 0))              # CREATEPENINDIRECT PS_NULL
    rec(0x012D, struct.pack("<H", 1))
    for k, dib in enumerate([CHECKER, BLUE34, STRIPES1, MIX3]):
        x0 = 30 + k * 190
        rec(0x0142, struct.pack("<HH", 5, 0) + dib)            # DIBCREATEPATTERNBRUSH（BS_DIBPATTERN、DIB_RGB_COLORS）-> 下标 2
        rec(0x012D, struct.pack("<H", 2))
        pts = [(x0, 140), (x0 + 80, 20), (x0 + 160, 140)]
        rec(0x0324, struct.pack("<h", len(pts)) + b"".join(struct.pack("<hh", *p) for p in pts))    # POLYGON
        rec(0x0418, struct.pack("<hhhh", 280, x0 + 160, 160, x0))                                    # ELLIPSE（下、右、上、左）
        rec(0x012D, struct.pack("<H", 0))
        rec(0x01F0, struct.pack("<H", 2))                      # DELETEOBJECT
    rec(0x0000)
    body = b"".join(recs)
    hdr = struct.pack("<HHHIHIH", 1, 9, 0x300, (18 + len(body)) // 2, 3, max(len(r) for r in recs) // 2, 0)
    words = struct.unpack("<10H", struct.pack("<IHhhhhH", 0x9AC6CDD7, 0, 0, 0, 800, 300, 96) + b"\0\0\0\0")
    chk = 0
    for w in words:
        chk ^= w
    placeable = struct.pack("<IHhhhhHIH", 0x9AC6CDD7, 0, 0, 0, 800, 300, 96, 0, chk)
    return placeable + hdr + body


# ---------------------------------------------------------------- EMF
def write_emf(path):
    gdi, user = ctypes.windll.gdi32, ctypes.windll.user32
    gdi.CreateEnhMetaFileW.restype = W.HDC
    gdi.CreateEnhMetaFileW.argtypes = [W.HDC, W.LPCWSTR, ctypes.c_void_p, W.LPCWSTR]
    gdi.CloseEnhMetaFile.restype = W.HANDLE
    gdi.CloseEnhMetaFile.argtypes = [W.HDC]
    gdi.DeleteEnhMetaFile.argtypes = [W.HANDLE]
    gdi.CreateSolidBrush.restype = W.HBRUSH
    gdi.CreateSolidBrush.argtypes = [W.COLORREF]
    gdi.CreateDIBPatternBrushPt.restype = W.HBRUSH
    gdi.CreateDIBPatternBrushPt.argtypes = [ctypes.c_void_p, W.UINT]
    gdi.CreateBitmap.restype = W.HBITMAP
    gdi.CreateBitmap.argtypes = [ctypes.c_int, ctypes.c_int, W.UINT, W.UINT, ctypes.c_void_p]
    gdi.CreatePatternBrush.restype = W.HBRUSH
    gdi.CreatePatternBrush.argtypes = [W.HBITMAP]
    gdi.SelectObject.restype = W.HGDIOBJ
    gdi.SelectObject.argtypes = [W.HDC, W.HGDIOBJ]
    gdi.GetStockObject.restype = W.HGDIOBJ
    gdi.SetTextColor.argtypes = [W.HDC, W.COLORREF]
    gdi.SetBkColor.argtypes = [W.HDC, W.COLORREF]
    gdi.Ellipse.argtypes = [W.HDC, ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_int]
    gdi.Rectangle.argtypes = [W.HDC, ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_int]
    user.FillRect.argtypes = [W.HDC, ctypes.POINTER(W.RECT), W.HBRUSH]

    emf = gdi.CreateEnhMetaFileW(None, path, None, None)
    user.FillRect(emf, ctypes.byref(W.RECT(0, 0, 800, 300)), gdi.CreateSolidBrush(0x00F0F0F0))
    gdi.SelectObject(emf, gdi.GetStockObject(8))               # NULL_PEN
    keep = []
    # 单色位图：每行 2 字节对齐，每 4 行里 1 行全是 1（1 占 1/4，看得出 0、1 各用哪个颜色）
    mono = (ctypes.c_ubyte * 16)(*[0xFF if (i // 2) % 4 == 0 else 0x00 for i in range(16)])
    hmono = gdi.CreateBitmap(8, 8, 1, 1, mono)
    brushes = []
    for dib in (CHECKER, BLUE34):
        buf = ctypes.create_string_buffer(dib, len(dib))
        keep.append(buf)
        brushes.append((gdi.CreateDIBPatternBrushPt(buf, 0), None))
    brushes.append((gdi.CreatePatternBrush(hmono), (BLUE, YELLOW)))
    brushes.append((gdi.CreatePatternBrush(hmono), (GREEN, WHITE)))
    for k, (br, colors) in enumerate(brushes):
        x0 = 30 + k * 190
        if colors:
            gdi.SetTextColor(emf, colorref(colors[0]))
            gdi.SetBkColor(emf, colorref(colors[1]))
        gdi.SelectObject(emf, br)
        gdi.Rectangle(emf, x0, 20, x0 + 160, 140)
        gdi.Ellipse(emf, x0, 160, x0 + 160, 280)
    gdi.DeleteEnhMetaFile(gdi.CloseEnhMetaFile(emf))


if __name__ == "__main__":
    open(sys.argv[1], "wb").write(wmf_bytes())
    write_emf(sys.argv[2])
