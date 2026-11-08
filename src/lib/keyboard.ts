import { isMac, isTypingTarget, modPressed } from './platform';
import type { AppState } from './state.svelte';

/**
 * Atajos globales. Los diálogos (paleta, ajustes, confirmación, selector de estado)
 * manejan sus propias teclas y cortan la propagación.
 */
export function handleGlobalKey(e: KeyboardEvent, app: AppState) {
  if (!app.ready || app.modalOpen || e.isComposing) return;

  const mod = modPressed(e);
  const typing = isTypingTarget(e.target);
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  const task = app.selectedTask;

  const done = () => {
    e.preventDefault();
    e.stopPropagation();
  };

  if (mod && !e.altKey) {
    // Pestañas: ⌘1…⌘9
    if (!e.shiftKey && /^Digit[1-9]$/.test(e.code)) {
      done();
      app.activateTabIndex(Number(e.code.slice(5)) - 1);
      return;
    }
    switch (key) {
      case 'k':
        done();
        app.palette = 'commands';
        return;
      case 'p':
        done();
        app.palette = e.shiftKey ? 'commands' : 'projects';
        return;
      case 'b':
        done();
        app.showSidebar = !app.showSidebar;
        return;
      case 'i':
        done();
        app.showDetail = !app.showDetail;
        return;
      case 'f':
        done();
        if (e.shiftKey) app.openSearch();
        else app.requestFocus('filter');
        return;
      case 'n':
        done();
        if (e.shiftKey) app.createProject();
        else app.requestFocus('new');
        return;
      case 'w':
        done();
        if (app.activeProject) app.closeTab(app.activeProject.id);
        return;
      case 'h':
        if (e.shiftKey) {
          done();
          app.hideDone = !app.hideDone;
        }
        return;
      case ',':
        done();
        app.settingsOpen = true;
        return;
      case '=':
      case '+':
        done();
        app.setFontSize(app.fontSize + 1);
        return;
      case '-':
        done();
        app.setFontSize(app.fontSize - 1);
        return;
      case '0':
        done();
        app.setFontSize(13);
        return;
      case 'z':
        if (typing) {
          // En macOS no hay "Deshacer" en el menú (para que ⌘Z llegue aquí), así que lo hacemos a mano.
          if (isMac && !e.shiftKey) {
            e.preventDefault();
            document.execCommand('undo');
          }
          return;
        }
        if (!e.shiftKey) {
          done();
          app.undo();
        }
        return;
      case 'Backspace':
      case 'Delete':
        if (!typing && task) {
          done();
          app.deleteTask(task.id);
        }
        return;
    }
    return;
  }

  if (typing) return;

  if (e.altKey && (key === 'ArrowUp' || key === 'ArrowDown')) {
    done();
    app.moveSelected(key === 'ArrowUp' ? -1 : 1);
    return;
  }
  if (e.altKey || mod) return;

  switch (key) {
    case 'ArrowDown':
    case 'j':
      done();
      app.selectRelative(1);
      return;
    case 'ArrowUp':
    case 'k':
      done();
      app.selectRelative(-1);
      return;
    case 'PageDown':
      done();
      app.selectRelative(10);
      return;
    case 'PageUp':
      done();
      app.selectRelative(-10);
      return;
    case 'Home':
      done();
      app.selectEdge('first');
      return;
    case 'g':
      done();
      app.selectEdge(e.shiftKey ? 'last' : 'first');
      return;
    case 'End':
      done();
      app.selectEdge('last');
      return;
    case 'Escape':
      if (app.filter) {
        done();
        app.filter = '';
      }
      return;
  }

  if (!task) {
    if (key === 'Enter' || key === 'o') {
      done();
      app.requestFocus('new');
    }
    return;
  }

  switch (key) {
    case 'Enter':
    case 'F2':
      done();
      app.editingTaskId = task.id;
      return;
    case ' ':
      done();
      app.cycleStatus(task.id, e.shiftKey ? -1 : 1);
      return;
    case 's':
      done();
      app.pickerFor = task.id;
      return;
    case '!':
    case 'p':
      done();
      app.cyclePriority(task.id);
      return;
    case 'o':
      done();
      app.requestFocus('new');
      return;
    case 'Delete':
      done();
      app.deleteTask(task.id);
      return;
  }
  if (/^Digit[1-9]$/.test(e.code) && !e.shiftKey) {
    done();
    app.setStatusByIndex(task.id, Number(e.code.slice(5)) - 1);
  }
}
