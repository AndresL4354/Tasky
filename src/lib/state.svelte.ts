import { createAdapter, type DataAdapter } from './db';
import { DEFAULT_STATUSES, PRIORITY_LABEL } from './defaults';
import { nowStamp, todayISO } from './dates';
import { uid } from './ids';
import { nextSortOrder, visibleTasks } from './order';
import { normalizeTag, parseEntry } from './parse';
import { keys } from './platform';
import type { Priority, Project, Snapshot, SortMode, Status, Task, ThemePref } from './types';

interface UiSettings {
  openTabs: string[];
  activeId: string | null;
  selected: Record<string, string | null>;
  showSidebar: boolean;
  showDetail: boolean;
  hideDone: boolean;
  sort: SortMode;
  theme: ThemePref;
  fontSize: number;
}

interface UndoEntry {
  label: string;
  tasks: { id: string; before: Task | null }[];
  projectId: string | null;
  selectedId: string | null;
}

export interface ConfirmRequest {
  title: string;
  message: string;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => void | Promise<void>;
}

export type FocusTarget = 'list' | 'new' | 'filter' | 'detail-title';
export const SORT_MODES: SortMode[] = ['manual', 'estado', 'prioridad', 'fecha'];
const UI_KEY = 'ui';

function plain<T>(value: T): T {
  return $state.snapshot(value) as T;
}

export class AppState {
  readonly db: DataAdapter;

  ready = $state(false);
  loadError = $state<string | null>(null);

  // Datos
  statuses = $state<Status[]>([]);
  projects = $state<Project[]>([]);
  tasks = $state<Task[]>([]);

  // Preferencias de interfaz (se guardan)
  openTabs = $state<string[]>([]);
  activeId = $state<string | null>(null);
  selected = $state<Record<string, string | null>>({});
  showSidebar = $state(true);
  showDetail = $state(true);
  hideDone = $state(false);
  sort = $state<SortMode>('manual');
  theme = $state<ThemePref>('system');
  fontSize = $state(13);

  // Estado transitorio
  filter = $state('');
  palette = $state<null | 'commands' | 'projects'>(null);
  pickerFor = $state<string | null>(null);
  editingTaskId = $state<string | null>(null);
  renamingProjectId = $state<string | null>(null);
  settingsOpen = $state(false);
  searchOpen = $state(false);
  searchQuery = $state('');
  confirmRequest = $state<ConfirmRequest | null>(null);
  toast = $state<{ id: number; text: string; tone: 'info' | 'error' } | null>(null);
  focusSignal = $state<{ target: FocusTarget; n: number }>({ target: 'list', n: 0 });

  // Derivados
  sortedStatuses = $derived([...this.statuses].sort((a, b) => a.sort_order - b.sort_order));
  statusById = $derived(new Map(this.statuses.map((s) => [s.id, s])));
  sortedProjects = $derived([...this.projects].sort((a, b) => a.sort_order - b.sort_order));
  liveProjects = $derived(this.sortedProjects.filter((p) => !p.archived));
  archivedProjects = $derived(this.sortedProjects.filter((p) => p.archived));
  activeProject = $derived(
    this.activeId && this.openTabs.includes(this.activeId)
      ? (this.projects.find((p) => p.id === this.activeId) ?? null)
      : null,
  );
  projectTasks = $derived(this.activeProject ? this.tasks.filter((t) => t.project_id === this.activeProject!.id) : []);
  rows = $derived(
    visibleTasks(this.projectTasks, {
      sort: this.sort,
      filter: this.filter,
      hideDone: this.hideDone,
      statuses: this.statuses,
    }),
  );
  selectedId = $derived(this.activeProject ? (this.selected[this.activeProject.id] ?? null) : null);
  selectedTask = $derived(this.selectedId ? (this.tasks.find((t) => t.id === this.selectedId) ?? null) : null);
  selectedIndex = $derived(this.selectedId ? this.rows.findIndex((t) => t.id === this.selectedId) : -1);
  modalOpen = $derived(
    this.palette !== null || this.settingsOpen || this.searchOpen || this.confirmRequest !== null,
  );

