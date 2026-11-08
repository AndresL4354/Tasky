import { isValidISODate } from '../dates';
import { normalizeTag } from '../parse';
import type { Project, Status, Task } from '../types';
import type { DeviceSnapshot, InboxNote, NoteKind, OutgoingNote, TaskPatch } from './types';

export const NOTE_LABEL = 'tasky';
const META_RE = /<!--\s*tasky\s+(\{[\s\S]*?\})\s*-->/;
/** Las terminadas en estos últimos días también se publican, para poder reabrirlas desde el celular. */
export const RECENT_DONE_DAYS = 3;
const MAX_NOTES = 20_000;

/** Etiqueta de las tareas nuevas para un equipo. */
export function deviceLabel(deviceId: string): string {
  return `para:${deviceId}`;
}

/**
 * Etiqueta de cambios y eliminaciones. Es distinta de `para:` a propósito: las versiones de
 * escritorio que no saben editar solo miran `para:` y así no confunden un cambio con una tarea nueva.
 */
export function changeLabel(deviceId: string): string {
  return `cambio:${deviceId}`;
}

export function labelsFor(note: OutgoingNote): string[] {
  const kind = note.kind ?? 'create';
  return [NOTE_LABEL, kind === 'create' ? deviceLabel(note.deviceId) : changeLabel(note.deviceId)];
}

/** Cuerpo del issue: metadatos legibles por Tasky + una línea para humanos. */
export function encodeNoteBody(note: OutgoingNote): string {
  const kind = note.kind ?? 'create';
  const meta: Record<string, unknown> = {
    v: 1,
    kind,
    device: note.deviceId,
    deviceName: note.deviceName,
    project: note.projectId,
    projectName: note.projectName,
    created: note.createdAt,
  };
  if (note.taskId) meta.task = note.taskId;
  if (note.patch) meta.patch = note.patch;
  const where = note.projectName ? ` · proyecto **${note.projectName}**` : '';
  const human =
    kind === 'create'
      ? `Enviada desde el celular a **${note.deviceName}**${where}.`
      : kind === 'update'
        ? `Cambio desde el celular para **${note.deviceName}**${where}.`
        : `Eliminar desde el celular en **${note.deviceName}**${where}.`;
  // `-->` dentro del JSON cortaría el comentario: se escapa.
  return `<!-- tasky ${JSON.stringify(meta).replace(/-->/g, '--\\u003e')} -->\n${human}`;
}

/** Deja solo campos válidos de un cambio que llegó desde afuera. */
export function sanitizePatch(raw: unknown, statusIds?: Set<string>): TaskPatch {
  const p = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const out: TaskPatch = {};
  if (typeof p.title === 'string' && p.title.trim()) out.title = p.title.trim().slice(0, 500);
  if (typeof p.status_id === 'string' && (!statusIds || statusIds.has(p.status_id))) out.status_id = p.status_id;
  if (p.priority === 1 || p.priority === 2 || p.priority === 3) out.priority = p.priority;
  if (p.due_date === null) out.due_date = null;
  else if (typeof p.due_date === 'string' && isValidISODate(p.due_date)) out.due_date = p.due_date;
  if (Array.isArray(p.tags)) {
    const tags = p.tags.map((t) => (typeof t === 'string' ? normalizeTag(t) : null)).filter((t): t is string => !!t);
    out.tags = [...new Set(tags)].slice(0, 30);
  }
  if (typeof p.notes === 'string') out.notes = p.notes.slice(0, MAX_NOTES);
  return out;
}

export function decodeNote(issue: { number: number; title: string; body?: string | null; created_at?: string }): InboxNote | null {
  const m = (issue.body ?? '').match(META_RE);
  if (!m) return null;
  try {
    const meta = JSON.parse(m[1]);
    if (typeof meta.device !== 'string' || !meta.device) return null;
    const kind: NoteKind = meta.kind === 'update' || meta.kind === 'delete' ? meta.kind : 'create';
    if (kind !== 'create' && (typeof meta.task !== 'string' || !meta.task)) return null;
    const note: InboxNote = {
      kind,
      number: issue.number,
      text: issue.title,
      deviceId: meta.device,
      deviceName: typeof meta.deviceName === 'string' ? meta.deviceName : meta.device,
      projectId: typeof meta.project === 'string' ? meta.project : null,
      projectName: typeof meta.projectName === 'string' ? meta.projectName : null,
      createdAt: typeof meta.created === 'string' ? meta.created : (issue.created_at ?? ''),
    };
    if (kind !== 'create') note.taskId = meta.task;
    if (kind === 'update') note.patch = sanitizePatch(meta.patch);
    return note;
  } catch {
    return null;
  }
}

/** Lista que publica un equipo: proyectos activos, tareas sin terminar y las terminadas hace poco. */
export function buildSnapshot(
  device: { id: string; name: string },
  data: { statuses: Status[]; projects: Project[]; tasks: Task[] },
  now: string,
): DeviceSnapshot {
  const done = new Set(data.statuses.filter((s) => s.is_done).map((s) => s.id));
  const projects = data.projects
    .filter((p) => !p.archived)
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((p) => ({ id: p.id, name: p.name, sort_order: p.sort_order }));
  const live = new Set(projects.map((p) => p.id));
  const nowMs = Date.parse(now);
  const cutoff = (Number.isNaN(nowMs) ? Date.now() : nowMs) - RECENT_DONE_DAYS * 86_400_000;
  const recentlyDone = (t: Task) => {
    const at = Date.parse(t.completed_at ?? t.updated_at);
    return !Number.isNaN(at) && at >= cutoff;
  };
  return {
    v: 1,
    id: device.id,
    name: device.name,
    updated_at: now,
    statuses: [...data.statuses]
      .sort((a, b) => a.sort_order - b.sort_order)
      .map(({ id, name, symbol, color, sort_order, is_done }) => ({ id, name, symbol, color, sort_order, is_done })),
    projects,
    tasks: data.tasks
      .filter((t) => live.has(t.project_id) && (!done.has(t.status_id) || recentlyDone(t)))
      .sort((a, b) => a.sort_order - b.sort_order)
      .map(({ id, project_id, title, status_id, priority, due_date, tags, sort_order, notes, completed_at }) => ({
        id,
        project_id,
        title,
        status_id,
        priority,
        due_date,
        tags: [...tags],
        sort_order,
        notes,
        completed_at,
      })),
  };
}

/** Firma del contenido (sin la fecha) para publicar solo si algo cambió. */
export function snapshotSignature(s: DeviceSnapshot): string {
  return JSON.stringify({ ...s, updated_at: '' });
}

/** "hace 3 min", "hace 2 h", "hace 4 d". */
export function timeAgo(iso: string, now: number = Date.now()): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return 'sin datos';
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 60) return 'hace un momento';
  const m = Math.round(s / 60);
  if (m < 60) return `hace ${m} min`;
  const h = Math.round(m / 60);
  if (h < 48) return `hace ${h} h`;
  return `hace ${Math.round(h / 24)} d`;
}
