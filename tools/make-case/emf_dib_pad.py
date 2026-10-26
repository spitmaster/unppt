"""用 GDI 生成中性 EMF，测 STRETCHDIBITS 的源框比位图宽 / 高（截图类 EMF 常见：源框、目标框都比位图宽 2~3 像素），
给 make.py 的 emf_stretchdibits_pad 用例：emf_dib_pad.py 输出1.emf 输出2.emf
输出1（浅灰底上一排排小位图，位图 40×30：红绿蓝黄四条竖带、最右一列和最下一行黑色）
  上排：源框 = 目标框，比位图宽 0 / 1 / 3 / 6 像素（32 位）；宽 3 像素（24 位）；比位图高 3 像素（32 位）
  下排：源框宽 3 像素、目标框横竖都放大 2 倍；只竖着放大 2 倍；横着放大 10 个单位；从上往下存的 DIB 源框 = 目标框宽 3 像素
输出2：只有一条 STRETCHDIBITS（和截图类 EMF 一样，画面范围按它算），位图 201×100（白底，每 20 像素一条黑竖线、一条红横线），
  源框 = 目标框 = 204×100
"""
import ctypes, sys
from ctypes import wintypes as W
gdi, user = ctypes.windll.gdi32, ctypes.windll.user32
gdi.CreateEnhMetaFileW.restype = W.HDC
gdi.CreateEnhMetaFileW.argtypes = [W.HDC, W.LPCWSTR, ctypes.c_void_p, W.LPCWSTR]
gdi.CloseEnhMetaFile.restype = W.HANDLE; gdi.CloseEnhMetaFile.argtypes = [W.HDC]
gdi.DeleteEnhMetaFile.argtypes = [W.HANDLE]
gdi.CreateSolidBrush.restype = W.HBRUSH; gdi.CreateSolidBrush.argtypes = [W.COLORREF]
user.FillRect.argtypes = [W.HDC, ctypes.POINTER(W.RECT), W.HBRUSH]
gdi.StretchDIBits.argtypes = [W.HDC, ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_int,
                              ctypes.c_void_p, ctypes.c_void_p, W.UINT, W.DWORD]

SRCCOPY = 0x00CC0020


class BIH(ctypes.Structure):
    _fields_ = [('biSize', W.DWORD), ('biWidth', W.LONG), ('biHeight', W.LONG), ('biPlanes', W.WORD), ('biBitCount', W.WORD), ('biCompression', W.DWORD),
                ('biSizeImage', W.DWORD), ('biXPelsPerMeter', W.LONG), ('biYPelsPerMeter', W.LONG), ('biClrUsed', W.DWORD), ('biClrImportant', W.DWORD)]


def dib(w, h, pixel, bpp=32, top_down=False):
    """DIB 的头和像素（pixel(x, y) 的 y 从上往下数）"""
    bih = BIH(ctypes.sizeof(BIH), w, -h if top_down else h, 1, bpp, 0, 0, 0, 0, 0, 0)
    n = bpp // 8
    stride = (w * n + 3) & ~3
    buf = (ctypes.c_ubyte * (stride * h))()
    for row in range(h):
        y = row if top_down else h - 1 - row
        for x in range(w):
            r, g, b = pixel(x, y)
            buf[row * stride + x * n:row * stride + x * n + 3] = [b, g, r]
    return bih, buf


BANDS = [(220, 40, 40), (40, 170, 60), (40, 80, 220), (240, 200, 30)]


def bands(x, y):
    """40×30：四条竖带，最右一列、最下一行黑色"""
    return (0, 0, 0) if x == 39 or y == 29 else BANDS[x // 10]


def grid(x, y):
    """201×100：白底，每 20 像素一条黑竖线、一条红横线"""
    return (0, 0, 0) if x % 20 == 0 else (220, 40, 40) if y % 20 == 0 else (255, 255, 255)


def blit(hdc, x, y, dw, dh, sw, sh, bih, buf):
    gdi.StretchDIBits(hdc, x, y, dw, dh, 0, 0, sw, sh, buf, ctypes.byref(bih), 0, SRCCOPY)


emf = gdi.CreateEnhMetaFileW(None, sys.argv[1], None, None)
user.FillRect(emf, ctypes.byref(W.RECT(0, 0, 400, 150)), gdi.CreateSolidBrush(0x00F0F0F0))
b32, b24, btd = dib(40, 30, bands), dib(40, 30, bands, 24), dib(40, 30, bands, top_down=True)
for x, k in [(10, 0), (60, 1), (110, 3), (160, 6)]:
    blit(emf, x, 10, 40 + k, 30, 40 + k, 30, *b32)
blit(emf, 215, 10, 43, 30, 43, 30, *b24)
blit(emf, 270, 10, 40, 33, 40, 33, *b32)
blit(emf, 10, 60, 86, 60, 43, 30, *b32)
blit(emf, 110, 60, 43, 60, 43, 30, *b32)
blit(emf, 170, 60, 53, 30, 43, 30, *b32)
blit(emf, 240, 60, 43, 30, 43, 30, *btd)
gdi.DeleteEnhMetaFile(gdi.CloseEnhMetaFile(emf))

emf = gdi.CreateEnhMetaFileW(None, sys.argv[2], None, None)
blit(emf, 0, 0, 204, 100, 204, 100, *dib(201, 100, grid))
gdi.DeleteEnhMetaFile(gdi.CloseEnhMetaFile(emf))
