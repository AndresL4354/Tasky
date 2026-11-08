<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { buildCommands, fuzzyScore } from '../lib/commands';
  import { app } from '../lib/state.svelte';

  interface Item {
    id: string;
    group: string;
    label: string;
    keys?: string;
    run: () => void;
  }

  let query = $state('');
  let active = $state(0);
  let input: HTMLInputElement | undefined = $state();
  let listEl: HTMLDivElement | undefined = $state();

  const mode = $derived(app.palette);

  const items = $derived.by<Item[]>(() => {
    if (mode === 'projects') {
      return app.sortedProjects.map((p) => {
        const pending = app.tasks.filter((t) => t.project_id === p.id && !app.statusById.get(t.status_id)?.is_done).length;
        return {
          id: p.id,
          group: p.archived ? 'archivado' : 'proyecto',
          label: p.name,
          keys: pending ? `${pending} pendientes` : '',
          run: () => {
            if (p.archived) app.setArchived(p.id, false);
            app.openProject(p.id);
          },
        };
      });
    }
    return buildCommands(app);
  });

  const results = $derived.by(() => {
    const q = query.trim();
    if (!q) return items;
    return items
      .map((item) => ({ item, score: fuzzyScore(`${item.group}: ${item.label}`, q) }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .map((x) => x.item);
  });

  $effect(() => {
    void query;
    active = 0;
  });

  $effect(() => {
    const i = active;
    tick().then(() => listEl?.querySelector<HTMLElement>(`[data-index="${i}"]`)?.scrollIntoView({ block: 'nearest' }));
  });

  onMount(() => input?.focus());

  function close() {
    app.palette = null;
    app.requestFocus('list');
  }

  function run(item: Item | undefined) {
    if (!item) return;
    app.palette = null;
    app.requestFocus('list');
    item.run();
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === 'ArrowDown') active = Math.min(results.length - 1, active + 1);
    else if (e.key === 'ArrowUp') active = Math.max(0, active - 1);
    else if (e.key === 'Enter') run(results[active]);
    else if (e.key === 'Escape') close();
    else if (e.key === 'Tab') {
      // Tab alterna entre comandos y proyectos.
      app.palette = mode === 'projects' ? 'commands' : 'projects';
      query = '';
    } else return;
    e.preventDefault();
    e.stopPropagation();
  }
</script>

<div class="overlay">
  <button class="scrim" aria-label="Cerrar la paleta" tabindex="-1" onclick={close}></button>
  <div class="palette" role="dialog" aria-modal="true" aria-label={mode === 'projects' ? 'Ir a proyecto' : 'Paleta de comandos'}>
    <label class="search">
      <span class="prompt">{mode === 'projects' ? '@' : '›'}</span>
      <span class="sr-only">{mode === 'projects' ? 'Buscar proyecto' : 'Buscar comando'}</span>
      <input
        class="ghost-input"
        bind:this={input}
        bind:value={query}
        onkeydown={onKey}
        placeholder={mode === 'projects' ? 'ir a proyecto…' : 'escribe un comando…'}
        spellcheck="false"
        role="combobox"
        aria-expanded="true"
        aria-controls="palette-list"
        aria-activedescendant={results.length ? `palette-${active}` : undefined}
      />
      <span class="kbd">tab: {mode === 'projects' ? 'comandos' : 'proyectos'}</span>
    </label>
    <div class="list" id="palette-list" role="listbox" bind:this={listEl}>
      {#each results as item, i (item.id)}
        <button
          id="palette-{i}"
          class="item"
          class:active={i === active}
          role="option"
          aria-selected={i === active}
          data-index={i}
          tabindex="-1"
          onmousemove={() => (active = i)}
          onclick={() => run(item)}
        >
          <span class="group">{item.group}:</span>
          <span class="text">{item.label}</span>
          {#if item.keys}<span class="kbd">{item.keys}</span>{/if}
        </button>
      {:else}
        <p class="empty">sin resultados</p>
      {/each}
    </div>
  </div>
</div>

<style>
  .overlay {
    position: absolute;
    inset: 0;
    z-index: 50;
    display: flex;
    justify-content: center;
    align-items: flex-start;
    padding-top: 72px;
  }
  .scrim {
    position: absolute;
    inset: 0;
    background: var(--scrim);
    cursor: default;
  }
  .palette {
    position: relative;
    width: 580px;
    max-width: calc(100% - 32px);
    overflow: hidden;
    background: var(--pop);
    border: 1px solid var(--border);
    border-radius: 8px;
    box-shadow: var(--shadow);
  }
  .search {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 14px;
    border-bottom: 1px solid var(--hair);
  }
  .prompt {
    color: var(--muted);
  }
  .search .kbd {
    font-size: 0.85em;
  }
  .list {
    max-height: min(380px, 60vh);
    overflow-y: auto;
    padding: 4px;
  }
  .item {
    display: flex;
    align-items: center;
    gap: 6px;
    width: 100%;
    padding: 5px 10px;
    border-radius: 4px;
    color: var(--text);
  }
  .item.active {
    background: var(--line);
  }
  .group {
    color: var(--muted);
  }
  .text {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .empty {
    margin: 8px 10px;
    color: var(--muted);
  }
</style>
