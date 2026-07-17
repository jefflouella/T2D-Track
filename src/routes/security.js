import crypto from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { asyncHandler, HttpError } from '../util.js';
import { config } from '../config.js';
import { verifyPassword } from '../services/auth.js';
import { verifyTotp, base32Encode } from '../services/totp.js';

const router = Router();

router.post(
  '/totp/setup',
  requireAuth,
  asyncHandler(async (req, res) => {
    const secret = base32Encode(crypto.randomBytes(20));
    await prisma.user.update({
      where: { id: req.user.id },
      data: { totpSecret: secret, totpEnabledAt: null },
    });
    const label = encodeURIComponent(`T2D Track:${req.user.email}`);
    const otpauth = `otpauth://totp/${label}?secret=${secret}&issuer=T2D%20Track&digits=6&period=30`;
    res.json({ secret, otpauth });
  }),
);

router.post(
  '/totp/enable',
  requireAuth,
  asyncHandler(async (req, res) => {
    const body = z.object({ code: z.string().min(6).max(8) }).parse(req.body);
    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    if (!user?.totpSecret) throw new HttpError(400, 'Run TOTP setup first');
    if (!verifyTotp(user.totpSecret, body.code)) throw new HttpError(400, 'Invalid authenticator code');
    await prisma.user.update({
      where: { id: user.id },
      data: { totpEnabledAt: new Date() },
    });
    res.json({ ok: true });
  }),
);

router.post(
  '/totp/disable',
  requireAuth,
  asyncHandler(async (req, res) => {
    const body = z
      .object({ password: z.string().min(1), code: z.string().min(6).max(8).optional() })
      .parse(req.body);
    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    const ok = await verifyPassword(body.password, user.passwordHash);
    if (!ok) throw new HttpError(401, 'Invalid password');
    if (user.totpEnabledAt && body.code && !verifyTotp(user.totpSecret, body.code)) {
      throw new HttpError(400, 'Invalid authenticator code');
    }
    await prisma.user.update({
      where: { id: user.id },
      data: { totpSecret: null, totpEnabledAt: null },
    });
    res.json({ ok: true });
  }),
);

router.get(
  '/totp/status',
  requireAuth,
  asyncHandler(async (req, res) => {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: { totpEnabledAt: true },
    });
    res.json({ enabled: Boolean(user.totpEnabledAt) });
  }),
);

router.get(
  '/passkeys',
  requireAuth,
  asyncHandler(async (req, res) => {
    const creds = await prisma.webAuthnCredential.findMany({
      where: { userId: req.user.id },
      select: { id: true, deviceType: true, createdAt: true, lastUsedAt: true },
    });
    res.json({
      credentials: creds,
      rpId: new URL(config.APP_URL).hostname,
      note: 'Passkey credential storage is ready. Full WebAuthn registration UI can be enabled per browser support.',
    });
  }),
);

router.delete(
  '/passkeys/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const cred = await prisma.webAuthnCredential.findUnique({ where: { id: req.params.id } });
    if (!cred || cred.userId !== req.user.id) throw new HttpError(404, 'Credential not found');
    await prisma.webAuthnCredential.delete({ where: { id: cred.id } });
    res.json({ ok: true });
  }),
);

export default router;
