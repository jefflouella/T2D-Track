import { DateTime } from 'luxon';
import { prisma } from '../db.js';
import { HttpError, toDecimal } from '../util.js';
import { applyInventoryChange, reverseTransaction } from './inventory.js';
import { writeAudit } from './audit.js';
import { randomToken } from '../crypto.js';

function parseTimeOfDay(timeOfDay) {
  const [h, m] = timeOfDay.split(':').map(Number);
  return { hour: h, minute: m || 0 };
}

function weekdayKey(dt) {
  return dt.toFormat('ccc').toLowerCase().slice(0, 3);
}

const WEEKDAY_MAP = {
  mon: 'mon',
  tue: 'tue',
  wed: 'wed',
  thu: 'thu',
  fri: 'fri',
  sat: 'sat',
  sun: 'sun',
  monday: 'mon',
  tuesday: 'tue',
  wednesday: 'wed',
  thursday: 'thu',
  friday: 'fri',
  saturday: 'sat',
  sunday: 'sun',
};

function normalizeDays(days) {
  return (days || []).map((d) => WEEKDAY_MAP[String(d).toLowerCase()] || d);
}

export function scheduleOccursOnLocalDate(schedule, localDate) {
  if (!schedule.active) return false;
  const start = DateTime.fromJSDate(schedule.startDate, { zone: 'utc' }).toISODate();
  const end = schedule.endDate
    ? DateTime.fromJSDate(schedule.endDate, { zone: 'utc' }).toISODate()
    : null;
  const iso = localDate.toISODate();
  if (iso < start) return false;
  if (end && iso > end) return false;

  if (schedule.scheduleType === 'daily') return true;
  if (schedule.scheduleType === 'weekly') {
    const days = normalizeDays(schedule.daysOfWeek);
    return days.includes(weekdayKey(localDate));
  }
  if (schedule.scheduleType === 'interval') {
    // Interval schedules are generated from last dose / start, not once-per-day.
    return false;
  }
  return false;
}

export function scheduledDateTime(schedule, localDate, timezone) {
  if (!schedule.timeOfDay) return null;
  const { hour, minute } = parseTimeOfDay(schedule.timeOfDay);
  return localDate.set({ hour, minute, second: 0, millisecond: 0 }).setZone(timezone, {
    keepLocalTime: true,
  });
}

/**
 * Generate missing dose events from fromDt through toDt (inclusive local days).
 */
