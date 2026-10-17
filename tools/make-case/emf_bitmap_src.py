"""用 GDI 生成中性 EMF，测位图记录的源框和光栅操作，给 make.py 的 emf_bitmap_src 用例：emf_bitmap_src.py 输出.emf
上排（源框）：80×80 的四色位图（左上红、右上绿、左下蓝、右下黄）
  1）StretchDIBits，从下往上存的 DIB，源框 (0, 0, 80, 40)    2）同上，从上往下存的 DIB
  3）StretchBlt（内存 DC），源框 (0, 0, 80, 40)              4）BitBlt，源点 (40, 40)、40×40
  5）StretchDIBits，源框 (0, 0, 84, 80)：比位图宽 4 像素
下排（光栅操作，深青色底上）：圆形图标
  6）SRCAND 黑白掩码 + SRCINVERT 彩色图（图标的常见画法）      7）SRCAND 掩码 + SRCPAINT 彩色图
"""
import ctypes, sys
from ctypes import wintypes as W
gdi, user = ctypes.windll.gdi32, ctypes.windll.user32
gdi.CreateEnhMetaFileW.restype = W.HDC
gdi.CreateEnhMetaFileW.argtypes = [W.HDC, W.LPCWSTR, ctypes.c_void_p, W.LPCWSTR]
gdi.CloseEnhMetaFile.restype = W.HANDLE; gdi.CloseEnhMetaFile.argtypes = [W.HDC]
gdi.DeleteEnhMetaFile.argtypes = [W.HANDLE]
gdi.CreateCompatibleDC.restype = W.HDC; gdi.CreateCompatibleDC.argtypes = [W.HDC]
gdi.SelectObject.restype = W.HGDIOBJ; gdi.SelectObject.argtypes = [W.HDC, W.HGDIOBJ]
gdi.CreateSolidBrush.restype = W.HBRUSH; gdi.CreateSolidBrush.argtypes = [W.COLORREF]
user.FillRect.argtypes = [W.HDC, ctypes.POINTER(W.RECT), W.HBRUSH]
gdi.CreateDIBSection.restype = W.HBITMAP
gdi.CreateDIBSection.argtypes = [W.HDC, ctypes.c_void_p, W.UINT, ctypes.POINTER(ctypes.c_void_p), W.HANDLE, W.DWORD]
gdi.CreateBitmap.restype = W.HBITMAP
gdi.CreateBitmap.argtypes = [ctypes.c_int, ctypes.c_int, W.UINT, W.UINT, ctypes.c_void_p]
gdi.StretchDIBits.argtypes = [W.HDC, ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_int,
                              ctypes.c_void_p, ctypes.c_void_p, W.UINT, W.DWORD]
gdi.StretchBlt.argtypes = [W.HDC, ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_int, W.HDC, ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_int, W.DWORD]
gdi.BitBlt.argtypes = [W.HDC, ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_int, W.HDC, ctypes.c_int, ctypes.c_int, W.DWORD]

SRCCOPY, SRCAND, SRCINVERT, SRCPAINT = 0x00CC0020, 0x008800C6, 0x00660046, 0x00EE0086


class BIH(ctypes.Structure):
    _fields_ = [('biSize', W.DWORD), ('biWidth', W.LONG), ('biHeight', W.LONG), ('biPlanes', W.WORD), ('biBitCount', W.WORD), ('biCompression', W.DWORD),
                ('biSizeImage', W.DWORD), ('biXPelsPerMeter', W.LONG), ('biYPelsPerMeter', W.LONG), ('biClrUsed', W.DWORD), ('biClrImportant', W.DWORD)]


def quad(x, y, n=80):
    """四色：左上红、右上绿、左下蓝、右下黄（RGB）"""
    top, left = y < n // 2, x < n // 2
    return (220, 40, 40) if top and left else (40, 170, 60) if top else (40, 80, 220) if left else (240, 200, 30)


