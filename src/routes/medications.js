import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import { requireAuth, requireManageAccess, requireViewAccess, assertMedicationAccess } from '../middleware/auth.js';
import { asyncHandler, serializeMedication, serializeInventoryTxn, HttpError } from '../util.js';
import {
  createMedication,
  updateMedication,
  setMedicationStatus,
  enrichMedicationWithSupply,
} from '../services/medications.js';
import {
  recordRefill,
  recordWaste,
  recordManualCount,
  reverseTransaction,
} from '../services/inventory.js';

const router = Router();

const medCreateSchema = z.object({
  kind: z.enum(['medication', 'supplement']).optional(),
  name: z.string().min(1),
  form: z.string().optional().nullable(),
  strengthValue: z.union([z.string(), z.number()]).optional().nullable(),
  strengthUnit: z.string().optional().nullable(),
  stockUnit: z.string().min(1),
  defaultUnitsPerDose: z.union([z.string(), z.number()]).optional(),
  trackInjectionSite: z.boolean().optional(),
  instructions: z.string().optional().nullable(),
  refillThresholdDays: z.number().int().optional(),
  refillLeadTimeDays: z.number().int().optional(),
  pharmacy: z.string().optional().nullable(),
  prescriptionNumber: z.string().optional().nullable(),
  refillsRemaining: z.number().int().optional().nullable(),
  prescriber: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  openingBalance: z.union([z.string(), z.number()]).optional(),
  scheduleType: z.enum(['daily', 'weekly', 'as_needed', 'interval']).optional(),
  timesOfDay: z.array(z.string()).optional(),
  timeOfDay: z.string().optional(),
  daysOfWeek: z.array(z.string()).optional(),
  intervalHours: z.number().int().positive().optional().nullable(),
  doseEntry: z.enum(['fixed', 'variable']).optional(),
  rxcui: z.string().optional().nullable(),
  unitsPerDose: z.union([z.string(), z.number()]).optional().nullable(),
  gracePeriodMinutes: z.number().int().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional().nullable(),
});

router.get(
  '/profiles/:profileId/medications',
  requireAuth,
  requireViewAccess('profileId'),
  asyncHandler(async (req, res) => {
    const kindFilter = z
      .enum(['medication', 'supplement', 'all'])
      .optional()
      .parse(req.query.kind || 'all');
    const profile = await prisma.personProfile.findUnique({ where: { id: req.params.profileId } });
    const meds = await prisma.medication.findMany({
      where: {
        personProfileId: req.params.profileId,
        ...(kindFilter && kindFilter !== 'all' ? { kind: kindFilter } : {}),
      },
      include: { schedules: true },
      orderBy: [{ status: 'asc' }, { name: 'asc' }],
    });
    const enriched = [];
    for (const med of meds) {
      const e = await enrichMedicationWithSupply(med, profile.timezone);
      enriched.push(serializeMedication(e));
    }
    res.json({ medications: enriched });
  }),
);

router.post(
  '/profiles/:profileId/medications',
  requireAuth,
  requireManageAccess('profileId'),
  asyncHandler(async (req, res) => {
    const body = medCreateSchema.parse(req.body);
    const med = await createMedication({
      profileId: req.params.profileId,
      userId: req.user.id,
      data: body,
    });
    res.status(201).json({ medication: serializeMedication(med) });
  }),
);

router.get(
  '/medications/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { medication } = await assertMedicationAccess(req.user.id, req.params.id, 'view');
    const full = await prisma.medication.findUnique({
      where: { id: medication.id },
      include: { schedules: true, personProfile: true },
    });
    const enriched = await enrichMedicationWithSupply(full, full.personProfile.timezone);
    res.json({ medication: serializeMedication(enriched) });
  }),
);

router.put(
  '/medications/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    await assertMedicationAccess(req.user.id, req.params.id, 'manage');
    const body = medCreateSchema.partial().parse(req.body);
    const med = await updateMedication({
      medicationId: req.params.id,
      userId: req.user.id,
      data: body,
    });
    res.json({ medication: serializeMedication(med) });
  }),
);

