"""Compare ordinary/markdown pairs from local PDF files and PDF.js measurements.

python scripts/compare-resume-pdfs.py output/pdf/comparison
All private excerpts and page images stay in the given local directory.
"""
import argparse
from bisect import bisect_left
from collections import Counter
from dataclasses import dataclass
from difflib import SequenceMatcher
import hashlib
import json
from pathlib import Path
import shutil
from statistics import median
import subprocess
import tempfile
import unicodedata

from PIL import Image, ImageChops, ImageDraw, ImageFont

RADICALS = str.maketrans({'⻔': '门', '⻓': '长', '⻘': '青', '⻚': '页', '⻆': '角'})


@dataclass
class Line:
    page: int
    number: int
    x: float
    y: float
    text: str
    normalized: str


def normalize(text):
    # NFKC resolves Kangxi radicals; a few radicals from the supplemental
    # block also occur in these PDFs and have no Unicode compatibility mapping.
    return ''.join(unicodedata.normalize('NFKC', text).translate(RADICALS).split())


def extract_lines(page, index):
    rows = []
    for item in sorted(page['items'], key=lambda t: (t['y'], t['x'])):
        if not rows or item['y'] - rows[-1][0]['y'] > 3:
            rows.append([])
        rows[-1].append(item)
    result = []
    for number, row in enumerate(rows, 1):
        row.sort(key=lambda t: t['x'])
        text = ''.join(t['s'] for t in row)
        result.append(Line(index, number, row[0]['x'], median(t['y'] for t in row),
                           text, normalize(text)))
    return result


def photo_rect(page):
    rectangles = []
    for a, b, c, d, e, f in page['photos']:
        xs = (e, e+a, e+c, e+a+c)
        ys = (f, f+b, f+d, f+b+d)
        rectangles.append((min(xs), page['height']-max(ys), max(xs)-min(xs), max(ys)-min(ys)))
    return max(rectangles, key=lambda r: r[2]*r[3], default=None)


def markdown_cell(value):
    value = value.replace('\x00', '⟦U+0000⟧')
    return value.replace('\\', '\\\\').replace('|', '\\|').replace('<', '&lt;').replace('>', '&gt;')


def line_position(line):
    return f'{line.page} 页 {line.number} 行'


def first_break_difference(left, right):
    """Locate the first different break using only characters present on both sides.

    PDF icons and extraction artifacts need not share codepoints. An actual
    line break is compared at the preceding position in the common sequence.
    """
    texts = [''.join(line.normalized for line in lines) for lines in (left, right)]
    aligned = [[], []]
    for a, b, length in SequenceMatcher(None, *texts, autojunk=False).get_matching_blocks():
        for side, start in enumerate((a,b)):
            aligned[side].extend(range(start, start + length))
    if not aligned[0]:
        return None
    breaks, positions = [], []
    for side, lines in enumerate((left, right)):
        consumed = 0; boundaries = {}; containing = []
        for line in lines:
            consumed += len(line.normalized)
            rank = bisect_left(aligned[side], consumed)
            boundaries[rank] = line
            containing.extend([line] * (rank-len(containing)))
        breaks.append(boundaries)
        positions.append(containing)
    differences = sorted((breaks[0].keys() ^ breaks[1].keys()) - {0, len(aligned[0])})
    if not differences:
        return None
    rank = differences[0]
    return tuple((positions[side][rank-1], rank in breaks[side]) for side in (0,1))