export async function generateDoseEventsForProfile(profileId, fromUtc, toUtc) {
  const profile = await prisma.personProfile.findUnique({ where: { id: profileId } });
  if (!profile) return { created: 0 };

  const meds = await prisma.medication.findMany({
    where: {
      personProfileId: profileId,
      status: 'active',
      OR: [{ holdUntil: null }, { holdUntil: { lt: new Date() } }],
    },
    include: {
      schedules: {
        where: { active: true, scheduleType: { in: ['daily', 'weekly', 'interval'] } },
      },
    },
  });

  const zone = profile.timezone;
  let cursor = DateTime.fromJSDate(fromUtc, { zone: 'utc' }).setZone(zone).startOf('day');
  const end = DateTime.fromJSDate(toUtc, { zone: 'utc' }).setZone(zone).endOf('day');
  let created = 0;

  // Interval schedules: create next occurrence after last taken/pending through catch-up window.
  for (const med of meds) {
    for (const schedule of med.schedules.filter((s) => s.scheduleType === 'interval')) {
      const hours = schedule.intervalHours || 24;
      const last = await prisma.doseEvent.findFirst({
        where: { scheduleId: schedule.id },
        orderBy: { scheduledFor: 'desc' },
      });
      let next = last?.scheduledFor
        ? DateTime.fromJSDate(last.scheduledFor, { zone: 'utc' }).plus({ hours })
        : DateTime.fromJSDate(schedule.startDate, { zone: 'utc' })
            .setZone(zone)
            .startOf('day')
            .toUTC();
      const windowEnd = DateTime.fromJSDate(toUtc, { zone: 'utc' });
      while (next <= windowEnd) {
        const scheduledFor = next.toJSDate();
        const existing = await prisma.doseEvent.findFirst({
          where: { scheduleId: schedule.id, scheduledFor },
        });
        if (!existing) {
          try {
            await prisma.doseEvent.create({
              data: {
                medicationId: med.id,
                scheduleId: schedule.id,
                personProfileId: profileId,
                scheduledFor,
                localScheduledDate: new Date(next.setZone(zone).toISODate()),
                status: 'pending',
                source: 'app',
              },
            });
            created += 1;
          } catch (err) {
            if (err?.code !== 'P2002') throw err;
          }
        }
        next = next.plus({ hours });
      }
    }
  }

  while (cursor <= end) {
    for (const med of meds) {
      for (const schedule of med.schedules.filter((s) => s.scheduleType !== 'interval')) {
        if (!scheduleOccursOnLocalDate(schedule, cursor)) continue;
        const scheduledLocal = scheduledDateTime(schedule, cursor, zone);
        if (!scheduledLocal) continue;
        const scheduledFor = scheduledLocal.toUTC().toJSDate();
        const existing = await prisma.doseEvent.findFirst({
          where: { scheduleId: schedule.id, scheduledFor },
        });
        if (existing) continue;
        try {
          await prisma.doseEvent.create({
            data: {
              medicationId: med.id,
              scheduleId: schedule.id,
              personProfileId: profileId,
              scheduledFor,
              localScheduledDate: new Date(cursor.toISODate()),
              status: 'pending',
              source: 'app',
            },
          });
          created += 1;
        } catch (err) {
          if (err?.code !== 'P2002') throw err;
        }
      }
    }
    cursor = cursor.plus({ days: 1 });
  }

  return { created };
}

export async function advanceOverdueAndMissed(now = new Date()) {
  const pending = await prisma.doseEvent.findMany({
    where: { status: { in: ['pending', 'snoozed'] } },
    include: { schedule: true, personProfile: true },
  });

  let overdue = 0;
  let missed = 0;
  const nowDt = DateTime.fromJSDate(now, { zone: 'utc' });

  for (const event of pending) {
    if (!event.scheduledFor) continue;
    const scheduled = DateTime.fromJSDate(event.scheduledFor, { zone: 'utc' });
    const grace = event.schedule?.gracePeriodMinutes ?? 120;
    const graceEnd = scheduled.plus({ minutes: grace });
    const zone = event.personProfile.timezone;
    const localDayEnd = scheduled.setZone(zone).endOf('day').toUTC();

    if (event.status === 'snoozed' && event.snoozedUntil && event.snoozedUntil > now) {
      continue;
    }

    if (nowDt > localDayEnd || nowDt > graceEnd.plus({ hours: 12 })) {
      await prisma.doseEvent.update({
        where: { id: event.id },
        data: { status: 'missed' },
      });
      missed += 1;
    }
  }

  return { overdue, missed };
}

