"""Generate the bundled PWA icons from the project's simple document mark."""
from pathlib import Path
from PIL import Image, ImageDraw

root = Path(__file__).resolve().parents[1] / "public"
for size, name in [(192, "icon-192.png"), (512, "icon-512.png"), (180, "apple-touch-icon.png")]:
    image = Image.new("RGB", (size, size), "#5064ee")
    draw = ImageDraw.Draw(image)
    def box(values):
        return tuple(round(x * size / 64) for x in values)
    draw.polygon([box(p) for p in [(22, 17),(36,17),(45,26),(45,47),(22,47)]], fill="white")
    draw.polygon([box(p) for p in [(36,17),(36,27),(45,27)]], fill="#dce1ff")
    for y, end in [(32,39),(38,39),(44,33)]:
        draw.line([box((27,y)),box((end,y))], fill="#5064ee", width=max(2, round(size*2/64)))
    image.save(root / name)
    print(name)
