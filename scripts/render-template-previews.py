"""Rasterize local renderer QA PDFs into offline, lightweight template covers.

Generate PDFs for the ordinary catalog first:
  $env:RESUME_PREVIEW_DIR = 'tmp/template-previews'
  npm run test -- tests/pdf.test.tsx
For Markdown, use RESUME_MD_PREVIEW_DIR=tmp/markdown-template-previews,
run tests/markdownTemplatePdf.test.tsx, and call this script with --markdown.
The renderer needs Pillow and Poppler's pdftoppm on PATH.
"""
import argparse
from pathlib import Path
import io
import json
import shutil
import subprocess
from PIL import Image

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--markdown', action='store_true', help='Render Markdown catalog covers and the classic Markdown cover')
parser.add_argument('--only', help='Update a single cover by template ID')
args = parser.parse_args()
root = Path(__file__).resolve().parents[1]
source = root / 'tmp' / ('markdown-template-previews' if args.markdown else 'template-previews')
destination = root / 'public' / 'template-previews'
destination.mkdir(parents=True, exist_ok=True)
if args.markdown:
    manifest = source / 'covers.json'
    if not manifest.is_file():
        raise SystemExit(f'Generate the current Markdown cover manifest first: {manifest}')
    pdfs = [source / f'{name}.pdf' for name in json.loads(manifest.read_text(encoding='utf-8'))]
else:
    pdfs = sorted(source.glob('*.pdf'))
if args.only:
    pdfs = [pdf for pdf in pdfs if pdf.stem == args.only]
expected = 1 if args.only else (16 if args.markdown else 22)
if len(set(pdfs)) != expected or not all(path.is_file() for path in pdfs):
    raise SystemExit(f'Expected {expected} renderer PDFs in {source}, found {len(pdfs)}')
total = 0
renderer = shutil.which('pdftoppm')
if not renderer:
    raise SystemExit('Poppler pdftoppm is required on PATH')
for path in pdfs:
    result = subprocess.run([renderer, '-f', '1', '-singlefile', '-scale-to-x', '560', '-scale-to-y', '-1', '-png', str(path)], check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    image = Image.open(io.BytesIO(result.stdout))
    output = destination / f'{path.stem}.webp'
    image.save(output, 'WEBP', quality=86, method=6)
    total += output.stat().st_size
print(f'{len(pdfs)} covers generated, {total / 1024:.0f} KiB total')