export async function getTodayBoard(profileId, dateIso) {
  const profile = await prisma.personProfile.findUnique({ where: { id: profileId } });
  if (!profile) throw new HttpError(404, 'Profile not found');

  const zone = profile.timezone;
  const day = dateIso
    ? DateTime.fromISO(dateIso, { zone })
    : DateTime.now().setZone(zone);
  const start = day.startOf('day').toUTC().toJSDate();
  const end = day.endOf('day').toUTC().toJSDate();
  const now = DateTime.now().setZone(zone);

  await generateDoseEventsForProfile(profileId, start, end);
  await advanceOverdueAndMissed();

  const events = await prisma.doseEvent.findMany({
    where: {
      personProfileId: profileId,
      OR: [
        { localScheduledDate: new Date(day.toISODate()) },
        {
          scheduledFor: { gte: start, lte: end },
        },
        {
          status: 'snoozed',
          snoozedUntil: { gte: start, lte: end },
        },
      ],
    },
    include: {
      medication: true,
      schedule: true,
    },
    orderBy: [{ scheduledFor: 'asc' }],
  });

  const groups = {
    dueNow: [],
    upcoming: [],
    overdue: [],
    completed: [],
    skipped: [],
  };

  for (const event of events) {
    if (event.status === 'taken') {
      groups.completed.push(event);
      continue;
    }
    if (event.status === 'skipped') {
      groups.skipped.push(event);
      continue;
    }
    if (event.status === 'missed') {
      groups.overdue.push(event);
      continue;
    }

    const scheduled = event.scheduledFor
      ? DateTime.fromJSDate(event.scheduledFor, { zone: 'utc' }).setZone(zone)
      : null;
    const grace = event.schedule?.gracePeriodMinutes ?? 120;

    if (event.status === 'snoozed' && event.snoozedUntil && event.snoozedUntil > new Date()) {
      groups.upcoming.push(event);
      continue;
    }

    if (scheduled && now > scheduled.plus({ minutes: grace })) {
      groups.overdue.push(event);
    } else if (scheduled && now >= scheduled.minus({ minutes: 15 }) && now <= scheduled.plus({ minutes: grace })) {
      groups.dueNow.push(event);
    } else {
      groups.upcoming.push(event);
    }
  }

  return { date: day.toISODate(), timezone: zone, groups };
}

export async function markTaken({
  doseEventId,
  userId,
  amountTaken,
  takenAt,
  injectionSite,
  notes,
  idempotencyKey,
  allowNegativeStock = false,
}) {
  const event = await prisma.doseEvent.findUnique({
    where: { id: doseEventId },
    include: {
      medication: { include: { personProfile: true } },
      schedule: true,
      inventoryTransactions: true,
    },
  });
  if (!event) throw new HttpError(404, 'Dose event not found');
  if (event.status === 'taken') {
    const existingTxn =
      event.inventoryTransactions?.[0] ||
      (await prisma.inventoryTransaction.findFirst({
        where: { doseEventId: event.id, kind: 'dose' },
        orderBy: { createdAt: 'desc' },
      }));
    return { event, inventoryTransaction: existingTxn };
  }

  const schedule = event.schedule;
  let amount;
  if (schedule?.doseEntry === 'variable') {
    if (amountTaken == null) throw new HttpError(400, 'Amount required for variable dose');
    amount = toDecimal(amountTaken);
  } else {
    amount = toDecimal(
      amountTaken ?? schedule?.unitsPerDose ?? event.medication.defaultUnitsPerDose,
    );
  }

  const key = idempotencyKey || `dose-taken:${doseEventId}`;
  const householdId = event.medication.personProfile.householdId;

  const txn = await applyInventoryChange({
    medicationId: event.medicationId,
    kind: 'dose',
    quantityDelta: amount.neg(),
    occurredAt: takenAt ? new Date(takenAt) : new Date(),
    recordedByUserId: userId,
    doseEventId: event.id,
    notes,
    idempotencyKey: key,
    allowNegative: allowNegativeStock,
    householdId,
    personProfileId: event.personProfileId,
  });

  const updated = await prisma.doseEvent.update({
    where: { id: event.id },
    data: {
      status: 'taken',
      takenAt: takenAt ? new Date(takenAt) : new Date(),
      amountTaken: amount,
      injectionSite: injectionSite || null,
      loggedByUserId: userId,
      notes: notes ?? event.notes,
    },
    include: { medication: true, schedule: true },
  });

  await writeAudit({
    householdId,
    personProfileId: event.personProfileId,
    actorUserId: userId,
    action: 'dose.taken',
    entityType: 'DoseEvent',
    entityId: event.id,
    summary: `Marked dose taken (${amount.toString()})`,
  });

  return { event: updated, inventoryTransaction: txn };
}

