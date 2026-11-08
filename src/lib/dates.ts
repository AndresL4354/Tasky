const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const DAY_MS = 86_400_000;

const pad = (n: number) => String(n).padStart(2, '0');

/** Fecha local de hoy como `YYYY-MM-DD`. */
export function todayISO(now: Date = new Date()): string {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d) + days * DAY_MS);
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

export function daysBetween(fromISO: string, toISO: string): number {
  const [a, b, c] = fromISO.split('-').map(Number);
  const [x, y, z] = toISO.split('-').map(Number);
  return Math.round((Date.UTC(x, y - 1, z) - Date.UTC(a, b - 1, c)) / DAY_MS);
}

export function isValidISODate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

/** "15 nov" o "15 nov 2027" si no es el año actual (o si se pide). */
export function formatShort(iso: string, today: string = todayISO(), withYear = false): string {
  const [y, m, d] = iso.split('-').map(Number);
  const sameYear = Number(today.slice(0, 4)) === y;
  return `${d} ${MONTHS[m - 1]}${withYear || !sameYear ? ` ${y}` : ''}`;
}

export type DueTone = 'overdue' | 'today' | 'soon' | 'normal' | 'done';

export interface DueInfo {
  label: string;
  tone: DueTone;
}

/** Texto y tono de una fecha límite, al estilo `@mañana` / `@vencida 3 nov`. */
export function dueInfo(due: string | null, done: boolean, today: string = todayISO()): DueInfo | null {
  if (!due) return null;
  const f = formatShort(due, today);
  if (done) return { label: `@${f}`, tone: 'done' };
  const diff = daysBetween(today, due);
  if (diff < 0) return { label: `@vencida ${f}`, tone: 'overdue' };
  if (diff === 0) return { label: '@hoy', tone: 'today' };
  if (diff === 1) return { label: '@mañana', tone: 'soon' };
  if (diff <= 2) return { label: `@${f}`, tone: 'soon' };
  return { label: `@${f}`, tone: 'normal' };
}

export function nowStamp(): string {
  return new Date().toISOString();
}
