import type { Project, Status, Task } from '../types';
import type { DeviceSnapshot, InboxNote, OutgoingNote } from './types';

export const NOTE_LABEL = 'tasky';
const META_RE = /<!--\s*tasky\s+(\{[\s\S]*?\})\s*-->/;

export function deviceLabel(deviceId: string): string {
  return `para:${deviceId}`;
}

/** Cuerpo del issue: metadatos legibles por Tasky + una línea para humanos. */
export function encodeNoteBody(note: OutgoingNote): string {
  const meta = {
    v: 1,
    device: note.deviceId,
    deviceName: note.deviceName,
    project: note.projectId,
    projectName: note.projectName,
    created: note.createdAt,
  };
  const where = note.projectName ? ` · proyecto **${note.projectName}**` : '';
  return `<!-- tasky ${JSON.stringify(meta)} -->\nEnviada desde el celular a **${note.deviceName}**${where}.`;
}

export function decodeNote(issue: { number: number; title: string; body?: string | null; created_at?: string }): InboxNote | null {
  const m = (issue.body ?? '').match(META_RE);
  if (!m) return null;
  try {
    const meta = JSON.parse(m[1]);
    if (typeof meta.device !== 'string' || !meta.device) return null;
    return {
      number: issue.number,
      text: issue.title,
      deviceId: meta.device,
      deviceName: typeof meta.deviceName === 'string' ? meta.deviceName : meta.device,
      projectId: typeof meta.project === 'string' ? meta.project : null,
      projectName: typeof meta.projectName === 'string' ? meta.projectName : null,
      createdAt: typeof meta.created === 'string' ? meta.created : (issue.created_at ?? ''),
    };
  } catch {
    return null;
  }
}

/** Lista que publica un equipo: proyectos activos y tareas sin terminar. */
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
      .filter((t) => live.has(t.project_id) && !done.has(t.status_id))
      .sort((a, b) => a.sort_order - b.sort_order)
      .map(({ id, project_id, title, status_id, priority, due_date, tags, sort_order }) => ({
        id,
        project_id,
        title,
        status_id,
        priority,
        due_date,
        tags: [...tags],
        sort_order,
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
