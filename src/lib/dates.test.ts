import { describe, expect, it } from 'vitest';
import { addDays, dueInfo, formatShort, isValidISODate } from './dates';

const TODAY = '2026-11-07';

describe('dueInfo', () => {
  it('marca vencidas, hoy, mañana y próximas', () => {
    expect(dueInfo('2026-11-05', false, TODAY)).toEqual({ label: '@vencida 5 nov', tone: 'overdue' });
    expect(dueInfo('2026-11-07', false, TODAY)).toEqual({ label: '@hoy', tone: 'today' });
    expect(dueInfo('2026-11-08', false, TODAY)).toEqual({ label: '@mañana', tone: 'soon' });
    expect(dueInfo('2026-11-09', false, TODAY)).toEqual({ label: '@9 nov', tone: 'soon' });
    expect(dueInfo('2026-11-20', false, TODAY)).toEqual({ label: '@20 nov', tone: 'normal' });
  });

  it('las terminadas no avisan', () => {
    expect(dueInfo('2026-11-01', true, TODAY)?.tone).toBe('done');
  });

  it('sin fecha no hay info', () => {
    expect(dueInfo(null, false, TODAY)).toBeNull();
  });
});

describe('helpers', () => {
  it('addDays cruza meses y años', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('formatShort muestra el año solo si cambia', () => {
    expect(formatShort('2026-11-15', TODAY)).toBe('15 nov');
    expect(formatShort('2027-01-02', TODAY)).toBe('2 ene 2027');
  });

  it('isValidISODate', () => {
    expect(isValidISODate('2026-02-29')).toBe(false);
    expect(isValidISODate('2028-02-29')).toBe(true);
  });
});
