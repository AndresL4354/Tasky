export type Id = string;

/** Nombre de un color del tema (se traduce a `var(--c-<nombre>)`). */
export type ColorToken = 'muted' | 'blue' | 'cyan' | 'green' | 'yellow' | 'orange' | 'red' | 'purple';

export interface Status {
  id: Id;
  name: string;
  symbol: string;
  color: ColorToken | string;
  sort_order: number;
  is_done: boolean;
}

export interface Project {
  id: Id;
  name: string;
  sort_order: number;
  archived: boolean;
  created_at: string;
  updated_at: string;
}

/** 1 = baja, 2 = media, 3 = alta. */
export type Priority = 1 | 2 | 3;

export interface Task {
  id: Id;
  project_id: Id;
  title: string;
  status_id: Id;
  priority: Priority;
  /** Fecha `YYYY-MM-DD` o null. */
  due_date: string | null;
  notes: string;
  /** Etiquetas con `#`, en minúsculas. */
  tags: string[];
  sort_order: number;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

export interface Snapshot {
  version: number;
  exported_at?: string | null;
  statuses: Status[];
  projects: Project[];
  tasks: Task[];
  settings: Record<string, string>;
}

export type SortMode = 'manual' | 'estado' | 'prioridad' | 'fecha';
export type ThemePref = 'system' | 'dark' | 'light';
