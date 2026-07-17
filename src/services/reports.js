import PDFDocument from 'pdfkit';
import { DateTime } from 'luxon';
import { prisma } from '../db.js';
import { HttpError, decimalToString } from '../util.js';
import { computeTimeInRange, doseCompletionSummary } from './health.js';

function resolveRange(range, from, to, timezone) {
  const end = to
    ? DateTime.fromISO(to, { zone: timezone }).endOf('day')
    : DateTime.now().setZone(timezone).endOf('day');
  let start;
  switch (range) {
    case '30d':
      start = end.minus({ days: 30 }).startOf('day');
      break;
    case '90d':
      start = end.minus({ months: 3 }).startOf('day');
      break;
    case '180d':
      start = end.minus({ months: 6 }).startOf('day');
      break;
    case '1y':
      start = end.minus({ years: 1 }).startOf('day');
      break;
    case 'all':
      start = DateTime.fromISO('1970-01-01', { zone: timezone });
      break;
    case 'custom':
      if (!from) throw new HttpError(400, 'Custom range requires from');
      start = DateTime.fromISO(from, { zone: timezone }).startOf('day');
      break;
    default:
      start = end.minus({ days: 30 }).startOf('day');
  }
  return { start, end, label: `${start.toISODate()} to ${end.toISODate()}` };
}

export async function gatherReportData(profileId, options) {
  const profile = await prisma.personProfile.findUnique({ where: { id: profileId } });
  if (!profile) throw new HttpError(404, 'Profile not found');
  const { start, end, label } = resolveRange(
    options.range || '30d',
    options.from,
    options.to,
    profile.timezone,
  );
  const from = start.toUTC().toJSDate();
  const to = end.toUTC().toJSDate();

  const [
    medications,
    doseEvents,
    inventory,
    bloodSugar,
    weight,
    bloodPressure,
    ketones,
    a1c,
    targets,
    completion7,
    completion30,
    symptomNotes,
  ] = await Promise.all([
    prisma.medication.findMany({
      where: { personProfileId: profileId },
      include: { schedules: true },
      orderBy: { name: 'asc' },
    }),
    prisma.doseEvent.findMany({
      where: {
        personProfileId: profileId,
        OR: [
          { scheduledFor: { gte: from, lte: to } },
          { takenAt: { gte: from, lte: to } },
        ],
      },
      include: { medication: true, schedule: true },
      orderBy: { scheduledFor: 'asc' },
    }),
    prisma.inventoryTransaction.findMany({
      where: {
        medication: { personProfileId: profileId },
        occurredAt: { gte: from, lte: to },
      },
      include: { medication: true },
      orderBy: { occurredAt: 'asc' },
    }),
    prisma.bloodSugarReading.findMany({
      where: { personProfileId: profileId, deletedAt: null, takenAt: { gte: from, lte: to } },
      orderBy: { takenAt: 'asc' },
    }),
    prisma.weightReading.findMany({
      where: { personProfileId: profileId, deletedAt: null, takenAt: { gte: from, lte: to } },
      orderBy: { takenAt: 'asc' },
    }),
    prisma.bloodPressureReading.findMany({
      where: { personProfileId: profileId, deletedAt: null, takenAt: { gte: from, lte: to } },
      orderBy: { takenAt: 'asc' },
    }),
    prisma.ketoneReading.findMany({
      where: { personProfileId: profileId, deletedAt: null, takenAt: { gte: from, lte: to } },
      orderBy: { takenAt: 'asc' },
    }),
    prisma.a1CReading.findMany({
      where: { personProfileId: profileId, deletedAt: null, takenAt: { gte: from, lte: to } },
      orderBy: { takenAt: 'asc' },
    }),
    prisma.healthTarget.findMany({ where: { personProfileId: profileId } }),
    doseCompletionSummary(profileId, 7),
    doseCompletionSummary(profileId, 30),
    prisma.symptomNote.findMany({
      where: { personProfileId: profileId, startedAt: { gte: from, lte: to } },
      orderBy: { startedAt: 'desc' },
      take: 50,
    }),
  ]);

  const bsTarget = targets.find((t) => t.metricType === 'blood_sugar' && t.context === 'any');
  const tir = computeTimeInRange(bloodSugar, bsTarget);

  return {
    profile,
    rangeLabel: label,
    start,
    end,
    medications,
    doseEvents,
    inventory,
    bloodSugar,
    weight,
    bloodPressure,
    ketones,
    a1c,
    targets,
    tir,
    completion7,
    completion30,
    symptomNotes,
    detail: options.detail || 'summary',
    recipient: options.recipient || null,
  };
}

