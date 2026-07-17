/**
 * Import RxTerms-style CSV into DrugCatalogEntry.
 * Expected columns (flexible): DISPLAY_NAME, SYNONYM, IS_BRAND, GENERIC_NAME, STRENGTH, FORM, RXCUI
 * Or JSON array file with {displayName, synonyms, isBrand, genericDisplayName, strengthsAndForms}
 */
import fs from 'node:fs';
import path from 'node:path';
import '../src/loadEnv.js';
import { replaceCatalog } from '../src/services/catalog.js';
import { prisma } from '../src/db.js';

const file = process.argv[2];
if (!file) {
  console.error('Usage: node scripts/import-rxterms.js <path-to.csv|json>');
  process.exit(1);
}

const abs = path.resolve(file);
const raw = fs.readFileSync(abs, 'utf8');
const version = `import-${path.basename(abs)}-${new Date().toISOString().slice(0, 10)}`;

let entries = [];
if (abs.endsWith('.json')) {
  entries = JSON.parse(raw);
} else {
  const lines = raw.split(/\r?\n/).filter(Boolean);
  const header = lines[0].split(',').map((h) => h.trim().replace(/^"|"$/g, '').toLowerCase());
  const idx = (name) => header.findIndex((h) => h.includes(name));
  const iName = idx('display') >= 0 ? idx('display') : idx('name');
  const iSyn = idx('synonym');
  const iBrand = idx('brand');
  const iGeneric = idx('generic');
  const iStrength = idx('strength');
  const iForm = idx('form');
  const iRxcui = idx('rxcui') >= 0 ? idx('rxcui') : idx('rxnorm');

  const map = new Map();
  for (const line of lines.slice(1)) {
    const cols = line.match(/("([^"]|"")*"|[^,]*)/g)?.map((c) => c.replace(/^"|"$/g, '').replace(/""/g, '"')) || [];
    const displayName = cols[iName];
    if (!displayName) continue;
    if (!map.has(displayName)) {
      map.set(displayName, {
        displayName,
        synonyms: [],
        isBrand: String(cols[iBrand] || '').toLowerCase() === 'true' || String(cols[iBrand]) === '1',
        genericDisplayName: iGeneric >= 0 ? cols[iGeneric] || null : null,
        strengthsAndForms: [],
      });
    }
    const entry = map.get(displayName);
    if (iSyn >= 0 && cols[iSyn]) {
      for (const s of cols[iSyn].split(';')) {
        const t = s.trim();
        if (t && !entry.synonyms.includes(t)) entry.synonyms.push(t);
      }
    }
    if (iStrength >= 0 && cols[iStrength]) {
      entry.strengthsAndForms.push({
        strength: cols[iStrength],
        form: iForm >= 0 ? cols[iForm] || null : null,
        rxcui: iRxcui >= 0 ? cols[iRxcui] || null : null,
      });
    }
  }
  entries = [...map.values()];
}

const result = await replaceCatalog(entries, version);
console.log(`Imported ${result.count} catalog entries from ${abs}`);
await prisma.$disconnect();
