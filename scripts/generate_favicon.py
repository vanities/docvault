#!/usr/bin/env python3
"""
Generate DocVault favicon — a vault/shield icon with a document motif.
Outputs SVG to public/docvault.svg and multi-size ICO to public/favicon.ico.

Usage:
    uv run --with Pillow --with cairosvg scripts/generate_favicon.py
"""

import io
import struct
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PUBLIC = ROOT / "public"

# DocVault favicon: a rounded shield/vault shape with a folded document inside.
# Colors match the app's dark theme with emerald accent.
SVG = """\
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" fill="none">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#16181e"/>
      <stop offset="100%" stop-color="#0c0e12"/>
    </linearGradient>
    <linearGradient id="accent" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#34d399"/>
      <stop offset="100%" stop-color="#059669"/>
    </linearGradient>
    <linearGradient id="doc" x1="0.2" y1="0" x2="0.8" y2="1">
      <stop offset="0%" stop-color="#d8dde9"/>
      <stop offset="100%" stop-color="#b4bccf"/>
    </linearGradient>
    <filter id="glow">
      <feGaussianBlur stdDeviation="8" result="blur"/>
      <feMerge>
        <feMergeNode in="blur"/>
        <feMergeNode in="SourceGraphic"/>
      </feMerge>
    </filter>
  </defs>

  <!-- Rounded square background -->
  <rect x="16" y="16" width="480" height="480" rx="96" fill="url(#bg)"
        stroke="url(#accent)" stroke-width="12"/>

  <!-- Vault keyhole / shield shape (subtle, behind document) -->
  <path d="M256 100 C180 100 120 155 120 230 L120 340 C120 390 183 420 256 440
           C329 420 392 390 392 340 L392 230 C392 155 332 100 256 100Z"
        fill="none" stroke="#1c1f26" stroke-width="20" opacity="0.5"/>

  <!-- Document body with folded corner -->
  <path d="M185 145 L330 145 L355 175 L355 390 L185 390 Z"
        fill="url(#doc)" opacity="0.95"/>

  <!-- Folded corner triangle -->
  <path d="M330 145 L355 175 L330 175 Z" fill="#8891a5"/>

  <!-- Text lines on document -->
  <rect x="210" y="200" width="120" height="8" rx="4" fill="#3a3f4b"/>
  <rect x="210" y="225" width="95" height="8" rx="4" fill="#3a3f4b"/>
  <rect x="210" y="250" width="110" height="8" rx="4" fill="#3a3f4b"/>

  <!-- Checkmark / verified badge -->
  <circle cx="330" cy="350" r="38" fill="url(#accent)" filter="url(#glow)"/>
  <polyline points="310,350 325,365 352,335" stroke="#0c0e12"
            stroke-width="10" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
</svg>
"""


def svg_to_png(svg_bytes: bytes, size: int) -> bytes:
    """Render SVG to PNG at the given square size."""
    import cairosvg

    return cairosvg.svg2png(bytestring=svg_bytes, output_width=size, output_height=size)


def pngs_to_ico(png_list: list[tuple[int, bytes]]) -> bytes:
    """Pack multiple PNGs into a single .ico file."""
    num = len(png_list)
    header = struct.pack("<HHH", 0, 1, num)
    offset = 6 + num * 16  # header + directory entries
    directory = b""
    image_data = b""

    for size, png_bytes in png_list:
        w = size if size < 256 else 0
        h = w
        directory += struct.pack(
            "<BBBBHHII", w, h, 0, 0, 1, 32, len(png_bytes), offset
        )
        image_data += png_bytes
        offset += len(png_bytes)

    return header + directory + image_data


def main():
    PUBLIC.mkdir(exist_ok=True)
    svg_bytes = SVG.encode("utf-8")

    # Write SVG
    svg_path = PUBLIC / "docvault.svg"
    svg_path.write_text(SVG)
    print(f"  wrote {svg_path.relative_to(ROOT)}")

    # Generate PNGs at standard favicon sizes and pack into ICO
    sizes = [16, 32, 48, 64, 128, 256]
    pngs = []
    for s in sizes:
        png = svg_to_png(svg_bytes, s)
        pngs.append((s, png))
        print(f"  rendered {s}x{s} PNG ({len(png)} bytes)")

    ico_bytes = pngs_to_ico(pngs)
    ico_path = PUBLIC / "favicon.ico"
    ico_path.write_bytes(ico_bytes)
    print(f"  wrote {ico_path.relative_to(ROOT)} ({len(ico_bytes)} bytes)")

    # Also write a 192px and 512px PNG for PWA / Apple touch icon
    for s in [180, 192, 512]:
        png = svg_to_png(svg_bytes, s)
        png_path = PUBLIC / f"icon-{s}.png"
        png_path.write_bytes(png)
        print(f"  wrote {png_path.relative_to(ROOT)}")

    print("\nDone! Update index.html to reference the new favicon:")
    print('  <link rel="icon" type="image/svg+xml" href="/docvault.svg" />')
    print('  <link rel="icon" type="image/x-icon" href="/favicon.ico" />')
    print('  <link rel="apple-touch-icon" href="/icon-180.png" />')


if __name__ == "__main__":
    main()