export async function buildDoctorPdf(profileId, options) {
  const data = await gatherReportData(profileId, options);
  const doc = new PDFDocument({ margin: 50, bufferPages: true });
  const chunks = [];
  doc.on('data', (c) => chunks.push(c));

  const done = new Promise((resolve, reject) => {
    doc.on('end', resolve);
    doc.on('error', reject);
  });

  doc.fontSize(20).text('T2D Track Visit Report');
  doc.moveDown(0.5);
  doc.fontSize(11).text(`Person: ${data.profile.displayName}`);
  if (data.recipient) doc.text(`Recipient: ${data.recipient}`);
  doc.text(
    `Generated: ${DateTime.now().setZone(data.profile.timezone).toFormat('yyyy-LL-dd HH:mm ZZZZ')}`,
  );
  doc.text(`Report range (${data.profile.timezone}): ${data.rangeLabel}`);
  doc.moveDown();

  doc.fontSize(14).text('Active medications');
  doc.fontSize(11);
  const activeMeds = data.medications.filter(
    (m) => m.status === 'active' && (m.kind || 'medication') === 'medication',
  );
  if (!activeMeds.length) doc.text('No active medications', { oblique: true });
  for (const m of activeMeds) {
    doc.text(
      `• ${m.name}${m.strengthValue ? ` ${decimalToString(m.strengthValue)} ${m.strengthUnit || ''}` : ''} (${m.stockUnit})${m.instructions ? ` - ${m.instructions}` : ''}`,
    );
  }

  doc.moveDown();
  doc.fontSize(14).text('Active supplements');
  doc.fontSize(11);
  const activeSupps = data.medications.filter(
    (m) => m.status === 'active' && m.kind === 'supplement',
  );
  if (!activeSupps.length) doc.text('No active supplements', { oblique: true });
  for (const m of activeSupps) {
    doc.text(
      `• ${m.name}${m.strengthValue ? ` ${decimalToString(m.strengthValue)} ${m.strengthUnit || ''}` : ''} (${m.stockUnit})${m.instructions ? ` - ${m.instructions}` : ''}`,
    );
  }

  doc.moveDown();
  doc.fontSize(14).text('Dose completion');
  doc.fontSize(11).text(
    `7-day: ${data.completion7.percent ?? 'n/a'}% (${data.completion7.taken}/${data.completion7.total}) | 30-day: ${data.completion30.percent ?? 'n/a'}% (${data.completion30.taken}/${data.completion30.total})`,
  );

  doc.moveDown();
  doc.fontSize(14).text('Blood sugar time-in-range');
  doc.fontSize(11).text(
    data.tir
      ? `${data.tir.percent ?? 'n/a'}% in range (${data.tir.inRange}/${data.tir.total}). ${data.tir.label}.`
      : 'No personal blood-sugar target ranges entered; time-in-range not calculated.',
  );

  doc.moveDown();
  doc.fontSize(14).text('Reading counts in range');
  doc.fontSize(11).text(
    `Blood sugar: ${data.bloodSugar.length} | Weight: ${data.weight.length} | Blood pressure: ${data.bloodPressure.length} | Ketones: ${data.ketones.length} | A1C: ${data.a1c.length}`,
  );

  if (data.targets.length) {
    doc.moveDown();
    doc.fontSize(14).text('Personal target ranges (user-entered)');
    doc.fontSize(11);
    for (const t of data.targets) {
      doc.text(
        `• ${t.metricType} (${t.context}): ${decimalToString(t.lowValue) ?? '-'} to ${decimalToString(t.highValue) ?? '-'} ${t.unit}`,
      );
    }
  }

  doc.moveDown();
  doc.fontSize(14).text('Notes & symptoms');
  doc.fontSize(11);
  const notes = data.symptomNotes || [];
  if (!notes.length) doc.text('No notes in range', { oblique: true });
  for (const n of notes.slice(0, 20)) {
    const tagStr = (n.tags || []).length ? ` [${n.tags.join(', ')}]` : '';
    const moodStr = n.mood != null ? ` mood ${n.mood}/5` : '';
    doc.text(
      `• ${n.startedAt.toISOString().slice(0, 10)} | ${n.kind}${moodStr}${tagStr}: ${n.summary}${n.details ? `: ${n.details}` : ''}`,
    );
  }

  if (data.detail === 'complete') {
    doc.addPage();
    doc.fontSize(14).text('Dose events');
    doc.fontSize(9);
    for (const e of data.doseEvents) {
      doc.text(
        `${e.scheduledFor ? e.scheduledFor.toISOString() : ''} | ${e.medication.name} | ${e.status} | ${decimalToString(e.amountTaken) || ''}`,
      );
    }
    doc.moveDown();
    doc.fontSize(14).text('Blood sugar readings');
    doc.fontSize(9);
    for (const r of data.bloodSugar) {
      doc.text(`${r.takenAt.toISOString()} | ${decimalToString(r.value)} ${r.unit} | ${r.context}`);
    }
    doc.moveDown();
    doc.fontSize(14).text('Ketone readings');
    doc.fontSize(9);
    for (const r of data.ketones) {
      doc.text(`${r.takenAt.toISOString()} | ${decimalToString(r.value)} ${r.unit} | ${r.context}`);
    }
  }

  const pages = doc.bufferedPageRange();
  for (let i = pages.start; i < pages.start + pages.count; i += 1) {
    doc.switchToPage(i);
    doc.fontSize(8).text(`Page ${i + 1} | ${data.rangeLabel}`, 50, doc.page.height - 40, {
      width: doc.page.width - 100,
      align: 'center',
    });
  }

  doc.end();
  await done;

  const filename = `t2d-track-${data.profile.displayName.replace(/\s+/g, '-').toLowerCase()}-${data.start.toISODate()}_${data.end.toISODate()}.pdf`;
  return { buffer: Buffer.concat(chunks), filename, preview: data };
}

