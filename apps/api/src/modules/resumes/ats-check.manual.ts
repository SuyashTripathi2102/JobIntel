/* eslint-disable no-console */
/**
 * Manual harness: run the real checker over real PDFs.
 *   npx ts-node -T src/modules/resumes/ats-check.manual.ts <file.pdf> [...]
 */
import { readFileSync } from 'fs';
import { PDFParse } from 'pdf-parse';
import { checkAts } from './ats-check';

async function main() {
  for (const file of process.argv.slice(2)) {
    const parser = new PDFParse({ data: new Uint8Array(readFileSync(file)) });
    const { text } = await parser.getText();
    await parser.destroy();

    const r = checkAts(text ?? '');
    console.log(`\n${file.split(/[\\/]/).pop()}`);
    console.log(`  ${r.verdict}  score ${r.score}/100  letterRatio ${r.letterRatio}`);
    for (const c of r.checks) {
      console.log(`  ${c.pass ? 'PASS' : 'FAIL'}  ${c.label} — ${c.detail}`);
    }
    if (r.warning) console.log(`  ! ${r.warning}`);
  }
}

void main();
