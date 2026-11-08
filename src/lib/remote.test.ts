import { describe, expect, it } from 'vitest';
import { MemoryAdapter } from './db/memory';
import { AppState } from './state.svelte';

async function setup() {
  const app = new AppState(new MemoryAdapter(false));
  await app.init(); // crea el proyecto "bienvenida"
  const project = app.projects[0];
  const task = app.tasks.find((t) => t.project_id === project.id)!;
  return { app, project, task };
}

describe('cambios que llegan del celular', () => {
  it('agrega una nota nueva al proyecto elegido, o a "bandeja"', async () => {
    const { app, project } = await setup();
    expect(app.importRemoteNote({ text: 'Comprar cables #oficina !alta @2026-11-13', projectId: project.id, projectName: project.name })).toBe(project.name);
    const t = app.tasks.find((x) => x.title === 'Comprar cables')!;
    expect(t.tags).toEqual(['#oficina']);
    expect(t.priority).toBe(3);
    expect(t.due_date).toBe('2026-11-13');

    expect(app.importRemoteNote({ text: 'Idea suelta', projectId: 'no-existe', projectName: null })).toBe('bandeja');
    expect(app.projects.some((p) => p.name === 'bandeja')).toBe(true);
  });

  it('aplica un cambio, ignora campos inválidos y se puede deshacer', async () => {
    const { app, task } = await setup();
    const before = { ...task, tags: [...task.tags] };
    expect(
      app.applyRemotePatch(task.id, {
        title: 'Título nuevo',
        status_id: 'lista',
        priority: 2,
        due_date: '2026-12-01',
        tags: ['Front End'],
        notes: 'notas desde el celular',
      }),
    ).toBe(true);
    const t = app.tasks.find((x) => x.id === task.id)!;
    expect(t.title).toBe('Título nuevo');
    expect(t.status_id).toBe('lista');
    expect(t.completed_at).not.toBeNull();
    expect(t.tags).toEqual(['#front-end']);
    expect(t.notes).toBe('notas desde el celular');

    app.applyRemotePatch(task.id, { status_id: 'inventado', priority: 9 } as never);
    expect(app.tasks.find((x) => x.id === task.id)!.status_id).toBe('lista');

    app.undo();
    expect(app.tasks.find((x) => x.id === task.id)!.title).toBe(before.title);
  });

  it('elimina por pedido del celular y se puede deshacer', async () => {
    const { app, task } = await setup();
    expect(app.removeTaskRemote(task.id)).toBe(true);
    expect(app.tasks.some((x) => x.id === task.id)).toBe(false);
    expect(app.removeTaskRemote(task.id)).toBe(false);
    app.undo();
    expect(app.tasks.some((x) => x.id === task.id)).toBe(true);
  });

  it('un cambio sobre una tarea que ya no existe no rompe nada', async () => {
    const { app } = await setup();
    expect(app.applyRemotePatch('no-existe', { title: 'x' })).toBe(false);
  });
});
