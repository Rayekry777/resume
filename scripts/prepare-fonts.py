"""Build two static Chinese TTFs from the licensed Google Fonts source.

Developer utility only. The generated fonts are shipped with the static site.
Install fonttools, then: python scripts/prepare-fonts.py path/to/NotoSansSC-Variable.ttf
"""
from pathlib import Path
import sys

local_packages = Path(__file__).resolve().parents[1] / "tmp" / "python"
if local_packages.exists():
    sys.path.insert(0, str(local_packages))

from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont

root = Path(__file__).resolve().parents[1]
source = Path(sys.argv[1]).resolve()
target = root / "public" / "fonts"
target.mkdir(parents=True, exist_ok=True)
for weight, name in [(400, "Regular"), (700, "Bold")]:
    font = TTFont(source)
    instantiateVariableFont(font, {"wght": weight}, inplace=True)
    # React PDF's shaper does not forward the document's zh-CN language tag.
    # Use Noto's own Simplified Chinese substitutions and positioning for
    # untagged runs, including punctuation-only runs in the default script.
    for tag in ('GSUB', 'GPOS'):
        scripts = {record.ScriptTag: record.Script for record in font[tag].table.ScriptList.ScriptRecord}
        for name, script in scripts.items():
            language_source = scripts['hani'] if name == 'DFLT' else script
            chinese = next((r.LangSys for r in language_source.LangSysRecord if r.LangSysTag == 'ZHS '), None)
            if chinese is not None:
                script.DefaultLangSys = chinese
    font.save(target / f"Chinese-{name}.ttf")
    print(f"Created Chinese-{name}.ttf")
