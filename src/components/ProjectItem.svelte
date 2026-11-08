<script lang="ts">
  import { tick } from 'svelte';
  import { app } from '../lib/state.svelte';
  import type { Project } from '../lib/types';
  import Icon from './Icon.svelte';

  let { project }: { project: Project } = $props();

  let menuOpen = $state(false);
  let draft = $state('');
  let input: HTMLInputElement | undefined = $state();
  let root: HTMLDivElement | undefined = $state();

  const renaming = $derived(app.renamingProjectId === project.id);
  const active = $derived(app.activeProject?.id === project.id);
  const pending = $derived(
    app.tasks.filter((t) => t.project_id === project.id && !app.statusById.get(t.status_id)?.is_done).length,
  );

  $effect(() => {
    if (renaming) {
      draft = project.name;
      tick().then(() => {
        input?.focus();
        input?.select();
      });
    }
  });

  function commit() {
    if (app.renamingProjectId === project.id) app.renameProject(project.id, draft);
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault();
      commit();
      app.requestFocus('list');
    } else if (e.key === 'Escape') {
      e.preventDefault();
      app.renamingProjectId = null;
      app.requestFocus('list');
    }
    e.stopPropagation();
  }

  function onWindowDown(e: MouseEvent) {
    if (menuOpen && root && !root.contains(e.target as Node)) menuOpen = false;
  }

  function act(fn: () => void) {
    menuOpen = false;
    fn();
  }
</script>

<svelte:window onmousedown={onWindowDown} />

<div class="item" class:on={active} class:archived={project.archived} bind:this={root}>
  {#if renaming}
    <div class="row">
      <Icon name="folder" size={14} />
      <label class="sr-only" for="rename-{project.id}">Nombre del proyecto</label>
      <input id="rename-{project.id}" class="field rename" bind:this={input} bind:value={draft} onkeydown={onKey} onblur={commit} />
    </div>
  {:else}
    <button
      class="row main"
      onclick={() => app.openProject(project.id)}
      ondblclick={() => (app.renamingProjectId = project.id)}
      oncontextmenu={(e) => {
        e.preventDefault();
        menuOpen = true;
      }}
    >
      <Icon name="folder" size={14} />
      <span class="name">{project.name}</span>
      <span class="count">{pending || ''}</span>
    </button>
    <button class="more icon-btn" aria-label="Acciones de {project.name}" aria-expanded={menuOpen} onclick={() => (menuOpen = !menuOpen)}>
      <Icon name="dots" size={14} />
    </button>
  {/if}

  {#if menuOpen}
    <div class="menu" role="menu">
      <button role="menuitem" onclick={() => act(() => (app.renamingProjectId = project.id))}>renombrar</button>
      <button role="menuitem" onclick={() => act(() => app.moveProject(project.id, -1))}>subir</button>
      <button role="menuitem" onclick={() => act(() => app.moveProject(project.id, 1))}>bajar</button>
      <button role="menuitem" onclick={() => act(() => app.setArchived(project.id, !project.archived))}>
        {project.archived ? 'restaurar' : 'archivar'}
      </button>
      <button role="menuitem" class="danger" onclick={() => act(() => app.confirmDeleteProject(project.id))}>eliminar…</button>
    </div>
  {/if}
</div>

<style>
  .item {
    position: relative;
    display: flex;
    align-items: center;
    border-radius: 4px;
    color: var(--text2);
  }
  .item:hover {
    background: var(--hover);
  }
  .item.on {
    background: var(--line);
    color: var(--text);
  }
  .item.archived .name {
    color: var(--muted);
  }
  .row {
    display: flex;
    align-items: center;
    gap: 8px;
    flex: 1;
    min-width: 0;
    padding: 4px 8px;
  }
  .row :global(svg) {
    flex: none;
    color: var(--muted);
  }
  .name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .count {
    color: var(--muted);
    font-size: 0.9em;
  }
  .rename {
    padding: 1px 6px;
  }
  .more {
    display: none;
    margin-right: 4px;
  }
  .item:hover .more,
  .more[aria-expanded='true'] {
    display: inline-flex;
  }
  .item:hover .count {
    display: none;
  }
  .menu {
    position: absolute;
    top: calc(100% + 2px);
    right: 4px;
    z-index: 40;
    min-width: 150px;
    padding: 4px;
    background: var(--pop);
    border: 1px solid var(--border);
    border-radius: 6px;
    box-shadow: var(--shadow);
  }
  .menu button {
    display: block;
    width: 100%;
    padding: 4px 10px;
    border-radius: 4px;
    color: var(--text);
  }
  .menu button:hover {
    background: var(--hover);
  }
  .menu .danger {
    color: var(--c-red);
  }
</style>
