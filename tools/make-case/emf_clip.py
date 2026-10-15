"""用 GDI 生成带裁剪路径（EMF 的 67 号记录 SELECTCLIPPATH）的中性 EMF，给 make.py 的 emf_clip_modes 用例：emf_clip.py 输出.emf
三组，每组先设一个圆形裁剪（替换），再用矩形按 求交 / 求并 / 求差 组合，然后整块填白色；底下是深蓝色矩形"""
import ctypes, sys
from ctypes import wintypes as W
gdi, user = ctypes.windll.gdi32, ctypes.windll.user32
gdi.CreateEnhMetaFileW.restype = W.HDC
gdi.CreateEnhMetaFileW.argtypes = [W.HDC, W.LPCWSTR, ctypes.c_void_p, W.LPCWSTR]
gdi.CloseEnhMetaFile.restype = W.HANDLE; gdi.CloseEnhMetaFile.argtypes = [W.HDC]
gdi.DeleteEnhMetaFile.argtypes = [W.HANDLE]
gdi.CreateSolidBrush.restype = W.HBRUSH; gdi.CreateSolidBrush.argtypes = [W.COLORREF]
user.FillRect.argtypes = [W.HDC, ctypes.POINTER(W.RECT), W.HBRUSH]
for f in ('BeginPath', 'EndPath', 'SaveDC'): getattr(gdi, f).argtypes = [W.HDC]
gdi.RestoreDC.argtypes = [W.HDC, ctypes.c_int]
gdi.SelectClipPath.argtypes = [W.HDC, ctypes.c_int]
gdi.Ellipse.argtypes = gdi.Rectangle.argtypes = [W.HDC, ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_int]
RGN_AND, RGN_OR, RGN_DIFF, RGN_COPY = 1, 2, 4, 5
emf = gdi.CreateEnhMetaFileW(None, sys.argv[1], None, None)
user.FillRect(emf, ctypes.byref(W.RECT(0, 0, 600, 200)), gdi.CreateSolidBrush(0x00602000))
white = gdi.CreateSolidBrush(0x00FFFFFF)
for k, mode in enumerate((RGN_AND, RGN_OR, RGN_DIFF)):
    x = 20 + k * 200
    gdi.SaveDC(emf)
    gdi.BeginPath(emf); gdi.Ellipse(emf, x, 20, x + 160, 180); gdi.EndPath(emf)
    gdi.SelectClipPath(emf, RGN_COPY)
    gdi.BeginPath(emf); gdi.Rectangle(emf, x + 80, 60, x + 175, 140); gdi.EndPath(emf)
    gdi.SelectClipPath(emf, mode)
    user.FillRect(emf, ctypes.byref(W.RECT(x - 10, 10, x + 190, 190)), white)
    gdi.RestoreDC(emf, -1)
gdi.DeleteEnhMetaFile(gdi.CloseEnhMetaFile(emf))
