"""Create licensed synthetic oblique WOFFs for PDF rich-text italics."""
from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tmp" / "python"))
from fontTools.ttLib import TTFont
from fontTools.pens.recordingPen import DecomposingRecordingPen
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.pens.transformPen import TransformPen

folder = Path(__file__).resolve().parents[1] / "public" / "fonts"
for source, target in [("Chinese-Regular.ttf", "Chinese-Italic.woff"), ("Chinese-Bold.ttf", "Chinese-BoldItalic.woff")]:
    font = TTFont(folder / source)
    glyph_set = font.getGlyphSet()
    replacements = {}
    for name in font.getGlyphOrder():
        recording = DecomposingRecordingPen(glyph_set)
        glyph_set[name].draw(recording)
        output = TTGlyphPen(None)
        recording.replay(TransformPen(output, (1, 0, 0.2, 1, -0.06 * font['head'].unitsPerEm, 0)))
        replacements[name] = output.glyph()
    font['glyf'].glyphs = replacements
    font['head'].macStyle |= 2
    font['OS/2'].fsSelection = (font['OS/2'].fsSelection | 1) & ~(1 << 6)
    font['post'].italicAngle = -11.3
    font.flavor = "woff"
    font.save(folder / target)
    print(target)
