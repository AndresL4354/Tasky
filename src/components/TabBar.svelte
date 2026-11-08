<script lang="ts">
  import { isMac, isTauri, keys } from '../lib/platform';
  import { app } from '../lib/state.svelte';
  import Icon from './Icon.svelte';

  // En macOS la barra de título está integrada: dejamos lugar para los semáforos.
  const macChrome = isMac && isTauri;
</script>

<header class="tabbar" class:mac={macChrome} data-tauri-drag-region>
  <button
    class="toggle"
    aria-label="Mostrar u ocultar la barra lateral"
    title="barra lateral ({keys('Mod+B')})"
    onclick={() => (app.showSidebar = !app.showSidebar)}
  >
    <Icon name="sidebar" size={15} />
  </button>

  <div class="tabs" role="tablist" aria-label="Proyectos abiertos" data-tauri-drag-region>
    {#each app.openTabs as id, i (id)}
      {@const project = app.projects.find((p) => p.id === id)}
      {#if project}
        <div class="tab" class:on={id === app.activeId}>
          <button
            class="tab-main"
            role="tab"
            aria-selected={id === app.activeId}
            title={i < 9 ? keys(`Mod+${i + 1}`) : undefined}
            onclick={() => app.openProject(id)}
            onauxclick={(e) => e.button === 1 && app.closeTab(id)}
          >
            <Icon name="list" size={13} />
            <span>{project.name}</span>
          </button>
          <button class="close" aria-label="Cerrar {project.name}" title={keys('Mod+W')} onclick={() => app.closeTab(id)}>
            <Icon name="x" size={10} />
          </button>
        </div>
      {/if}
    {/each}
    <div class="fill" data-tauri-drag-region></div>
  </div>

  <button class="search" title="buscar en todos los proyectos ({keys('Mod+Shift+F')})" onclick={() => app.openSearch()}>
    <Icon name="search" size={13} />
    <span class="search-label">buscar</span>
    <span class="kbd">{keys('Mod+Shift+F')}</span>
  </button>

  <button
    class="toggle"
    aria-label="Mostrar u ocultar el panel de detalle"
    title="detalle ({keys('Mod+I')})"
    onclick={() => (app.showDetail = !app.showDetail)}
  >
    <Icon name="detail" size={15} />
  </button>
</header>

<style>
  .tabbar {
    display: flex;
    align-items: stretch;
    flex: none;
    height: 38px;
    background: var(--chrome);
    border-bottom: 1px solid var(--hair);
  }
  .tabbar.mac {
    padding-left: 76px;
  }
  .toggle {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 38px;
    flex: none;
    color: var(--muted);
  }
  .toggle:hover {
    color: var(--text);
  }
  .tabs {
    display: flex;
    align-items: stretch;
    flex: 1;
    min-width: 0;
    overflow-x: auto;
    scrollbar-width: none;
  }
  .tabs::-webkit-scrollbar {
    display: none;
  }
  .fill {
    flex: 1;
    min-width: 24px;
  }
  .search {
    display: flex;
    align-items: center;
    gap: 8px;
    flex: none;
    align-self: center;
    height: 26px;
    margin-left: 8px;
    padding: 0 10px;
    border: 1px solid var(--border);
    border-radius: 5px;
    background: var(--bg);
    color: var(--muted);
    font-size: 0.92em;
  }
  .search:hover {
    color: var(--text);
    border-color: var(--muted);
  }
  .search .kbd {
    font-size: 0.9em;
  }
  @media (max-width: 860px) {
    .search-label,
    .search .kbd {
      display: none;
    }
  }
  .tab {
    display: flex;
    align-items: center;
    flex: none;
    max-width: 240px;
    color: var(--muted);
    border-right: 1px solid var(--hair);
  }
  .tab:first-child {
    border-left: 1px solid var(--hair);
  }
  .tab:hover {
    color: var(--text2);
  }
  .tab.on {
    background: var(--bg);
    color: var(--text);
  }
  .tab-main {
    display: flex;
    align-items: center;
    gap: 8px;
    height: 100%;
    min-width: 0;
    padding: 0 6px 0 14px;
  }
  .tab-main span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .close {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 20px;
    height: 20px;
    margin-right: 8px;
    border-radius: 3px;
    color: transparent;
  }
  .tab:hover .close,
  .tab.on .close {
    color: var(--muted);
  }
  .close:hover {
    color: var(--text) !important;
    background: var(--chip);
  }
</style>
