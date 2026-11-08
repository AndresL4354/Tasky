<script lang="ts">
  import { onMount } from 'svelte';
  import CommandPalette from './components/CommandPalette.svelte';
  import ConfirmDialog from './components/ConfirmDialog.svelte';
  import DetailPanel from './components/DetailPanel.svelte';
  import Editor from './components/Editor.svelte';
  import GlobalSearch from './components/GlobalSearch.svelte';
  import Settings from './components/Settings.svelte';
  import Sidebar from './components/Sidebar.svelte';
  import StatusBar from './components/StatusBar.svelte';
  import TabBar from './components/TabBar.svelte';
  import Toast from './components/Toast.svelte';
  import { handleGlobalKey } from './lib/keyboard';
  import { isTauri, isTypingTarget } from './lib/platform';
  import { app } from './lib/state.svelte';

  let systemDark = $state(true);
  const themeClass = $derived(
    app.theme === 'system' ? (systemDark ? 'theme-dark' : 'theme-light') : `theme-${app.theme}`,
  );

  onMount(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    systemDark = mq.matches;
    const onScheme = (e: MediaQueryListEvent) => (systemDark = e.matches);
    mq.addEventListener('change', onScheme);
    const flush = () => app.flushPending();
    window.addEventListener('beforeunload', flush);
    window.addEventListener('blur', flush);
    void app.init();
    return () => {
      mq.removeEventListener('change', onScheme);
      window.removeEventListener('beforeunload', flush);
      window.removeEventListener('blur', flush);
    };
  });

  $effect(() => {
    document.documentElement.className = themeClass;
  });

  $effect(() => {
    app.saveUi(app.uiSnapshot());
  });

  function onContextMenu(e: MouseEvent) {
    // Sin el menú contextual del navegador ("Recargar", "Inspeccionar") en la app empaquetada.
    if (isTauri && !import.meta.env.DEV && !isTypingTarget(e.target)) e.preventDefault();
  }
</script>

<svelte:window onkeydown={(e) => handleGlobalKey(e, app)} oncontextmenu={onContextMenu} />

<div class="app" style:font-size="{app.fontSize}px">
  {#if app.loadError}
    <div class="center">
      <div class="message">
        <strong>No se pudieron cargar tus datos</strong>
        <p>{app.loadError}</p>
      </div>
    </div>
  {:else if app.ready}
    <TabBar />
    <div class="main">
      {#if app.showSidebar}
        <Sidebar />
      {/if}
      <Editor />
      {#if app.showDetail && app.activeProject}
        <DetailPanel />
      {/if}
    </div>
    <StatusBar />
    {#if app.palette}
      <CommandPalette />
    {/if}
    {#if app.settingsOpen}
      <Settings />
    {/if}
    {#if app.searchOpen}
      <GlobalSearch />
    {/if}
    {#if app.confirmRequest}
      <ConfirmDialog />
    {/if}
    <Toast />
  {/if}
</div>

<style>
  :global(html) {
    background: var(--bg);
  }
  .app {
    position: relative;
    display: flex;
    flex-direction: column;
    height: 100%;
    background: var(--bg);
    color: var(--text2);
    line-height: 1.5;
  }
  .main {
    flex: 1;
    min-height: 0;
    display: flex;
  }
  .center {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 32px;
  }
  .message {
    max-width: 520px;
    color: var(--text);
  }
  .message p {
    color: var(--muted);
    -webkit-user-select: text;
    user-select: text;
  }
</style>
