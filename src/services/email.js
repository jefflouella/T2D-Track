import { Resend } from 'resend';
import { config } from '../config.js';
import { logger } from '../logger.js';

let resendClient = null;

function getClient() {
  if (!config.RESEND_API_KEY) return null;
  if (!resendClient) resendClient = new Resend(config.RESEND_API_KEY);
  return resendClient;
}

export async function sendEmail({ to, subject, text, html }) {
  const client = getClient();
  if (!client) {
    logger.info('email.skipped', { to, subject, reason: 'RESEND_API_KEY not set' });
    logger.debug('email.body', { text });
    return { skipped: true };
  }
  try {
    const result = await client.emails.send({
      from: config.FROM_EMAIL,
      to,
      subject,
      text,
      html,
    });
    logger.info('email.sent', { to, subject, id: result?.data?.id });
    return result;
  } catch (err) {
    logger.error('email.failed', { to, subject, error: err.message });
    throw err;
  }
}
