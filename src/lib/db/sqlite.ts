import { invoke } from '@tauri-apps/api/core';
import type { Project, Snapshot, Status, Task } from '../types';
import type { DataAdapter } from './adapter';

/** Persistencia real: comandos Rust sobre SQLite (src-tauri/src/lib.rs). */
export class SqliteAdapter implements DataAdapter {
  readonly kind = 'sqlite' as const;

  loadAll() {
    return invoke<Snapshot>('load_all');
  }
  saveProjects(projects: Project[]) {
    return invoke<void>('save_projects', { projects });
  }
  deleteProject(id: string) {
    return invoke<void>('delete_project', { id });
  }
  saveTasks(tasks: Task[]) {
    return invoke<void>('save_tasks', { tasks });
  }
  deleteTasks(ids: string[]) {
    return invoke<void>('delete_tasks', { ids });
  }
  saveStatuses(statuses: Status[]) {
    return invoke<void>('save_statuses', { statuses });
  }
  deleteStatus(id: string, replacement: string, now: string) {
    return invoke<void>('delete_status', { id, replacement, now });
  }
  setSetting(key: string, value: string) {
    return invoke<void>('set_setting', { key, value });
  }
  getLocal(key: string) {
    return invoke<string | null>('get_local', { key });
  }
  setLocal(key: string, value: string | null) {
    return invoke<void>('set_local', { key, value });
  }
  exportBackup(fileName: string, exportedAt: string) {
    return invoke<string | null>('export_backup', { fileName, exportedAt });
  }
  importBackup() {
    return invoke<Snapshot | null>('import_backup');
  }
}