  private undoStack: UndoEntry[] = [];
  private pendingSaves = new Map<string, ReturnType<typeof setTimeout>>();
  private uiTimer: ReturnType<typeof setTimeout> | null = null;
  private lastUi = '';
  private toastTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(db: DataAdapter = createAdapter()) {
    this.db = db;
  }

  // ───────────────────────── carga y preferencias

  async init() {
    try {
      const snap = await this.db.loadAll();
      this.applySnapshot(snap);
      if (this.projects.length === 0) await this.seedWelcome();
      this.ready = true;
    } catch (e) {
      this.loadError = e instanceof Error ? e.message : String(e);
    }
  }

  private applySnapshot(snap: Snapshot) {
    this.statuses = snap.statuses.length ? snap.statuses : DEFAULT_STATUSES.map((s) => ({ ...s }));
    this.projects = snap.projects;
    this.tasks = snap.tasks.map((t) => ({
      ...t,
      priority: ([1, 2, 3].includes(t.priority) ? t.priority : 1) as Priority,
      tags: Array.isArray(t.tags) ? t.tags : [],
    }));

    let ui: Partial<UiSettings> = {};
    try {
      ui = snap.settings[UI_KEY] ? JSON.parse(snap.settings[UI_KEY]) : {};
    } catch {
      ui = {};
    }
    const exists = new Set(this.projects.map((p) => p.id));
    this.openTabs = (ui.openTabs ?? []).filter((id) => exists.has(id));
    this.activeId = ui.activeId && this.openTabs.includes(ui.activeId) ? ui.activeId : (this.openTabs[0] ?? null);
    this.selected = ui.selected ?? {};
    this.showSidebar = ui.showSidebar ?? true;
    this.showDetail = ui.showDetail ?? true;
    this.hideDone = ui.hideDone ?? false;
    this.sort = SORT_MODES.includes(ui.sort as SortMode) ? (ui.sort as SortMode) : 'manual';
    this.theme = ui.theme === 'dark' || ui.theme === 'light' ? ui.theme : 'system';
    this.fontSize = Math.min(18, Math.max(11, Number(ui.fontSize) || 13));
    this.filter = '';

    if (this.openTabs.length === 0 && this.liveProjects.length > 0) {
      this.openTabs = [this.liveProjects[0].id];
      this.activeId = this.liveProjects[0].id;
    }
    this.ensureSelection();
  }

  /** Serializa lo que hay que recordar entre sesiones (lo lee un $effect). */
  uiSnapshot(): string {
    const ui: UiSettings = {
      openTabs: this.openTabs,
      activeId: this.activeId,
      selected: this.selected,
      showSidebar: this.showSidebar,
      showDetail: this.showDetail,
      hideDone: this.hideDone,
      sort: this.sort,
      theme: this.theme,
      fontSize: this.fontSize,
    };
    return JSON.stringify(ui);
  }

  saveUi(json: string) {
    if (!this.ready || json === this.lastUi) return;
    if (this.uiTimer) clearTimeout(this.uiTimer);
    this.uiTimer = setTimeout(() => {
      this.lastUi = json;
      this.persist(this.db.setSetting(UI_KEY, json));
    }, 400);
  }

