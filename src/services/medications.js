import { prisma } from '../db.js';
import { HttpError, toDecimal } from '../util.js';
import { recordOpeningBalance } from './inventory.js';
import { writeAudit } from './audit.js';
import { estimateDaysOfSupply } from './supplyEstimate.js';

function normalizeTimes(timesOfDay) {
  if (!timesOfDay || timesOfDay.length === 0) return [];
  return timesOfDay.map((t) => {
    if (/^\d{2}:\d{2}$/.test(t)) return t;
    throw new HttpError(400, `Invalid time_of_day: ${t}`);
  });
}

export async function createMedication({
  profileId,
  userId,
  data,
}) {
  const profile = await prisma.personProfile.findUnique({ where: { id: profileId } });
  if (!profile) throw new HttpError(404, 'Profile not found');

  const times = normalizeTimes(data.timesOfDay || (data.timeOfDay ? [data.timeOfDay] : []));
  const scheduleType = data.scheduleType || 'daily';

  const kind = data.kind === 'supplement' ? 'supplement' : 'medication';
  const isSupplement = kind === 'supplement';

  const medication = await prisma.$transaction(async (tx) => {
    const med = await tx.medication.create({
      data: {
        personProfileId: profileId,
        kind,
        name: data.name,
        rxcui: data.rxcui || null,
        form: data.form || null,
        strengthValue: data.strengthValue != null ? toDecimal(data.strengthValue) : null,
        strengthUnit: data.strengthUnit || null,
        stockUnit: data.stockUnit,
        defaultUnitsPerDose: toDecimal(data.defaultUnitsPerDose ?? 1),
        trackInjectionSite: Boolean(data.trackInjectionSite),
        instructions: data.instructions || null,
        refillThresholdDays: data.refillThresholdDays ?? 7,
        refillLeadTimeDays: data.refillLeadTimeDays ?? 3,
        pharmacy: data.pharmacy || null,
        prescriptionNumber: isSupplement ? null : data.prescriptionNumber || null,
        refillsRemaining: isSupplement ? null : (data.refillsRemaining ?? null),
        refillEligibleOn:
          isSupplement || !data.refillEligibleOn ? null : new Date(data.refillEligibleOn),
        prescriber: isSupplement ? null : data.prescriber || null,
        notes: data.notes || null,
        startDate: data.startDate ? new Date(data.startDate) : new Date(),
        status: 'active',
      },
    });

    if (scheduleType === 'as_needed') {
      await tx.medicationSchedule.create({
        data: {
          medicationId: med.id,
          label: data.scheduleLabel || 'As needed',
          scheduleType: 'as_needed',
          doseEntry: data.doseEntry || 'fixed',
          unitsPerDose: data.unitsPerDose != null ? toDecimal(data.unitsPerDose) : toDecimal(data.defaultUnitsPerDose ?? 1),
          startDate: data.startDate ? new Date(data.startDate) : new Date(),
          gracePeriodMinutes: data.gracePeriodMinutes ?? 120,
        },
      });
    } else if (scheduleType === 'interval') {
      await tx.medicationSchedule.create({
        data: {
          medicationId: med.id,
          label: data.scheduleLabel || `Every ${data.intervalHours || 24}h`,
          scheduleType: 'interval',
          intervalHours: data.intervalHours || 24,
          doseEntry: data.doseEntry || 'fixed',
          unitsPerDose:
            data.doseEntry === 'variable' && data.unitsPerDose == null
              ? null
              : toDecimal(data.unitsPerDose ?? data.defaultUnitsPerDose ?? 1),
          startDate: data.startDate ? new Date(data.startDate) : new Date(),
          endDate: data.endDate ? new Date(data.endDate) : null,
          gracePeriodMinutes: data.gracePeriodMinutes ?? 120,
        },
      });
    } else if (times.length > 0) {
      for (const timeOfDay of times) {
        await tx.medicationSchedule.create({
          data: {
            medicationId: med.id,
            label: data.scheduleLabel || timeOfDay,
            scheduleType,
            timeOfDay,
            daysOfWeek: scheduleType === 'weekly' ? data.daysOfWeek || [] : [],
            doseEntry: data.doseEntry || 'fixed',
            unitsPerDose:
              data.doseEntry === 'variable' && data.unitsPerDose == null
                ? null
                : toDecimal(data.unitsPerDose ?? data.defaultUnitsPerDose ?? 1),
            startDate: data.startDate ? new Date(data.startDate) : new Date(),
            endDate: data.endDate ? new Date(data.endDate) : null,
            gracePeriodMinutes: data.gracePeriodMinutes ?? 120,
          },
        });
      }
    }

    return med;
  });

  if (data.openingBalance != null) {
    await recordOpeningBalance({
      medicationId: medication.id,
      quantity: data.openingBalance,
      recordedByUserId: userId,
      householdId: profile.householdId,
      personProfileId: profileId,
      notes: 'Opening balance',
    });
  }

  await writeAudit({
    householdId: profile.householdId,
    personProfileId: profileId,
    actorUserId: userId,
    action: 'medication.created',
    entityType: 'Medication',
    entityId: medication.id,
    summary: `Added ${kind} ${data.name}`,
  });

  return prisma.medication.findUnique({
    where: { id: medication.id },
    include: { schedules: true },
  });
}

