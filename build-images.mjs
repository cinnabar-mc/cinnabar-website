/** Write smaller WebP copies of the logotype, so pages need not download the full PNG to show it. */
import sharp from 'sharp';
import { join } from 'node:path';

const [source, output, ...widths] = process.argv.slice(2);
if (!source || !output || !widths.length) throw new Error('Pass the logotype, an output directory and at least one width.');
for (const width of widths.map(Number)) {
  if (!Number.isInteger(width) || width < 1) throw new Error('Widths must be whole pixels.');
  await sharp(source).resize({ width }).webp({ quality: 86, alphaQuality: 100, effort: 6 })
    .toFile(join(output, `title-${width}.webp`));
}
