import { prisma } from '../db.js';
import { HttpError, toDecimal } from '../util.js';
import { writeAudit } from './audit.js';
import { DateTime } from 'luxon';

export async function searchDrugCatalog(q, limit = 20) {
  const query = String(q || '').trim();
  if (query.length < 2) return [];
  const rows = await prisma.$queryRaw`
    SELECT id, display_name as "displayName", synonyms, is_brand as "isBrand",
           generic_display_name as "genericDisplayName", strengths_and_forms as "strengthsAndForms",
           source_version as "sourceVersion"
    FROM drug_catalog_entries
    WHERE display_name ILIKE ${'%' + query + '%'}
       OR EXISTS (
         SELECT 1 FROM unnest(synonyms) s WHERE s ILIKE ${'%' + query + '%'}
       )
       OR COALESCE(generic_display_name, '') ILIKE ${'%' + query + '%'}
    ORDER BY display_name ASC
    LIMIT ${limit}
  `;
  return rows;
}

export async function replaceCatalog(entries, sourceVersion) {
  return prisma.$transaction(async (tx) => {
    await tx.drugCatalogEntry.deleteMany();
    if (!entries.length) return { count: 0 };
    // createMany in chunks
    const chunkSize = 500;
    let count = 0;
    for (let i = 0; i < entries.length; i += chunkSize) {
      const chunk = entries.slice(i, i + chunkSize).map((e) => ({
        displayName: e.displayName,
        synonyms: e.synonyms || [],
        isBrand: Boolean(e.isBrand),
        genericDisplayName: e.genericDisplayName || null,
        strengthsAndForms: e.strengthsAndForms || [],
        sourceVersion,
      }));
      const result = await tx.drugCatalogEntry.createMany({ data: chunk });
      count += result.count;
    }
    return { count, sourceVersion };
  });
}

export async function createSupply({ profileId, userId, data }) {
  const profile = await prisma.personProfile.findUnique({ where: { id: profileId } });
  if (!profile) throw new HttpError(404, 'Profile not found');
  const item = await prisma.supplyItem.create({
    data: {
      personProfileId: profileId,
      name: data.name,
      stockUnit: data.stockUnit,
      refillThresholdDays: data.refillThresholdDays ?? null,
      expectedDailyUse: data.expectedDailyUse != null ? toDecimal(data.expectedDailyUse) : null,
      currentStockCache: toDecimal(data.openingBalance ?? 0),
    },
  });
  if (data.openingBalance != null && Number(data.openingBalance) !== 0) {
    await prisma.inventoryTransaction.create({
      data: {
        supplyItemId: item.id,
        kind: 'opening',
        quantityDelta: toDecimal(data.openingBalance),
        balanceAfter: toDecimal(data.openingBalance),
        occurredAt: new Date(),
        recordedByUserId: userId,
        notes: 'Opening balance',
      },
    });
  }
  await writeAudit({
    householdId: profile.householdId,
    personProfileId: profileId,
    actorUserId: userId,
    action: 'supply.created',
    entityType: 'SupplyItem',
    entityId: item.id,
    summary: `Added supply ${item.name}`,
  });
  return item;
}

export async function applySupplyInventory({
  supplyItemId,
  kind,
  quantityDelta,
  userId,
  notes,
  idempotencyKey,
}) {
  if (idempotencyKey) {
    const existing = await prisma.inventoryTransaction.findUnique({
      where: { idempotencyKey },
    });
    if (existing) return existing;
  }
  return prisma.$transaction(async (tx) => {
    const item = await tx.supplyItem.findUnique({ where: { id: supplyItemId } });
    if (!item) throw new HttpError(404, 'Supply not found');
    const next = toDecimal(item.currentStockCache).plus(toDecimal(quantityDelta));
    const txn = await tx.inventoryTransaction.create({
      data: {
        supplyItemId,
        kind,
        quantityDelta: toDecimal(quantityDelta),
        balanceAfter: next,
        occurredAt: new Date(),
        recordedByUserId: userId,
        notes: notes || null,
        idempotencyKey: idempotencyKey || null,
      },
    });
    await tx.supplyItem.update({
      where: { id: supplyItemId },
      data: { currentStockCache: next },
    });
    return txn;
  });
}