/**
 * Strength/form/stock unit changes stop the old medication and create a replacement.
 */
export async function updateMedication({ medicationId, userId, data }) {
  const existing = await prisma.medication.findUnique({
    where: { id: medicationId },
    include: { schedules: true, personProfile: true },
  });
  if (!existing) throw new HttpError(404, 'Medication not found');

  const identityChanged =
    (data.strengthValue != null &&
      String(data.strengthValue) !== String(existing.strengthValue ?? '')) ||
    (data.strengthUnit != null && data.strengthUnit !== existing.strengthUnit) ||
    (data.form != null && data.form !== existing.form) ||
    (data.stockUnit != null && data.stockUnit !== existing.stockUnit);

  if (identityChanged && existing.status === 'active') {
    const replacement = await createMedication({
      profileId: existing.personProfileId,
      userId,
      data: {
        kind: data.kind ?? existing.kind,
        name: data.name ?? existing.name,
        form: data.form ?? existing.form,
        strengthValue: data.strengthValue ?? existing.strengthValue,
        strengthUnit: data.strengthUnit ?? existing.strengthUnit,
        stockUnit: data.stockUnit ?? existing.stockUnit,
        defaultUnitsPerDose: data.defaultUnitsPerDose ?? existing.defaultUnitsPerDose,
        trackInjectionSite: data.trackInjectionSite ?? existing.trackInjectionSite,
        instructions: data.instructions ?? existing.instructions,
        refillThresholdDays: data.refillThresholdDays ?? existing.refillThresholdDays,
        refillLeadTimeDays: data.refillLeadTimeDays ?? existing.refillLeadTimeDays,
        pharmacy: data.pharmacy ?? existing.pharmacy,
        prescriptionNumber: data.prescriptionNumber ?? existing.prescriptionNumber,
        refillsRemaining: data.refillsRemaining ?? existing.refillsRemaining,
        prescriber: data.prescriber ?? existing.prescriber,
        notes: data.notes ?? existing.notes,
        openingBalance: existing.currentStockCache,
        timesOfDay: existing.schedules
          .filter((s) => s.active && s.timeOfDay)
          .map((s) => s.timeOfDay),
        scheduleType: existing.schedules.find((s) => s.active)?.scheduleType || 'daily',
        daysOfWeek: existing.schedules.find((s) => s.active)?.daysOfWeek,
        doseEntry: existing.schedules.find((s) => s.active)?.doseEntry,
        unitsPerDose: existing.schedules.find((s) => s.active)?.unitsPerDose,
      },
    });

    await prisma.medication.update({
      where: { id: existing.id },
      data: {
        status: 'stopped',
        endDate: new Date(),
        replacedById: replacement.id,
      },
    });
    await prisma.medicationSchedule.updateMany({
      where: { medicationId: existing.id, active: true },
      data: { active: false, endDate: new Date() },
    });

    await writeAudit({
      householdId: existing.personProfile.householdId,
      personProfileId: existing.personProfileId,
      actorUserId: userId,
      action: 'medication.replaced',
      entityType: 'Medication',
      entityId: existing.id,
      summary: `Stopped and replaced medication due to identity field change`,
      metadata: { replacementId: replacement.id },
    });

    return replacement;
  }

  const updated = await prisma.medication.update({
    where: { id: medicationId },
    data: {
      name: data.name ?? undefined,
      instructions: data.instructions ?? undefined,
      trackInjectionSite: data.trackInjectionSite ?? undefined,
      refillThresholdDays: data.refillThresholdDays ?? undefined,
      refillLeadTimeDays: data.refillLeadTimeDays ?? undefined,
      pharmacy: data.pharmacy ?? undefined,
      prescriptionNumber: data.prescriptionNumber ?? undefined,
      refillsRemaining: data.refillsRemaining ?? undefined,
      refillEligibleOn: data.refillEligibleOn ? new Date(data.refillEligibleOn) : undefined,
      prescriber: data.prescriber ?? undefined,
      notes: data.notes ?? undefined,
      defaultUnitsPerDose:
        data.defaultUnitsPerDose != null ? toDecimal(data.defaultUnitsPerDose) : undefined,
    },
    include: { schedules: true },
  });

  return updated;
}