export function reportDataToCsv(data) {
  const lines = ['type,timestamp,medication,value,unit,context,status,notes'];
  for (const e of data.doseEvents) {
    lines.push(
      [
        'dose',
        e.scheduledFor?.toISOString() || '',
        JSON.stringify(e.medication.name),
        decimalToString(e.amountTaken) || '',
        e.medication.stockUnit,
        '',
        e.status,
        JSON.stringify(e.notes || ''),
      ].join(','),
    );
  }
  for (const r of data.bloodSugar) {
    lines.push(
      [
        'blood_sugar',
        r.takenAt.toISOString(),
        '',
        decimalToString(r.value),
        r.unit,
        r.context,
        '',
        JSON.stringify(r.notes || ''),
      ].join(','),
    );
  }
  for (const r of data.ketones) {
    lines.push(
      [
        'ketone',
        r.takenAt.toISOString(),
        '',
        decimalToString(r.value),
        r.unit,
        r.context,
        '',
        JSON.stringify(r.notes || ''),
      ].join(','),
    );
  }
  for (const r of data.weight) {
    lines.push(
      ['weight', r.takenAt.toISOString(), '', decimalToString(r.value), r.unit, '', '', JSON.stringify(r.notes || '')].join(
        ',',
      ),
    );
  }
  for (const r of data.bloodPressure) {
    lines.push(
      [
        'blood_pressure',
        r.takenAt.toISOString(),
        '',
        `${r.systolic}/${r.diastolic}`,
        'mmHg',
        r.context,
        '',
        JSON.stringify(r.notes || ''),
      ].join(','),
    );
  }
  for (const r of data.a1c) {
    lines.push(
      [
        'a1c',
        r.takenAt.toISOString?.() || String(r.takenAt),
        '',
        decimalToString(r.valuePercent),
        '%',
        '',
        '',
        JSON.stringify(r.notes || ''),
      ].join(','),
    );
  }
  for (const n of data.symptomNotes || []) {
    lines.push(
      [
        n.kind || 'note',
        n.startedAt?.toISOString?.() || '',
        '',
        n.mood != null ? String(n.mood) : '',
        '',
        (n.tags || []).join('|'),
        '',
        JSON.stringify(`${n.summary}${n.details ? `: ${n.details}` : ''}`),
      ].join(','),
    );
  }
  return lines.join('\n');
}

export async function buildWalletCardPdf(profileId) {
  const profile = await prisma.personProfile.findUnique({ where: { id: profileId } });
  if (!profile) throw new HttpError(404, 'Profile not found');
  const meds = await prisma.medication.findMany({
    where: { personProfileId: profileId, status: 'active' },
    include: { schedules: { where: { active: true } } },
    orderBy: { name: 'asc' },
  });

  const doc = new PDFDocument({ size: [288, 180], margin: 12 });
  const chunks = [];
  doc.on('data', (c) => chunks.push(c));
  const done = new Promise((resolve, reject) => {
    doc.on('end', resolve);
    doc.on('error', reject);
  });

  doc.fontSize(11).text('T2D Track Emergency Card', { align: 'center' });
  doc.moveDown(0.3);
  doc.fontSize(9).text(profile.displayName, { align: 'center' });
  doc.moveDown(0.4);
  doc.fontSize(7);
  for (const m of meds.slice(0, 8)) {
    const times = m.schedules
      .filter((s) => s.timeOfDay)
      .map((s) => s.timeOfDay)
      .join(', ');
    doc.text(
      `• ${m.kind === 'supplement' ? '[S] ' : ''}${m.name}${m.strengthValue ? ` ${decimalToString(m.strengthValue)}${m.strengthUnit || ''}` : ''}${times ? ` @ ${times}` : ''}`,
    );
  }
  if (meds.length > 8) doc.text(`…and ${meds.length - 8} more`);
  doc.moveDown(0.3);
  doc.fontSize(6).text('Not clinical advice. Verify with current prescriptions.', {
    align: 'center',
  });
  doc.end();
  await done;
  const filename = `t2d-wallet-${profile.displayName.replace(/\s+/g, '-').toLowerCase()}.pdf`;
  return { buffer: Buffer.concat(chunks), filename };
}

