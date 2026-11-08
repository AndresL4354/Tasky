import { describe, expect, it } from 'vitest';
import { DEFAULT_STATUSES } from '../defaults';
import { normalizeEntry } from '../parse';
import type { Project, Task } from '../types';
import { parseRepo } from './config';
import { GitHubRelay, toBase64 } from './github';
import { buildSnapshot, decodeNote, encodeNoteBody, snapshotSignature, timeAgo } from './notes';
import type { OutgoingNote } from './types';

const note: OutgoingNote = {
  text: 'Comprar cables #oficina !alta @2026-11-13',
  deviceId: 'abc123',
  deviceName: 'pc del trabajo',
  projectId: 'p1',
  projectName: 'api-backend',
  createdAt: '2026-11-08T10:00:00.000Z',
};

describe('notas', () => {
  it('codifica y decodifica los metadatos en el cuerpo del issue', () => {
    const body = encodeNoteBody(note);
    expect(body).toContain('pc del trabajo');
    expect(decodeNote({ number: 7, title: note.text, body })).toEqual({ ...note, number: 7 });
  });

  it('ignora issues que no son de Tasky', () => {
    expect(decodeNote({ number: 1, title: 'x', body: 'hola' })).toBeNull();
    expect(decodeNote({ number: 1, title: 'x', body: '<!-- tasky {roto -->' })).toBeNull();
  });

  it('normaliza fechas relativas antes de enviar', () => {
    expect(normalizeEntry('Comprar cables @viernes #oficina', '2026-11-08')).toBe('Comprar cables @2026-11-13 #oficina');
    expect(normalizeEntry('Escribir a @juan', '2026-11-08')).toBe('Escribir a @juan');
  });

  it('timeAgo', () => {
    const now = Date.parse('2026-11-08T12:00:00Z');
    expect(timeAgo('2026-11-08T11:59:30Z', now)).toBe('hace un momento');
    expect(timeAgo('2026-11-08T11:45:00Z', now)).toBe('hace 15 min');
    expect(timeAgo('2026-11-08T09:00:00Z', now)).toBe('hace 3 h');
    expect(timeAgo('2026-11-01T12:00:00Z', now)).toBe('hace 7 d');
  });

  it('parseRepo acepta URL y nombre corto', () => {
    expect(parseRepo('https://github.com/AndresL4354/tasky-bandeja.git')).toEqual({ owner: 'AndresL4354', repo: 'tasky-bandeja' });
    expect(parseRepo('AndresL4354/tasky-bandeja')).toEqual({ owner: 'AndresL4354', repo: 'tasky-bandeja' });
    expect(parseRepo('tasky-bandeja')).toBeNull();
  });

  it('toBase64 maneja acentos', () => {
    expect(atob(toBase64('ñ'))).toBe('Ã±');
  });
});

describe('buildSnapshot', () => {
  const projects: Project[] = [
    { id: 'p1', name: 'api', sort_order: 1, archived: false, created_at: '', updated_at: '' },
    { id: 'p2', name: 'viejo', sort_order: 2, archived: true, created_at: '', updated_at: '' },
  ];
  const base = { priority: 1 as const, due_date: null, notes: 'secreto', tags: [], created_at: '', updated_at: '', completed_at: null };
  const tasks: Task[] = [
    { ...base, id: 'a', project_id: 'p1', title: 'pendiente', status_id: 'pendiente', sort_order: 2 },
    { ...base, id: 'b', project_id: 'p1', title: 'hecha', status_id: 'lista', sort_order: 1 },
    { ...base, id: 'c', project_id: 'p2', title: 'archivada', status_id: 'pendiente', sort_order: 1 },
  ];

  it('incluye solo proyectos activos y tareas sin terminar, sin notas', () => {
    const s = buildSnapshot({ id: 'd', name: 'mac' }, { statuses: DEFAULT_STATUSES, projects, tasks }, 'now');
    expect(s.projects.map((p) => p.id)).toEqual(['p1']);
    expect(s.tasks.map((t) => t.id)).toEqual(['a']);
    expect(JSON.stringify(s)).not.toContain('secreto');
  });

  it('la firma no depende de la fecha', () => {
    const a = buildSnapshot({ id: 'd', name: 'mac' }, { statuses: DEFAULT_STATUSES, projects, tasks }, 'uno');
    const b = buildSnapshot({ id: 'd', name: 'mac' }, { statuses: DEFAULT_STATUSES, projects, tasks }, 'dos');
    expect(snapshotSignature(a)).toBe(snapshotSignature(b));
  });
});

