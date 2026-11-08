import { keys } from './platform';
import type { AppState } from './state.svelte';

export interface Command {
  id: string;
  group: string;
  label: string;
  keys?: string;
  run: () => void;
}

/** Comandos de la paleta. Se recalculan al abrirla para reflejar el estado actual. */
export function buildCommands(app: AppState): Command[] {
  const task = app.selectedTask;
  const project = app.activeProject;
  const cmds: Command[] = [];
  const add = (c: Command | false | null | undefined) => {
    if (c) cmds.push(c);
  };

  add(project && { id: 'task.new', group: 'tarea', label: 'nueva tarea', keys: keys('Mod+N'), run: () => app.requestFocus('new') });
  add(task && { id: 'task.edit', group: 'tarea', label: 'editar título', keys: keys('Enter'), run: () => (app.editingTaskId = task.id) });
  add(task && { id: 'task.status', group: 'tarea', label: 'cambiar estado…', keys: 'S', run: () => (app.pickerFor = task.id) });
  add(task && { id: 'task.next', group: 'tarea', label: 'avanzar estado', keys: keys('Space'), run: () => app.cycleStatus(task.id) });
  for (const [i, s] of app.sortedStatuses.entries()) {
    add(task && { id: `task.status.${s.id}`, group: 'tarea', label: `marcar como ${s.symbol} ${s.name}`, keys: i < 9 ? String(i + 1) : undefined, run: () => app.setStatus(task.id, s.id) });
  }
  add(task && { id: 'task.prio.3', group: 'tarea', label: 'prioridad alta', run: () => app.setPriority(task.id, 3) });
  add(task && { id: 'task.prio.2', group: 'tarea', label: 'prioridad media', run: () => app.setPriority(task.id, 2) });
  add(task && { id: 'task.prio.1', group: 'tarea', label: 'prioridad baja', run: () => app.setPriority(task.id, 1) });
  add(task && { id: 'task.up', group: 'tarea', label: 'mover arriba', keys: keys('Alt+Up'), run: () => app.moveSelected(-1) });
  add(task && { id: 'task.down', group: 'tarea', label: 'mover abajo', keys: keys('Alt+Down'), run: () => app.moveSelected(1) });
  add(task && { id: 'task.delete', group: 'tarea', label: 'eliminar tarea', keys: keys('Mod+Backspace'), run: () => app.deleteTask(task.id) });
  add({ id: 'edit.undo', group: 'editar', label: 'deshacer', keys: keys('Mod+Z'), run: () => app.undo() });

  add({ id: 'project.new', group: 'proyecto', label: 'nuevo proyecto', keys: keys('Mod+Shift+N'), run: () => app.createProject() });
  add({ id: 'project.goto', group: 'proyecto', label: 'ir a proyecto…', keys: keys('Mod+P'), run: () => setTimeout(() => (app.palette = 'projects')) });
  add(project && { id: 'project.rename', group: 'proyecto', label: `renombrar "${project.name}"`, run: () => { app.showSidebar = true; app.renamingProjectId = project.id; } });
  add(project && { id: 'project.archive', group: 'proyecto', label: project.archived ? `restaurar "${project.name}"` : `archivar "${project.name}"`, run: () => app.setArchived(project.id, !project.archived) });
  add(project && { id: 'project.delete', group: 'proyecto', label: `eliminar "${project.name}"…`, run: () => app.confirmDeleteProject(project.id) });
  add(project && { id: 'tab.close', group: 'proyecto', label: 'cerrar pestaña', keys: keys('Mod+W'), run: () => app.closeTab(project.id) });

  add({ id: 'search.global', group: 'buscar', label: 'buscar en todos los proyectos', keys: keys('Mod+Shift+F'), run: () => app.openSearch() });
  add({ id: 'view.filter', group: 'vista', label: 'filtrar tareas del proyecto', keys: keys('Mod+F'), run: () => app.requestFocus('filter') });
  add({ id: 'view.done', group: 'vista', label: app.hideDone ? 'mostrar tareas terminadas' : 'ocultar tareas terminadas', keys: keys('Mod+Shift+H'), run: () => (app.hideDone = !app.hideDone) });
  add({ id: 'view.sort.manual', group: 'vista', label: 'ordenar manual', run: () => (app.sort = 'manual') });
  add({ id: 'view.sort.estado', group: 'vista', label: 'ordenar por estado', run: () => (app.sort = 'estado') });
  add({ id: 'view.sort.prioridad', group: 'vista', label: 'ordenar por prioridad', run: () => (app.sort = 'prioridad') });
  add({ id: 'view.sort.fecha', group: 'vista', label: 'ordenar por fecha límite', run: () => (app.sort = 'fecha') });
  add({ id: 'view.sidebar', group: 'vista', label: 'mostrar/ocultar barra lateral', keys: keys('Mod+B'), run: () => (app.showSidebar = !app.showSidebar) });
  add({ id: 'view.detail', group: 'vista', label: 'mostrar/ocultar panel de detalle', keys: keys('Mod+I'), run: () => (app.showDetail = !app.showDetail) });
  add({ id: 'view.font.up', group: 'vista', label: 'agrandar texto', keys: keys('Mod+='), run: () => app.setFontSize(app.fontSize + 1) });
  add({ id: 'view.font.down', group: 'vista', label: 'achicar texto', keys: keys('Mod+-'), run: () => app.setFontSize(app.fontSize - 1) });

  add({ id: 'settings.open', group: 'ajustes', label: 'abrir ajustes y estados', keys: keys('Mod+,'), run: () => (app.settingsOpen = true) });
  add({ id: 'settings.theme.system', group: 'ajustes', label: 'tema: según el sistema', run: () => (app.theme = 'system') });
  add({ id: 'settings.theme.dark', group: 'ajustes', label: 'tema: oscuro', run: () => (app.theme = 'dark') });
  add({ id: 'settings.theme.light', group: 'ajustes', label: 'tema: claro', run: () => (app.theme = 'light') });
  add({ id: 'data.export', group: 'datos', label: 'exportar respaldo JSON…', run: () => void app.exportBackup() });
  add({ id: 'data.import', group: 'datos', label: 'importar respaldo JSON…', run: () => app.confirmImportBackup() });

  return cmds;
}

/** Coincidencia difusa simple: subsecuencia, priorizando prefijos y contigüidad. */
export function fuzzyScore(text: string, query: string): number {
  const t = text.toLowerCase();
  const q = query.toLowerCase().trim();
  if (!q) return 1;
  const direct = t.indexOf(q);
  if (direct >= 0) return 1000 - direct;
  let score = 0;
  let ti = 0;
  let streak = 0;
  for (const ch of q) {
    if (ch === ' ') continue;
    const found = t.indexOf(ch, ti);
    if (found < 0) return 0;
    streak = found === ti ? streak + 1 : 0;
    score += 10 + streak * 5 - Math.min(found - ti, 10);
    ti = found + 1;
  }
  return score;
}
