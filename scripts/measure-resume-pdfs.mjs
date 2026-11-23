import fs from 'node:fs/promises';
import path from 'node:path';
import { getDocument, OPS, Util } from 'pdfjs-dist/legacy/build/pdf.mjs';

const folder = process.argv[2];
if (!folder) throw new Error('Usage: node scripts/measure-resume-pdfs.mjs <comparison directory>');

for (const mode of ['ordinary', 'markdown']) {
  for (const source of ['original', 'local']) {
    const prefix = path.join(folder, mode + '-' + source);
    const job = getDocument({ data: new Uint8Array(await fs.readFile(prefix + '.pdf')), useSystemFonts: false });
    try {
      const pdf = await job.promise;
      const pages = [];
      for (let number = 1; number <= pdf.numPages; number++) {
        const page = await pdf.getPage(number);
        const { width, height } = page.getViewport({ scale: 1 });
        const content = await page.getTextContent();
        const items = content.items.filter(item => item.str?.trim()).map(item => ({
          s: item.str, x: item.transform[4], y: height - item.transform[5],
          w: item.width, h: item.height, f: item.fontName,
        }));
        let matrix = [1, 0, 0, 1, 0, 0];
        const stack = [], photos = [];
        const operators = await page.getOperatorList();
        operators.fnArray.forEach((op, index) => {
          if (op === OPS.save) stack.push(matrix);
          else if (op === OPS.restore) matrix = stack.pop() ?? matrix;
          else if (op === OPS.transform) matrix = Util.transform(matrix, operators.argsArray[index]);
          else if (op === OPS.paintImageXObject || op === OPS.paintInlineImageXObject) photos.push(matrix);
        });
        pages.push({ items, photos, width, height });
      }
      await fs.writeFile(prefix + '.json', JSON.stringify(pages));
    } finally {
      await job.destroy();
    }
  }
}
