# -*- coding: utf-8 -*-
"""PyInstaller 用 app.ico を生成"""
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "static", "icons", "app.ico")


def main():
    try:
        from PIL import Image, ImageDraw
    except ImportError:
        print("Pillow not installed; skip icon generation")
        sys.exit(0)

    sizes = [(256, 256), (128, 128), (64, 64), (48, 48), (32, 32), (16, 16)]
    images = []
    for size in sizes:
        img = Image.new("RGBA", size, (11, 15, 28, 255))
        draw = ImageDraw.Draw(img)
        w, h = size
        pad = max(2, w // 16)
        pts = [
            (pad, h - pad),
            (w * 0.35, h * 0.45),
            (w * 0.55, h * 0.55),
            (w - pad, pad * 2),
        ]
        draw.line(pts, fill=(38, 166, 154, 255), width=max(2, w // 32))
        images.append(img)
    images[0].save(OUT, format="ICO", sizes=[(s[0], s[1]) for s in sizes])
    print(f"Created {OUT}")


if __name__ == "__main__":
    main()
