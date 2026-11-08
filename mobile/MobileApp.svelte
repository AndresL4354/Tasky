<script lang="ts">
  import { onMount } from 'svelte';
  import { dueInfo, formatShort } from '../src/lib/dates';
  import { colorVar, PRIORITY_LABEL } from '../src/lib/defaults';
  import { normalizeEntry, parseEntry } from '../src/lib/parse';
  import { DEFAULT_RELAY_REPO, NEW_TOKEN_URL, parseRepo } from '../src/lib/relay/config';
  import { DemoRelay } from '../src/lib/relay/demo';
  import { GitHubRelay } from '../src/lib/relay/github';
  import { timeAgo } from '../src/lib/relay/notes';
  import { RelayError, type DeviceSnapshot, type InboxNote, type OutgoingNote, type Relay } from '../src/lib/relay/types';

  const STORE_KEY = 'tasky-movil';
  /** Proyecto "bandeja" que el equipo crea solo si todavía no existe. */
  const BANDEJA = '__bandeja__';

  interface Store {
    repo: string;
    token: string;
    device: string | null;
    projects: Record<string, string>;
    /** Notas que no se pudieron enviar (sin conexión); se reintentan. */
    outbox: OutgoingNote[];
  }

  const params = new URLSearchParams(location.hash.slice(1));
  const demo = params.has('demo');

  function load(): Store {
    const base: Store = { repo: params.get('repo') || DEFAULT_RELAY_REPO, token: '', device: null, projects: {}, outbox: [] };
    if (demo) return base;
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) {
        const s = JSON.parse(raw) as Partial<Store>;
        return { ...base, ...s, repo: s.repo || base.repo, projects: s.projects ?? {}, outbox: Array.isArray(s.outbox) ? s.outbox : [] };
      }
    } catch {
      /* sin almacenamiento */
    }
    return base;
  }

  let store = $state<Store>(load());

  function save() {
    if (demo) return;
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(store));
    } catch {
      /* sin almacenamiento: queda solo en memoria */
    }
  }

  function makeRelay(): Relay | null {
    if (demo) return new DemoRelay();
    if (!store.token) return null;
    try {
      return new GitHubRelay(store.repo, store.token);
    } catch {
      return null;
    }
  }

  let relay = $state<Relay | null>(makeRelay());

  // Conexión
  let repoDraft = $state(store.repo);
  let tokenDraft = $state('');
  let setupError = $state('');
  let connecting = $state(false);

  // Datos
  let devices = $state<DeviceSnapshot[]>([]);
  let notes = $state<InboxNote[]>([]);
  let loading = $state(false);
  let loaded = $state(false);
  let loadError = $state('');
  let now = $state(Date.now());

  // Interfaz
  let tab = $state<'anotar' | 'ver'>('anotar');
  let text = $state('');
  let sending = $state(false);
  let flash = $state<{ text: string; tone: 'ok' | 'error' } | null>(null);
  let showSettings = $state(false);
  let input: HTMLTextAreaElement | undefined = $state();

  const device = $derived(devices.find((d) => d.id === store.device) ?? devices[0] ?? null);

  const projectChips = $derived.by(() => {
    if (!device) return [];
    const list = [...device.projects].sort((a, b) => a.sort_order - b.sort_order).map((p) => ({ id: p.id, name: p.name }));
    return list.some((p) => p.name.toLowerCase() === 'bandeja') ? list : [{ id: BANDEJA, name: 'bandeja' }, ...list];
  });

  const project = $derived.by(() => {
    if (!device) return null;
    const wanted = store.projects[device.id];
    return (
      projectChips.find((c) => c.id === wanted) ??
      projectChips.find((c) => c.name.toLowerCase() === 'bandeja') ??
      projectChips[0] ??
      null
    );
  });

  const statusById = $derived(new Map((device?.statuses ?? []).map((s) => [s.id, s])));

  const tasks = $derived(
    device && project ? device.tasks.filter((t) => t.project_id === project.id).sort((a, b) => a.sort_order - b.sort_order) : [],
  );

  const countByProject = $derived.by(() => {
    const m = new Map<string, number>();
    for (const t of device?.tasks ?? []) m.set(t.project_id, (m.get(t.project_id) ?? 0) + 1);
    return m;
  });

  const inTransit = $derived(
    device
      ? [
          ...notes.filter((n) => n.deviceId === device.id).map((n) => ({ ...n, unsent: false })),
          ...store.outbox.filter((n) => n.deviceId === device.id).map((n) => ({ ...n, number: -1, unsent: true })),
        ]
      : [],
  );

  const preview = $derived.by(() => {
    if (!text.trim()) return [];
    const p = parseEntry(text);
    const tokens: { text: string; cls: string }[] = [{ text: p.title || '(sin título)', cls: 'title' }];
    for (const t of p.tags) tokens.push({ text: t, cls: 'tag' });
    if (p.priority && p.priority > 1) tokens.push({ text: `!${PRIORITY_LABEL[p.priority]}`, cls: `p${p.priority}` });
    if (p.due) tokens.push({ text: `@${formatShort(p.due)}`, cls: 'due' });
    return tokens.length > 1 || p.title !== text.trim() ? tokens : [];
  });

  function message(e: unknown): string {
    return e instanceof Error ? e.message : String(e);
  }

  function show(t: string, tone: 'ok' | 'error') {
    flash = { text: t, tone };
    setTimeout(() => {
      if (flash?.text === t) flash = null;
    }, 3500);
  }

  async function flushOutbox() {
    if (!relay || store.outbox.length === 0) return;
    const rest: OutgoingNote[] = [];
    for (const n of store.outbox) {
      try {
        const number = await relay.sendNote(n);
        notes = [...notes, { ...n, number }];
      } catch {
        rest.push(n);
      }
    }
    store.outbox = rest;
    save();
  }

  async function refresh() {
    if (!relay || loading) return;
    loading = true;
    loadError = '';
    try {
      await flushOutbox();
      const [d, n] = await Promise.all([relay.listDevices(), relay.listNotes()]);
      devices = d;
      notes = n;
      loaded = true;
    } catch (e) {
      loadError = message(e);
    } finally {
      loading = false;
    }
  }

  async function send() {
    const raw = text.trim();
    if (!raw) {
      show('Escribe algo primero.', 'error');
      return;
    }
    if (!relay || !device || !project) return;
    const note: OutgoingNote = {
      text: normalizeEntry(raw),
      deviceId: device.id,
      deviceName: device.name,
      projectId: project.id === BANDEJA ? null : project.id,
      projectName: project.name,
      createdAt: new Date().toISOString(),
    };
    sending = true;
    try {
      const number = await relay.sendNote(note);
      notes = [...notes, { ...note, number }];
      text = '';
      show(`✓ Enviada a ${device.name}`, 'ok');
    } catch (e) {
      if (e instanceof RelayError && e.status === 0) {
        store.outbox = [...store.outbox, note];
        save();
        text = '';
        show('Sin conexión: se enviará cuando vuelvas a tener internet.', 'error');
      } else {
        show(message(e), 'error');
      }
    } finally {
      sending = false;
      input?.focus();
    }
  }

  async function connect() {
    setupError = '';
    if (!parseRepo(repoDraft)) {
      setupError = 'Escribe el repo como usuario/repo.';
      return;
    }
    if (!tokenDraft.trim()) {
      setupError = 'Pega el token de GitHub.';
      return;
    }
    connecting = true;
    try {
      const r = new GitHubRelay(repoDraft.trim(), tokenDraft.trim());
      await r.checkAccess();
      store.repo = repoDraft.trim();
      store.token = tokenDraft.trim();
      save();
      tokenDraft = '';
      showSettings = false;
      relay = r;
      await refresh();
    } catch (e) {
      setupError = message(e);
    } finally {
      connecting = false;
    }
  }

  function disconnect() {
    store.token = '';
    save();
    relay = null;
    devices = [];
    notes = [];
    loaded = false;
    showSettings = false;
  }

  function selectDevice(id: string) {
    store.device = id;
    save();
  }

  function selectProject(id: string) {
    if (!device) return;
    store.projects = { ...store.projects, [device.id]: id };
    save();
  }

  function insert(token: string) {
    const sep = text && !/\s$/.test(text) ? ' ' : '';
    text = `${text}${sep}${token}${token === '#' ? '' : ' '}`;
    input?.focus();
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      void send();
    }
  }

  onMount(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const applyTheme = () => (document.documentElement.className = mq.matches ? 'theme-dark' : 'theme-light');
    applyTheme();
    mq.addEventListener('change', applyTheme);

    if (relay) void refresh();
    const onVisible = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    const onOnline = () => void refresh();
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', onOnline);
    const clock = setInterval(() => (now = Date.now()), 15_000);
    const poll = setInterval(() => {
      if (document.visibilityState === 'visible') void refresh();
    }, 60_000);
    return () => {
      mq.removeEventListener('change', applyTheme);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', onOnline);
      clearInterval(clock);
      clearInterval(poll);
    };
  });
