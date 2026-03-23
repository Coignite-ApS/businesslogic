import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const distDir = join(__dirname, '..', 'dist');

const files = ['bl-calculator.es.js', 'bl-calculator.iife.js'];
const hashes = {};

for (const file of files) {
  const content = readFileSync(join(distDir, file));
  const hash = createHash('sha384').update(content).digest('base64');
  hashes[file] = `sha384-${hash}`;
}

writeFileSync(join(distDir, 'sri.json'), JSON.stringify(hashes, null, 2) + '\n');
console.log('SRI hashes generated:');
for (const [file, hash] of Object.entries(hashes)) {
  console.log(`  ${file}: ${hash}`);
}
