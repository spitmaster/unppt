"""用 GDI 生成带 AlphaBlend（EMF 的 114 号记录）的中性 EMF，给 make.py 的 emf_alphablend 用例：emf_alpha.py 输出.emf"""
import ctypes, sys
from ctypes import wintypes as W
gdi, user, msimg = ctypes.windll.gdi32, ctypes.windll.user32, ctypes.windll.msimg32
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
msimg.AlphaBlend.argtypes = [W.HDC, ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_int, W.HDC, ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_int, W.DWORD]
class BIH(ctypes.Structure):
    _fields_ = [('biSize', W.DWORD), ('biWidth', W.LONG), ('biHeight', W.LONG), ('biPlanes', W.WORD), ('biBitCount', W.WORD), ('biCompression', W.DWORD),
                ('biSizeImage', W.DWORD), ('biXPelsPerMeter', W.LONG), ('biYPelsPerMeter', W.LONG), ('biClrUsed', W.DWORD), ('biClrImportant', W.DWORD)]
emf = gdi.CreateEnhMetaFileW(None, sys.argv[1], None, None)
# 背景：浅蓝色矩形
user.FillRect(emf, ctypes.byref(W.RECT(0, 0, 400, 200)), gdi.CreateSolidBrush(0x00F0C080))
def bitmap(w, h, pixel):
    bih = BIH(ctypes.sizeof(BIH), w, -h, 1, 32, 0, 0, 0, 0, 0, 0)
    bits = ctypes.c_void_p()
    hbm = gdi.CreateDIBSection(None, ctypes.byref(bih), 0, ctypes.byref(bits), None, 0)
    buf = (ctypes.c_ubyte * (w * h * 4)).from_address(bits.value)
    for y in range(h):
        for x in range(w):
            b, g, r, a = pixel(x, y)
            o = (y * w + x) * 4
            buf[o:o + 4] = [b * a // 255, g * a // 255, r * a // 255, a]   # 预乘
    return hbm
mem = gdi.CreateCompatibleDC(None)
# 1）逐像素透明：红色圆点，圆外完全透明，圆内从左到右透明度渐变
hbm = bitmap(100, 100, lambda x, y: (40, 40, 220, int(255 * x / 99)) if (x - 50) ** 2 + (y - 50) ** 2 < 45 ** 2 else (0, 0, 0, 0))
gdi.SelectObject(mem, hbm)
msimg.AlphaBlend(emf, 30, 50, 100, 100, mem, 0, 0, 100, 100, 0x01FF0000)          # AC_SRC_OVER, 255, AC_SRC_ALPHA
# 2）整体透明度 50%：绿色方块
hbm2 = bitmap(100, 100, lambda x, y: (60, 180, 60, 255))
gdi.SelectObject(mem, hbm2)
msimg.AlphaBlend(emf, 200, 50, 100, 100, mem, 0, 0, 100, 100, 0x00800000)          # 128，不用逐像素透明
gdi.DeleteEnhMetaFile(gdi.CloseEnhMetaFile(emf))