def dib(w, h, pixel, top_down):
    """24 位 DIB 的头和像素（pixel(x, y) 的 y 从上往下数）"""
    bih = BIH(ctypes.sizeof(BIH), w, -h if top_down else h, 1, 24, 0, 0, 0, 0, 0, 0)
    stride = (w * 3 + 3) & ~3
    buf = (ctypes.c_ubyte * (stride * h))()
    for row in range(h):
        y = row if top_down else h - 1 - row
        for x in range(w):
            r, g, b = pixel(x, y)
            buf[row * stride + x * 3:row * stride + x * 3 + 3] = [b, g, r]
    return bih, buf


def section(w, h, pixel):
    """选进内存 DC 用的 DIB 位图"""
    bih = BIH(ctypes.sizeof(BIH), w, -h, 1, 24, 0, 0, 0, 0, 0, 0)
    bits = ctypes.c_void_p()
    hbm = gdi.CreateDIBSection(None, ctypes.byref(bih), 0, ctypes.byref(bits), None, 0)
    stride = (w * 3 + 3) & ~3
    buf = (ctypes.c_ubyte * (stride * h)).from_address(bits.value)
    for y in range(h):
        for x in range(w):
            r, g, b = pixel(x, y)
            buf[y * stride + x * 3:y * stride + x * 3 + 3] = [b, g, r]
    return hbm


emf = gdi.CreateEnhMetaFileW(None, sys.argv[1], None, None)
user.FillRect(emf, ctypes.byref(W.RECT(0, 0, 600, 260)), gdi.CreateSolidBrush(0x00F0F0F0))
# 上排：源框
for k, top_down in enumerate([False, True]):
    bih, buf = dib(80, 80, quad, top_down)
    gdi.StretchDIBits(emf, 10 + k * 115, 10, 100, 100, 0, 0, 80, 40, buf, ctypes.byref(bih), 0, SRCCOPY)
mem = gdi.CreateCompatibleDC(None)
gdi.SelectObject(mem, section(80, 80, quad))
gdi.StretchBlt(emf, 240, 10, 100, 100, mem, 0, 0, 80, 40, SRCCOPY)
gdi.BitBlt(emf, 355, 10, 40, 40, mem, 40, 40, SRCCOPY)
bih, buf = dib(80, 80, quad, False)
gdi.StretchDIBits(emf, 410, 10, 105, 100, 0, 0, 84, 80, buf, ctypes.byref(bih), 0, SRCCOPY)
# 下排：深青色底上的圆形图标
user.FillRect(emf, ctypes.byref(W.RECT(0, 130, 600, 260)), gdi.CreateSolidBrush(0x00808000))
inside = lambda x, y: (x - 31.5) ** 2 + (y - 31.5) ** 2 < 28 ** 2
# 黑白掩码：圆内 0（黑）、圆外 1（白），每行按 2 字节对齐
mask_bits = (ctypes.c_ubyte * (8 * 64))()
for y in range(64):
    for x in range(64):
        if not inside(x, y):
            mask_bits[y * 8 + x // 8] |= 0x80 >> (x % 8)
hmask = gdi.CreateBitmap(64, 64, 1, 1, mask_bits)
color = section(64, 64, lambda x, y: ((230, 120, 30) if x < 32 else (250, 240, 240)) if inside(x, y) else (0, 0, 0))
for k, rop in enumerate([SRCINVERT, SRCPAINT]):
    x0 = 40 + k * 160
    gdi.SelectObject(mem, hmask)
    gdi.StretchBlt(emf, x0, 160, 80, 80, mem, 0, 0, 64, 64, SRCAND)
    gdi.SelectObject(mem, color)
    gdi.StretchBlt(emf, x0, 160, 80, 80, mem, 0, 0, 64, 64, rop)
gdi.DeleteEnhMetaFile(gdi.CloseEnhMetaFile(emf))
