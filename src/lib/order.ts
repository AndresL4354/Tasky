import type { SortMode, Status, Task } from './types';

/** Filtra por texto: título, `#etiqueta` o nombre de estado. Varias palabras = todas deben coincidir. */
export function matchesFilter(task: Task, query: string, statusName: string): boolean {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return true;
  const title = task.title.toLowerCase();
  const status = statusName.toLowerCase();
  return terms.every((term) => {
    if (term.startsWith('#')) return task.tags.some((t) => t.startsWith(term));
    if (term.startsWith('!')) {
      const p = term.slice(1);
      return (p === 'alta' && task.priority === 3) || (p === 'media' && task.priority === 2) || (p === 'baja' && task.priority === 1);
    }
    return title.includes(term) || status.includes(term) || task.tags.some((t) => t.includes(term));
  });
}

export function sortTasks(tasks: Task[], mode: SortMode, statuses: Status[]): Task[] {
  const list = [...tasks].sort((a, b) => a.sort_order - b.sort_order);
  if (mode === 'manual') return list;
  const statusOrder = new Map(statuses.map((s) => [s.id, s.sort_order]));
  const index = new Map(list.map((t, i) => [t.id, i]));
  return list.sort((a, b) => {
    let d = 0;
    if (mode === 'estado') d = (statusOrder.get(a.status_id) ?? 99) - (statusOrder.get(b.status_id) ?? 99);
    else if (mode === 'prioridad') d = b.priority - a.priority;
    else if (mode === 'fecha') {
      const ad = a.due_date ?? '9999-99-99';
      const bd = b.due_date ?? '9999-99-99';
      d = ad < bd ? -1 : ad > bd ? 1 : 0;
    }
    return d || index.get(a.id)! - index.get(b.id)!;
  });
}

export interface VisibleOptions {
  sort: SortMode;
  filter: string;
  hideDone: boolean;
  statuses: Status[];
}

export function visibleTasks(tasks: Task[], opts: VisibleOptions): Task[] {
  const byId = new Map(opts.statuses.map((s) => [s.id, s]));
  const filtered = tasks.filter((t) => {
    const st = byId.get(t.status_id);
    if (opts.hideDone && st?.is_done) return false;
    return matchesFilter(t, opts.filter, st?.name ?? '');
  });
  return sortTasks(filtered, opts.sort, opts.statuses);
}

/** sort_order para insertar al final. */
export function nextSortOrder(tasks: Task[]): number {
  return tasks.reduce((max, t) => Math.max(max, t.sort_order), 0) + 1;
}