describe('GitHubRelay', () => {
  function fakeFetch(responses: Record<string, { status?: number; body?: unknown; text?: string }>) {
    const calls: { url: string; method: string; body?: string; accept?: string }[] = [];
    const impl = (async (url: string, init: RequestInit = {}) => {
      const method = init.method ?? 'GET';
      const headers = init.headers as Record<string, string>;
      calls.push({ url, method, body: init.body as string | undefined, accept: headers.Accept });
      const key = `${method} ${url.replace('https://api.github.com', '')}`;
      const r = responses[key] ?? { status: 404, body: { message: 'Not Found' } };
      const status = r.status ?? 200;
      return new Response(r.text ?? JSON.stringify(r.body ?? {}), { status });
    }) as unknown as typeof fetch;
    return { impl, calls };
  }

  it('envía una nota como issue etiquetado para el equipo', async () => {
    const { impl, calls } = fakeFetch({ 'POST /repos/o/r/issues': { status: 201, body: { number: 42 } } });
    const relay = new GitHubRelay('o/r', 'tok', impl);
    expect(await relay.sendNote(note)).toBe(42);
    const sent = JSON.parse(calls[0].body!);
    expect(sent.labels).toEqual(['tasky', 'para:abc123']);
    expect(sent.title).toBe(note.text);
  });

  it('lista notas pendientes de un equipo', async () => {
    const issue = { number: 3, title: note.text, body: encodeNoteBody(note), created_at: note.createdAt };
    const { impl, calls } = fakeFetch({
      'GET /repos/o/r/issues?state=open&per_page=100&sort=created&direction=asc&labels=para%3Aabc123': { body: [issue] },
    });
    const notes = await new GitHubRelay('o/r', 'tok', impl).listNotes('abc123');
    expect(notes.map((n) => n.number)).toEqual([3]);
    expect(calls[0].url).toContain('labels=para%3Aabc123');
  });

  it('sin carpeta devices devuelve lista vacía', async () => {
    const { impl } = fakeFetch({});
    expect(await new GitHubRelay('o/r', 'tok', impl).listDevices()).toEqual([]);
  });

  it('publica creando el archivo y luego lo actualiza con su sha', async () => {
    const { impl, calls } = fakeFetch({
      'PUT /repos/o/r/contents/devices/d.json': { status: 201, body: { content: { sha: 'sha1' } } },
    });
    const relay = new GitHubRelay('o/r', 'tok', impl);
    const snap = buildSnapshot({ id: 'd', name: 'mac' }, { statuses: DEFAULT_STATUSES, projects: [], tasks: [] }, 'now');
    await relay.publishDevice(snap);
    await relay.publishDevice(snap);
    const puts = calls.filter((c) => c.method === 'PUT').map((c) => JSON.parse(c.body!));
    expect(puts[0].sha).toBeUndefined();
    expect(puts[1].sha).toBe('sha1');
  });

  it('explica errores comunes en español', async () => {
    const { impl } = fakeFetch({ 'GET /repos/o/r': { status: 401, body: { message: 'Bad credentials' } } });
    await expect(new GitHubRelay('o/r', 'tok', impl).checkAccess()).rejects.toThrow(/token no es válido/);
  });
});
