const SENSITIVE_KEYS = new Set([
  'password',
  'passwordHash',
  'token',
  'tokenHash',
  'session',
  'auth',
  'p256dh',
  'authorization',
  'cookie',
  'notes',
  'value',
  'valuePercent',
  'systolic',
  'diastolic',
  'amountTaken',
]);

function redact(value, key) {
  if (key && SENSITIVE_KEYS.has(key)) return '[redacted]';
  if (Array.isArray(value)) return value.map((item) => redact(item));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = redact(v, k);
    return out;
  }
  return value;
}

function log(level, message, meta) {
  const entry = {
    level,
    time: new Date().toISOString(),
    msg: message,
    ...(meta ? { meta: redact(meta) } : {}),
  };
  const line = JSON.stringify(entry);
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

export const logger = {
  debug: (message, meta) => log('debug', message, meta),
  info: (message, meta) => log('info', message, meta),
  warn: (message, meta) => log('warn', message, meta),
  error: (message, meta) => log('error', message, meta),
};
