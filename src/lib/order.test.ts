import { describe, expect, it } from 'vitest';
import { DEFAULT_STATUSES } from './defaults';
import { matchesFilter, nextSortOrder, sortTasks, visibleTasks } from './order';
import type { Task } from './types';

function task(id: string, over: Partial<Task> = {}): Task {
  return {
    id,
    project_id: 'p',
    title: `tarea ${id}`,
    status_id: 'pendiente',
    priority: 1,
    due_date: null,
    notes: '',
    tags: [],
    sort_order: Number(id),
    created_at: '',
    updated_at: '',
    completed_at: null,
    ...over,
  };
}

const tasks = [
  task('1', { status_id: 'lista', priority: 3, due_date: '2026-11-20', tags: ['#bug'] }),
  task('2', { status_id: 'proceso', priority: 1, title: 'Login con OAuth' }),
  task('3', { status_id: 'pendiente', priority: 2, due_date: '2026-11-10' }),
];

describe('sortTasks', () => {
  it('manual respeta sort_order', () => {
    expect(sortTasks([...tasks].reverse(), 'manual', DEFAULT_STATUSES).map((t) => t.id)).toEqual(['1', '2', '3']);
  });
  it('por estado sigue el orden de los estados', () => {
    expect(sortTasks(tasks, 'estado', DEFAULT_STATUSES).map((t) => t.id)).toEqual(['3', '2', '1']);
  });
  it('por prioridad de alta a baja', () => {
    expect(sortTasks(tasks, 'prioridad', DEFAULT_STATUSES).map((t) => t.id)).toEqual(['1', '3', '2']);
  });
  it('por fecha deja las sin fecha al final', () => {
    expect(sortTasks(tasks, 'fecha', DEFAULT_STATUSES).map((t) => t.id)).toEqual(['3', '1', '2']);
  });
});

describe('filtros', () => {
  it('texto, #tag, !prioridad y estado', () => {
    expect(matchesFilter(tasks[1], 'oauth', 'en proceso')).toBe(true);
    expect(matchesFilter(tasks[0], '#bu', 'lista')).toBe(true);
    expect(matchesFilter(tasks[0], '!alta', 'lista')).toBe(true);
    expect(matchesFilter(tasks[1], 'proceso', 'en proceso')).toBe(true);
    expect(matchesFilter(tasks[1], 'login #bug', 'en proceso')).toBe(false);
  });

  it('visibleTasks oculta terminadas', () => {
    const ids = visibleTasks(tasks, { sort: 'manual', filter: '', hideDone: true, statuses: DEFAULT_STATUSES }).map((t) => t.id);
    expect(ids).toEqual(['2', '3']);
  });

  it('nextSortOrder', () => {
    expect(nextSortOrder(tasks)).toBe(4);
    expect(nextSortOrder([])).toBe(1);
  });
});
