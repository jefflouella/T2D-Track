import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireViewAccess } from '../middleware/auth.js';
import { asyncHandler } from '../util.js';
import { buildDoctorPdf, gatherReportData, reportDataToCsv } from '../services/reports.js';

const router = Router();

const reportBody = z.object({
  range: z.enum(['30d', '90d', '180d', '1y', 'all', 'custom']).default('30d'),
  from: z.string().optional(),
  to: z.string().optional(),
  detail: z.enum(['summary', 'complete']).default('summary'),
  recipient: z.string().optional(),
});

router.post(
  '/profiles/:profileId/reports/doctor.pdf',
  requireAuth,
  requireViewAccess('profileId'),
  asyncHandler(async (req, res) => {
    const body = reportBody.parse(req.body || {});
    const { buffer, filename } = await buildDoctorPdf(req.params.profileId, body);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
  }),
);

router.post(
  '/profiles/:profileId/reports/preview',
  requireAuth,
  requireViewAccess('profileId'),
  asyncHandler(async (req, res) => {
    const body = reportBody.parse(req.body || {});
    const data = await gatherReportData(req.params.profileId, body);
    res.json({
      rangeLabel: data.rangeLabel,
      medicationCount: data.medications.filter((m) => m.status === 'active').length,
      doseEventCount: data.doseEvents.length,
      bloodSugarCount: data.bloodSugar.length,
      weightCount: data.weight.length,
      bloodPressureCount: data.bloodPressure.length,
      a1cCount: data.a1c.length,
      tir: data.tir,
      completion7: data.completion7,
      completion30: data.completion30,
      recipient: data.recipient,
      detail: data.detail,
    });
  }),
);

router.get(
  '/profiles/:profileId/export.csv',
  requireAuth,
  requireViewAccess('profileId'),
  asyncHandler(async (req, res) => {
    const data = await gatherReportData(req.params.profileId, {
      range: req.query.range || '30d',
      from: req.query.from,
      to: req.query.to,
      detail: 'complete',
    });
    const csv = reportDataToCsv(data);
    const filename = `t2d-track-export-${data.start.toISODate()}_${data.end.toISODate()}.csv`;
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csv);
  }),
);

router.get(
  '/profiles/:profileId/export.json',
  requireAuth,
  requireViewAccess('profileId'),
  asyncHandler(async (req, res) => {
    const data = await gatherReportData(req.params.profileId, {
      range: req.query.range || 'all',
      from: req.query.from,
      to: req.query.to,
      detail: 'complete',
    });
    res.json(data);
  }),
);

router.post(
  '/profiles/:profileId/reports/wallet-card.pdf',
  requireAuth,
  requireViewAccess('profileId'),
  asyncHandler(async (req, res) => {
    const { buildWalletCardPdf } = await import('../services/reports.js');
    const { buffer, filename } = await buildWalletCardPdf(req.params.profileId);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
  }),
);

export default router;
