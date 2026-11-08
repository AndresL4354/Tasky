import type { Project, Status, Task } from './types';

/** Rango [inicio, fin) dentro del texto original. */
export type Range = [number, number];

/**
 * Pasa a minúsculas y quita acentos ("Producción" → "produccion"),
 * guardando a qué posición del texto original corresponde cada carácter.
 */
export function fold(s: string): { text: string; map: number[] } {
  let text = '';
  const map: number[] = [];
  for (let i = 0; i < s.length; i++) {
    const base = s[i].normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
    for (let k = 0; k < base.length; k++) {
      text += base[k];
      map.push(i);
    }
  }
  return { text, map };
}

export function foldText(s: string): string {
  return fold(s).text;
}

function mergeRanges(ranges: Range[]): Range[] {
  const sorted = [...ranges].sort((a, b) => a[0] - b[0]);
  const out: Range[] = [];
  for (const r of sorted) {
    const last = out[out.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else out.push([r[0], r[1]]);
  }
  return out;
}

/** Todas las apariciones de los términos (ya normalizados) dentro de `s`, sin importar acentos. */
export function findRanges(s: string, terms: string[]): Range[] {
  if (!s) return [];
  const { text, map } = fold(s);
  const ranges: Range[] = [];
  for (const term of terms) {
    if (!term) continue;
    let from = 0;
    for (;;) {
      const i = text.indexOf(term, from);
      if (i < 0) break;
      ranges.push([map[i], map[i + term.length - 1] + 1]);
      from = i + term.length;
    }
  }
  return mergeRanges(ranges);
}

/** Corta un texto en trozos marcando los que coinciden, para resaltarlos. */
export function segments(s: string, ranges: Range[]): { text: string; hit: boolean }[] {
  const out: { text: string; hit: boolean }[] = [];
  let pos = 0;
  for (const [a, b] of ranges) {
    if (a > pos) out.push({ text: s.slice(pos, a), hit: false });
    out.push({ text: s.slice(a, b), hit: true });
    pos = b;
  }
  if (pos < s.length) out.push({ text: s.slice(pos), hit: false });
  return out;
}

export interface ParsedQuery {
  /** Palabras que se buscan en cualquier campo. */
  terms: string[];
  /** Palabras con `#`: deben coincidir con el inicio de una etiqueta. */
  tagTerms: string[];
}

export function parseQuery(query: string): ParsedQuery {
  const words = foldText(query).split(/\s+/).filter(Boolean);
  return {
    terms: words.filter((w) => !w.startsWith('#')),
    tagTerms: words.filter((w) => w.startsWith('#') && w.length > 1),
  };
}

export interface NoteSnippet {
  text: string;
  ranges: Range[];
}

/** Primera línea de las notas que coincide, recortada alrededor de la coincidencia. */
export function noteSnippet(notes: string, terms: string[], width = 110): NoteSnippet | null {
  for (const line of notes.split('\n')) {
    const ranges = findRanges(line, terms);
    if (!ranges.length) continue;
    const from = Math.max(0, ranges[0][0] - 30);
    const to = Math.min(line.length, from + width);
    const prefix = from > 0 ? '…' : '';
    const suffix = to < line.length ? '…' : '';
    const shift = prefix.length - from;
    return {
      text: prefix + line.slice(from, to) + suffix,
      ranges: ranges
        .filter(([a, b]) => a < to && b > from)
        .map(([a, b]) => [Math.max(a, from) + shift, Math.min(b, to) + shift] as Range),
    };
  }
  return null;
}

export interface TaskHit {
  task: Task;
  project: Project;
  status: Status | undefined;
  /** Posición de la tarea en su proyecto (orden manual), empezando en 1. */
  line: number;
  score: number;
  titleRanges: Range[];
  tags: { tag: string; hit: boolean }[];
  note: NoteSnippet | null;
  statusHit: boolean;
}

export interface ProjectHit {
  project: Project;
  ranges: Range[];
}

export interface SearchResults {
  projects: ProjectHit[];
  tasks: TaskHit[];
  /** Total de tareas encontradas (puede ser mayor que `tasks.length` si se recortó). */
  total: number;
}

const WORD_START = /[\s\p{P}\p{S}]/u;

/**
 * Búsqueda global: título, notas, etiquetas y estado de cada tarea, más el nombre del proyecto.
 * Todas las palabras deben aparecer (en cualquier campo) y al menos una en la propia tarea,
 * para que buscar el nombre de un proyecto no liste todas sus tareas.
 */
export function searchAll(
  query: string,
  data: { tasks: Task[]; projects: Project[]; statuses: Status[] },
  limit = 300,
): SearchResults {
  const { terms, tagTerms } = parseQuery(query);
  if (terms.length === 0 && tagTerms.length === 0) return { projects: [], tasks: [], total: 0 };

  const projectById = new Map(data.projects.map((p) => [p.id, p]));
  const statusById = new Map(data.statuses.map((s) => [s.id, s]));

  const projects: ProjectHit[] =
    tagTerms.length || terms.length === 0
      ? []
      : data.projects
          .filter((p) => {
            const name = foldText(p.name);
            return terms.every((t) => name.includes(t));
          })
          .sort((a, b) => Number(a.archived) - Number(b.archived) || a.sort_order - b.sort_order)
          .map((project) => ({ project, ranges: findRanges(project.name, terms) }));

  // Número de línea de cada tarea dentro de su proyecto.
  const lineOf = new Map<string, number>();
  const byProject = new Map<string, Task[]>();
  for (const t of data.tasks) {
    const list = byProject.get(t.project_id) ?? [];
    list.push(t);
    byProject.set(t.project_id, list);
  }
  for (const list of byProject.values()) {
    list.sort((a, b) => a.sort_order - b.sort_order).forEach((t, i) => lineOf.set(t.id, i + 1));
  }

  const hits: TaskHit[] = [];
  for (const task of data.tasks) {
    const project = projectById.get(task.project_id);
    if (!project) continue;
    const status = statusById.get(task.status_id);
    const fTitle = foldText(task.title);
    const fNotes = foldText(task.notes);
    const fTags = task.tags.map(foldText);
    const fStatus = status ? foldText(status.name) : '';
    const fProject = foldText(project.name);

    if (!tagTerms.every((tt) => fTags.some((g) => g.startsWith(tt)))) continue;

    let score = tagTerms.length * 8;
    let own = tagTerms.length > 0;
    let ok = true;
    for (const t of terms) {
      let s = 0;
      const ti = fTitle.indexOf(t);
      if (ti >= 0) s += ti === 0 || WORD_START.test(fTitle[ti - 1]) ? 14 : 10;
      if (fTags.some((g) => g.includes(t))) s += 7;
      if (fStatus.includes(t)) s += 3;
      if (fNotes.includes(t)) s += 2;
      if (s > 0) own = true;
      if (fProject.includes(t)) s += 1;
      if (s === 0) {
        ok = false;
        break;
      }
      score += s;
    }
    if (!ok || !own) continue;
    if (status?.is_done) score -= 1;
    if (project.archived) score -= 1;

    hits.push({
      task,
      project,
      status,
      line: lineOf.get(task.id) ?? 0,
      score,
      titleRanges: findRanges(task.title, terms),
      tags: task.tags.map((tag, i) => ({
        tag,
        hit: terms.some((t) => fTags[i].includes(t)) || tagTerms.some((tt) => fTags[i].startsWith(tt)),
      })),
      note: terms.some((t) => fNotes.includes(t)) ? noteSnippet(task.notes, terms) : null,
      statusHit: terms.some((t) => fStatus.includes(t)),
    });
  }

  hits.sort(
    (a, b) =>
      b.score - a.score ||
      Number(a.project.archived) - Number(b.project.archived) ||
      a.project.sort_order - b.project.sort_order ||
      a.task.sort_order - b.task.sort_order,
  );
  return { projects, tasks: hits.slice(0, limit), total: hits.length };
}

/** Agrupa los resultados por proyecto, en el orden del mejor resultado de cada uno. */
export function groupByProject(hits: TaskHit[]): { project: Project; hits: TaskHit[] }[] {
  const groups = new Map<string, { project: Project; hits: TaskHit[] }>();
  for (const h of hits) {
    const g = groups.get(h.project.id) ?? { project: h.project, hits: [] };
    g.hits.push(h);
    groups.set(h.project.id, g);
  }
  return [...groups.values()];
}