def pair_lines(left, right):
    """Match exact rows first; pair changed rows only with shared text in order."""
    left_text = [line.normalized for line in left]
    right_text = [line.normalized for line in right]
    matcher = SequenceMatcher(None, left_text, right_text, autojunk=False)
    for op, a, b, c, d in matcher.get_opcodes():
        if op == 'equal':
            yield from zip(left[a:b], right[c:d])
            continue
        # Sequence alignment localizes a moved wrap without treating following
        # unaffected lines as different. Low-similarity data stays unmatched.
        size1, size2 = b-a, d-c
        scores = [[0.0]*(size2+1) for _ in range(size1+1)]
        direction = {}
        for i in range(size1):
            for j in range(size2):
                ratio = SequenceMatcher(None, left_text[a+i], right_text[c+j], autojunk=False).ratio()
                choices = [(scores[i][j+1], 'drop'), (scores[i+1][j], 'add')]
                if ratio >= .45:
                    choices.append((scores[i][j]+ratio, 'pair'))
                scores[i+1][j+1], direction[i+1,j+1] = max(choices)
        i,j = size1,size2
        pairs = []
        while i or j:
            action = direction.get((i,j), 'drop' if i else 'add')
            if action == 'pair':
                i -= 1; j -= 1
                pairs.append((left[a+i], right[c+j]))
            elif action == 'drop':
                i -= 1
                pairs.append((left[a+i], None))
            else:
                j -= 1
                pairs.append((None, right[c+j]))
        yield from reversed(pairs)


def blank_page(image):
    rgb = image.convert('RGB')
    return ImageChops.difference(rgb, Image.new('RGB', rgb.size, 'white')).getbbox() is None


