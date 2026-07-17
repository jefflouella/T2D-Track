import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import { requireAuth, requireManageAccess, requireViewAccess, assertReadingAccess } from '../middleware/auth.js';
import { asyncHandler, serializeReading } from '../util.js';
import {
  createBloodSugar,
  createWeight,
  createBloodPressure,
  createA1c,
  softDeleteReading,
  listReadings,
  upsertHealthTargets,
  computeTimeInRange,
  doseCompletionSummary,
} from '../services/health.js';

const router = Router();

router.post(
  '/profiles/:profileId/health/blood-sugar',
  requireAuth,
  requireManageAccess('profileId'),
  asyncHandler(async (req, res) => {
    const body = z
      .object({
        value: z.union([z.string(), z.number()]),
        unit: z.enum(['mg_dL', 'mmol_L']).optional(),
        context: z
          .enum(['fasting', 'before_meal', 'after_meal', 'bedtime', 'exercise', 'illness', 'random', 'other'])
          .optional(),
        takenAt: z.string().optional(),
        notes: z.string().optional(),
        confirmUnusual: z.boolean().optional(),
      })
      .parse(req.body);
    const value = Number(body.value);
    if ((value < 40 || value > 400) && body.unit !== 'mmol_L' && !body.confirmUnusual) {
      return res.status(400).json({
        error: 'Unusual blood sugar value. Confirm to save.',
        needsConfirmation: true,
      });
    }
    const reading = await createBloodSugar({
      profileId: req.params.profileId,
      userId: req.user.id,
      data: body,
    });
    res.status(201).json({ reading: serializeReading(reading) });
  }),
);

router.get(
  '/profiles/:profileId/health/blood-sugar',
  requireAuth,
  requireViewAccess('profileId'),
  asyncHandler(async (req, res) => {
    const readings = await listReadings(prisma.bloodSugarReading, req.params.profileId, req.query);
    res.json({ readings: readings.map(serializeReading) });
  }),
);

router.put(
  '/health/blood-sugar/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const existing = await prisma.bloodSugarReading.findUnique({ where: { id: req.params.id } });
    await assertReadingAccess(req.user.id, existing, 'manage');
    const body = z
      .object({
        value: z.union([z.string(), z.number()]).optional(),
        context: z.string().optional(),
        takenAt: z.string().optional(),
        notes: z.string().optional().nullable(),
      })
      .parse(req.body);
    const reading = await prisma.bloodSugarReading.update({
      where: { id: req.params.id },
      data: {
        value: body.value,
        context: body.context,
        takenAt: body.takenAt ? new Date(body.takenAt) : undefined,
        notes: body.notes,
      },
    });
    res.json({ reading: serializeReading(reading) });
  }),
);

router.delete(
  '/health/blood-sugar/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const existing = await prisma.bloodSugarReading.findUnique({ where: { id: req.params.id } });
    await assertReadingAccess(req.user.id, existing, 'manage');
    const reading = await softDeleteReading(prisma.bloodSugarReading, req.params.id, req.user.id);
    res.json({ reading: serializeReading(reading) });
  }),
);

router.post(
  '/profiles/:profileId/health/weight',
  requireAuth,
  requireManageAccess('profileId'),
  asyncHandler(async (req, res) => {
    const body = z
      .object({
        value: z.union([z.string(), z.number()]),
        unit: z.enum(['lb', 'kg']).optional(),
        takenAt: z.string().optional(),
        notes: z.string().optional(),
      })
      .parse(req.body);
    const reading = await createWeight({
      profileId: req.params.profileId,
      userId: req.user.id,
      data: body,
    });
    res.status(201).json({ reading: serializeReading(reading) });
  }),
);

router.get(
  '/profiles/:profileId/health/weight',
  requireAuth,
  requireViewAccess('profileId'),
  asyncHandler(async (req, res) => {
    const readings = await listReadings(prisma.weightReading, req.params.profileId, req.query);
    res.json({ readings: readings.map(serializeReading) });
  }),
);

router.put(
  '/health/weight/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const existing = await prisma.weightReading.findUnique({ where: { id: req.params.id } });
    await assertReadingAccess(req.user.id, existing, 'manage');
    const body = z
      .object({
        value: z.union([z.string(), z.number()]).optional(),
        takenAt: z.string().optional(),
        notes: z.string().optional().nullable(),
      })
      .parse(req.body);
    const reading = await prisma.weightReading.update({
      where: { id: req.params.id },
      data: {
        value: body.value,
        takenAt: body.takenAt ? new Date(body.takenAt) : undefined,
        notes: body.notes,
      },
    });
    res.json({ reading: serializeReading(reading) });
  }),
);

router.delete(
  '/health/weight/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const existing = await prisma.weightReading.findUnique({ where: { id: req.params.id } });
    await assertReadingAccess(req.user.id, existing, 'manage');
    const reading = await softDeleteReading(prisma.weightReading, req.params.id, req.user.id);
    res.json({ reading: serializeReading(reading) });
  }),
);

router.post(
  '/profiles/:profileId/health/blood-pressure',
  requireAuth,
  requireManageAccess('profileId'),
  asyncHandler(async (req, res) => {
    const body = z
      .object({
        systolic: z.number().int(),
        diastolic: z.number().int(),
        pulse: z.number().int().optional().nullable(),
        context: z
          .enum(['morning', 'evening', 'resting', 'before_exercise', 'after_exercise', 'illness', 'other'])
          .optional(),
        takenAt: z.string().optional(),
        notes: z.string().optional(),
        confirmUnusual: z.boolean().optional(),
      })
      .parse(req.body);
    if ((body.systolic > 200 || body.systolic < 70) && !body.confirmUnusual) {
      return res.status(400).json({
        error: 'Unusual blood pressure value. Confirm to save.',
        needsConfirmation: true,
      });
    }
    const reading = await createBloodPressure({
      profileId: req.params.profileId,
      userId: req.user.id,
      data: body,
    });
    res.status(201).json({ reading: serializeReading(reading) });
  }),
);

