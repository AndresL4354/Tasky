<script lang="ts">
  import { colorVar } from '../lib/defaults';
  import { keys } from '../lib/platform';
  import { phone } from '../lib/phone.svelte';
  import { app } from '../lib/state.svelte';
  import type { ThemePref } from '../lib/types';

  const counts = $derived(
    app.sortedStatuses
      .map((s) => ({ status: s, count: app.projectTasks.filter((t) => t.status_id === s.id).length }))
      .filter((c) => c.count > 0),
  );
  const total = $derived(app.projectTasks.length);
  const themes: ThemePref[] = ['system', 'dark', 'light'];
  const themeName: Record<ThemePref, string> = { system: 'sistema', dark: 'oscuro', light: 'claro' };
</script>

<footer class="statusbar">
  {#if app.activeProject}
    <span class="project">{app.activeProject.name}</span>
    <span>{total} {total === 1 ? 'tarea' : 'tareas'}</span>
    {#each counts as { status, count } (status.id)}
      <span title={status.name} style:color={colorVar(status.color)}>{status.symbol} {count}</span>
    {/each}
  {:else}
    <span>sin proyecto abierto</span>
  {/if}

  <span class="fill"></span>

  {#if app.filter.trim()}
    <button class="text-btn" title="quitar filtro" onclick={() => (app.filter = '')}>filtro: {app.filter.trim()} ×</button>
  {/if}
  {#if phone.ready && phone.enabled}
    <button
      class="text-btn phone {phone.status}"
      title={phone.status === 'error' ? (phone.lastError ?? 'error') : 'recibiendo notas del celular · abrir ajustes'}
      onclick={() => (app.settingsOpen = true)}
    >
      <span class="dot">●</span> celular
    </button>
  {/if}
  <button class="text-btn" title="cambiar orden" onclick={() => app.cycleSort()}>orden: {app.sort}</button>
  <button class="text-btn" aria-pressed={app.hideDone} title={keys('Mod+Shift+H')} onclick={() => (app.hideDone = !app.hideDone)}>
    {app.hideDone ? '[x]' : '[ ]'} ocultar terminadas
  </button>
  <button class="text-btn" title="cambiar tema" onclick={() => (app.theme = themes[(themes.indexOf(app.theme) + 1) % themes.length])}>
    tema: {themeName[app.theme]}
  </button>
  {#if app.activeProject}
    <span>{app.selectedIndex >= 0 ? `Ln ${app.selectedIndex + 1}/${app.rows.length}` : `${app.rows.length} líneas`}</span>
  {/if}
  <button class="text-btn" onclick={() => (app.palette = 'commands')}>{keys('Mod+K')} comandos</button>
</footer>

<style>
  .statusbar {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 2px 14px;
    flex: none;
    min-height: 26px;
    padding: 0 10px;
    background: var(--chrome);
    border-top: 1px solid var(--hair);
    color: var(--muted);
    font-size: 0.88em;
    white-space: nowrap;
  }
  .project {
    color: var(--text2);
  }
  .fill {
    flex: 1;
  }
  .text-btn {
    margin: 0 -8px;
  }
  .phone .dot {
    color: var(--muted);
  }
  .phone.ok .dot {
    color: var(--c-green);
  }
  .phone.syncing .dot {
    color: var(--c-yellow);
  }
  .phone.error .dot {
    color: var(--c-red);
  }
</style>
