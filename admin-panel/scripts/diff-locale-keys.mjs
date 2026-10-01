#!/usr/bin/env node
/**
 * Lists every translation key present in one locale message file but missing
 * from the other, in both directions. Used to find en/pl drift.
 *
 * Usage: node scripts/diff-locale-keys.mjs
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const messagesDir = path.join(__dirname, '..', 'src', 'messages');

function flatten(obj, prefix = '', out = new Set()) {
  for (const [key, value] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      flatten(value, fullKey, out);
    } else {
      out.add(fullKey);
    }
  }
  return out;
}

const en = JSON.parse(readFileSync(path.join(messagesDir, 'en.json'), 'utf8'));
const pl = JSON.parse(readFileSync(path.join(messagesDir, 'pl.json'), 'utf8'));

const enKeys = flatten(en);
const plKeys = flatten(pl);

const inEnNotPl = [...enKeys].filter((k) => !plKeys.has(k)).sort();
const inPlNotEn = [...plKeys].filter((k) => !enKeys.has(k)).sort();

console.log(`en.json total keys: ${enKeys.size}`);
console.log(`pl.json total keys: ${plKeys.size}`);
console.log('');
console.log(`Keys in en.json but MISSING from pl.json (${inEnNotPl.length}):`);
for (const k of inEnNotPl) console.log(`  ${k}`);
console.log('');
console.log(`Keys in pl.json but MISSING from en.json (${inPlNotEn.length}):`);
for (const k of inPlNotEn) console.log(`  ${k}`);