export async function markSkipped({ doseEventId, userId, notes }) {
  const event = await prisma.doseEvent.findUnique({
    where: { id: doseEventId },
    include: { medication: { include: { personProfile: true } } },
  });
  if (!event) throw new HttpError(404, 'Dose event not found');
  const updated = await prisma.doseEvent.update({
    where: { id: event.id },
    data: {
      status: 'skipped',
      loggedByUserId: userId,
      notes: notes ?? event.notes,
    },
    include: { medication: true, schedule: true },
  });
  await writeAudit({
    householdId: event.medication.personProfile.householdId,
    personProfileId: event.personProfileId,
    actorUserId: userId,
    action: 'dose.skipped',
    entityType: 'DoseEvent',
    entityId: event.id,
    summary: 'Marked dose skipped',
  });
  return updated;
}

export async function snoozeDose({ doseEventId, userId, minutes = 30 }) {
  const event = await prisma.doseEvent.findUnique({ where: { id: doseEventId } });
  if (!event) throw new HttpError(404, 'Dose event not found');
  return prisma.doseEvent.update({
    where: { id: event.id },
    data: {
      status: 'snoozed',
      snoozedUntil: DateTime.utc().plus({ minutes }).toJSDate(),
      loggedByUserId: userId,
    },
    include: { medication: true, schedule: true },
  });
}

export async function undoDoseAction({ doseEventId, userId }) {
  const event = await prisma.doseEvent.findUnique({
    where: { id: doseEventId },
    include: {
      medication: { include: { personProfile: true } },
      inventoryTransactions: { where: { kind: 'dose' }, orderBy: { createdAt: 'desc' }, take: 1 },
    },
  });
  if (!event) throw new HttpError(404, 'Dose event not found');

  const householdId = event.medication.personProfile.householdId;
  if (event.status === 'taken' && event.inventoryTransactions[0]) {
    await reverseTransaction({
      transactionId: event.inventoryTransactions[0].id,
      recordedByUserId: userId,
      householdId,
      personProfileId: event.personProfileId,
      notes: 'Undo dose taken',
      idempotencyKey: `undo-dose:${doseEventId}:${event.inventoryTransactions[0].id}`,
    });
  }

  const updated = await prisma.doseEvent.update({
    where: { id: event.id },
    data: {
      status: 'pending',
      takenAt: null,
      amountTaken: null,
      injectionSite: null,
      snoozedUntil: null,
      loggedByUserId: userId,
    },
    include: { medication: true, schedule: true },
  });

  await writeAudit({
    householdId,
    personProfileId: event.personProfileId,
    actorUserId: userId,
    action: 'dose.undo',
    entityType: 'DoseEvent',
    entityId: event.id,
    summary: 'Undid most recent dose action',
  });

  return updated;
}

export async function logAsNeededDose({
  medicationId,
  userId,
  amountTaken,
  takenAt,
  injectionSite,
  notes,
  idempotencyKey,
  allowNegativeStock = false,
}) {
  const medication = await prisma.medication.findUnique({
    where: { id: medicationId },
    include: { personProfile: true },
  });
  if (!medication) throw new HttpError(404, 'Medication not found');

  const amount = toDecimal(amountTaken ?? medication.defaultUnitsPerDose);
  const event = await prisma.doseEvent.create({
    data: {
      medicationId,
      personProfileId: medication.personProfileId,
      status: 'taken',
      takenAt: takenAt ? new Date(takenAt) : new Date(),
      amountTaken: amount,
      injectionSite: injectionSite || null,
      loggedByUserId: userId,
      source: 'app',
      notes: notes || null,
    },
  });

  const txn = await applyInventoryChange({
    medicationId,
    kind: 'dose',
    quantityDelta: amount.neg(),
    occurredAt: event.takenAt,
    recordedByUserId: userId,
    doseEventId: event.id,
    notes,
    idempotencyKey: idempotencyKey || `as-needed:${medicationId}:${randomToken(8)}`,
    allowNegative: allowNegativeStock,
    householdId: medication.personProfile.householdId,
    personProfileId: medication.personProfileId,
  });

  return { event, inventoryTransaction: txn };
}
