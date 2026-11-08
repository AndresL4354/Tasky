import { DEFAULT_STATUSES } from '../defaults';
import type { Project, Snapshot, Status, Task } from '../types';
import type { DataAdapter } from './adapter';

const STORAGE_KEY = 'tasky-dev-db';
const LOCAL_PREFIX = 'tasky-dev-local:';

function emptySnapshot(): Snapshot {
  return { version: 1, statuses: DEFAULT_STATUSES.map((s) => ({ ...s })), projects: [], tasks: [], settings: {} };
}

/** Valida lo mínimo de un respaldo antes de aceptarlo. */
export function validateSnapshot(data: unknown): Snapshot {
  const s = data as Snapshot;
  if (!s || typeof s !== 'object' || !Array.isArray(s.statuses) || !Array.isArray(s.projects) || !Array.isArray(s.tasks)) {
    throw new Error('El archivo no es un respaldo válido de Tasky.');
  }
  if (s.statuses.length === 0) throw new Error('El respaldo no tiene estados.');
  const statusIds = new Set(s.statuses.map((x) => x.id));
  const projectIds = new Set(s.projects.map((x) => x.id));
  for (const t of s.tasks) {
    if (!projectIds.has(t.project_id) || !statusIds.has(t.status_id)) {
      throw new Error(`La tarea "${t.title}" apunta a un proyecto o estado que no existe.`);
    }
  }
  return { version: 1, statuses: s.statuses, projects: s.projects, tasks: s.tasks, settings: s.settings ?? {} };
}

/**
 * Persistencia para correr la interfaz en un navegador (desarrollo y pruebas).
 * Guarda en localStorage cuando está disponible.
 */
export class MemoryAdapter implements DataAdapter {
  readonly kind = 'memory' as const;
  private data: Snapshot;

  constructor(private persist = true, initial?: Snapshot) {
    this.data = initial ?? this.read() ?? emptySnapshot();
  }

  private read(): Snapshot | null {
    if (!this.persist) return null;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? validateSnapshot(JSON.parse(raw)) : null;
    } catch {
      return null;
    }
  }

  private write() {
    if (!this.persist) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.data));
    } catch {
      /* sin almacenamiento: solo memoria */
    }
  }

  private clone<T>(v: T): T {
    return JSON.parse(JSON.stringify(v));
  }

  private upsert<T extends { id: string }>(list: T[], items: T[]) {
    for (const item of items) {
      const i = list.findIndex((x) => x.id === item.id);
      if (i >= 0) list[i] = this.clone(item);
      else list.push(this.clone(item));
    }
  }

  async loadAll() {
    return this.clone(this.data);
  }
  async saveProjects(projects: Project[]) {
    this.upsert(this.data.projects, projects);
    this.write();
  }
  async deleteProject(id: string) {
    this.data.projects = this.data.projects.filter((p) => p.id !== id);
    this.data.tasks = this.data.tasks.filter((t) => t.project_id !== id);
    this.write();
  }
  async saveTasks(tasks: Task[]) {
    this.upsert(this.data.tasks, tasks);
    this.write();
  }
  async deleteTasks(ids: string[]) {
    const set = new Set(ids);
    this.data.tasks = this.data.tasks.filter((t) => !set.has(t.id));
    this.write();
  }
  async saveStatuses(statuses: Status[]) {
    this.upsert(this.data.statuses, statuses);
    this.write();
  }
  async deleteStatus(id: string, replacement: string, now: string) {
    for (const t of this.data.tasks) {
      if (t.status_id === id) {
        t.status_id = replacement;
        t.updated_at = now;
      }
    }
    this.data.statuses = this.data.statuses.filter((s) => s.id !== id);
    this.write();
  }
  async setSetting(key: string, value: string) {
    this.data.settings[key] = value;
    this.write();
  }

  private local = new Map<string, string>();

  async getLocal(key: string) {
    if (this.persist) {
      try {
        return localStorage.getItem(`${LOCAL_PREFIX}${key}`);
      } catch {
        /* sin almacenamiento */
      }
    }
    return this.local.get(key) ?? null;
  }
  async setLocal(key: string, value: string | null) {
    if (value === null) this.local.delete(key);
    else this.local.set(key, value);
    if (!this.persist) return;
    try {
      if (value === null) localStorage.removeItem(`${LOCAL_PREFIX}${key}`);
      else localStorage.setItem(`${LOCAL_PREFIX}${key}`, value);
    } catch {
      /* sin almacenamiento */
    }
  }

  async exportBackup(fileName: string, exportedAt: string) {
    const json = JSON.stringify({ ...this.data, exported_at: exportedAt }, null, 2);
    const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return fileName;
  }

  importBackup() {
    return new Promise<Snapshot | null>((resolve, reject) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'application/json,.json';
      input.onchange = async () => {
        const file = input.files?.[0];
        if (!file) return resolve(null);
        try {
          this.data = validateSnapshot(JSON.parse(await file.text()));
          this.write();
          resolve(this.clone(this.data));
        } catch (e) {
          reject(e);
        }
      };
      input.oncancel = () => resolve(null);
      input.click();
    });
  }
}
