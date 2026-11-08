<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { dueInfo } from '../lib/dates';
  import { colorVar } from '../lib/defaults';
  import { keys } from '../lib/platform';
  import { groupByProject, searchAll, segments, type ProjectHit, type TaskHit } from '../lib/search';
  import { app } from '../lib/state.svelte';
  import Icon from './Icon.svelte';

  type Item = { kind: 'project'; hit: ProjectHit } | { kind: 'task'; hit: TaskHit };

  let input: HTMLInputElement | undefined = $state();
  let listEl: HTMLDivElement | undefined = $state();
  let active = $state(0);

  const query = $derived(app.searchQuery.trim());
  const results = $derived(
    searchAll(app.searchQuery, { tasks: app.tasks, projects: app.projects, statuses: app.statuses }),
  );
  const groups = $derived(groupByProject(results.tasks));
  const items = $derived<Item[]>([
    ...results.projects.map((hit) => ({ kind: 'project' as const, hit })),
    ...groups.flatMap((g) => g.hits.map((hit) => ({ kind: 'task' as const, hit }))),
  ]);
  const indexOf = $derived(
    new Map(items.map((it, i) => [it.kind === 'task' ? it.hit.task.id : `p:${it.hit.project.id}`, i])),
  );

  $effect(() => {
    void app.searchQuery;
    active = 0;
  });

  $effect(() => {
    const i = active;
    tick().then(() => listEl?.querySelector<HTMLElement>(`[data-index="${i}"]`)?.scrollIntoView({ block: 'nearest' }));
  });

  onMount(() => {
    input?.focus();
    input?.select();
  });

  function open(item: Item | undefined) {
    if (!item) return;
    if (item.kind === 'project') {
      app.searchOpen = false;
      app.openProject(item.hit.project.id);
      app.requestFocus('list');
    } else {
      app.revealTask(item.hit.task.id, { showDetail: !!item.hit.note });
    }
  }

  function onKey(e: KeyboardEvent) {
    const last = items.length - 1;
    if (e.key === 'ArrowDown') active = Math.min(last, active + 1);
    else if (e.key === 'ArrowUp') active = Math.max(0, active - 1);
    else if (e.key === 'PageDown') active = Math.min(last, active + 8);
    else if (e.key === 'PageUp') active = Math.max(0, active - 8);
    else if (e.key === 'Enter') open(items[active]);
    else if (e.key === 'Escape') app.closeSearch();
    else return;
    e.preventDefault();
    e.stopPropagation();
  }
</script>