router.post(
  '/medications/:id/pause',
  requireAuth,
  asyncHandler(async (req, res) => {
    await assertMedicationAccess(req.user.id, req.params.id, 'manage');
    const med = await setMedicationStatus(req.params.id, req.user.id, 'paused');
    res.json({ medication: serializeMedication(med) });
  }),
);

router.post(
  '/medications/:id/resume',
  requireAuth,
  asyncHandler(async (req, res) => {
    await assertMedicationAccess(req.user.id, req.params.id, 'manage');
    const med = await setMedicationStatus(req.params.id, req.user.id, 'active');
    res.json({ medication: serializeMedication(med) });
  }),
);

router.delete(
  '/medications/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    await assertMedicationAccess(req.user.id, req.params.id, 'manage');
    const med = await setMedicationStatus(req.params.id, req.user.id, 'stopped');
    res.json({ medication: serializeMedication(med) });
  }),
);

router.get(
  '/medications/:id/schedules',
  requireAuth,
  asyncHandler(async (req, res) => {
    await assertMedicationAccess(req.user.id, req.params.id, 'view');
    const schedules = await prisma.medicationSchedule.findMany({
      where: { medicationId: req.params.id },
      orderBy: { timeOfDay: 'asc' },
    });
    res.json({ schedules });
  }),
);

router.post(
  '/medications/:id/schedules',
  requireAuth,
  asyncHandler(async (req, res) => {
    await assertMedicationAccess(req.user.id, req.params.id, 'manage');
    const body = z
      .object({
        label: z.string().optional(),
        scheduleType: z.enum(['daily', 'weekly', 'as_needed']),
        timeOfDay: z.string().optional().nullable(),
        daysOfWeek: z.array(z.string()).optional(),
        doseEntry: z.enum(['fixed', 'variable']).optional(),
        unitsPerDose: z.union([z.string(), z.number()]).optional().nullable(),
        startDate: z.string(),
        endDate: z.string().optional().nullable(),
        gracePeriodMinutes: z.number().int().optional(),
      })
      .parse(req.body);
    const schedule = await prisma.medicationSchedule.create({
      data: {
        medicationId: req.params.id,
        label: body.label || null,
        scheduleType: body.scheduleType,
        timeOfDay: body.timeOfDay || null,
        daysOfWeek: body.daysOfWeek || [],
        doseEntry: body.doseEntry || 'fixed',
        unitsPerDose: body.unitsPerDose != null ? body.unitsPerDose : null,
        startDate: new Date(body.startDate),
        endDate: body.endDate ? new Date(body.endDate) : null,
        gracePeriodMinutes: body.gracePeriodMinutes ?? 120,
      },
    });
    res.status(201).json({ schedule });
  }),
);

router.get(
  '/medications/:id/inventory-transactions',
  requireAuth,
  asyncHandler(async (req, res) => {
    await assertMedicationAccess(req.user.id, req.params.id, 'view');
    const txns = await prisma.inventoryTransaction.findMany({
      where: { medicationId: req.params.id },
      orderBy: { occurredAt: 'desc' },
      take: 100,
    });
    res.json({ transactions: txns.map(serializeInventoryTxn) });
  }),
);

router.post(
  '/medications/:id/refills',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { medication } = await assertMedicationAccess(req.user.id, req.params.id, 'manage');
    const body = z
      .object({
        quantity: z.union([z.string(), z.number()]),
        notes: z.string().optional(),
        idempotencyKey: z.string().optional(),
      })
      .parse(req.body);
    const full = await prisma.medication.findUnique({
      where: { id: medication.id },
      include: { personProfile: true },
    });
    const txn = await recordRefill({
      medicationId: medication.id,
      quantity: body.quantity,
      recordedByUserId: req.user.id,
      notes: body.notes,
      idempotencyKey: body.idempotencyKey,
      householdId: full.personProfile.householdId,
      personProfileId: full.personProfileId,
    });
    res.status(201).json({ transaction: serializeInventoryTxn(txn) });
  }),
);

