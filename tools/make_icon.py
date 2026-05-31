# -*- coding: utf-8 -*-
"""PyInstaller 用 app.ico を icon-512.png から生成"""
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "static", "icons", "icon-512.png")
OUT = os.path.join(ROOT, "static", "icons", "app.ico")
FAV = os.path.join(ROOT, "static", "icons", "favicon.ico")


def main():
    try:
        from PIL import Image
    except ImportError:
        print("Pillow not installed; skip icon generation")
        sys.exit(0)

    if not os.path.isfile(SRC):
        print(f"Missing {SRC}; run icon export first")
        sys.exit(1)

    img = Image.open(SRC).convert("RGBA")
    sizes = [(256, 256), (128, 128), (64, 64), (48, 48), (32, 32), (16, 16)]
    images = [img.resize(size, Image.Resampling.LANCZOS) for size in sizes]
    ico_sizes = [(s[0], s[1]) for s in sizes]
    images[0].save(OUT, format="ICO", sizes=ico_sizes)
    images[0].save(FAV, format="ICO", sizes=ico_sizes)
    print(f"Created {OUT} and {FAV}")


if __name__ == "__main__":
    main()
