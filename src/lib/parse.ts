import { addDays, isValidISODate, todayISO } from './dates';
import type { Priority } from './types';

export interface ParsedEntry {
  title: string;
  tags: string[];
  priority: Priority | null;
  due: string | null;
}

const WEEKDAYS: Record<string, number> = {
  domingo: 0, lunes: 1, martes: 2, miercoles: 3, miércoles: 3, jueves: 4, viernes: 5, sabado: 6, sábado: 6,
};

const TAG_RE = /^#[\p{L}\p{N}_-]+$/u;
const PRIORITY_RE = /^!(alta|media|baja|a|m|b|1|2|3)$/i;

/** Interpreta `hoy`, `mañana`, `15/11`, `15/11/27`, `2026-11-15` o un día de la semana. */
export function parseDate(raw: string, today: string = todayISO()): string | null {
  const s = raw.toLowerCase();
  if (s === 'hoy') return today;
  if (s === 'mañana' || s === 'manana') return addDays(today, 1);
  if (s in WEEKDAYS) {
    const [y, m, d] = today.split('-').map(Number);
    const current = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
    const delta = (WEEKDAYS[s] - current + 7) % 7 || 7;
    return addDays(today, delta);
  }
  if (isValidISODate(s)) return s;
  const m = s.match(/^(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2}|\d{4}))?$/);
  if (!m) return null;
  const thisYear = Number(today.slice(0, 4));
  let year = m[3] ? Number(m[3]) : thisYear;
  if (year < 100) year += 2000;
  let iso = `${year}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  if (!isValidISODate(iso)) return null;
  // Sin año explícito y ya pasó: se asume el año siguiente.
  if (!m[3] && iso < today) iso = `${year + 1}${iso.slice(4)}`;
  return isValidISODate(iso) ? iso : null;
}

function parsePriority(v: string): Priority {
  const k = v.toLowerCase();
  if (k === 'alta' || k === 'a' || k === '3') return 3;
  if (k === 'media' || k === 'm' || k === '2') return 2;
  return 1;
}

/**
 * Entrada rápida estilo código: `Arreglar login #auth !alta @15/11`.
 * Las palabras que no son marcas quedan como título.
 */
export function parseEntry(text: string, today: string = todayISO()): ParsedEntry {
  const out: ParsedEntry = { title: '', tags: [], priority: null, due: null };
  const words: string[] = [];
  for (const w of text.trim().split(/\s+/)) {
    if (!w) continue;
    if (TAG_RE.test(w)) {
      const tag = w.toLowerCase();
      if (!out.tags.includes(tag)) out.tags.push(tag);
      continue;
    }
    const pm = w.match(PRIORITY_RE);
    if (pm) {
      out.priority = parsePriority(pm[1]);
      continue;
    }
    if (w.startsWith('@') && w.length > 1) {
      const d = parseDate(w.slice(1), today);
      if (d) {
        out.due = d;
        continue;
      }
    }
    words.push(w);
  }
  out.title = words.join(' ');
  return out;
}

/** Normaliza una etiqueta escrita por el usuario: `Front End` → `#front-end`. */
export function normalizeTag(raw: string): string | null {
  const v = raw.trim().toLowerCase().replace(/^#+/, '').replace(/\s+/g, '-');
  if (!v) return null;
  const tag = `#${v}`;
  return TAG_RE.test(tag) ? tag : null;
}
