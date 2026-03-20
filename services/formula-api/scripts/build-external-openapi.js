import { readFileSync, writeFileSync } from 'node:fs';
import { load, dump } from 'js-yaml';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const inputPath = resolve(__dirname, '../docs/openapi.yaml');
const outputPath = resolve(__dirname, '../docs/openapi-external.yaml');

const spec = load(readFileSync(inputPath, 'utf8'));

// Remove internal operations; drop empty paths
for (const [path, methods] of Object.entries(spec.paths)) {
  for (const [method, op] of Object.entries(methods)) {
    if (method === 'parameters') continue; // path-level params
    if (op?.['x-internal']) {
      delete methods[method];
    }
  }
  // If only path-level params remain (or empty), drop the path
  const ops = Object.keys(methods).filter(k => k !== 'parameters');
  if (ops.length === 0) delete spec.paths[path];
}

// Strip leftover x-internal keys from remaining operations
for (const methods of Object.values(spec.paths)) {
  for (const [method, op] of Object.entries(methods)) {
    if (method === 'parameters' || !op) continue;
    delete op['x-internal'];
  }
}

// Collect all $ref strings transitively from remaining paths
const refs = new Set();
function collectRefs(obj) {
  if (!obj || typeof obj !== 'object') return;
  if (Array.isArray(obj)) { obj.forEach(collectRefs); return; }
  for (const [key, val] of Object.entries(obj)) {
    if (key === '$ref' && typeof val === 'string') refs.add(val);
    else collectRefs(val);
  }
}
collectRefs(spec.paths);

// Iteratively resolve refs until stable (schemas can reference other schemas)
let prevSize = 0;
while (refs.size > prevSize) {
  prevSize = refs.size;
  for (const ref of [...refs]) {
    const resolved = resolveRef(spec, ref);
    if (resolved) collectRefs(resolved);
  }
}

function resolveRef(root, ref) {
  const parts = ref.replace('#/', '').split('/');
  let node = root;
  for (const p of parts) node = node?.[p];
  return node;
}

// Prune components sections to only referenced items
function pruneSection(section) {
  if (!spec.components?.[section]) return;
  const prefix = `#/components/${section}/`;
  for (const name of Object.keys(spec.components[section])) {
    if (!refs.has(prefix + name)) {
      delete spec.components[section][name];
    }
  }
  if (Object.keys(spec.components[section]).length === 0) {
    delete spec.components[section];
  }
}

pruneSection('schemas');
pruneSection('responses');
pruneSection('securitySchemes');
pruneSection('parameters');

// Clean empty components
if (spec.components && Object.keys(spec.components).length === 0) {
  delete spec.components;
}

const yaml = dump(spec, {
  lineWidth: -1,
  noRefs: true,
  quotingType: '"',
  forceQuotes: false,
  sortKeys: false,
});

writeFileSync(outputPath, yaml, 'utf8');

// Verification
const external = load(readFileSync(outputPath, 'utf8'));
const pathCount = Object.entries(external.paths)
  .reduce((n, [, m]) => n + Object.keys(m).filter(k => k !== 'parameters').length, 0);

console.log(`External spec: ${pathCount} operations across ${Object.keys(external.paths).length} paths`);
console.log(`Written to ${outputPath}`);

// Check for dangling refs
const danglingRefs = [];
function checkRefs(obj, path = '') {
  if (!obj || typeof obj !== 'object') return;
  if (Array.isArray(obj)) { obj.forEach((v, i) => checkRefs(v, `${path}[${i}]`)); return; }
  for (const [key, val] of Object.entries(obj)) {
    if (key === '$ref' && typeof val === 'string') {
      const resolved = resolveRef(external, val);
      if (!resolved) danglingRefs.push(`${path}: ${val}`);
    } else {
      checkRefs(val, `${path}.${key}`);
    }
  }
}
checkRefs(external);
if (danglingRefs.length) {
  console.error(`\nDANGLING REFS:\n${danglingRefs.join('\n')}`);
  process.exit(1);
} else {
  console.log('No dangling $ref found');
}
