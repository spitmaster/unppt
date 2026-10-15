"""用 GDI 的 GradientFill 生成带渐变填充（EMF 的 118 号记录）的中性 EMF，给 make.py 的 emf_gradient_fill 用例：emf_gradient.py 输出.emf
水平渐变矩形（红 -> 蓝）、垂直渐变矩形（黄 -> 绿）、三角形（三个顶点红、绿、蓝），以及 40 条竖条拼出的渐变（导出工具常这样画）"""
import ctypes, sys
from ctypes import wintypes as W
gdi, user, msimg = ctypes.windll.gdi32, ctypes.windll.user32, ctypes.windll.msimg32
gdi.CreateEnhMetaFileW.restype = W.HDC
gdi.CreateEnhMetaFileW.argtypes = [W.HDC, W.LPCWSTR, ctypes.c_void_p, W.LPCWSTR]
gdi.CloseEnhMetaFile.restype = W.HANDLE; gdi.CloseEnhMetaFile.argtypes = [W.HDC]
gdi.DeleteEnhMetaFile.argtypes = [W.HANDLE]
gdi.CreateSolidBrush.restype = W.HBRUSH; gdi.CreateSolidBrush.argtypes = [W.COLORREF]
user.FillRect.argtypes = [W.HDC, ctypes.POINTER(W.RECT), W.HBRUSH]


class TRIVERTEX(ctypes.Structure):
    _fields_ = [('x', W.LONG), ('y', W.LONG), ('Red', W.USHORT), ('Green', W.USHORT), ('Blue', W.USHORT), ('Alpha', W.USHORT)]


msimg.GradientFill.argtypes = [W.HDC, ctypes.POINTER(TRIVERTEX), W.ULONG, ctypes.c_void_p, W.ULONG, W.ULONG]


def v(x, y, r, g, b):
    return TRIVERTEX(x, y, r << 8, g << 8, b << 8, 0)


def fill(verts, idx, mode):
    va = (TRIVERTEX * len(verts))(*verts)
    ia = (W.ULONG * len(idx))(*idx)
    msimg.GradientFill(emf, va, len(verts), ia, len(idx) // (3 if mode == 2 else 2), mode)


emf = gdi.CreateEnhMetaFileW(None, sys.argv[1], None, None)
user.FillRect(emf, ctypes.byref(W.RECT(0, 0, 800, 200)), gdi.CreateSolidBrush(0x00FFFFFF))
fill([v(10, 10, 220, 30, 30), v(190, 190, 30, 30, 220)], [0, 1], 0)            # GRADIENT_FILL_RECT_H
fill([v(210, 10, 240, 220, 20), v(390, 190, 20, 160, 60)], [0, 1], 1)          # GRADIENT_FILL_RECT_V
fill([v(500, 10, 230, 30, 30), v(590, 190, 30, 200, 30), v(410, 190, 30, 30, 230)], [0, 1, 2], 2)   # 三角形
verts, idx = [], []
for k in range(40):                                                            # 竖条拼出的渐变
    c0, c1 = 255 - k * 5, 255 - (k + 1) * 5
    verts += [v(610 + k * 4, 10, 255, c0, 0), v(614 + k * 4, 190, 255, c1, 0)]
    idx += [2 * k, 2 * k + 1]
fill(verts, idx, 0)
gdi.DeleteEnhMetaFile(gdi.CloseEnhMetaFile(emf))
