#!/usr/bin/env node
/**
 * Seed bl_widget_templates from built-in JSON files.
 * Inserts templates where no matching tool_binding + resource_binding IS NULL exists.
 * Idempotent — safe to run repeatedly.
 *
 * Usage: node scripts/seed-widget-templates.js
 * Requires DATABASE_URL env var.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import pg from 'pg';

const __dirname = dirname(fileURLToPath(import.meta.url));
const templatesDir = join(__dirname, '..', 'src', 'widgets', 'templates');

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('DATABASE_URL required. Set it or use: node --env-file=.env scripts/seed-widget-templates.js');
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: databaseUrl, max: 2 });

async function seed() {
  const files = readdirSync(templatesDir).filter(f => f.endsWith('.json'));
  console.log(`Found ${files.length} template files`);

  let seeded = 0;
  let skipped = 0;

  for (const file of files) {
    const raw = readFileSync(join(templatesDir, file), 'utf-8');
    const tpl = JSON.parse(raw);

    if (!tpl.tool_binding) {
      console.log(`  SKIP ${file} — no tool_binding`);
      skipped++;
      continue;
    }

    // Check if already exists
    const existing = await pool.query(
      `SELECT id FROM bl_widget_templates
       WHERE tool_binding = $1 AND resource_binding IS NULL LIMIT 1`,
      [tpl.tool_binding]
    );

    if (existing.rows.length > 0) {
      console.log(`  SKIP ${file} — ${tpl.tool_binding} already in DB`);
      skipped++;
      continue;
    }

    // Insert
    await pool.query(
      `INSERT INTO bl_widget_templates (id, name, description, tool_binding, resource_binding, template, data_mapping, status, sort, date_created, date_updated)
       VALUES ($1, $2, $3, $4, NULL, $5, $6, 'published', $7, NOW(), NOW())`,
      [
        randomUUID(),
        tpl.name,
        tpl.description || null,
        tpl.tool_binding,
        typeof tpl.template === 'string' ? tpl.template : JSON.stringify(tpl.template),
        typeof tpl.data_mapping === 'string' ? tpl.data_mapping : JSON.stringify(tpl.data_mapping),
        tpl.sort || 1,
      ]
    );

    console.log(`  SEED ${file} → ${tpl.tool_binding}`);
    seeded++;
  }

  console.log(`Done: ${seeded} seeded, ${skipped} skipped`);
  await pool.end();
}

seed().catch(err => {
  console.error('Seed failed:', err.message);
  process.exit(1);
});