  private async seedWelcome() {
    const now = nowStamp();
    const project: Project = { id: uid(), name: 'bienvenida', sort_order: 1, archived: false, created_at: now, updated_at: now };
    const has = (id: string) => this.statuses.some((s) => s.id === id);
    const st = (id: string) => (has(id) ? id : this.defaultStatus().id);
    const lines: [string, string, Priority, string[], string?][] = [
      [`Escribe en la última línea y presiona ${keys('Enter')} para crear una tarea`, 'proceso', 3, ['#tip'],
        '## entrada rápida\n- `#etiqueta` agrega etiquetas\n- `!alta` / `!media` / `!baja` define prioridad\n- `@hoy`, `@mañana`, `@viernes` o `@15/11` pone fecha límite'],
      ['Al escribir usa #etiquetas, !alta o !media y @mañana o @15/11', 'pendiente', 2, ['#tip']],
      [`${keys('Space')} avanza el estado, S abre el selector y 1–5 lo elige directo`, 'pendiente', 1, ['#tip']],
      [`${keys('Alt+Up')} / ${keys('Alt+Down')} mueve la tarea, ${keys('Mod+Backspace')} la elimina y ${keys('Mod+Z')} deshace`, 'bloqueada', 1, ['#tip']],
      [`${keys('Mod+K')} abre la paleta de comandos y ${keys('Mod+P')} salta entre proyectos`, 'deploy', 1, ['#tip']],
      [`${keys('Mod+I')} muestra el detalle con notas, fecha y etiquetas`, 'pendiente', 1, []],
      [`Crea tu primer proyecto con ${keys('Mod+Shift+N')}`, 'lista', 1, []],
    ];
    const tasks: Task[] = lines.map(([title, status, priority, tags, notes], i) => ({
      id: uid(),
      project_id: project.id,
      title,
      status_id: st(status),
      priority,
      due_date: null,
      notes: notes ?? '',
      tags,
      sort_order: i + 1,
      created_at: now,
      updated_at: now,
      completed_at: this.statusById.get(st(status))?.is_done ? now : null,
    }));
    this.projects.push(project);
    this.tasks.push(...tasks);
    this.openTabs = [project.id];
    this.activeId = project.id;
    this.selected = { [project.id]: tasks[0].id };
    await this.db.saveProjects([project]);
    await this.db.saveTasks(tasks);
  }

  // ───────────────────────── utilidades

