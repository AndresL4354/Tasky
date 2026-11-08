import type { Project, Snapshot, Status, Task } from '../types';

/** Capa de persistencia. La app trabaja en memoria y guarda cada cambio a través de esto. */
export interface DataAdapter {
  readonly kind: 'sqlite' | 'memory';
  loadAll(): Promise<Snapshot>;
  saveProjects(projects: Project[]): Promise<void>;
  deleteProject(id: string): Promise<void>;
  saveTasks(tasks: Task[]): Promise<void>;
  deleteTasks(ids: string[]): Promise<void>;
  saveStatuses(statuses: Status[]): Promise<void>;
  deleteStatus(id: string, replacement: string, now: string): Promise<void>;
  setSetting(key: string, value: string): Promise<void>;
  /** Devuelve la ruta/nombre del archivo guardado o null si se canceló. */
  exportBackup(fileName: string, exportedAt: string): Promise<string | null>;
  /** Reemplaza todo con un respaldo elegido por el usuario. null si se canceló. */
  importBackup(): Promise<Snapshot | null>;
}
