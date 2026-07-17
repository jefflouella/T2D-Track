/**
 * Import RxTerms (NLM) or a simple CSV/JSON into DrugCatalogEntry.
 *
 * Native RxTerms: pipe-delimited RxTermsYYYYMM.txt from
 * https://data.lhncbc.nlm.nih.gov/public/rxterms/release/
 *
 * Also accepts flexible CSV or JSON array:
 * {displayName, synonyms, isBrand, genericDisplayName, strengthsAndForms}
 */
import fs from 'node:fs';
import path from 'node:path';
import '../src/loadEnv.js';
import { replaceCatalog } from '../src/services/catalog.js';
import { prisma } from '../src/db.js';

const file = process.argv[2];
if (!file) {
  console.error('Usage: node scripts/import-rxterms.js <path-to-RxTerms.txt|csv|json>');
  process.exit(1);
}

const abs = path.resolve(file);
const raw = fs.readFileSync(abs, 'utf8');
const version = `import-${path.basename(abs)}-${new Date().toISOString().slice(0, 10)}`;

function splitCsvLine(line) {
  return (
    line.match(/("([^"]|"")*"|[^,]*)/g)?.map((c) => c.replace(/^"|"$/g, '').replace(/""/g, '"')) || []
  );
}

function parseFlexibleCsv(text) {
  const lines = text.split(/\r?\n/).filter(Boolean);
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
    const cols = splitCsvLine(line);
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
  return [...map.values()];
}

/**
 * Parse NLM RxTermsYYYYMM.txt (pipe-delimited).
 * Groups by DISPLAY_NAME; skips suppressed/retired rows.
 */
function parseNativeRxTerms(text) {
  const lines = text.split(/\r?\n/).filter(Boolean);
  const header = lines[0].split('|').map((h) => h.trim().toUpperCase());
  const col = (name) => header.indexOf(name);
  const iDisplay = col('DISPLAY_NAME');
  const iSyn = col('DISPLAY_NAME_SYNONYM');
  const iBrand = col('BRAND_NAME');
  const iGenericFull = col('FULL_GENERIC_NAME');
  const iStrength = col('STRENGTH');
  const iForm = col('NEW_DOSE_FORM');
  const iRxcui = col('RXCUI');
  const iSuppress = col('SUPPRESS_FOR');
  const iRetired = col('IS_RETIRED');

  if (iDisplay < 0) {
    throw new Error('Not a native RxTerms file (missing DISPLAY_NAME column)');
  }

  const map = new Map();
  for (const line of lines.slice(1)) {
    const cols = line.split('|');
    const suppress = iSuppress >= 0 ? cols[iSuppress]?.trim() : '';
    const retired = iRetired >= 0 ? cols[iRetired]?.trim() : '';
    if (suppress || String(retired).toUpperCase() === 'TRUE') continue;

    const displayName = cols[iDisplay]?.trim();
    if (!displayName) continue;

    const brand = iBrand >= 0 ? cols[iBrand]?.trim() : '';
    const isBrand = Boolean(brand);
    if (!map.has(displayName)) {
      let genericDisplayName = null;
      if (iGenericFull >= 0 && cols[iGenericFull]) {
        // Prefer a short generic label from the full generic name (before strength).
        const g = cols[iGenericFull].trim();
        genericDisplayName = g.split(/\s+\d/)[0]?.trim() || g.slice(0, 80);
      }
      map.set(displayName, {
        displayName,
        synonyms: [],
        isBrand,
        genericDisplayName: isBrand ? genericDisplayName : null,
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
    // Brand display names are uppercase; also index lowercase brand as synonym for search.
    if (brand) {
      const nice = brand
        .split(/\s+/)
        .map((w) => w.charAt(0) + w.slice(1).toLowerCase())
        .join(' ');
      if (nice && !entry.synonyms.includes(nice) && nice.toUpperCase() !== displayName.toUpperCase()) {
        entry.synonyms.push(nice);
      }
    }
    const strength = iStrength >= 0 ? cols[iStrength]?.trim() : '';
    if (strength) {
      const form = iForm >= 0 ? cols[iForm]?.trim() || null : null;
      const rxcui = iRxcui >= 0 ? cols[iRxcui]?.trim() || null : null;
      const exists = entry.strengthsAndForms.some(
        (s) => s.strength === strength && s.form === form && s.rxcui === rxcui,
      );
      if (!exists) {
        entry.strengthsAndForms.push({ strength, form, rxcui });
      }
    }
  }
  return [...map.values()];
}

let entries = [];
if (abs.endsWith('.json')) {
  entries = JSON.parse(raw);
} else if (raw.includes('DISPLAY_NAME|') || raw.startsWith('RXCUI|')) {
  console.log('Detected native RxTerms pipe format…');
  entries = parseNativeRxTerms(raw);
} else {
  entries = parseFlexibleCsv(raw);
}

console.log(`Parsed ${entries.length} unique display names; writing to database…`);
const result = await replaceCatalog(entries, version);
console.log(`Imported ${result.count} catalog entries from ${abs} (${version})`);
await prisma.$disconnect();
