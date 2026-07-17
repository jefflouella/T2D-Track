import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import {
  requireAuth,
  requireManageAccess,
  requireViewAccess,
  assertReadingAccess,
  getProfileAccess,
  requirePermission,
} from '../middleware/auth.js';
import { asyncHandler, serializeReading, serializeInventoryTxn, HttpError } from '../util.js';
import {
  searchDrugCatalog,
  createSupply,
  applySupplyInventory,
  createLabResult,
  createSymptomNote,
  upsertDailyCheckIn,
  importBloodSugarCsv,
} from '../services/catalog.js';

const router = Router();

router.get(
  '/drug-catalog/search',
  requireAuth,
  asyncHandler(async (req, res) => {
    const q = String(req.query.q || '');
    const limit = Math.min(Number(req.query.limit) || 20, 50);
    const results = await searchDrugCatalog(q, limit);
    res.json({ results });
  }),
);

router.get(
  '/profiles/:profileId/supplies',
  requireAuth,
  requireViewAccess('profileId'),
  asyncHandler(async (req, res) => {
    const supplies = await prisma.supplyItem.findMany({
      where: { personProfileId: req.params.profileId, status: 'active' },
      orderBy: { name: 'asc' },
    });
    res.json({
      supplies: supplies.map((s) => ({
        ...s,
        currentStockCache: s.currentStockCache.toString(),
        expectedDailyUse: s.expectedDailyUse?.toString() ?? null,
      })),
    });
  }),
);

router.post(
  '/profiles/:profileId/supplies',
  requireAuth,
  requireManageAccess('profileId'),
  asyncHandler(async (req, res) => {
    const body = z
      .object({
        name: z.string().min(1),
        stockUnit: z.string().min(1),
        openingBalance: z.union([z.string(), z.number()]).optional(),
        refillThresholdDays: z.number().int().optional().nullable(),
        expectedDailyUse: z.union([z.string(), z.number()]).optional().nullable(),
      })
      .parse(req.body);
    const supply = await createSupply({
      profileId: req.params.profileId,
      userId: req.user.id,
      data: body,
    });
    res.status(201).json({ supply });
  }),
);

router.post(
  '/supplies/:id/refills',
  requireAuth,
  asyncHandler(async (req, res) => {
    const item = await prisma.supplyItem.findUnique({ where: { id: req.params.id } });
    if (!item) throw new HttpError(404, 'Supply not found');
    const access = await getProfileAccess(req.user.id, item.personProfileId);
    requirePermission(access, 'manage');
    const body = z
      .object({
        quantity: z.union([z.string(), z.number()]),
        notes: z.string().optional(),
        idempotencyKey: z.string().optional(),
      })
      .parse(req.body);
    const txn = await applySupplyInventory({
      supplyItemId: item.id,
      kind: 'refill',
      quantityDelta: body.quantity,
      userId: req.user.id,
      notes: body.notes,
      idempotencyKey: body.idempotencyKey,
    });
    res.status(201).json({ transaction: serializeInventoryTxn(txn) });
  }),
);

router.post(
  '/supplies/:id/manual-counts',
  requireAuth,
  asyncHandler(async (req, res) => {
    const item = await prisma.supplyItem.findUnique({ where: { id: req.params.id } });
    if (!item) throw new HttpError(404, 'Supply not found');
    const access = await getProfileAccess(req.user.id, item.personProfileId);
    requirePermission(access, 'manage');
    const body = z
      .object({
        observedQuantity: z.union([z.string(), z.number()]),
        notes: z.string().optional(),
      })
      .parse(req.body);
    const delta = Number(body.observedQuantity) - Number(item.currentStockCache);
    const txn = await applySupplyInventory({
      supplyItemId: item.id,
      kind: 'adjustment',
      quantityDelta: delta,
      userId: req.user.id,
      notes: body.notes || `Manual count: ${body.observedQuantity}`,
    });
    res.status(201).json({ transaction: serializeInventoryTxn(txn) });
  }),
);

router.post(
  '/profiles/:profileId/health/labs',
  requireAuth,
  requireManageAccess('profileId'),
  asyncHandler(async (req, res) => {
    const body = z
      .object({
        testName: z.string().min(1),
        value: z.union([z.string(), z.number()]),
        unit: z.string().min(1),
        takenAt: z.string().optional(),
        laboratory: z.string().optional(),
        notes: z.string().optional(),
      })
      .parse(req.body);
    const reading = await createLabResult({
      profileId: req.params.profileId,
      userId: req.user.id,
      data: body,
    });
    res.status(201).json({ reading: serializeReading(reading) });
  }),
);

router.get(
  '/profiles/:profileId/health/labs',
  requireAuth,
  requireViewAccess('profileId'),
  asyncHandler(async (req, res) => {
    const labs = await prisma.labResult.findMany({
      where: { personProfileId: req.params.profileId, deletedAt: null },
      orderBy: { takenAt: 'desc' },
      take: 100,
    });
    res.json({ labs: labs.map(serializeReading) });
  }),
);

router.delete(
  '/health/labs/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const existing = await prisma.labResult.findUnique({ where: { id: req.params.id } });
    await assertReadingAccess(req.user.id, existing, 'manage');
    const reading = await prisma.labResult.update({
      where: { id: req.params.id },
      data: { deletedAt: new Date(), deletedByUserId: req.user.id },
    });
    res.json({ reading: serializeReading(reading) });
  }),
);

