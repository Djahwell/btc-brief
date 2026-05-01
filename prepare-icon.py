"""
prepare-icon.py  —  Maison Toé BTC Brief  —  icon generator
=============================================================
Turns your actual logo PNG (gold calligraphy on black background)
into all required Android icon + splash sizes.

USAGE
-----
1. Save your logo PNG into the "BTC Brief Mac" folder
   (e.g. save it from the chat as  maison-toe-logo.png)
2. Run:
       python3 prepare-icon.py maison-toe-logo.png
3. Rebuild the APK:
       npm run cap:sync
   then open Android Studio → Build → Build APK(s)
"""

import sys, os
from PIL import Image, ImageDraw, ImageFont, ImageFilter

BASE = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                    "android", "app", "src", "main", "res")

GOLD_DARK  = (140,  88,  8)
GOLD_MID   = (200, 140, 16)


def load_logo(path: str) -> Image.Image:
    """
    Loads the logo and returns it as RGBA with rounded corners.
    Handles both:
      • dark-bg logos (gold on black)  — cropped + rounded
      • light-bg logos (black on white) — inverted + tinted gold + rounded
    """
    import numpy as np
    src = Image.open(path).convert("RGBA")
    grey = src.convert("L")
    w, h = src.size
    corners = [grey.getpixel(p) for p in [(4,4),(w-4,4),(4,h-4),(w-4,h-4)]]
    avg_corner = sum(corners) / 4

    if avg_corner < 80:
        print("  Detected: dark-background logo → using as-is with rounded corners")
        result = src
    else:
        print("  Detected: light-background logo → cropping white + applying rounded corners")
        # Crop white border, then tint gold
        arr = np.array(src)
        is_white = (arr[:,:,0] > 200) & (arr[:,:,1] > 200) & (arr[:,:,2] > 200)
        non_white = ~is_white
        rows = np.any(non_white, axis=1)
        cols = np.any(non_white, axis=0)
        rmin, rmax = np.where(rows)[0][[0, -1]]
        cmin, cmax = np.where(cols)[0][[0, -1]]
        pad = 4
        rmin, cmin = max(0, rmin-pad), max(0, cmin-pad)
        rmax, cmax = min(h-1, rmax+pad), min(w-1, cmax+pad)
        src = src.crop((cmin, rmin, cmax+1, rmax+1))
        w, h = src.size

    # Crop white/light outer padding for dark-bg logos too
    arr = np.array(src.convert("RGB"))
    is_light = (arr[:,:,0] > 200) & (arr[:,:,1] > 200) & (arr[:,:,2] > 200)
    non_light = ~is_light
    if non_light.any():
        rows = np.any(non_light, axis=1)
        cols = np.any(non_light, axis=0)
        rmin, rmax = np.where(rows)[0][[0, -1]]
        cmin, cmax = np.where(cols)[0][[0, -1]]
        pad = 4
        rmin, cmin = max(0, rmin-pad), max(0, cmin-pad)
        rmax, cmax = min(h-1, rmax+pad), min(w-1, cmax+pad)
        src = src.crop((cmin, rmin, cmax+1, rmax+1))
        w, h = src.size

    # Make square and apply rounded corners mask (8% radius)
    s = max(w, h)
    square = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    square.paste(src, ((s - w) // 2, (s - h) // 2))
    r_px = int(s * 0.08)
    mask = Image.new("L", (s, s), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, s-1, s-1], radius=r_px, fill=255)
    square.putalpha(mask)
    return square


def draw_border(draw, size):
    t = max(2, size // 36)
    r = max(4, size // 24)
    draw.rounded_rectangle([t//2, t//2, size-1-t//2, size-1-t//2],
                            radius=r, outline=GOLD_DARK, width=t)
    gap = t + max(1, size//80)
    draw.rounded_rectangle([gap, gap, size-1-gap, size-1-gap],
                            radius=max(2, r-gap), outline=GOLD_MID,
                            width=max(1, t//2))


def make_icon(logo: Image.Image, size: int, out_path: str,
              circular: bool = False, foreground_only: bool = False):
    canvas = Image.new("RGBA", (size, size),
                       (0,0,0,0) if foreground_only else (0,0,0,255))
    draw   = ImageDraw.Draw(canvas)

    if not foreground_only:
        draw_border(draw, size)

    # Fit logo in 80% of safe area
    safe = int(size * (0.92 if foreground_only else 0.78))
    aw = logo.width; ah = logo.height
    if aw / ah > 1:
        lw, lh = safe, int(safe * ah / aw)
    else:
        lw, lh = int(safe * aw / ah), safe
    lw, lh = max(1, lw), max(1, lh)

    resized = logo.resize((lw, lh), Image.LANCZOS)
    ox = (size - lw) // 2
    oy = (size - lh) // 2
    canvas.paste(resized, (ox, oy), mask=resized.split()[3])

    if circular and not foreground_only:
        mask = Image.new("L", (size, size), 0)
        ImageDraw.Draw(mask).ellipse([0, 0, size, size], fill=255)
        canvas.putalpha(mask)

    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    canvas.save(out_path, "PNG")
    print(f"  ✓  {os.path.relpath(out_path)}  ({size}×{size})")


def make_splash(logo: Image.Image, w: int, h: int, out_path: str):
    canvas = Image.new("RGB", (w, h), (0, 0, 0))
    draw   = ImageDraw.Draw(canvas)

    # Gold border
    t = max(3, min(w, h) // 60)
    r = max(4, min(w, h) // 40)
    draw.rounded_rectangle([t, t, w-1-t, h-1-t], radius=r,
                            outline=GOLD_DARK, width=t)
    gap = t * 3
    draw.rounded_rectangle([gap, gap, w-1-gap, h-1-gap],
                            radius=max(2, r - gap), outline=(80, 50, 4),
                            width=max(1, t // 2))

    # Logo centred, ~55% of shorter dimension
    logo_max = int(min(w, h) * 0.55)
    aw, ah = logo.width, logo.height
    if aw / ah > 1:
        lw, lh = logo_max, int(logo_max * ah / aw)
    else:
        lw, lh = int(logo_max * aw / ah), logo_max
    lw, lh = max(1, lw), max(1, lh)

    resized = logo.resize((lw, lh), Image.LANCZOS)
    ox = (w - lw) // 2
    oy = int(h * 0.30)
    canvas.paste(resized, (ox, oy), mask=resized.split()[3])

    # 'DIGITAL ASSETS' subtitle below logo
    text_y = oy + lh + int(min(w, h) * 0.045)
    fs = max(12, int(min(w, h) * 0.030))
    try:
        fnt = ImageFont.truetype(
            "/usr/share/fonts/truetype/dejavu/DejaVuSerif-Bold.ttf", fs)
        draw.text((w // 2, text_y), "DIGITAL ASSETS",
                  font=fnt, fill=GOLD_MID, anchor="mt")
    except: pass

    # Rule line
    rl_y  = oy - int(min(w, h) * 0.025)
    rl_hw = int(min(w, h) * 0.22)
    draw.line([(w//2 - rl_hw, rl_y), (w//2 + rl_hw, rl_y)],
              fill=GOLD_DARK, width=max(1, int(min(w, h) * 0.003)))

    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    canvas.save(out_path, "PNG")
    print(f"  ✓  {os.path.relpath(out_path)}  ({w}×{h})")


# ── Entry point ───────────────────────────────────────────────────────────────
if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(0)

    logo_path = sys.argv[1]
    if not os.path.isfile(logo_path):
        print(f"ERROR: file not found — {logo_path}")
        sys.exit(1)

    print(f"\nLoading: {logo_path}")
    logo = load_logo(logo_path)
    print(f"Logo loaded: {logo.size[0]}×{logo.size[1]} RGBA\n")

    print("── Launcher icons ──────────────────────────────────")
    for folder, sz in [("mipmap-mdpi",48),("mipmap-hdpi",72),
                       ("mipmap-xhdpi",96),("mipmap-xxhdpi",144),
                       ("mipmap-xxxhdpi",192)]:
        make_icon(logo, sz, f"{BASE}/{folder}/ic_launcher.png")
        make_icon(logo, sz, f"{BASE}/{folder}/ic_launcher_round.png", circular=True)

    print("\n── Adaptive foreground layers ──────────────────────")
    for folder, sz in [("mipmap-mdpi",108),("mipmap-hdpi",162),
                       ("mipmap-xhdpi",216),("mipmap-xxhdpi",324),
                       ("mipmap-xxxhdpi",432)]:
        make_icon(logo, sz, f"{BASE}/{folder}/ic_launcher_foreground.png",
                  foreground_only=True)

    print("\n── Splash screens (portrait) ────────────────────────")
    for folder, w, h in [
        ("drawable-port-mdpi",320,480), ("drawable-port-hdpi",480,800),
        ("drawable-port-xhdpi",720,1280), ("drawable-port-xxhdpi",960,1600),
        ("drawable-port-xxxhdpi",1280,1920)]:
        make_splash(logo, w, h, f"{BASE}/{folder}/splash.png")

    print("\n── Splash screens (landscape) ───────────────────────")
    for folder, w, h in [
        ("drawable-land-mdpi",480,320), ("drawable-land-hdpi",800,480),
        ("drawable-land-xhdpi",1280,720), ("drawable-land-xxhdpi",1600,960),
        ("drawable-land-xxxhdpi",1920,1280)]:
        make_splash(logo, w, h, f"{BASE}/{folder}/splash.png")

    print("\n✅  All done. Run:  npm run cap:sync\nthen rebuild APK in Android Studio.\n")
