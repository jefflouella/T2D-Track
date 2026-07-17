import { Router } from 'express';
import { z } from 'zod';
import {
  registerUser,
  loginUser,
  verifyEmailToken,
  issueEmailVerification,
  requestPasswordReset,
  completePasswordReset,
  revokeSessionByRawToken,
  canRegister,
} from '../services/auth.js';
import { asyncHandler, HttpError } from '../util.js';
import { requireAuth } from '../middleware/auth.js';
import { isProd } from '../config.js';

const router = Router();

const registerSchema = z.object({
  name: z.string().min(1).max(120),
  email: z.string().email(),
  password: z.string().min(10).max(200),
  timezone: z.string().optional(),
  glucoseUnit: z.enum(['mg_dL', 'mmol_L']).optional(),
  weightUnit: z.enum(['lb', 'kg']).optional(),
});

function setSessionCookie(res, raw, expiresAt) {
  res.cookie('t2d_session', raw, {
    httpOnly: true,
    sameSite: 'lax',
    secure: isProd,
    path: '/',
    expires: expiresAt,
  });
}

router.get(
  '/registration-status',
  asyncHandler(async (_req, res) => {
    res.json({ open: await canRegister() });
  }),
);

router.post(
  '/register',
  asyncHandler(async (req, res) => {
    const body = registerSchema.parse(req.body);
    const result = await registerUser(body);
    const session = await (await import('../services/auth.js')).createSession(result.user.id);
    setSessionCookie(res, session.raw, session.expiresAt);
    res.status(201).json({
      user: { id: result.user.id, email: result.user.email, name: result.user.name },
      profile: result.profile,
      household: result.household,
    });
  }),
);

router.post(
  '/login',
  asyncHandler(async (req, res) => {
    const body = z
      .object({
        email: z.string().email(),
        password: z.string().min(1),
        totpCode: z.string().optional(),
      })
      .parse(req.body);
    const { user, session } = await loginUser(body.email, body.password, body.totpCode);
    setSessionCookie(res, session.raw, session.expiresAt);
    res.json({ user: { id: user.id, email: user.email, name: user.name } });
  }),
);

router.post(
  '/logout',
  requireAuth,
  asyncHandler(async (req, res) => {
    await revokeSessionByRawToken(req.sessionToken);
    res.clearCookie('t2d_session', { path: '/' });
    res.json({ ok: true });
  }),
);

router.post(
  '/verify-email',
  asyncHandler(async (req, res) => {
    const { token } = z.object({ token: z.string().min(1) }).parse(req.body);
    await verifyEmailToken(token);
    res.json({ ok: true });
  }),
);

router.post(
  '/verification/resend',
  requireAuth,
  asyncHandler(async (req, res) => {
    if (req.user.emailVerifiedAt) throw new HttpError(400, 'Email already verified');
    await issueEmailVerification(req.user);
    res.json({ ok: true });
  }),
);

router.post(
  '/recovery/request',
  asyncHandler(async (req, res) => {
    const { email } = z.object({ email: z.string().email() }).parse(req.body);
    await requestPasswordReset(email);
    res.json({ ok: true });
  }),
);

router.post(
  '/recovery/complete',
  asyncHandler(async (req, res) => {
    const body = z
      .object({ token: z.string().min(1), password: z.string().min(10).max(200) })
      .parse(req.body);
    await completePasswordReset(body.token, body.password);
    res.json({ ok: true });
  }),
);

router.get(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json({
      user: {
        id: req.user.id,
        email: req.user.email,
        name: req.user.name,
        emailVerifiedAt: req.user.emailVerifiedAt,
      },
    });
  }),
);

export default router;
