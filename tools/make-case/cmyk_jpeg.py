"""把 RGB 图片存成 Adobe 写法的四分量 JPEG（印刷用的 CMYK 照片常见这种；样本里约一成课件有）：
  - CMYK：Adobe APP14 的颜色变换写 0，四个分量按 Adobe 的习惯取反存储（255 = 没有油墨）；
  - YCCK：颜色变换写 2，前三个分量是 255 − 取反存储的 C、M、Y 当成 RGB 算出的 YCbCr（libjpeg 的 cmyk_ycck_convert），K 照存。
Pillow 只会写 CMYK（变换 0），而且存的时候自己取反一次：YCCK 的四个分量算好后取反交给它，存完把 APP14 里的变换改成 2。
黑色按"底色去除"放进 K（K = 三个颜色里最亮的那个），这样 K 分量也有内容。
tiny_profile() 是一个自己编的最小 CMYK ICC 配置文件（3×3×3×3 格的 lut16，Lab 连接空间），单元测试用来检查按嵌入配置文件换算。
用法：python cmyk_jpeg.py 输入图片 输出.jpg [ycck]（测试用的图片在 packages/transcoder/test/images）
"""
from __future__ import annotations

import struct
import sys
from pathlib import Path

import numpy as np
from PIL import Image


def adobe_planes(rgb: Image.Image, ycck: bool) -> np.ndarray:
    """RGB -> 文件里要存的四个分量（高 × 宽 × 4，取值 0~255）"""
    a = np.asarray(rgb.convert("RGB")).astype(np.float64)
    k = a.max(axis=2)
    safe = np.where(k > 0, k, 1)
    # 取反存储的 C、M、Y、K：解码时 R = C × K / 255
    cmy = np.where(k[..., None] > 0, a * 255 / safe[..., None], 255)
    planes = np.concatenate([cmy, k[..., None]], axis=2)
    if ycck:
        r, g, b = (255 - planes[..., i] for i in range(3))
        y = 0.299 * r + 0.587 * g + 0.114 * b
        cb = -0.168736 * r - 0.331264 * g + 0.5 * b + 128
        cr = 0.5 * r - 0.418688 * g - 0.081312 * b + 128
        planes = np.stack([y, cb, cr, planes[..., 3]], axis=2)
    return np.clip(np.round(planes), 0, 255).astype(np.uint8)


def save_adobe_jpeg(rgb: Image.Image, path: Path, ycck: bool = False, quality: int = 92, icc: bytes | None = None) -> None:
    planes = adobe_planes(rgb, ycck)
    # Pillow 存 CMYK 时自己取反一次（Adobe 习惯），先反过来
    Image.fromarray(255 - planes, "CMYK").save(path, "JPEG", quality=quality, **({"icc_profile": icc} if icc else {}))
    b = bytearray(path.read_bytes())
    p = 2
    while p + 4 <= len(b):
        if b[p] != 0xFF:
            p += 1
            continue
        m, ln = b[p + 1], (b[p + 2] << 8) | b[p + 3]
        if m == 0xEE and b[p + 4:p + 9] == b"Adobe":
            b[p + 15] = 2 if ycck else 0
            break
        if m == 0xDA:
            raise ValueError("没有 Adobe APP14 标记")
        p += 2 + ln
    path.write_bytes(bytes(b))


def tiny_profile(g: int = 3) -> bytes:
    """最小的 CMYK 输出设备配置文件：desc、cprt、wtpt 和 A2B0（lut16，g^4 格，输入输出曲线是直线）。
    格子里是随便定的平滑映射：油墨越多越暗，C 偏青、M 偏品红、Y 偏黄，K 压暗"""
    def s15(v):
        return struct.pack(">i", int(round(v * 65536)))
    desc = b"unppt test CMYK\0"
    tags = [
        (b"desc", b"desc" + bytes(4) + struct.pack(">I", len(desc)) + desc + bytes(4 + 4 + 2 + 1 + 67)),
        (b"cprt", b"text" + bytes(4) + b"No copyright, test data\0"),
        (b"wtpt", b"XYZ " + bytes(4) + s15(0.9642) + s15(1.0) + s15(0.8249)),
    ]
    lut = b"mft2" + bytes(4) + bytes([4, 3, g, 0]) + b"".join(s15(v) for v in (1, 0, 0, 0, 1, 0, 0, 0, 1)) + struct.pack(">HH", 2, 2)
    lut += struct.pack(">HH", 0, 65535) * 4
    pts = np.linspace(0, 1, g)
    for c in pts:
        for m in pts:
            for y in pts:
                for k in pts:
                    L = min(100, max(0, 100 * (1 - 0.45 * c - 0.35 * m - 0.15 * y) * (1 - 0.85 * k)))
                    a = min(255.99, max(0, 128 - 50 * c + 60 * m + 5 * y))
                    b = min(255.99, max(0, 128 - 40 * c - 10 * m + 70 * y))
                    lut += struct.pack(">HHH", round(L / 100 * 65280), round(a * 256), round(b * 256))
    lut += struct.pack(">HH", 0, 65535) * 3
    tags.append((b"A2B0", lut))
    off = 128 + 4 + 12 * len(tags)
    table, body = b"", b""
    for sig, data in tags:
        body += bytes(-(off + len(body)) % 4)
        table += sig + struct.pack(">II", off + len(body), len(data))
        body += data
    size = off + len(body)
    hdr = (struct.pack(">I", size) + b"none" + bytes([2, 0x10, 0, 0]) + b"prtr" + b"CMYK" + b"Lab " + bytes(12) + b"acsp"
           + bytes(4 * 4 + 8 + 4) + s15(0.9642) + s15(1.0) + s15(0.8249) + bytes(4 + 16 + 28))
    return hdr + struct.pack(">I", len(tags)) + table + body


if __name__ == "__main__":
    save_adobe_jpeg(Image.open(sys.argv[1]), Path(sys.argv[2]), ycck=len(sys.argv) > 3 and sys.argv[3] == "ycck")