export async function createLabResult({ profileId, userId, data }) {
  return prisma.labResult.create({
    data: {
      personProfileId: profileId,
      testName: data.testName,
      value: toDecimal(data.value),
      unit: data.unit,
      takenAt: data.takenAt ? new Date(data.takenAt) : new Date(),
      laboratory: data.laboratory || null,
      notes: data.notes || null,
      recordedByUserId: userId,
    },
  });
}

export async function createSymptomNote({ profileId, userId, data }) {
  return prisma.symptomNote.create({
    data: {
      personProfileId: profileId,
      kind: data.kind || 'symptom',
      summary: data.summary,
      details: data.details || null,
      mood: data.mood != null ? Number(data.mood) : null,
      tags: Array.isArray(data.tags) ? data.tags : [],
      startedAt: data.startedAt ? new Date(data.startedAt) : new Date(),
      endedAt: data.endedAt ? new Date(data.endedAt) : null,
      recordedByUserId: userId,
    },
  });
}

export async function upsertDailyCheckIn({ profileId, userId, data, timezone }) {
  const zone = timezone || 'UTC';
  const day = data.localDate
    ? DateTime.fromISO(data.localDate, { zone }).startOf('day')
    : DateTime.now().setZone(zone).startOf('day');
  const start = day.toUTC().toJSDate();
  const end = day.endOf('day').toUTC().toJSDate();

  const tags = Array.isArray(data.tags) ? data.tags : [];
  const mood = data.mood != null ? Number(data.mood) : null;
  const noteText = data.details || data.note || null;
  const summaryParts = [];
  if (mood != null) summaryParts.push(`Mood ${mood}/5`);
  if (tags.length) summaryParts.push(tags.join(', '));
  const summary = data.summary || summaryParts.join(' · ') || 'Daily check-in';

  const existing = await prisma.symptomNote.findFirst({
    where: {
      personProfileId: profileId,
      kind: 'check_in',
      startedAt: { gte: start, lte: end },
    },
    orderBy: { startedAt: 'desc' },
  });

  if (existing) {
    return prisma.symptomNote.update({
      where: { id: existing.id },
      data: {
        summary,
        details: noteText,
        mood,
        tags,
        recordedByUserId: userId,
      },
    });
  }

  return prisma.symptomNote.create({
    data: {
      personProfileId: profileId,
      kind: 'check_in',
      summary,
      details: noteText,
      mood,
      tags,
      startedAt: day.set({ hour: 12 }).toUTC().toJSDate(),
      recordedByUserId: userId,
    },
  });
}

export async function importBloodSugarCsv({ profileId, userId, csvText }) {
  const profile = await prisma.personProfile.findUnique({ where: { id: profileId } });
  if (!profile) throw new HttpError(404, 'Profile not found');
  const lines = String(csvText)
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (!lines.length) throw new HttpError(400, 'CSV is empty');

  const header = lines[0].toLowerCase();
  const hasHeader = header.includes('value') || header.includes('glucose') || header.includes('taken');
  const rows = hasHeader ? lines.slice(1) : lines;
  let imported = 0;
  const errors = [];

  for (let i = 0; i < rows.length; i += 1) {
    const parts = rows[i].split(',').map((p) => p.trim().replace(/^"|"$/g, ''));
    // expected: taken_at,value,unit?,context?,notes?
    const takenAt = parts[0];
    const value = parts[1];
    const unit = parts[2] || profile.glucoseUnit;
    const context = parts[3] || 'random';
    const notes = parts[4] || null;
    if (!takenAt || value == null || value === '') {
      errors.push({ line: i + 1, error: 'missing taken_at or value' });
      continue;
    }
    try {
      await prisma.bloodSugarReading.create({
        data: {
          personProfileId: profileId,
          value: toDecimal(value),
          unit: unit === 'mmol_L' || unit === 'mmol/L' ? 'mmol_L' : 'mg_dL',
          context: [
            'fasting',
            'before_meal',
            'after_meal',
            'bedtime',
            'exercise',
            'illness',
            'random',
            'other',
          ].includes(context)
            ? context
            : 'other',
          takenAt: new Date(takenAt),
          notes,
          recordedByUserId: userId,
        },
      });
      imported += 1;
    } catch (err) {
      errors.push({ line: i + 1, error: err.message });
    }
  }

  return { imported, errors };
}