router.get(
  '/profiles/:profileId/health/blood-pressure',
  requireAuth,
  requireViewAccess('profileId'),
  asyncHandler(async (req, res) => {
    const readings = await listReadings(prisma.bloodPressureReading, req.params.profileId, req.query);
    res.json({ readings: readings.map(serializeReading) });
  }),
);

router.put(
  '/health/blood-pressure/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const existing = await prisma.bloodPressureReading.findUnique({ where: { id: req.params.id } });
    await assertReadingAccess(req.user.id, existing, 'manage');
    const body = z
      .object({
        systolic: z.number().int().optional(),
        diastolic: z.number().int().optional(),
        pulse: z.number().int().optional().nullable(),
        context: z.string().optional(),
        takenAt: z.string().optional(),
        notes: z.string().optional().nullable(),
      })
      .parse(req.body);
    const reading = await prisma.bloodPressureReading.update({
      where: { id: req.params.id },
      data: {
        ...body,
        takenAt: body.takenAt ? new Date(body.takenAt) : undefined,
      },
    });
    res.json({ reading: serializeReading(reading) });
  }),
);

router.delete(
  '/health/blood-pressure/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const existing = await prisma.bloodPressureReading.findUnique({ where: { id: req.params.id } });
    await assertReadingAccess(req.user.id, existing, 'manage');
    const reading = await softDeleteReading(prisma.bloodPressureReading, req.params.id, req.user.id);
    res.json({ reading: serializeReading(reading) });
  }),
);

router.post(
  '/profiles/:profileId/health/a1c',
  requireAuth,
  requireManageAccess('profileId'),
  asyncHandler(async (req, res) => {
    const body = z
      .object({
        valuePercent: z.union([z.string(), z.number()]),
        takenAt: z.string().optional(),
        laboratory: z.string().optional(),
        notes: z.string().optional(),
      })
      .parse(req.body);
    const reading = await createA1c({
      profileId: req.params.profileId,
      userId: req.user.id,
      data: body,
    });
    res.status(201).json({ reading: serializeReading(reading) });
  }),
);

router.get(
  '/profiles/:profileId/health/a1c',
  requireAuth,
  requireViewAccess('profileId'),
  asyncHandler(async (req, res) => {
    const readings = await listReadings(prisma.a1CReading, req.params.profileId, req.query);
    res.json({ readings: readings.map(serializeReading) });
  }),
);

router.put(
  '/health/a1c/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const existing = await prisma.a1CReading.findUnique({ where: { id: req.params.id } });
    await assertReadingAccess(req.user.id, existing, 'manage');
    const body = z
      .object({
        valuePercent: z.union([z.string(), z.number()]).optional(),
        takenAt: z.string().optional(),
        laboratory: z.string().optional().nullable(),
        notes: z.string().optional().nullable(),
      })
      .parse(req.body);
    const reading = await prisma.a1CReading.update({
      where: { id: req.params.id },
      data: {
        valuePercent: body.valuePercent,
        takenAt: body.takenAt ? new Date(body.takenAt) : undefined,
        laboratory: body.laboratory,
        notes: body.notes,
      },
    });
    res.json({ reading: serializeReading(reading) });
  }),
);

router.delete(
  '/health/a1c/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const existing = await prisma.a1CReading.findUnique({ where: { id: req.params.id } });
    await assertReadingAccess(req.user.id, existing, 'manage');
    const reading = await softDeleteReading(prisma.a1CReading, req.params.id, req.user.id);
    res.json({ reading: serializeReading(reading) });
  }),
);

router.get(
  '/profiles/:profileId/health-targets',
  requireAuth,
  requireViewAccess('profileId'),
  asyncHandler(async (req, res) => {
    const targets = await prisma.healthTarget.findMany({
      where: { personProfileId: req.params.profileId },
    });
    res.json({ targets: targets.map(serializeReading) });
  }),
);

router.put(
  '/profiles/:profileId/health-targets',
  requireAuth,
  requireManageAccess('profileId'),
  asyncHandler(async (req, res) => {
    const body = z
      .object({
        targets: z.array(
          z.object({
            metricType: z.enum(['blood_sugar', 'systolic', 'diastolic', 'weight', 'a1c']),
            context: z.string().optional(),
            lowValue: z.union([z.string(), z.number()]).optional().nullable(),
            highValue: z.union([z.string(), z.number()]).optional().nullable(),
            unit: z.string(),
            label: z.string().optional().nullable(),
          }),
        ),
      })
      .parse(req.body);
    const targets = await upsertHealthTargets(req.params.profileId, req.user.id, body.targets);
    res.json({ targets: targets.map(serializeReading) });
  }),
);

router.get(
  '/profiles/:profileId/health/summaries',
  requireAuth,
  requireViewAccess('profileId'),
  asyncHandler(async (req, res) => {
    const targets = await prisma.healthTarget.findMany({
      where: { personProfileId: req.params.profileId, metricType: 'blood_sugar' },
    });
    const readings = await prisma.bloodSugarReading.findMany({
      where: {
        personProfileId: req.params.profileId,
        deletedAt: null,
        takenAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
      },
    });
    const anyTarget = targets.find((t) => t.context === 'any') || targets[0];
    res.json({
      timeInRange: computeTimeInRange(readings, anyTarget),
      completion7: await doseCompletionSummary(req.params.profileId, 7),
      completion30: await doseCompletionSummary(req.params.profileId, 30),
    });
  }),
);

export default router;