<div class="overlay">
  <button class="scrim" aria-label="Cerrar la búsqueda" tabindex="-1" onclick={() => app.closeSearch()}></button>
  <div class="panel" role="dialog" aria-modal="true" aria-label="Buscar en todos los proyectos">
    <label class="bar">
      <Icon name="search" size={14} />
      <span class="sr-only">Buscar en todos los proyectos</span>
      <input
        class="ghost-input"
        bind:this={input}
        bind:value={app.searchQuery}
        onkeydown={onKey}
        placeholder="buscar en todo: títulos, notas, #etiquetas, estados, proyectos…"
        spellcheck="false"
        autocomplete="off"
        role="combobox"
        aria-expanded="true"
        aria-controls="search-results"
        aria-activedescendant={items.length ? `sr-${active}` : undefined}
      />
      {#if query}
        <span class="count">{results.total} {results.total === 1 ? 'resultado' : 'resultados'}</span>
      {/if}
    </label>

    <div class="results" id="search-results" role="listbox" aria-label="Resultados" bind:this={listEl}>
      {#if !query}
        <div class="help">
          <p>Busca en los títulos, notas, etiquetas y estados de todas tus tareas, y en los nombres de los proyectos.</p>
          <p><span class="code">#bug</span> solo esa etiqueta · <span class="code">login api</span> deben aparecer las dos palabras · no importan acentos ni mayúsculas</p>
        </div>
      {:else if items.length === 0}
        <p class="empty">sin resultados para "{query}"</p>
      {:else}
        {#if results.projects.length}
          <div class="group-head"><span>proyectos</span></div>
          {#each results.projects as hit (hit.project.id)}
            {@const i = indexOf.get(`p:${hit.project.id}`) ?? 0}
            <button
              id="sr-{i}"
              class="item project-item"
              class:active={i === active}
              data-index={i}
              role="option"
              aria-selected={i === active}
              tabindex="-1"
              onmousemove={() => (active = i)}
              onclick={() => open(items[i])}
            >
              <Icon name="folder" size={13} />
              <span class="title">{#each segments(hit.project.name, hit.ranges) as seg, k (k)}{#if seg.hit}<mark>{seg.text}</mark>{:else}{seg.text}{/if}{/each}</span>
              {#if hit.project.archived}<span class="muted">archivado</span>{/if}
              <span class="muted go">abrir proyecto</span>
            </button>
          {/each}
        {/if}

        {#each groups as group (group.project.id)}
          <div class="group-head">
            <Icon name="folder" size={13} />
            <span class="pname">{group.project.name}</span>
            {#if group.project.archived}<span>· archivado</span>{/if}
            <span>· {group.hits.length}</span>
          </div>
          {#each group.hits as hit (hit.task.id)}
            {@const i = indexOf.get(hit.task.id) ?? 0}
            {@const done = hit.status?.is_done ?? false}
            {@const due = dueInfo(hit.task.due_date, done)}
            <button
              id="sr-{i}"
              class="item task-item"
              class:active={i === active}
              class:done
              data-index={i}
              role="option"
              aria-selected={i === active}
              tabindex="-1"
              onmousemove={() => (active = i)}
              onclick={() => open(items[i])}
            >
              <span class="ln">{hit.line}</span>
              <span class="body">
                <span class="first">
                  <span class="title">{#each segments(hit.task.title, hit.titleRanges) as seg, k (k)}{#if seg.hit}<mark>{seg.text}</mark>{:else}{seg.text}{/if}{/each}</span>
                  {#each hit.tags as t (t.tag)}
                    <span class="tag" class:hit={t.hit}>{t.tag}</span>
                  {/each}
                  {#if due}<span class="due {due.tone}">{due.label}</span>{/if}
                </span>
                {#if hit.note}
                  <span class="note">¶ {#each segments(hit.note.text, hit.note.ranges) as seg, k (k)}{#if seg.hit}<mark>{seg.text}</mark>{:else}{seg.text}{/if}{/each}</span>
                {/if}
              </span>
              <span class="status" style:color={colorVar(hit.status?.color ?? 'muted')}>
                <span class="sym">{hit.status?.symbol ?? '?'}</span>
                <span class="sname" class:hit={hit.statusHit}>{hit.status?.name ?? 'sin estado'}</span>
              </span>
            </button>
          {/each}
        {/each}

        {#if results.total > results.tasks.length}
          <p class="empty">mostrando {results.tasks.length} de {results.total}; escribe más para afinar</p>
        {/if}
      {/if}
    </div>

    <div class="footer">
      <span>↑↓ navegar</span>
      <span>{keys('Enter')} abrir</span>
      <span>esc cerrar</span>
      <span class="fill"></span>
      <span>{keys('Mod+F')} filtra solo el proyecto actual</span>
    </div>
  </div>
</div>

<style>
  .overlay {
    position: absolute;
    inset: 0;
    z-index: 52;
    display: flex;
    justify-content: center;
    align-items: flex-start;
    padding: 56px 16px 16px;
  }
  .scrim {
    position: absolute;
    inset: 0;
    background: var(--scrim);
    cursor: default;
  }
  .panel {
    position: relative;
    display: flex;
    flex-direction: column;
    width: 780px;
    max-width: 100%;
    max-height: calc(100% - 24px);
    overflow: hidden;
    background: var(--pop);
    border: 1px solid var(--border);
    border-radius: 8px;
    box-shadow: var(--shadow);
  }
  .bar {
    display: flex;
    align-items: center;
    gap: 10px;
    flex: none;
    padding: 11px 14px;
    border-bottom: 1px solid var(--hair);
    color: var(--muted);
  }
  .count {
    flex: none;
    font-size: 0.88em;
  }
  .results {
    flex: 1;
    min-height: 0;
    max-height: 62vh;
    overflow-y: auto;
    padding: 4px 4px 8px;
  }
  .help {
    padding: 6px 12px;
    color: var(--muted);
  }
  .help p {
    margin: 6px 0;
  }
  .code {
    color: var(--c-cyan);
  }
  .empty {
    margin: 10px 12px;
    color: var(--muted);
  }
  .group-head {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 10px 10px 4px;
    color: var(--muted);
    font-size: 0.88em;
  }
  .pname {
    color: var(--c-purple);
  }
  .item {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    width: 100%;
    padding: 4px 10px;
    border-radius: 4px;
    color: var(--text);
  }
  .item.active {
    background: var(--line);
  }
  .project-item {
    align-items: center;
  }
  .project-item :global(svg) {
    color: var(--muted);
  }
  .go {
    margin-left: auto;
    font-size: 0.85em;
  }
  .muted {
    color: var(--muted);
  }
  .ln {
    flex: none;
    width: 3ch;
    text-align: right;
    color: var(--ln);
    font-variant-numeric: tabular-nums;
  }
  .item.active .ln {
    color: var(--ln-active);
  }
  .body {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
  }
  .first {
    display: flex;
    align-items: baseline;
    gap: 12px;
    min-width: 0;
  }
  .title {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .tag,
  .due {
    flex: none;
  }
  .tag {
    color: var(--c-cyan);
  }
  .due {
    color: var(--muted);
  }
  .due.overdue {
    color: var(--c-red);
  }
  .due.today,
  .due.soon {
    color: var(--c-yellow);
  }
  .note {
    margin-top: 1px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--muted);
    font-size: 0.92em;
  }
  .status {
    flex: none;
    display: flex;
    gap: 8px;
    min-width: 15ch;
  }
  .sym {
    width: 1em;
    text-align: center;
  }
  .item.done {
    background: color-mix(in srgb, var(--c-green) 9%, transparent);
  }
  .item.done.active {
    background: color-mix(in srgb, var(--c-green) 18%, transparent);
  }
  mark,
  .tag.hit,
  .sname.hit {
    background: color-mix(in srgb, var(--c-yellow) 30%, transparent);
    color: inherit;
    border-radius: 2px;
  }
  .footer {
    display: flex;
    gap: 16px;
    flex: none;
    padding: 6px 14px;
    border-top: 1px solid var(--hair);
    color: var(--muted);
    font-size: 0.85em;
  }
  .fill {
    flex: 1;
  }
  @media (max-width: 700px) {
    .status {
      min-width: 0;
    }
    .sname,
    .footer .fill,
    .footer .fill + span {
      display: none;
    }
  }
</style>
