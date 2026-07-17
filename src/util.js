import { Decimal } from '@prisma/client/runtime/library';

export function toDecimal(value) {
  if (value instanceof Decimal) return value;
  return new Decimal(value ?? 0);
}

export function decimalToNumber(value) {
  if (value == null) return null;
  return Number(value.toString());
}

export function decimalToString(value) {
  if (value == null) return null;
  return value.toString();
}

export function serializeMedication(med) {
  if (!med) return null;
  return {
    ...med,
    strengthValue: decimalToString(med.strengthValue),
    defaultUnitsPerDose: decimalToString(med.defaultUnitsPerDose),
    currentStockCache: decimalToString(med.currentStockCache),
    schedules: med.schedules?.map(serializeSchedule),
  };
}

export function serializeSchedule(schedule) {
  if (!schedule) return null;
  return {
    ...schedule,
    unitsPerDose: decimalToString(schedule.unitsPerDose),
  };
}

export function serializeDoseEvent(event) {
  if (!event) return null;
  return {
    ...event,
    amountTaken: decimalToString(event.amountTaken),
    medication: event.medication ? serializeMedication(event.medication) : undefined,
    schedule: event.schedule ? serializeSchedule(event.schedule) : undefined,
  };
}

export function serializeInventoryTxn(txn) {
  if (!txn) return null;
  return {
    ...txn,
    quantityDelta: decimalToString(txn.quantityDelta),
    balanceAfter: decimalToString(txn.balanceAfter),
  };
}

export function serializeReading(reading) {
  if (!reading) return null;
  const out = { ...reading };
  if (reading.value != null) out.value = decimalToString(reading.value);
  if (reading.valuePercent != null) out.valuePercent = decimalToString(reading.valuePercent);
  return out;
}

export class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}
