import { DateTime } from 'luxon';
import { toDecimal } from '../util.js';

/**
 * Estimate days of supply from active schedules in the profile timezone.
 */
export function estimateDaysOfSupply({
  medication,
  schedules,
  timezone,
  recentAmounts = [],
}) {
  const stock = toDecimal(medication.currentStockCache);
  if (stock.lte(0)) {
    return {
      estimatedDays: 0,
      stockState: 'out',
      basis: 'stock',
      dailyConsumption: '0',
    };
  }

  const activeSchedules = (schedules || []).filter(
    (s) => s.active && s.scheduleType !== 'as_needed',
  );

  if (medication.status !== 'active' || activeSchedules.length === 0) {
    return {
      estimatedDays: null,
      stockState: stock.gt(0) ? 'available' : 'out',
      basis: 'quantity_only',
      dailyConsumption: null,
    };
  }

  let unitsPerDay = toDecimal(0);
  let basis = 'schedule';

  for (const schedule of activeSchedules) {
    let units = schedule.unitsPerDose != null ? toDecimal(schedule.unitsPerDose) : toDecimal(medication.defaultUnitsPerDose);

    if (schedule.doseEntry === 'variable') {
      if (recentAmounts.length > 0) {
        const sum = recentAmounts.reduce((acc, n) => acc.plus(toDecimal(n)), toDecimal(0));
        units = sum.div(recentAmounts.length);
        basis = 'trailing_average';
      } else if (schedule.unitsPerDose == null) {
        units = toDecimal(medication.defaultUnitsPerDose);
        basis = 'prefill_fallback';
      }
    }

    if (schedule.scheduleType === 'daily') {
      unitsPerDay = unitsPerDay.plus(units);
    } else if (schedule.scheduleType === 'weekly') {
      const days = schedule.daysOfWeek?.length || 0;
      if (days > 0) {
        unitsPerDay = unitsPerDay.plus(units.mul(days).div(7));
      }
    }
  }

  if (unitsPerDay.lte(0)) {
    return {
      estimatedDays: null,
      stockState: stock.lt(0) ? 'needs_reconciliation' : 'available',
      basis: 'quantity_only',
      dailyConsumption: '0',
    };
  }

  const estimatedDays = Math.floor(Number(stock.div(unitsPerDay).toFixed(0)));
  const stockState = deriveStockState({
    stock,
    estimatedDays,
    refillThresholdDays: medication.refillThresholdDays,
    refillLeadTimeDays: medication.refillLeadTimeDays,
    unitsPerDay,
  });

  return {
    estimatedDays,
    stockState,
    basis,
    dailyConsumption: unitsPerDay.toString(),
    timezone,
  };
}

export function deriveStockState({
  stock,
  estimatedDays,
  refillThresholdDays,
  refillLeadTimeDays,
  unitsPerDay,
}) {
  if (stock.lt(0)) return 'needs_reconciliation';
  if (stock.lte(0)) return 'out';
  if (unitsPerDay && stock.lt(unitsPerDay)) return 'urgent_refill';
  if (estimatedDays != null && estimatedDays <= refillLeadTimeDays) return 'urgent_refill';
  if (estimatedDays != null && estimatedDays <= refillThresholdDays) return 'refill_soon';
  return 'available';
}

export function localDateInZone(jsDate, timezone) {
  return DateTime.fromJSDate(jsDate, { zone: 'utc' }).setZone(timezone).toISODate();
}
