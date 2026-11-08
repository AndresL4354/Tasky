import { describe, expect, it } from 'vitest';
import { MemoryAdapter, validateSnapshot } from './memory';

describe('MemoryAdapter', () => {
  it('arranca con los estados por defecto', async () => {
    const db = new MemoryAdapter(false);
    const snap = await db.loadAll();
    expect(snap.statuses.map((s) => s.id)).toEqual(['pendiente', 'proceso', 'bloqueada', 'deploy', 'lista']);
  });

  it('guarda, borra en cascada y reasigna estados', async () => {
    const db = new MemoryAdapter(false);
    await db.saveProjects([{ id: 'p', name: 'p', sort_order: 1, archived: false, created_at: '', updated_at: '' }]);
    const base = { project_id: 'p', priority: 1 as const, due_date: null, notes: '', tags: [], created_at: '', updated_at: '', completed_at: null };
    await db.saveTasks([
      { ...base, id: 'a', title: 'a', status_id: 'bloqueada', sort_order: 1 },
      { ...base, id: 'b', title: 'b', status_id: 'proceso', sort_order: 2 },
    ]);
    await db.deleteStatus('bloqueada', 'pendiente', 'now');
    let snap = await db.loadAll();
    expect(snap.tasks.find((t) => t.id === 'a')?.status_id).toBe('pendiente');
    await db.deleteProject('p');
    snap = await db.loadAll();
    expect(snap.tasks).toHaveLength(0);
  });

  it('valida respaldos inconsistentes', () => {
    expect(() => validateSnapshot({ statuses: [], projects: [], tasks: [] })).toThrow();
    expect(() =>
      validateSnapshot({
        statuses: [{ id: 's' }],
        projects: [],
        tasks: [{ id: 't', title: 't', project_id: 'nope', status_id: 's' }],
      }),
    ).toThrow(/no existe/);
  });
});
