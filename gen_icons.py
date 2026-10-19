import os
from PIL import Image, ImageDraw

OUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "assets", "icons")
CANVAS = 512  # se genera en alta resolución y se reescala para que quede nítido

BLUE = (66, 133, 244, 255)  # #4285F4 (Google Blue)
WHITE = (255, 255, 255, 255)


def rounded_square(size, radius, color):
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    draw.rounded_rectangle([0, 0, size - 1, size - 1], radius=radius, fill=color)
    return img


def draw_download_glyph(img, cx, cy, scale):
    """Flecha de descarga + bandeja, estilo Material 'file_download',
    centrado en (cx, cy) sobre un icono virtual de 24x24 * scale."""
    draw = ImageDraw.Draw(img)

    def p(x, y):
        return (cx + (x - 12) * scale, cy + (y - 12) * scale)

    # Vástago de la flecha.
    stem_w = 3.0
    draw.rectangle(
        [p(12 - stem_w / 2, 3)[0], p(0, 3)[1], p(12 + stem_w / 2, 3)[0], p(0, 13)[1]],
        fill=WHITE,
    )
    # Punta de la flecha (triángulo).
    draw.polygon([p(7, 11), p(17, 11), p(12, 16.5)], fill=WHITE)
    # Bandeja inferior.
    tray_h = 2.4
    draw.rounded_rectangle(
        [p(5, 18)[0], p(0, 18)[1], p(19, 18 + tray_h)[0], p(0, 18 + tray_h)[1]],
        radius=1.2 * scale,
        fill=WHITE,
    )


def make_master():
    radius = int(CANVAS * 0.22)
    img = rounded_square(CANVAS, radius, BLUE)
    draw_download_glyph(img, cx=CANVAS * 0.5, cy=CANVAS * 0.5, scale=CANVAS / 24 * 0.66)
    return img


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    master = make_master()
    for size in (16, 32, 48, 128):
        resized = master.resize((size, size), Image.LANCZOS)
        resized.save(f"{OUT_DIR}/icon{size}.png")
        print(f"icon{size}.png OK")


if __name__ == "__main__":
    main()