</script>

<div class="app">
  {#if !relay}
    <main class="setup">
      <h1>tasky</h1>
      <p>Conecta el celular con tu bandeja privada de GitHub para anotar en el Tasky de cada equipo.</p>
      <label class="field-label" for="repo">bandeja (repo privado)</label>
      <input id="repo" class="field" bind:value={repoDraft} autocapitalize="off" autocomplete="off" spellcheck="false" />
      <label class="field-label" for="token">token de GitHub</label>
      <input id="token" class="field" type="password" bind:value={tokenDraft} placeholder="github_pat_…" autocomplete="off" />
      {#if setupError}<p class="error" role="alert">{setupError}</p>{/if}
      <button class="primary" onclick={connect} disabled={connecting}>{connecting ? 'conectando…' : 'conectar'}</button>
      <p class="hint">
        Usa el mismo token que pegaste en Tasky de escritorio (Ajustes → celular). Se guarda solo en este celular.
        <a href={NEW_TOKEN_URL} target="_blank" rel="noopener">Crear un token</a>
      </p>
    </main>
  {:else}
    <header>
      <div class="top">
        <span class="brand">tasky{#if demo}<span class="demo"> · demo</span>{/if}</span>
        <span class="fill"></span>
        <button class="icon" aria-label="Actualizar" onclick={refresh} disabled={loading}>
          <svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true" class:spin={loading}><path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9M13.5 2.5v3h-3" /></svg>
        </button>
        <button class="icon" aria-label="Ajustes" aria-expanded={showSettings} onclick={() => (showSettings = !showSettings)}>
          <svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" aria-hidden="true"><circle cx="8" cy="8" r="2.2" /><path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M3.4 12.6l1.4-1.4M11.2 4.8l1.4-1.4" /></svg>
        </button>
      </div>

      {#if showSettings}
        <div class="settings">
          <p>bandeja: <span class="strong">{store.repo}</span></p>
          {#if !demo}<button class="secondary" onclick={disconnect}>cambiar token o desconectar</button>{/if}
        </div>
      {/if}

      {#if devices.length > 0}
        <div class="label">enviar a</div>
        <div class="chips" role="radiogroup" aria-label="Equipo">
          {#each devices as d (d.id)}
            <button class="chip device" class:on={d.id === device?.id} role="radio" aria-checked={d.id === device?.id} onclick={() => selectDevice(d.id)}>
              <span>{d.name}</span>
              <span class="seen">visto {timeAgo(d.updated_at, now)}</span>
            </button>
          {/each}
        </div>
      {/if}
    </header>

    {#if loadError}<p class="banner" role="alert">{loadError}</p>{/if}

    {#if devices.length === 0}
      <main class="empty">
        {#if loading || !loaded}
          <p>cargando tus equipos…</p>
        {:else}
          <p><span class="strong">Todavía no hay equipos.</span></p>
          <p>En Tasky de escritorio abre Ajustes → celular, activa "recibir notas del celular" y pega el token. El equipo aparecerá aquí en menos de un minuto.</p>
        {/if}
      </main>
    {:else if device}
      <div class="tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'anotar'} class:on={tab === 'anotar'} onclick={() => (tab = 'anotar')}>anotar</button>
        <button role="tab" aria-selected={tab === 'ver'} class:on={tab === 'ver'} onclick={() => (tab = 'ver')}>ver · {device.tasks.length}</button>
      </div>

      <div class="label">proyecto</div>
      <div class="chips" role="radiogroup" aria-label="Proyecto">
        {#each projectChips as c (c.id)}
          <button class="chip" class:on={c.id === project?.id} role="radio" aria-checked={c.id === project?.id} onclick={() => selectProject(c.id)}>
            {c.name}{#if tab === 'ver' && countByProject.get(c.id)}<span class="count"> {countByProject.get(c.id)}</span>{/if}
          </button>
        {/each}
      </div>

      {#if tab === 'anotar'}
        <main class="compose">
          <label class="sr-only" for="note">Nueva tarea para {device.name}</label>
          <textarea
            id="note"
            bind:this={input}
            bind:value={text}
            rows="3"
            enterkeyhint="send"
            placeholder="escribe una tarea o idea…"
            onkeydown={onKey}
          ></textarea>
          <div class="marks" aria-label="Insertar marca">
            <button onclick={() => insert('#')}>#etiqueta</button>
            <button onclick={() => insert('!alta')}>!alta</button>
            <button onclick={() => insert('!media')}>!media</button>
            <button onclick={() => insert('@hoy')}>@hoy</button>
            <button onclick={() => insert('@mañana')}>@mañana</button>
          </div>
          {#if preview.length}
            <div class="preview" aria-live="polite">
              <span class="arrow">→</span>
              {#each preview as t, i (i)}<span class={t.cls}>{t.text}</span>{/each}
            </div>
          {/if}
          <button class="primary" onclick={send} disabled={sending}>
            {sending ? 'enviando…' : `enviar a ${device.name}`}
          </button>
          {#if flash}<p class="flash {flash.tone}" role="status">{flash.text}</p>{/if}

          <div class="label">en camino · llegan cuando {device.name} revise su bandeja</div>
          {#each inTransit as n (n.unsent ? `o-${n.createdAt}` : n.number)}
            <div class="transit">
              <span class="dots" aria-hidden="true">…</span>
              <span class="t">{parseEntry(n.text).title || n.text}</span>
              <span class="p">{n.unsent ? 'sin enviar' : (n.projectName ?? 'bandeja')}</span>
            </div>
          {:else}
            <p class="muted">nada pendiente de entrega</p>
          {/each}
        </main>
      {:else}
        <main class="list">
          <div class="label">{device.name} · {project?.name} · actualizado {timeAgo(device.updated_at, now)}</div>
          {#each tasks as t, i (t.id)}
            {@const st = statusById.get(t.status_id)}
            {@const due = dueInfo(t.due_date, false)}
            <div class="task">
              <span class="prio p{t.priority}" aria-hidden="true"></span>
              <span class="ln">{i + 1}</span>
              <span class="body">
                <span class="title">{t.title}</span>
                {#each t.tags as tag (tag)}<span class="tag">{tag}</span>{/each}
                {#if due}<span class="due {due.tone}">{due.label}</span>{/if}
              </span>
              <span class="status" style:color={colorVar(st?.color ?? 'muted')}>
                {st?.symbol ?? '?'}<span class="sname">{st?.name ?? ''}</span>
              </span>
            </div>
          {:else}
            <p class="muted">sin pendientes en este proyecto</p>
          {/each}
        </main>
      {/if}
    {/if}
  {/if}
</div>

<style>
  :global(html),
  :global(body) {
    background: var(--bg);
    height: auto;
    overflow: auto;
  }
  :global(body) {
    -webkit-user-select: auto;
    user-select: auto;
    -webkit-tap-highlight-color: transparent;
  }
  :global(#app) {
    height: auto;
    overflow: visible;
  }
  .app {
    min-height: 100dvh;
    max-width: 640px;
    margin: 0 auto;
    padding: calc(env(safe-area-inset-top) + 10px) 16px calc(env(safe-area-inset-bottom) + 24px);
    color: var(--text2);
    font-size: 15px;
    line-height: 1.5;
  }
  button {
    cursor: pointer;
    text-align: center;
  }
  button:disabled {
    opacity: 0.6;
  }
  .top {
    display: flex;
    align-items: center;
    gap: 4px;
    min-height: 44px;
  }
  .brand {
    color: var(--text);
    font-weight: 500;
    font-size: 1.1em;
  }
  .demo {
    color: var(--c-yellow);
    font-weight: 400;
    font-size: 0.85em;
  }
  .fill {
    flex: 1;
  }
  .icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 44px;
    height: 44px;
    border-radius: 8px;
    color: var(--muted);
  }
  .icon:active {
    background: var(--hover);
  }
  .spin {
    animation: spin 0.8s linear infinite;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
  .settings {
    margin: 4px 0 8px;
    padding: 12px;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--panel);
  }
  .settings p {
    margin: 0 0 10px;
    word-break: break-all;
  }
  .strong {
    color: var(--text);
  }
  .label {
    margin: 14px 0 6px;
    color: var(--muted);
    font-size: 0.82em;
  }
  .chips {
    display: flex;
    gap: 8px;
    overflow-x: auto;
    padding-bottom: 2px;
    scrollbar-width: none;
  }
  .chips::-webkit-scrollbar {
    display: none;
  }
  .chip {
    flex: none;
    min-height: 40px;
    padding: 6px 12px;
    border: 1px solid var(--border);
    border-radius: 8px;
    color: var(--text2);
    white-space: nowrap;
  }
  .chip.on {
    border-color: var(--c-blue);
    background: var(--line);
    color: var(--text);
  }
  .chip.device {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    text-align: left;
    line-height: 1.3;
  }
  .seen,
  .count {
    color: var(--muted);
    font-size: 0.78em;
  }
  .tabs {
    display: flex;
    margin-top: 14px;
    border-bottom: 1px solid var(--hair);
  }
  .tabs button {
    flex: 1;
    min-height: 44px;
    color: var(--muted);
    border-bottom: 2px solid transparent;
  }
  .tabs button.on {
    color: var(--text);
    border-bottom-color: var(--c-blue);
  }
  .compose {
    display: flex;
    flex-direction: column;
    gap: 10px;
    margin-top: 14px;
  }
  textarea,
  .field {
    width: 100%;
    font: inherit;
    font-size: 16px;
    color: var(--text);
    background: var(--input);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 10px 12px;
    outline: none;
  }
  textarea {
    resize: none;
  }
  textarea:focus,
  .field:focus {
    border-color: var(--c-blue);
  }
  textarea::placeholder,
  .field::placeholder {
    color: var(--muted);
  }
  .marks {
    display: flex;
    gap: 6px;
    overflow-x: auto;
    scrollbar-width: none;
  }
  .marks button {
    flex: none;
    min-height: 36px;
    padding: 4px 10px;
    border: 1px solid var(--border);
    border-radius: 6px;
    color: var(--c-cyan);
    font-size: 0.88em;
  }
  .preview {
    display: flex;
    flex-wrap: wrap;
    gap: 2px 10px;
    font-size: 0.88em;
  }
  .arrow {
    color: var(--muted);
  }
  .preview .title {
    color: var(--text);
  }
  .tag {
    color: var(--c-cyan);
  }
  .p3 {
    color: var(--c-red);
  }
  .p2 {
    color: var(--c-yellow);
  }
  .preview .due {
    color: var(--c-yellow);
  }
  .primary {
    min-height: 48px;
    border-radius: 10px;
    background: var(--c-blue);
    color: var(--bg);
    font-weight: 500;
  }
  .secondary {
    min-height: 40px;
    padding: 0 12px;
    border: 1px solid var(--border);
    border-radius: 8px;
    color: var(--text);
  }
  .flash {
    margin: 0;
    font-size: 0.9em;
  }
  .flash.ok {
    color: var(--c-green);
  }
  .flash.error,
  .error {
    color: var(--c-red);
  }
  .banner {
    margin: 10px 0 0;
    padding: 10px 12px;
    border: 1px solid var(--c-red);
    border-radius: 8px;
    color: var(--text);
    font-size: 0.9em;
  }
  .transit {
    display: flex;
    gap: 10px;
    align-items: baseline;
    padding: 6px 0;
    border-bottom: 1px solid var(--hair);
  }
  .dots {
    color: var(--c-yellow);
  }
  .transit .t {
    flex: 1;
    color: var(--text);
    min-width: 0;
  }
  .transit .p {
    color: var(--muted);
    font-size: 0.85em;
  }
  .muted {
    color: var(--muted);
  }
  .list {
    margin-top: 4px;
  }
  .task {
    display: grid;
    grid-template-columns: 3px 2.4ch minmax(0, 1fr) auto;
    gap: 10px;
    align-items: baseline;
    padding: 8px 0;
    border-bottom: 1px solid var(--hair);
  }
  .prio {
    align-self: stretch;
    border-radius: 2px;
  }
  .prio.p3 {
    background: var(--c-red);
  }
  .prio.p2 {
    background: var(--c-yellow);
  }
  .ln {
    color: var(--ln);
    text-align: right;
    font-size: 0.85em;
  }
  .body {
    display: flex;
    flex-wrap: wrap;
    gap: 2px 10px;
  }
  .body .title {
    color: var(--text);
  }
  .due {
    color: var(--muted);
    font-size: 0.88em;
  }
  .due.overdue {
    color: var(--c-red);
  }
  .due.today,
  .due.soon {
    color: var(--c-yellow);
  }
  .status {
    display: flex;
    flex-direction: column;
    align-items: center;
    max-width: 9ch;
    line-height: 1.2;
    text-align: center;
  }
  .sname {
    font-size: 0.68em;
  }
  .count {
    margin-left: 6px;
  }
  .setup {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding-top: 12vh;
  }
  .setup h1 {
    margin: 0 0 4px;
    color: var(--text);
    font-size: 1.6em;
    font-weight: 500;
  }
  .setup p {
    margin: 0 0 12px;
  }
  .field-label {
    margin-top: 6px;
    color: var(--muted);
    font-size: 0.85em;
  }
  .hint {
    color: var(--muted);
    font-size: 0.88em;
  }
  a {
    color: var(--c-blue);
  }
  .empty {
    padding-top: 10vh;
  }
</style>