  notify(text: string, tone: 'info' | 'error' = 'info') {
    const id = (this.toast?.id ?? 0) + 1;
    this.toast = { id, text, tone };
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => {
      if (this.toast?.id === id) this.toast = null;
    }, tone === 'error' ? 7000 : 3500);
  }

  private persist(p: Promise<unknown>) {
    p.catch((e) => this.notify(`No se pudo guardar: ${e instanceof Error ? e.message : e}`, 'error'));
  }

  private saveTask(task: Task, debounce = false) {
    const id = task.id;
    const pending = this.pendingSaves.get(id);
    if (pending) clearTimeout(pending);
    if (!debounce) {
      this.pendingSaves.delete(id);
      this.persist(this.db.saveTasks([plain(task)]));
      return;
    }
    this.pendingSaves.set(
      id,
      setTimeout(() => {
        this.pendingSaves.delete(id);
        const t = this.tasks.find((x) => x.id === id);
        if (t) this.persist(this.db.saveTasks([plain(t)]));
      }, 350),
    );
  }

  /** Guarda de inmediato lo que esté pendiente (antes de cerrar o exportar). */
  flushPending() {
    const ids = [...this.pendingSaves.keys()];
    for (const id of ids) clearTimeout(this.pendingSaves.get(id));
    this.pendingSaves.clear();
    const tasks = this.tasks.filter((t) => ids.includes(t.id)).map((t) => plain(t));
    if (tasks.length) this.persist(this.db.saveTasks(tasks));
  }

  requestFocus(target: FocusTarget) {
    this.focusSignal = { target, n: this.focusSignal.n + 1 };
  }

  ask(req: ConfirmRequest) {
    this.palette = null;
    this.pickerFor = null;
    this.confirmRequest = req;
  }

  defaultStatus(): Status {
    return this.sortedStatuses.find((s) => !s.is_done) ?? this.sortedStatuses[0];
  }

  isDone(task: Task): boolean {
    return this.statusById.get(task.status_id)?.is_done ?? false;
  }

  private ensureSelection() {
    const p = this.activeProject;
    if (!p) return;
    const cur = this.selected[p.id];
    if (cur && this.tasks.some((t) => t.id === cur && t.project_id === p.id)) return;
    this.selected[p.id] = this.rows[0]?.id ?? null;
  }

  // ───────────────────────── deshacer

  private remember(label: string, ids: string[]) {
    this.undoStack.push({
      label,
      tasks: ids.map((id) => {
        const t = this.tasks.find((x) => x.id === id);
        return { id, before: t ? plain(t) : null };
      }),
      projectId: this.activeProject?.id ?? null,
      selectedId: this.selectedId,
    });
    if (this.undoStack.length > 200) this.undoStack.shift();
  }

  undo() {
    const entry = this.undoStack.pop();
    if (!entry) {
      this.notify('Nada que deshacer');
      return;
    }
    const projectIds = new Set(this.projects.map((p) => p.id));
    const toSave: Task[] = [];
    const toDelete: string[] = [];
    for (const { id, before } of entry.tasks) {
      const i = this.tasks.findIndex((t) => t.id === id);
      if (before) {
        if (!projectIds.has(before.project_id)) continue;
        if (i >= 0) this.tasks[i] = before;
        else this.tasks.push(before);
        toSave.push(before);
      } else if (i >= 0) {
        this.tasks.splice(i, 1);
        toDelete.push(id);
      }
    }
    if (toSave.length) this.persist(this.db.saveTasks(toSave));
    if (toDelete.length) this.persist(this.db.deleteTasks(toDelete));
    if (entry.projectId && projectIds.has(entry.projectId)) {
      const restored = entry.tasks.find((x) => x.before)?.id ?? entry.selectedId;
      this.selected[entry.projectId] = restored ?? null;
      if (this.openTabs.includes(entry.projectId)) this.activeId = entry.projectId;
    }
    this.ensureSelection();
    this.notify(`Deshecho: ${entry.label}`);
  }

  // ───────────────────────── búsqueda global

  openSearch(query?: string) {
    this.palette = null;
    this.pickerFor = null;
    this.editingTaskId = null;
    this.settingsOpen = false;
    if (query !== undefined) this.searchQuery = query;
    this.searchOpen = true;
  }

  closeSearch() {
    this.searchOpen = false;
    this.requestFocus('list');
  }

  /** Abre el proyecto de la tarea y la deja seleccionada y visible. */
  revealTask(id: string, opts: { showDetail?: boolean } = {}) {
    const task = this.tasks.find((t) => t.id === id);
    if (!task) return;
    this.openProject(task.project_id);
    this.filter = '';
    if (this.hideDone && this.isDone(task)) {
      this.hideDone = false;
      this.notify('Se muestran las tareas terminadas para ver el resultado');
    }
    this.selected[task.project_id] = task.id;
    if (opts.showDetail) this.showDetail = true;
    this.searchOpen = false;
    this.requestFocus('list');
  }

  // ───────────────────────── tareas

  select(id: string | null) {
    const p = this.activeProject;
    if (!p) return;
    this.selected[p.id] = id;
  }

  selectRelative(delta: number) {
    const rows = this.rows;
    if (rows.length === 0) return;
    const i = this.selectedIndex;
    const next = i < 0 ? (delta > 0 ? 0 : rows.length - 1) : Math.min(rows.length - 1, Math.max(0, i + delta));
    this.select(rows[next].id);
  }

  selectEdge(edge: 'first' | 'last') {
    const rows = this.rows;
    if (rows.length) this.select(edge === 'first' ? rows[0].id : rows[rows.length - 1].id);
  }

  createTaskFromEntry(text: string): boolean {
    const project = this.activeProject;
    if (!project) return false;
    const parsed = parseEntry(text);
    if (!parsed.title) return false;
    const now = nowStamp();
    const status = this.defaultStatus();
    const task: Task = {
      id: uid(),
      project_id: project.id,
      title: parsed.title,
      status_id: status.id,
      priority: parsed.priority ?? 1,
      due_date: parsed.due,
      notes: '',
      tags: parsed.tags,
      sort_order: nextSortOrder(this.projectTasks),
      created_at: now,
      updated_at: now,
      completed_at: status.is_done ? now : null,
    };
    this.remember('crear tarea', [task.id]);
    this.tasks.push(task);
    this.selected[project.id] = task.id;
    if (this.filter && !this.rows.some((t) => t.id === task.id)) this.filter = '';
    this.saveTask(task);
    return true;
  }

  updateTask(id: string, patch: Partial<Task>, opts: { undo?: string; debounce?: boolean } = {}) {
    const t = this.tasks.find((x) => x.id === id);
    if (!t) return;
    if (opts.undo) this.remember(opts.undo, [id]);
    Object.assign(t, patch, { updated_at: nowStamp() });
    if ('status_id' in patch) {
      t.completed_at = this.isDone(t) ? (t.completed_at ?? nowStamp()) : null;
    }
    this.saveTask(t, opts.debounce);
  }

  /** Copia de una tarea para registrar después una edición de texto larga como un solo paso. */
  snapshotTask(id: string): Task | null {
    const t = this.tasks.find((x) => x.id === id);
    return t ? plain(t) : null;
  }

  /** Registra en el historial una edición ya hecha, a partir de la copia previa. */
  recordEdit(label: string, before: Task) {
    const now = this.tasks.find((x) => x.id === before.id);
    if (!now || (now.title === before.title && now.notes === before.notes)) return;
    this.undoStack.push({ label, tasks: [{ id: before.id, before }], projectId: before.project_id, selectedId: before.id });
  }

  setStatus(id: string, statusId: string) {
    const t = this.tasks.find((x) => x.id === id);
    if (!t || t.status_id === statusId) return;
    this.updateTask(id, { status_id: statusId }, { undo: 'cambiar estado' });
  }

  setStatusByIndex(id: string, index: number) {
    const s = this.sortedStatuses[index];
    if (s) this.setStatus(id, s.id);
  }

  cycleStatus(id: string, dir: 1 | -1 = 1) {
    const t = this.tasks.find((x) => x.id === id);
    if (!t) return;
    const list = this.sortedStatuses;
    const i = list.findIndex((s) => s.id === t.status_id);
    const next = list[(i + dir + list.length) % list.length];
    this.setStatus(id, next.id);
  }

  setPriority(id: string, priority: Priority) {
    const t = this.tasks.find((x) => x.id === id);
    if (!t || t.priority === priority) return;
    this.updateTask(id, { priority }, { undo: 'cambiar prioridad' });
  }

  cyclePriority(id: string) {
    const t = this.tasks.find((x) => x.id === id);
    if (!t) return;
    this.setPriority(id, ((t.priority % 3) + 1) as Priority);
    this.notify(`Prioridad: ${PRIORITY_LABEL[t.priority]}`);
  }

  /** Confirma la edición en línea: acepta marcas `#tag !alta @fecha` además del título. */
  commitTitleEdit(id: string, text: string) {
    this.editingTaskId = null;
    const t = this.tasks.find((x) => x.id === id);
    if (!t) return;
    const parsed = parseEntry(text);
    if (!parsed.title) return;
    const patch: Partial<Task> = { title: parsed.title };
    if (parsed.tags.length) patch.tags = [...new Set([...t.tags, ...parsed.tags])];
    if (parsed.priority) patch.priority = parsed.priority;
    if (parsed.due) patch.due_date = parsed.due;
    const changed =
      patch.title !== t.title ||
      (patch.tags && patch.tags.length !== t.tags.length) ||
      (patch.priority && patch.priority !== t.priority) ||
      (patch.due_date && patch.due_date !== t.due_date);
    if (changed) this.updateTask(id, patch, { undo: 'editar tarea' });
  }

  addTag(id: string, raw: string): boolean {
    const tag = normalizeTag(raw);
    const t = this.tasks.find((x) => x.id === id);
    if (!tag || !t || t.tags.includes(tag)) return false;
    this.updateTask(id, { tags: [...t.tags, tag] }, { undo: 'agregar etiqueta' });
    return true;
  }

  removeTag(id: string, tag: string) {
    const t = this.tasks.find((x) => x.id === id);
    if (!t) return;
    this.updateTask(id, { tags: t.tags.filter((x) => x !== tag) }, { undo: 'quitar etiqueta' });
  }

  deleteTask(id: string) {
    const i = this.tasks.findIndex((t) => t.id === id);
    if (i < 0) return;
    const task = this.tasks[i];
    const rowIndex = this.rows.findIndex((t) => t.id === id);
    const neighbor = this.rows[rowIndex + 1] ?? this.rows[rowIndex - 1] ?? null;
    this.remember('eliminar tarea', [id]);
    const pending = this.pendingSaves.get(id);
    if (pending) clearTimeout(pending);
    this.pendingSaves.delete(id);
    this.tasks.splice(i, 1);
    if (this.selected[task.project_id] === id) this.selected[task.project_id] = neighbor?.id ?? null;
    if (this.pickerFor === id) this.pickerFor = null;
    if (this.editingTaskId === id) this.editingTaskId = null;
    this.persist(this.db.deleteTasks([id]));
    this.notify(`Tarea eliminada · ${keys('Mod+Z')} para deshacer`);
  }

  moveSelected(dir: -1 | 1) {
    if (this.sort !== 'manual') {
      this.notify('Cambia a orden manual para mover tareas');
      return;
    }
    const rows = this.rows;
    const i = this.selectedIndex;
    const j = i + dir;
    if (i < 0 || j < 0 || j >= rows.length) return;
    const a = rows[i];
    const b = rows[j];
    this.remember('mover tarea', [a.id, b.id]);
    let ao = b.sort_order;
    let bo = a.sort_order;
    if (ao === bo) {
      ao = dir < 0 ? bo - 0.5 : bo + 0.5;
    }
    a.sort_order = ao;
    b.sort_order = bo;
    const now = nowStamp();
    a.updated_at = now;
    b.updated_at = now;
    this.persist(this.db.saveTasks([plain(a), plain(b)]));
  }

  // ───────────────────────── proyectos

  private uniqueProjectName(base: string): string {
    const names = new Set(this.projects.map((p) => p.name));
    if (!names.has(base)) return base;
    let n = 2;
    while (names.has(`${base}-${n}`)) n++;
    return `${base}-${n}`;
  }

  createProject(name?: string) {
    const now = nowStamp();
    const project: Project = {
      id: uid(),
      name: this.uniqueProjectName(name?.trim() || 'nuevo-proyecto'),
      sort_order: this.projects.reduce((m, p) => Math.max(m, p.sort_order), 0) + 1,
      archived: false,
      created_at: now,
      updated_at: now,
    };
    this.projects.push(project);
    this.openTabs = [...this.openTabs, project.id];
    this.activeId = project.id;
    this.showSidebar = true;
    this.filter = '';
    this.renamingProjectId = project.id;
    this.persist(this.db.saveProjects([project]));
  }

  private saveProject(p: Project) {
    p.updated_at = nowStamp();
    this.persist(this.db.saveProjects([plain(p)]));
  }

  renameProject(id: string, name: string) {
    this.renamingProjectId = null;
    const p = this.projects.find((x) => x.id === id);
    const clean = name.trim();
    if (!p || !clean || clean === p.name) return;
    p.name = clean;
    this.saveProject(p);
  }

  openProject(id: string) {
    if (!this.projects.some((p) => p.id === id)) return;
    if (!this.openTabs.includes(id)) this.openTabs = [...this.openTabs, id];
    this.activeId = id;
    this.pickerFor = null;
    this.editingTaskId = null;
    this.filter = '';
    this.ensureSelection();
  }

  closeTab(id: string) {
    const i = this.openTabs.indexOf(id);
    if (i < 0) return;
    const tabs = this.openTabs.filter((t) => t !== id);
    this.openTabs = tabs;
    if (this.activeId === id) this.activeId = tabs[Math.min(i, tabs.length - 1)] ?? null;
    this.pickerFor = null;
    this.editingTaskId = null;
    this.filter = '';
    this.ensureSelection();
  }

  activateTabIndex(index: number) {
    const id = this.openTabs[index];
    if (id) this.openProject(id);
  }

  setArchived(id: string, archived: boolean) {
    const p = this.projects.find((x) => x.id === id);
    if (!p) return;
    p.archived = archived;
    if (archived) this.closeTab(id);
    this.saveProject(p);
    this.notify(archived ? `"${p.name}" archivado` : `"${p.name}" restaurado`);
  }

  moveProject(id: string, dir: -1 | 1) {
    const p = this.projects.find((x) => x.id === id);
    if (!p) return;
    const group = p.archived ? this.archivedProjects : this.liveProjects;
    const i = group.findIndex((x) => x.id === id);
    const other = group[i + dir];
    if (!other) return;
    [p.sort_order, other.sort_order] = [other.sort_order, p.sort_order];
    if (p.sort_order === other.sort_order) p.sort_order += dir * 0.5;
    const now = nowStamp();
    p.updated_at = now;
    other.updated_at = now;
    this.persist(this.db.saveProjects([plain(p), plain(other)]));
  }

  confirmDeleteProject(id: string) {
    const p = this.projects.find((x) => x.id === id);
    if (!p) return;
    const count = this.tasks.filter((t) => t.project_id === id).length;
    this.ask({
      title: `Eliminar "${p.name}"`,
      message:
        count > 0
          ? `Se eliminarán también sus ${count} ${count === 1 ? 'tarea' : 'tareas'}. Esto no se puede deshacer.`
          : 'El proyecto está vacío. Esto no se puede deshacer.',
      confirmLabel: 'Eliminar proyecto',
      danger: true,
      onConfirm: () => this.deleteProject(id),
    });
  }

  private deleteProject(id: string) {
    this.closeTab(id);
    this.projects = this.projects.filter((p) => p.id !== id);
    this.tasks = this.tasks.filter((t) => t.project_id !== id);
    delete this.selected[id];
    this.persist(this.db.deleteProject(id));
  }

  // ───────────────────────── notas del celular

  /** Proyecto activo con ese nombre (sin distinguir mayúsculas); si no existe, lo crea. */
  ensureProject(name: string): Project {
    const clean = name.trim() || 'bandeja';
    const found = this.liveProjects.find((p) => p.name.toLowerCase() === clean.toLowerCase());
    if (found) return found;
    const now = nowStamp();
    const project: Project = {
      id: uid(),
      name: clean,
      sort_order: this.projects.reduce((m, p) => Math.max(m, p.sort_order), 0) + 1,
      archived: false,
      created_at: now,
      updated_at: now,
    };
    this.projects.push(project);
    this.persist(this.db.saveProjects([project]));
    return this.projects.find((p) => p.id === project.id)!;
  }

  /**
   * Agrega una nota que llegó del celular al proyecto elegido allá.
   * Si ese proyecto ya no existe (o no se eligió), va a "bandeja". Devuelve el proyecto usado.
   */
  importRemoteNote(note: { text: string; projectId: string | null; projectName: string | null }): string {
    let project = note.projectId ? this.liveProjects.find((p) => p.id === note.projectId) : undefined;
    if (!project && note.projectName) {
      project = this.liveProjects.find((p) => p.name.toLowerCase() === note.projectName!.toLowerCase());
    }
    if (!project) project = this.ensureProject('bandeja');
    const parsed = parseEntry(note.text);
    const now = nowStamp();
    const status = this.defaultStatus();
    const task: Task = {
      id: uid(),
      project_id: project.id,
      title: parsed.title || note.text.trim() || 'nota sin texto',
      status_id: status.id,
      priority: parsed.priority ?? 1,
      due_date: parsed.due,
      notes: '',
      tags: parsed.tags,
      sort_order: nextSortOrder(this.tasks.filter((t) => t.project_id === project.id)),
      created_at: now,
      updated_at: now,
      completed_at: status.is_done ? now : null,
    };
    this.tasks.push(task);
    this.saveTask(task);
    return project.name;
  }

  // ───────────────────────── estados

  updateStatus(id: string, patch: Partial<Status>) {
    const s = this.statuses.find((x) => x.id === id);
    if (!s) return;
    Object.assign(s, patch);
    this.persist(this.db.saveStatuses([plain(s)]));
  }

  addStatus() {
    const status: Status = {
      id: uid(),
      name: 'nuevo estado',
      symbol: '◇',
      color: 'cyan',
      sort_order: this.statuses.reduce((m, s) => Math.max(m, s.sort_order), 0) + 1,
      is_done: false,
    };
    this.statuses.push(status);
    this.persist(this.db.saveStatuses([status]));
    return status.id;
  }

  moveStatus(id: string, dir: -1 | 1) {
    const list = this.sortedStatuses;
    const i = list.findIndex((s) => s.id === id);
    const a = list[i];
    const b = list[i + dir];
    if (!a || !b) return;
    [a.sort_order, b.sort_order] = [b.sort_order, a.sort_order];
    this.persist(this.db.saveStatuses([plain(a), plain(b)]));
  }

  deleteStatus(id: string, replacementId: string) {
    if (this.statuses.length <= 1 || id === replacementId) return;
    const now = nowStamp();
    const replacementDone = this.statusById.get(replacementId)?.is_done ?? false;
    for (const t of this.tasks) {
      if (t.status_id === id) {
        t.status_id = replacementId;
        t.updated_at = now;
        t.completed_at = replacementDone ? (t.completed_at ?? now) : null;
      }
    }
    this.statuses = this.statuses.filter((s) => s.id !== id);
    // El deshacer no sabe de estados borrados: se limpia para no restaurar referencias rotas.
    this.undoStack = this.undoStack.filter((e) => e.tasks.every((x) => !x.before || x.before.status_id !== id));
    this.persist(this.db.deleteStatus(id, replacementId, now));
  }

  // ───────────────────────── vista

  cycleSort() {
    this.sort = SORT_MODES[(SORT_MODES.indexOf(this.sort) + 1) % SORT_MODES.length];
  }

  setFontSize(size: number) {
    this.fontSize = Math.min(18, Math.max(11, Math.round(size)));
  }

  // ───────────────────────── respaldo

  async exportBackup() {
    this.flushPending();
    try {
      const where = await this.db.exportBackup(`tasky-respaldo-${todayISO()}.json`, nowStamp());
      if (where) this.notify(`Respaldo guardado en ${where}`);
    } catch (e) {
      this.notify(`No se pudo exportar: ${e instanceof Error ? e.message : e}`, 'error');
    }
  }

  confirmImportBackup() {
    this.ask({
      title: 'Importar respaldo',
      message: 'Importar reemplaza todos tus proyectos, tareas y estados actuales por los del archivo.',
      confirmLabel: 'Elegir archivo…',
      danger: true,
      onConfirm: () => this.importBackup(),
    });
  }

  private async importBackup() {
    this.flushPending();
    try {
      const snap = await this.db.importBackup();
      if (!snap) return;
      this.undoStack = [];
      this.applySnapshot(snap);
      this.notify('Respaldo importado');
    } catch (e) {
      this.notify(`No se pudo importar: ${e instanceof Error ? e.message : e}`, 'error');
    }
  }
}

export const app = new AppState();