router.get(
  '/profiles/:profileId/symptoms',
  requireAuth,
  requireViewAccess('profileId'),
  asyncHandler(async (req, res) => {
    const kind = req.query.kind ? String(req.query.kind) : null;
    const from = req.query.from ? String(req.query.from) : null;
    const to = req.query.to ? String(req.query.to) : null;
    const where = { personProfileId: req.params.profileId };
    if (kind) where.kind = kind;
    if (from || to) {
      where.startedAt = {};
      if (from) where.startedAt.gte = new Date(from);
      if (to) where.startedAt.lte = new Date(to);
    }
    const notes = await prisma.symptomNote.findMany({
      where,
      orderBy: { startedAt: 'desc' },
      take: 100,
    });
    res.json({ notes });
  }),
);

router.post(
  '/profiles/:profileId/symptoms',
  requireAuth,
  requireManageAccess('profileId'),
  asyncHandler(async (req, res) => {
    const body = z
      .object({
        kind: z
          .enum(['check_in', 'journal', 'symptom', 'illness', 'exercise', 'other'])
          .optional(),
        summary: z.string().min(1),
        details: z.string().optional().nullable(),
        mood: z.number().int().min(1).max(5).optional().nullable(),
        tags: z.array(z.string()).optional(),
        startedAt: z.string().optional(),
        endedAt: z.string().optional().nullable(),
      })
      .parse(req.body);
    const note = await createSymptomNote({
      profileId: req.params.profileId,
      userId: req.user.id,
      data: body,
    });
    res.status(201).json({ note });
  }),
);

router.post(
  '/profiles/:profileId/check-in',
  requireAuth,
  requireManageAccess('profileId'),
  asyncHandler(async (req, res) => {
    const body = z
      .object({
        mood: z.number().int().min(1).max(5).optional().nullable(),
        tags: z.array(z.string()).optional(),
        note: z.string().optional().nullable(),
        details: z.string().optional().nullable(),
        summary: z.string().optional(),
        localDate: z.string().optional(),
      })
      .parse(req.body);
    const profile = await prisma.personProfile.findUnique({ where: { id: req.params.profileId } });
    const note = await upsertDailyCheckIn({
      profileId: req.params.profileId,
      userId: req.user.id,
      data: body,
      timezone: profile?.timezone,
    });
    res.status(201).json({ note });
  }),
);

router.get(
  '/profiles/:profileId/check-in/today',
  requireAuth,
  requireViewAccess('profileId'),
  asyncHandler(async (req, res) => {
    const { DateTime } = await import('luxon');
    const profile = await prisma.personProfile.findUnique({ where: { id: req.params.profileId } });
    const zone = profile?.timezone || 'UTC';
    const day = DateTime.now().setZone(zone).startOf('day');
    const note = await prisma.symptomNote.findFirst({
      where: {
        personProfileId: req.params.profileId,
        kind: 'check_in',
        startedAt: {
          gte: day.toUTC().toJSDate(),
          lte: day.endOf('day').toUTC().toJSDate(),
        },
      },
      orderBy: { startedAt: 'desc' },
    });
    res.json({ note: note || null, localDate: day.toISODate() });
  }),
);

router.post(
  '/profiles/:profileId/health/blood-sugar/import',
  requireAuth,
  requireManageAccess('profileId'),
  asyncHandler(async (req, res) => {
    const body = z.object({ csv: z.string().min(1) }).parse(req.body);
    const result = await importBloodSugarCsv({
      profileId: req.params.profileId,
      userId: req.user.id,
      csvText: body.csv,
    });
    res.json(result);
  }),
);

router.post(
  '/medications/:id/refill-workflow',
  requireAuth,
  asyncHandler(async (req, res) => {
    const med = await prisma.medication.findUnique({
      where: { id: req.params.id },
      include: { personProfile: true },
    });
    if (!med) throw new HttpError(404, 'Medication not found');
    const access = await getProfileAccess(req.user.id, med.personProfileId);
    requirePermission(access, 'manage');
    const body = z
      .object({
        status: z.enum(['none', 'requested', 'ready', 'picked_up', 'cancelled', 'last_refill']),
      })
      .parse(req.body);
    const updated = await prisma.medication.update({
      where: { id: med.id },
      data: { refillWorkflowStatus: body.status },
    });
    res.json({ medication: updated });
  }),
);

router.post(
  '/medications/:id/hold',
  requireAuth,
  asyncHandler(async (req, res) => {
    const med = await prisma.medication.findUnique({ where: { id: req.params.id } });
    if (!med) throw new HttpError(404, 'Medication not found');
    const access = await getProfileAccess(req.user.id, med.personProfileId);
    requirePermission(access, 'manage');
    const body = z
      .object({
        holdUntil: z.string().nullable(),
        pause: z.boolean().optional(),
      })
      .parse(req.body);
    const updated = await prisma.medication.update({
      where: { id: med.id },
      data: {
        holdUntil: body.holdUntil ? new Date(body.holdUntil) : null,
        status: body.pause ? 'paused' : undefined,
      },
      include: { schedules: true },
    });
    res.json({ medication: updated });
  }),
);

export default router;