def images_and_status(folder, kind, label, dpi, font, temporary, metadata):
    images, statuses = {}, {}
    for source in ['original', 'local']:
        prefix = temporary / (kind+'-'+source)
        subprocess.run([shutil.which('pdftoppm') or 'pdftoppm', '-r', str(dpi), '-png',
                        str(folder / (prefix.name+'.pdf')), str(prefix)], check=True, capture_output=True)
        files = sorted(temporary.glob(prefix.name+'-*.png'), key=lambda p: int(p.stem.rsplit('-',1)[-1]))
        if len(files) != len(metadata[source]):
            raise ValueError('PDF 与测量文件页数不同，请重新生成测量')
        images[source] = files
        statuses[source] = []
        for filename in files:
            with Image.open(filename) as image:
                statuses[source].append('空白页' if blank_page(image) else '有内容')
    for i in range(max(len(pages) for pages in images.values())):
        panels = []
        for source in ['original', 'local']:
            if i < len(images[source]):
                with Image.open(images[source][i]) as im:
                    panel = im.convert('RGB')
            else:
                reference = images['local' if source == 'original' else 'original'][i]
                with Image.open(reference) as im:
                    panel = Image.new('RGB', im.size, '#f1f3f6')
                draw = ImageDraw.Draw(panel)
                draw.text((panel.width//2, panel.height//2), '没有这一页', font=font, fill='#596477', anchor='mm')
            panels.append(panel)
        gap, pad, header = 20, 22, 68
        cover = Image.new('RGB', (sum(p.width for p in panels)+gap+2*pad,
                           max(p.height for p in panels)+header+pad), '#e7ebf0')
        draw = ImageDraw.Draw(cover)
        x = pad
        for source, title, panel in zip(['original','local'], ['参考原稿','本地导出'], panels):
            state = statuses[source][i] if i < len(statuses[source]) else '无此页'
            draw.text((x,16), f'{label}  ·  {title}  ·  第 {i+1} 页'
                      + (f'  ·  {state}' if state != '有内容' else ''), fill='#283749', font=font)
            cover.paste(panel, (x,header))
            x += panel.width + gap
        cover.save(folder / f'{kind}-page-{i+1:02d}.png')
    return statuses


HEADINGS = ('教育经历','专业技能','项目经历')


def anchors(page_rows, metadata):
    located = {}
    rows = [row for page in page_rows for row in page]
    if page_rows[0]:
        first = page_rows[0][0]
        located['姓名'] = (first.page, first.x, first.y)
    photo = photo_rect(metadata[0])
    if photo:
        located['头像左上角'] = (1, photo[0], photo[1])
        located['头像宽高'] = (1, photo[2], photo[3])
    for title in HEADINGS:
        for index, row in enumerate(rows):
            if row.normalized == title:
                located[title] = (row.page, row.x, row.y)
                if title == HEADINGS[0] and index+1 < len(rows):
                    body = rows[index+1]
                    located['首模块正文首行'] = (body.page, body.x, body.y)
                break
    return located


def coordinates(point):
    return f'P{point[0]} ({point[1]:.2f}, {point[2]:.2f})' if point else '未定位'


def page_statistics(original, local):
    pairs = list(pair_lines(original, local))
    matched = [(a,b) for a,b in pairs if a and b]
    exact = [(a,b) for a,b in matched if a.normalized == b.normalized]
    common_tails = sum(a.normalized[-12:] == b.normalized[-12:] for a,b in matched)
    def maximum(lines):
        if not lines:
            return '—'
        a,b = max(lines, key=lambda pair: abs(pair[1].y-pair[0].y))
        return f'{abs(b.y-a.y):.2f}（原 L{a.number} / 本 L{b.number}）'
    denominator = len(pairs)
    suffix = f'{common_tails}/{denominator}' if denominator else '—'
    return f'| {len(original)} / {len(local)} | {len(matched)} | {suffix} | {len(exact)} | {maximum(exact)} | {maximum(matched)} |'


def physical_lines(original, local):
    """Compare the nth physical line directly; no alignment, shuffling or search."""
    size = max(len(original), len(local))
    exact, standard, aliases, ends = 0, 0, 0, 0
    def diagnostic(text):
        return text.replace('戶','户').replace('\x00','——')
    for left, right in zip(original, local):
        exact += left.text == right.text
        standard += left.normalized == right.normalized
        a,b = diagnostic(left.normalized), diagnostic(right.normalized)
        aliases += a == b
        ends += a[-12:] == b[-12:]
    return ' | '.join(f'{value}/{size}' if size else '—' for value in (exact,standard,aliases,ends))


def decoration_insensitive(text):
    result = []
    for char in text:
        category = unicodedata.category(char)
        if char in '•·|丨▪●‧' or category == 'Co':
            continue
        result.append('-' if category == 'Pd' else char)
    return ''.join(result)


def glyph_audit(original, local):
    # Keep raw distinctions visible even when the glyphs resemble one another.
    # This table is diagnostic only and never feeds line/geometry matching.
    counts = [Counter(''.join(line.text for line in lines)) for lines in (original, local)]
    differences = []
    for char in sorted(set(counts[0]) | set(counts[1])):
        category = unicodedata.category(char)
        if counts[0][char] == counts[1][char]:
            continue
        if not (char in '户戶⼾' or char == '\x00' or category in ('Pd','Co') or
                0x2e80 <= ord(char) <= 0x2fff or char in '•·|丨▪●‧'):
            continue
        literal = f'U+{ord(char):04X}' if ord(char)<32 else f'{markdown_cell(char)} (U+{ord(char):04X})'
        differences.append(f'| {literal} | {counts[0][char]} | {counts[1][char]} |')
    return differences


def compare_variant(folder, kind, label, dpi, font, temporary):
    sources = ('original','local')
    metadata = {s: json.loads((folder / f'{kind}-{s}.json').read_text(encoding='utf-8')) for s in sources}
    statuses = images_and_status(folder, kind, label, dpi, font, temporary, metadata)
    pages = {s: [extract_lines(p,i) for i,p in enumerate(metadata[s],1)] for s in sources}
    rows = {s: [row for page in pages[s] for row in page] for s in sources}
    pairs = list(pair_lines(rows['original'], rows['local']))
    hashes = [hashlib.sha256((folder / f'{kind}-{s}.pdf').read_bytes()).hexdigest() for s in sources]
    report = [f'## {label}', '', f'[参考原稿 PDF]({kind}-original.pdf) · [本地导出 PDF]({kind}-local.pdf)', '',
              f'文件指纹 SHA-256（前 16 位）为原版 `{hashes[0][:16]}`、本地 `{hashes[1][:16]}`。', '',
              f'原版 {len(pages["original"])} 页，本地 {len(pages["local"])} 页。', '',
              '| 页 | 原版页首 / 页尾 | 本地页首 / 页尾 | 对照图 |','|---|---|---|---|']
    page_count = max(len(v) for v in pages.values())
    for old in folder.glob(f'{kind}-page-[0-9][0-9].png'):
        if int(old.stem.rsplit('-', 1)[1]) > page_count:
            old.unlink()
    for n in range(page_count):
        boundaries = []
        for s in sources:
            if n >= len(pages[s]):
                boundaries.append('无此页')
            elif not pages[s][n]:
                boundaries.append(statuses[s][n] if statuses[s][n]=='空白页' else '有图形，无可提取文字')
            else:
                lines = pages[s][n]
                boundaries.append(markdown_cell(lines[0].text[:24])+' / '+markdown_cell(lines[-1].text[-24:]))
        report.append(f'| {n+1} | {boundaries[0]} | {boundaries[1]} | [并排查看]({kind}-page-{n+1:02d}.png) |')
    report += ['', '逐页在本页内按顺序对齐文字行。行尾比较最后 12 个归一化字符，短行比较整行。分母是对应的行对数加上任一侧的未匹配行数。'
               '基线偏差的单位是 pt，分别对全文相同的行和所有有对应关系的行计算最大绝对值，列出产生最大值的双方行号。', '',
               '| 页 | 原 / 本行数 | 配对行数 | 行尾相同 / 全部对齐行 | 全文相同行 | 全文相同行最大基线偏差 | 全部配对行最大基线偏差 |',
               '|---|---|---|---|---|---|---|']
    for i in range(page_count):
        report.append(f'| {i+1} ' + page_statistics(
            pages['original'][i] if i < len(pages['original']) else [],
            pages['local'][i] if i < len(pages['local']) else [],
        ))
    report += ['', '另按原版第 n 页第 m 行直接对本地同页同行，不重排或寻找相似行。'
               '第一列文字结果按原提取字符直接比较；第二列使用上述 Unicode/空白规则；第三、四列仅在第二列基础上'
               '将「戶」按「户」、一个 U+0000 按两个 U+2014（——）计算。此附加比对是文本层诊断，'
               '不能说明实际字形的笔画、大小或墨色相同。分母取该页两边较大的行数，缺失行计作不一致。', '',
               '| 页 | 原提取整行相同 | 归一化整行相同 | 补充两组别名后整行相同 | 同一物理行尾相同（12 字符，含别名） |',
               '|---|---|---|---|---|']
    for i in range(page_count):
        original = pages['original'][i] if i < len(pages['original']) else []
        local = pages['local'][i] if i < len(pages['local']) else []
        report.append(f'| {i+1} | {physical_lines(original, local)} |')
    originals, local = anchors(pages['original'], metadata['original']), anchors(pages['local'], metadata['local'])
    report += ['', '| 项目 | 原版坐标 pt | 本地坐标 pt | 本地减原版 pt | 2pt 验收 |', '|---|---|---|---|---|']
    for key in ['姓名','头像左上角','头像宽高','教育经历','首模块正文首行','专业技能','项目经历']:
        a, b = originals.get(key), local.get(key)
        if a and b:
            dx, dy = b[1]-a[1], b[2]-a[2]
            delta, status = f'{dx:+.2f}, {dy:+.2f}', '通过' if a[0] == b[0] and max(abs(dx),abs(dy)) <= 2 else '有差异'
        else:
            delta, status = '—','待核对'
        report.append(f'| {key} | {coordinates(a)} | {coordinates(b)} | {delta} | {status} |')
    first = next(((a,b) for a,b in pairs if a is None or b is None or a.normalized != b.normalized), None)
    report.append('')
    if first:
        a,b=first
        report.append('首次归一化行文不同。原版'+(f'{line_position(a)}「{markdown_cell(a.text[-36:])}」' if a else '该行未匹配')
                      +'，本地'+(f'{line_position(b)}「{markdown_cell(b.text[-36:])}」' if b else '该行未匹配')+'。详见下表及对照图。')
        if a and b:
            if decoration_insensitive(a.normalized) == decoration_insensitive(b.normalized):
                report.append('该首处行文差异只涉及横线字形、分隔符、项目符号或字体私有区字形，其余文字一致。上表仍计入实际提取差异。')
    else:
        report.append('两份文档的可提取行文一致。')
    mismatch = first_break_difference(rows['original'], rows['local'])
    if mismatch:
        detail = []
        for side, (line, boundary) in zip(('原版','本地'), mismatch):
            detail.append(side + line_position(line) + ('在此换行' if boundary else '此处继续排字'))
        report.append('首次可匹配文字的换行差异在' + '，'.join(detail) + '。')
    else:
        report.append('可匹配文字的行断点未发现差异。')
    differences = glyph_audit(rows['original'], rows['local'])
    if differences:
        report += ['', '文本层字形计数直接取自原始提取结果。下表单列两份文件中数量不同的部首、横线、分隔符、'
                   '户/戶、私有区和空字符。遇到 U+0000 时显示编码。此表仅作诊断，行尾统计保持原来的比较规则。',
                   '', '| 提取的字形 | 原版个数 | 本地个数 |', '|---|---|---|', *differences]
    count = sum(bool(a and b and a.normalized == b.normalized) for a,b in pairs)
    report += ['', f'原版可识别 {len(rows["original"])} 行，本地可识别 {len(rows["local"])} 行，其中 {count} 行全文相同。', '',
               '| 模块 | 原版行和行尾 | 本地行和行尾 | 结果 |', '|---|---|---|---|']
    heading = '页首'
    for a,b in pairs:
        if a and a.normalized in HEADINGS:
            heading = a.normalized
        if not a or not b:
            tag = '仅本地匹配到' if not a else '仅原版匹配到'
        elif a.normalized != b.normalized:
            tag = '行文不同' if a.normalized[-12:] == b.normalized[-12:] else '行文及行尾不同'
        else:
            tag = '相同' if a.page == b.page else '文字相同，跨页位置不同'
        cells = [f'{line_position(line)}　{markdown_cell(line.text[-20:])}' if line else '—' for line in (a,b)]
        report.append(f'| {heading} | {cells[0]} | {cells[1]} | {tag} |')
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('folder', type=Path)
    parser.add_argument('--dpi', type=int, default=144)
    args = parser.parse_args()
    scripts = Path(__file__).resolve().parent
    subprocess.run(['node', str(scripts / 'measure-resume-pdfs.mjs'), str(args.folder.resolve())], check=True)
    fontfile = scripts.parent / 'public/fonts/Chinese-Regular.ttf'
    font = ImageFont.truetype(str(fontfile), 25)
    report = ['# 简历逐页对照', '',
              f'左侧为原版，右侧为本地。两侧都用 Poppler 以 {args.dpi} DPI 原比例绘制。'
              '纸张真实存在且整页为白色时记为空白页，页数不足时记为无此页。', '',
              '坐标原点为 PDF 左上角。文字使用行内最左起点和基线中位数，头像比较图像边框。'
              '同一行按 3pt 基线容差分组，再从左向右读。比较时使用 Unicode NFKC 归并部首异码并忽略空白。'
              '表中保留提取的原始行尾。图标、文本层缺字及正文有增减时，行的配对可能不唯一，需结合相邻行和对照图阅读。', '']
    with tempfile.TemporaryDirectory() as scratch:
        for kind, label in [('ordinary','普通版'), ('markdown','Markdown 版')]:
            report.extend(compare_variant(args.folder, kind, label, args.dpi, font, Path(scratch)))
            report.append('')
    (args.folder / '逐页对照.md').write_text('\n'.join(report), encoding='utf8')
    print('Generated page comparisons and report.')


if __name__ == '__main__':
    main()
