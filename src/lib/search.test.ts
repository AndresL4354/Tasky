import { describe, expect, it } from 'vitest';
import { DEFAULT_STATUSES } from './defaults';
import { findRanges, fold, groupByProject, noteSnippet, parseQuery, searchAll, segments } from './search';
import type { Project, Task } from './types';

const project = (id: string, name: string, extra: Partial<Project> = {}): Project => ({
  id,
  name,
  sort_order: 1,
  archived: false,
  created_at: '',
  updated_at: '',
  ...extra,
});

const task = (id: string, project_id: string, over: Partial<Task> = {}): Task => ({
  id,
  project_id,
  title: id,
  status_id: 'pendiente',
  priority: 1,
  due_date: null,
  notes: '',
  tags: [],
  sort_order: 1,
  created_at: '',
  updated_at: '',
  completed_at: null,
  ...over,
});

const projects = [project('api', 'api-backend'), project('web', 'web-app', { sort_order: 2 })];
const tasks = [
  task('a1', 'api', { title: 'Implementar login con OAuth', tags: ['#auth'], status_id: 'proceso', sort_order: 1 }),
  task('a2', 'api', { title: 'Revisar logs de producción', notes: 'Mirar el panel de errores\n- revisar la API de pagos', sort_order: 2 }),
  task('w1', 'web', { title: 'Pantalla de ajustes', tags: ['#ui'], status_id: 'lista' }),
  task('w2', 'web', { title: 'Error 500 al subir avatar', tags: ['#bug', '#ui'], status_id: 'bloqueada', sort_order: 2 }),
];
const data = { tasks, projects, statuses: DEFAULT_STATUSES };

describe('normalización', () => {
  it('ignora acentos y mayúsculas', () => {
    expect(fold('Producción').text).toBe('produccion');
    const s = 'Revisar logs de producción';
    const [[a, b]] = findRanges(s, ['produccion']);
    expect(s.slice(a, b)).toBe('producción');
  });

  it('segments marca los trozos encontrados', () => {
    expect(segments('hola mundo', [[5, 10]])).toEqual([
      { text: 'hola ', hit: false },
      { text: 'mundo', hit: true },
    ]);
  });

  it('parseQuery separa etiquetas', () => {
    expect(parseQuery('Login #Auth')).toEqual({ terms: ['login'], tagTerms: ['#auth'] });
  });
});

describe('searchAll', () => {
  it('busca en títulos de todos los proyectos', () => {
    const r = searchAll('produccion', data);
    expect(r.tasks.map((h) => h.task.id)).toEqual(['a2']);
    expect(r.tasks[0].line).toBe(2);
  });

  it('busca en notas y devuelve un fragmento', () => {
    const r = searchAll('pagos', data);
    expect(r.tasks.map((h) => h.task.id)).toEqual(['a2']);
    expect(r.tasks[0].note?.text).toBe('- revisar la API de pagos');
    expect(r.tasks[0].note?.ranges).toEqual([[20, 25]]);
  });

  it('busca etiquetas con y sin #', () => {
    expect(searchAll('#ui', data).tasks.map((h) => h.task.id).sort()).toEqual(['w1', 'w2']);
    expect(searchAll('bug', data).tasks.map((h) => h.task.id)).toEqual(['w2']);
  });

  it('busca por nombre de estado', () => {
    expect(searchAll('bloqueada', data).tasks.map((h) => h.task.id)).toEqual(['w2']);
  });

  it('todas las palabras deben coincidir; el proyecto cuenta pero no basta solo', () => {
    expect(searchAll('web ajustes', data).tasks.map((h) => h.task.id)).toEqual(['w1']);
    const onlyProject = searchAll('backend', data);
    expect(onlyProject.tasks).toEqual([]);
    expect(onlyProject.projects.map((p) => p.project.id)).toEqual(['api']);
  });

  it('prioriza coincidencias en el título', () => {
    const r = searchAll('revisar', data);
    expect(r.tasks[0].task.id).toBe('a2');
    expect(r.tasks[0].titleRanges).toEqual([[0, 7]]);
  });

  it('consulta vacía no devuelve nada', () => {
    expect(searchAll('   ', data)).toEqual({ projects: [], tasks: [], total: 0 });
  });

  it('agrupa por proyecto', () => {
    const groups = groupByProject(searchAll('#ui', data).tasks);
    expect(groups.map((g) => g.project.id)).toEqual(['web']);
    expect(groups[0].hits).toHaveLength(2);
  });
});

describe('noteSnippet', () => {
  it('recorta líneas largas con puntos suspensivos', () => {
    const long = `${'x'.repeat(60)} clave ${'y'.repeat(200)}`;
    const s = noteSnippet(long, ['clave'])!;
    expect(s.text.startsWith('…')).toBe(true);
    expect(s.text.endsWith('…')).toBe(true);
    const [a, b] = s.ranges[0];
    expect(s.text.slice(a, b)).toBe('clave');
  });
});
