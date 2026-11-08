<script lang="ts">
  import { colorVar } from '../lib/defaults';
  import { keys } from '../lib/platform';
  import { app } from '../lib/state.svelte';
  import Icon from './Icon.svelte';
  import ProjectItem from './ProjectItem.svelte';

  let showArchived = $state(false);

  const legend = $derived(
    app.sortedStatuses.map((s) => ({
      status: s,
      count: app.projectTasks.filter((t) => t.status_id === s.id).length,
    })),
  );
</script>

<aside class="sidebar" aria-label="Proyectos">
  <div class="head">
    <span class="label">proyectos</span>
    <button class="icon-btn" aria-label="Nuevo proyecto" title="nuevo proyecto ({keys('Mod+Shift+N')})" onclick={() => app.createProject()}>
      <Icon name="plus" size={13} />
    </button>
  </div>

  <nav class="list">
    {#each app.liveProjects as project (project.id)}
      <ProjectItem {project} />
    {:else}
      <p class="empty">sin proyectos todavía</p>
    {/each}

    {#if app.archivedProjects.length > 0}
      <button class="section" aria-expanded={showArchived} onclick={() => (showArchived = !showArchived)}>
        <span class="caret">{showArchived ? '▾' : '▸'}</span> archivados ({app.archivedProjects.length})
      </button>
      {#if showArchived}
        {#each app.archivedProjects as project (project.id)}
          <ProjectItem {project} />
        {/each}
      {/if}
    {/if}
  </nav>

  {#if app.activeProject}
    <div class="legend">
      <span class="label">estados · {app.activeProject.name}</span>
      {#each legend as { status, count } (status.id)}
        <div class="legend-row">
          <span class="sym" style:color={colorVar(status.color)}>{status.symbol}</span>
          <span class="name">{status.name}</span>
          <span class="count">{count}</span>
        </div>
      {/each}
    </div>
  {/if}
</aside>

<style>
  .sidebar {
    flex: 0 0 232px;
    display: flex;
    flex-direction: column;
    min-height: 0;
    background: var(--panel);
    border-right: 1px solid var(--hair);
  }
  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 8px 6px 14px;
  }
  .list {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 1px;
    padding: 0 6px 8px;
  }
  .empty {
    margin: 4px 8px;
    color: var(--muted);
  }
  .section {
    margin-top: 10px;
    padding: 4px 8px;
    color: var(--muted);
    font-size: 0.9em;
  }
  .section:hover {
    color: var(--text);
  }
  .caret {
    display: inline-block;
    width: 1em;
  }
  .legend {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 12px 14px 14px;
    border-top: 1px solid var(--hair);
  }
  .legend .label {
    margin-bottom: 4px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .legend-row {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .sym {
    width: 1.2em;
    text-align: center;
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
  }
</style>
