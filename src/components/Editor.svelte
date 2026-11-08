<script lang="ts">
  import { tick } from 'svelte';
  import { keys } from '../lib/platform';
  import { app } from '../lib/state.svelte';
  import Icon from './Icon.svelte';
  import QuickEntry from './QuickEntry.svelte';
  import TaskLine from './TaskLine.svelte';

  let lines: HTMLDivElement | undefined = $state();
  let filterInput: HTMLInputElement | undefined = $state();
  let entry: QuickEntry | undefined = $state();

  const project = $derived(app.activeProject);
  const showNoMatches = $derived(
    !!project && app.rows.length === 0 && app.projectTasks.length > 0 && (!!app.filter.trim() || app.hideDone),
  );

  // Enfoque pedido desde atajos o comandos.
  $effect(() => {
    const { target } = app.focusSignal;
    tick().then(() => {
      if (app.modalOpen) return;
      if (target === 'new') entry?.focus();
      else if (target === 'filter') {
        filterInput?.focus();
        filterInput?.select();
      } else if (target === 'list') lines?.focus({ preventScroll: true });
    });
  });

  // Mantener visible la línea seleccionada.
  $effect(() => {
    const id = app.selectedId;
    if (!id || !lines) return;
    tick().then(() => {
      lines?.querySelector<HTMLElement>(`[data-task="${id}"]`)?.scrollIntoView({ block: 'nearest' });
    });
  });

  function onFilterKey(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      if (app.filter) app.filter = '';
      else app.requestFocus('list');
    } else if (e.key === 'Enter' || e.key === 'ArrowDown') {
      e.preventDefault();
      e.stopPropagation();
      if (app.rows.length) app.select(app.rows[0].id);
      app.requestFocus('list');
    }
  }
</script>

<section class="editor" aria-label="Tareas">
  {#if project}
    <div class="crumbs">
      <span class="muted">tasky</span>
      <span class="muted">›</span>
      <span class="current">{project.name}</span>
      {#if project.archived}<span class="muted">(archivado)</span>{/if}
      <span class="fill"></span>
      <label class="filter" title="filtrar ({keys('Mod+F')})">
        <Icon name="search" size={13} />
        <span class="sr-only">Filtrar tareas</span>
        <input
          class="ghost-input"
          bind:this={filterInput}
          bind:value={app.filter}
          onkeydown={onFilterKey}
          placeholder="filtrar: texto, #tag, estado"
          spellcheck="false"
        />
      </label>
    </div>

    <div class="lines" bind:this={lines} tabindex="-1" aria-label="Lista de tareas de {project.name}">
      {#each app.rows as task, i (task.id)}
        <TaskLine {task} line={i + 1} selected={task.id === app.selectedId} />
      {/each}
      {#if showNoMatches}
        <div class="row">
          <span></span>
          <span class="ln">~</span>
          <span class="muted">
            {app.filter.trim() ? `sin coincidencias para "${app.filter.trim()}"` : 'todo terminado por aquí'}
          </span>
        </div>
      {/if}
      <QuickEntry bind:this={entry} line={app.rows.length + 1} />
    </div>
  {:else}
    <div class="welcome">
      <div class="welcome-box">
        <span class="title">tasky</span>
        <span class="muted">abre un proyecto de la barra lateral o crea uno nuevo</span>
        <button class="shortcut" onclick={() => (app.palette = 'projects')}>
          <span>ir a proyecto</span><span class="kbd">{keys('Mod+P')}</span>
        </button>
        <button class="shortcut" onclick={() => app.createProject()}>
          <span>nuevo proyecto</span><span class="kbd">{keys('Mod+Shift+N')}</span>
        </button>
        <button class="shortcut" onclick={() => app.openSearch()}>
          <span>buscar en todo</span><span class="kbd">{keys('Mod+Shift+F')}</span>
        </button>
        <button class="shortcut" onclick={() => (app.palette = 'commands')}>
          <span>paleta de comandos</span><span class="kbd">{keys('Mod+K')}</span>
        </button>
        <button class="shortcut" onclick={() => (app.settingsOpen = true)}>
          <span>ajustes y estados</span><span class="kbd">{keys('Mod+,')}</span>
        </button>
      </div>
    </div>
  {/if}
</section>

<style>
  .editor {
    flex: 1 1 420px;
    min-width: 0;
    min-height: 0;
    display: flex;
    flex-direction: column;
    background: var(--bg);
  }
  .crumbs {
    display: flex;
    align-items: center;
    gap: 10px;
    flex: none;
    min-height: 32px;
    padding: 0 14px 0 16px;
    border-bottom: 1px solid var(--hair);
  }
  .current {
    color: var(--text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .muted {
    color: var(--muted);
  }
  .fill {
    flex: 1;
  }
  .filter {
    display: flex;
    align-items: center;
    gap: 8px;
    color: var(--muted);
  }
  .filter input {
    width: min(240px, 28vw);
    font-size: 0.92em;
  }
  .lines {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 6px 0 56px;
    outline: none;
  }
  .row {
    display: grid;
    grid-template-columns: 3px 52px minmax(0, 1fr);
    align-items: center;
    min-height: 26px;
  }
  .ln {
    padding-right: 16px;
    text-align: right;
    color: var(--ln);
  }
  .welcome {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 32px;
  }
  .welcome-box {
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-width: 320px;
  }
  .title {
    color: var(--text);
    font-size: 1.4em;
    font-weight: 500;
  }
  .welcome-box > .muted {
    margin-bottom: 12px;
  }
  .shortcut {
    display: flex;
    justify-content: space-between;
    gap: 24px;
    padding: 4px 8px;
    margin: 0 -8px;
    border-radius: 4px;
    color: var(--text2);
  }
  .shortcut:hover {
    background: var(--hover);
    color: var(--text);
  }
</style>
