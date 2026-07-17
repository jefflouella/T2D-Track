import { prisma } from '../db.js';
import { HttpError, toDecimal } from '../util.js';
import { writeAudit } from './audit.js';

async function getProfile(profileId) {
  const profile = await prisma.personProfile.findUnique({ where: { id: profileId } });
  if (!profile) throw new HttpError(404, 'Profile not found');
  return profile;
}

export async function createBloodSugar({ profileId, userId, data }) {
  const profile = await getProfile(profileId);
  const reading = await prisma.bloodSugarReading.create({
    data: {
      personProfileId: profileId,
      value: toDecimal(data.value),
      unit: data.unit || profile.glucoseUnit,
      context: data.context || 'random',
      takenAt: data.takenAt ? new Date(data.takenAt) : new Date(),
      notes: data.notes || null,
      recordedByUserId: userId,
    },
  });
  await writeAudit({
    householdId: profile.householdId,
    personProfileId: profileId,
    actorUserId: userId,
    action: 'health.blood_sugar.created',
    entityType: 'BloodSugarReading',
    entityId: reading.id,
    summary: 'Logged blood sugar reading',
  });
  return reading;
}

export async function createWeight({ profileId, userId, data }) {
  const profile = await getProfile(profileId);
  const reading = await prisma.weightReading.create({
    data: {
      personProfileId: profileId,
      value: toDecimal(data.value),
      unit: data.unit || profile.weightUnit,
      takenAt: data.takenAt ? new Date(data.takenAt) : new Date(),
      notes: data.notes || null,
      recordedByUserId: userId,
    },
  });
  return reading;
}

export async function createKetone({ profileId, userId, data }) {
  const profile = await getProfile(profileId);
  const reading = await prisma.ketoneReading.create({
    data: {
      personProfileId: profileId,
      value: toDecimal(data.value),
      unit: data.unit || 'mmol_L',
      context: data.context || 'random',
      takenAt: data.takenAt ? new Date(data.takenAt) : new Date(),
      notes: data.notes || null,
      recordedByUserId: userId,
    },
  });
  await writeAudit({
    householdId: profile.householdId,
    personProfileId: profileId,
    actorUserId: userId,
    action: 'health.ketone.created',
    entityType: 'KetoneReading',
    entityId: reading.id,
    summary: 'Logged ketone reading',
  });
  return reading;
}

export async function createBloodPressure({ profileId, userId, data }) {
  const profile = await getProfile(profileId);
  const reading = await prisma.bloodPressureReading.create({
    data: {
      personProfileId: profileId,
      systolic: data.systolic,
      diastolic: data.diastolic,
      pulse: data.pulse ?? null,
      context: data.context || 'other',
      takenAt: data.takenAt ? new Date(data.takenAt) : new Date(),
      notes: data.notes || null,
      recordedByUserId: userId,
    },
  });
  return reading;
}

export async function createA1c({ profileId, userId, data }) {
  const profile = await getProfile(profileId);
  const reading = await prisma.a1CReading.create({
    data: {
      personProfileId: profileId,
      valuePercent: toDecimal(data.valuePercent),
      takenAt: data.takenAt ? new Date(data.takenAt) : new Date(),
      laboratory: data.laboratory || null,
      notes: data.notes || null,
      recordedByUserId: userId,
    },
  });
  return reading;
}

export async function softDeleteReading(model, id, userId) {
  const reading = await model.findUnique({ where: { id } });
  if (!reading || reading.deletedAt) throw new HttpError(404, 'Reading not found');
  return model.update({
    where: { id },
    data: { deletedAt: new Date(), deletedByUserId: userId },
  });
}

export async function listReadings(model, profileId, { from, to, context, cursor, take = 50 }) {
  const where = {
    personProfileId: profileId,
    deletedAt: null,
  };
  if (from || to) {
    where.takenAt = {};
    if (from) where.takenAt.gte = new Date(from);
    if (to) where.takenAt.lte = new Date(to);
  }
  if (context) where.context = context;
  if (cursor) where.id = { lt: cursor };

  const limit = Math.min(Math.max(Number(take) || 50, 1), 500);

  return model.findMany({
    where,
    orderBy: [{ takenAt: 'desc' }, { id: 'desc' }],
    take: limit,
  });
}

export async function upsertHealthTargets(profileId, userId, targets) {
  const profile = await getProfile(profileId);
  const results = [];
  for (const t of targets) {
    const row = await prisma.healthTarget.upsert({
      where: {
        personProfileId_metricType_context: {
          personProfileId: profileId,
          metricType: t.metricType,
          context: t.context || 'any',
        },
      },
      create: {
        personProfileId: profileId,
        metricType: t.metricType,
        context: t.context || 'any',
        lowValue: t.lowValue != null ? toDecimal(t.lowValue) : null,
        highValue: t.highValue != null ? toDecimal(t.highValue) : null,
        unit: t.unit,
        label: t.label || null,
        createdByUserId: userId,
      },
      update: {
        lowValue: t.lowValue != null ? toDecimal(t.lowValue) : null,
        highValue: t.highValue != null ? toDecimal(t.highValue) : null,
        unit: t.unit,
        label: t.label || null,
      },
    });
    results.push(row);
  }
  await writeAudit({
    householdId: profile.householdId,
    personProfileId: profileId,
    actorUserId: userId,
    action: 'health.targets.updated',
    entityType: 'HealthTarget',
    entityId: profileId,
    summary: 'Updated personal health target ranges',
  });
  return results;
}

export function computeTimeInRange(readings, target) {
  if (!target || (target.lowValue == null && target.highValue == null)) {
    return null;
  }
  const low = target.lowValue != null ? Number(target.lowValue) : -Infinity;
  const high = target.highValue != null ? Number(target.highValue) : Infinity;
  if (!readings.length) {
    return { inRange: 0, total: 0, percent: null, label: 'personal settings' };
  }
  let inRange = 0;
  for (const r of readings) {
    const v = Number(r.value);
    if (v >= low && v <= high) inRange += 1;
  }
  return {
    inRange,
    total: readings.length,
    percent: Math.round((inRange / readings.length) * 1000) / 10,
    label: 'Measured against personal settings',
  };
}

export async function doseCompletionSummary(profileId, days) {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const events = await prisma.doseEvent.findMany({
    where: {
      personProfileId: profileId,
      scheduledFor: { gte: since },
      status: { in: ['taken', 'skipped', 'missed', 'pending', 'snoozed'] },
    },
  });
  const relevant = events.filter((e) => ['taken', 'skipped', 'missed'].includes(e.status));
  const taken = relevant.filter((e) => e.status === 'taken').length;
  return {
    days,
    taken,
    total: relevant.length,
    percent: relevant.length ? Math.round((taken / relevant.length) * 1000) / 10 : null,
  };
}