export async function setMedicationStatus(medicationId, userId, status) {
  const med = await prisma.medication.findUnique({
    where: { id: medicationId },
    include: { personProfile: true },
  });
  if (!med) throw new HttpError(404, 'Medication not found');

  const updated = await prisma.medication.update({
    where: { id: medicationId },
    data: {
      status,
      endDate: status === 'stopped' ? new Date() : med.endDate,
    },
    include: { schedules: true },
  });

  if (status === 'paused' || status === 'stopped') {
    await prisma.medicationSchedule.updateMany({
      where: { medicationId, active: true },
      data: { active: status === 'stopped' ? false : true },
    });
  }

  await writeAudit({
    householdId: med.personProfile.householdId,
    personProfileId: med.personProfileId,
    actorUserId: userId,
    action: `medication.${status}`,
    entityType: 'Medication',
    entityId: medicationId,
    summary: `Medication marked ${status}`,
  });

  return updated;
}

export async function enrichMedicationWithSupply(medication, timezone) {
  const recent = await prisma.doseEvent.findMany({
    where: {
      medicationId: medication.id,
      status: 'taken',
      amountTaken: { not: null },
      takenAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
    },
    select: { amountTaken: true },
  });
  const estimate = estimateDaysOfSupply({
    medication,
    schedules: medication.schedules || [],
    timezone,
    recentAmounts: recent.map((r) => r.amountTaken),
  });
  return { ...medication, supply: estimate };
}

/**
 * End active timed schedules the day before `startDate`, then create new ones.
 * Use for dose/time changes that should take effect on a future (or today) date.
 */
export async function replaceTimedSchedules({ medicationId, userId, data }) {
  const med = await prisma.medication.findUnique({
    where: { id: medicationId },
    include: { personProfile: true, schedules: true },
  });
  if (!med) throw new HttpError(404, 'Medication not found');

  const times = normalizeTimes(data.timesOfDay || []);
  if (!times.length && data.scheduleType !== 'as_needed') {
    throw new HttpError(400, 'At least one time of day is required');
  }

  const startDate = data.startDate ? new Date(data.startDate) : new Date();
  const endPrior = new Date(startDate);
  endPrior.setUTCDate(endPrior.getUTCDate() - 1);

  const scheduleType = data.scheduleType || 'daily';
  const unitsPerDose =
    data.unitsPerDose != null ? toDecimal(data.unitsPerDose) : toDecimal(med.defaultUnitsPerDose);
  const doseEntry = data.doseEntry || 'fixed';

  await prisma.$transaction(async (tx) => {
    await tx.medicationSchedule.updateMany({
      where: {
        medicationId,
        active: true,
        scheduleType: { in: ['daily', 'weekly', 'interval'] },
      },
      data: {
        active: false,
        endDate: endPrior,
      },
    });

    if (scheduleType === 'as_needed') {
      await tx.medicationSchedule.create({
        data: {
          medicationId,
          label: data.scheduleLabel || 'As needed',
          scheduleType: 'as_needed',
          doseEntry,
          unitsPerDose,
          startDate,
          gracePeriodMinutes: data.gracePeriodMinutes ?? 120,
        },
      });
    } else {
      for (const timeOfDay of times) {
        await tx.medicationSchedule.create({
          data: {
            medicationId,
            label: data.scheduleLabel || timeOfDay,
            scheduleType,
            timeOfDay,
            daysOfWeek: scheduleType === 'weekly' ? data.daysOfWeek || [] : [],
            doseEntry,
            unitsPerDose,
            startDate,
            gracePeriodMinutes: data.gracePeriodMinutes ?? 120,
          },
        });
      }
    }

    if (data.unitsPerDose != null) {
      await tx.medication.update({
        where: { id: medicationId },
        data: { defaultUnitsPerDose: unitsPerDose },
      });
    }
  });

  await writeAudit({
    householdId: med.personProfile.householdId,
    personProfileId: med.personProfileId,
    actorUserId: userId,
    action: 'medication.schedule_replaced',
    entityType: 'Medication',
    entityId: medicationId,
    summary: `Schedule updated effective ${startDate.toISOString().slice(0, 10)}`,
  });

  return prisma.medication.findUnique({
    where: { id: medicationId },
    include: { schedules: true },
  });
}