router.post(
  '/medications/:id/adjustments',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { medication } = await assertMedicationAccess(req.user.id, req.params.id, 'manage');
    const body = z
      .object({
        quantityDelta: z.union([z.string(), z.number()]),
        notes: z.string().optional(),
        allowNegative: z.boolean().optional(),
        idempotencyKey: z.string().optional(),
      })
      .parse(req.body);
    const full = await prisma.medication.findUnique({
      where: { id: medication.id },
      include: { personProfile: true },
    });
    const { applyInventoryChange } = await import('../services/inventory.js');
    const txn = await applyInventoryChange({
      medicationId: medication.id,
      kind: 'adjustment',
      quantityDelta: body.quantityDelta,
      recordedByUserId: req.user.id,
      notes: body.notes,
      allowNegative: body.allowNegative,
      idempotencyKey: body.idempotencyKey,
      householdId: full.personProfile.householdId,
      personProfileId: full.personProfileId,
    });
    res.status(201).json({ transaction: serializeInventoryTxn(txn) });
  }),
);

router.post(
  '/medications/:id/manual-counts',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { medication } = await assertMedicationAccess(req.user.id, req.params.id, 'manage');
    const body = z
      .object({
        observedQuantity: z.union([z.string(), z.number()]),
        notes: z.string().optional(),
        idempotencyKey: z.string().optional(),
      })
      .parse(req.body);
    const full = await prisma.medication.findUnique({
      where: { id: medication.id },
      include: { personProfile: true },
    });
    const txn = await recordManualCount({
      medicationId: medication.id,
      observedQuantity: body.observedQuantity,
      recordedByUserId: req.user.id,
      notes: body.notes,
      idempotencyKey: body.idempotencyKey,
      householdId: full.personProfile.householdId,
      personProfileId: full.personProfileId,
    });
    res.status(201).json({ transaction: serializeInventoryTxn(txn) });
  }),
);

router.post(
  '/medications/:id/waste',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { medication } = await assertMedicationAccess(req.user.id, req.params.id, 'manage');
    const body = z
      .object({
        quantity: z.union([z.string(), z.number()]),
        notes: z.string().optional(),
        allowNegative: z.boolean().optional(),
        idempotencyKey: z.string().optional(),
      })
      .parse(req.body);
    const full = await prisma.medication.findUnique({
      where: { id: medication.id },
      include: { personProfile: true },
    });
    const txn = await recordWaste({
      medicationId: medication.id,
      quantity: body.quantity,
      recordedByUserId: req.user.id,
      notes: body.notes,
      allowNegative: body.allowNegative,
      idempotencyKey: body.idempotencyKey,
      householdId: full.personProfile.householdId,
      personProfileId: full.personProfileId,
    });
    res.status(201).json({ transaction: serializeInventoryTxn(txn) });
  }),
);

router.post(
  '/inventory-transactions/:id/reverse',
  requireAuth,
  asyncHandler(async (req, res) => {
    const txn = await prisma.inventoryTransaction.findUnique({
      where: { id: req.params.id },
      include: { medication: { include: { personProfile: true } } },
    });
    if (!txn) throw new HttpError(404, 'Transaction not found');
    await assertMedicationAccess(req.user.id, txn.medicationId, 'manage');
    const reversed = await reverseTransaction({
      transactionId: txn.id,
      recordedByUserId: req.user.id,
      householdId: txn.medication.personProfile.householdId,
      personProfileId: txn.medication.personProfileId,
      notes: req.body?.notes,
      idempotencyKey: req.body?.idempotencyKey,
    });
    res.json({ transaction: serializeInventoryTxn(reversed) });
  }),
);

export default router;
