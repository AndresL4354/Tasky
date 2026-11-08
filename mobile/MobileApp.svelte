<script lang="ts">
  import { onMount } from 'svelte';
  import { dueInfo, formatShort } from '../src/lib/dates';
  import { colorVar, PRIORITY_LABEL } from '../src/lib/defaults';
  import { normalizeEntry, parseEntry } from '../src/lib/parse';
  import { DEFAULT_RELAY_REPO, NEW_TOKEN_URL, parseRepo } from '../src/lib/relay/config';
  import { DemoRelay } from '../src/lib/relay/demo';
  import { GitHubRelay } from '../src/lib/relay/github';
  import { timeAgo } from '../src/lib/relay/notes';
  import {
    RelayError,
    type DeviceSnapshot,
    type InboxNote,
    type OutgoingNote,
    type Relay,
    type SnapshotTask,
    type TaskPatch,
  } from '../src/lib/relay/types';
  import { listen, ring, type Ring } from '../src/lib/relay/doorbell';
  import TaskEditor from './TaskEditor.svelte';

  type ShownTask = SnapshotTask & { pending: boolean; deleting: boolean };

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

  // Timbre en tiempo real
  let live = $state(false);
  let topic: string | null = null;
  let stopListening: (() => void) | null = null;
  /** Notas que el equipo ya aplicó (el listado de GitHub tarda unos segundos en reflejarlo). */
  let applied = new Set<number>();

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
  const isDone = (statusId: string) => statusById.get(statusId)?.is_done ?? false;

  /** Todo lo que está en camino a este equipo: enviado y todavía sin enviar (sin conexión). */
  const pending = $derived(
    device
      ? [
          ...notes.filter((n) => n.deviceId === device.id).map((n) => ({ ...n, unsent: false })),
          ...store.outbox
            .filter((n) => n.deviceId === device.id)
            .map((n) => ({ ...n, kind: n.kind ?? 'create', number: -1, unsent: true })),
        ]
      : [],
  );

  /** Tareas del equipo con los cambios en camino ya aplicados, para verlos al instante. */
  const shown = $derived.by<ShownTask[]>(() => {
    if (!device) return [];
    const changes = pending.filter((n) => n.kind !== 'create');
    return device.tasks
      .map((t) => {
        const task: ShownTask = { ...t, tags: [...t.tags], pending: false, deleting: false };
        for (const c of changes) {
          if (c.taskId !== t.id) continue;
          task.pending = true;
          if (c.kind === 'delete') task.deleting = true;
          else Object.assign(task, c.patch);
        }
        return task;
      })
      .sort((a, b) => a.sort_order - b.sort_order);
  });

  const projectTasks = $derived(project ? shown.filter((t) => t.project_id === project.id) : []);
  const activeTasks = $derived(projectTasks.filter((t) => !isDone(t.status_id)));
  const doneTasks = $derived(projectTasks.filter((t) => isDone(t.status_id)));
  const activeCount = $derived(shown.filter((t) => !isDone(t.status_id) && !t.deleting).length);

  const countByProject = $derived.by(() => {
    const m = new Map<string, number>();
    for (const t of shown) if (!isDone(t.status_id) && !t.deleting) m.set(t.project_id, (m.get(t.project_id) ?? 0) + 1);
    return m;
  });

  const inTransit = $derived(pending);

  // Edición
  let editing = $state<{ task: ShownTask; line: number } | null>(null);
  let statusFor = $state<ShownTask | null>(null);

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
        notes = [...notes, { ...n, kind: n.kind ?? 'create', number }];
        ringNote(number, n.deviceId);
      } catch {
        rest.push(n);
      }
    }
    store.outbox = rest;
    save();
  }

  let refreshAgain = false;

  async function refresh() {
    if (!relay) return;
    if (loading) {
      // Llegó un aviso mientras se actualizaba: se repite al terminar.
      refreshAgain = true;
      return;
    }
    loading = true;
    loadError = '';
    try {
      await flushOutbox();
      const [d, n] = await Promise.all([relay.listDevices(), relay.listNotes()]);
      devices = d;
      notes = n.filter((x) => !applied.has(x.number));
      loaded = true;
      void connectDoorbell();
    } catch (e) {
      loadError = message(e);
    } finally {
      loading = false;
      if (refreshAgain) {
        refreshAgain = false;
        void refresh();
      }
    }
  }

  async function connectDoorbell() {
    if (!relay || stopListening) return;
    try {
      const t = await relay.doorbellTopic(false);
      if (!t || stopListening) return;
      topic = t;
      stopListening = listen(t, onRing, (v) => (live = v));
    } catch {
      /* sin timbre: queda la revisión periódica */
    }
  }

  function disconnectDoorbell() {
    stopListening?.();
    stopListening = null;
    topic = null;
    live = false;
  }

  function onRing(r: Ring) {
    if (r.t !== 'snap') return;
    if (r.a?.length) {
      for (const n of r.a) applied.add(n);
      notes = notes.filter((x) => !applied.has(x.number));
    }
    void refresh();
  }

  function ringNote(number: number, deviceId: string) {
    if (topic) void ring(topic, { t: 'note', n: number, d: deviceId });
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
      notes = [...notes, { ...note, kind: 'create', number }];
      ringNote(number, note.deviceId);
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

  /** Envía un cambio o una eliminación de una tarea existente. */
  async function sendChange(task: ShownTask, kind: 'update' | 'delete', patch?: TaskPatch) {
    if (!relay || !device) return;
    const projectName = device.projects.find((p) => p.id === task.project_id)?.name ?? null;
    const title = patch?.title ?? task.title;
    const note: OutgoingNote = {
      kind,
      text: `${kind === 'delete' ? 'eliminar' : 'editar'}: ${title}`.slice(0, 250),
      deviceId: device.id,
      deviceName: device.name,
      projectId: task.project_id,
      projectName,
      createdAt: new Date().toISOString(),
      taskId: task.id,
      patch,
    };
    try {
      const number = await relay.sendNote(note);
      notes = [...notes, { ...note, kind, number }];
      ringNote(number, device.id);
      show(kind === 'delete' ? `✓ Se eliminará en ${device.name}` : `✓ Cambio enviado a ${device.name}`, 'ok');
    } catch (e) {
      if (e instanceof RelayError && e.status === 0) {
        store.outbox = [...store.outbox, note];
        save();
        show('Sin conexión: el cambio se enviará cuando vuelvas a tener internet.', 'error');
      } else {
        show(message(e), 'error');
      }
    }
    // Sin timbre, el equipo lo toma en su próxima revisión: se vuelve a mirar en un rato.
    if (!live) setTimeout(() => void refresh(), 25_000);
  }

  function openEditor(task: ShownTask, line: number) {
    if (task.deleting) return;
    editing = { task, line };
  }

  function saveEdit(patch: TaskPatch) {
    const t = editing?.task;
    editing = null;
    if (t) void sendChange(t, 'update', patch);
  }

  function deleteEdited() {
    const t = editing?.task;
    editing = null;
    if (t) void sendChange(t, 'delete');
  }

  function quickStatus(statusId: string) {
    const t = statusFor;
    statusFor = null;
    if (t && t.status_id !== statusId) void sendChange(t, 'update', { status_id: statusId });
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
    disconnectDoorbell();
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
    // Revisión de respaldo (las consultas sin cambios no cuentan para el límite de GitHub).
    const poll = setInterval(() => {
      if (document.visibilityState === 'visible') void refresh();
    }, 15_000);
    return () => {
      mq.removeEventListener('change', applyTheme);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', onOnline);
      clearInterval(clock);
      clearInterval(poll);
      disconnectDoorbell();
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
        {#if live}<span class="live" title="cambios al instante">● en vivo</span>{/if}
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
        <button role="tab" aria-selected={tab === 'ver'} class:on={tab === 'ver'} onclick={() => (tab = 'ver')}>ver · {activeCount}</button>
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
              <span class="t">{n.kind === 'create' ? parseEntry(n.text).title || n.text : n.text}</span>
              <span class="p">{n.unsent ? 'sin enviar' : (n.projectName ?? 'bandeja')}</span>
            </div>
          {:else}
            <p class="muted">nada pendiente de entrega</p>
          {/each}
        </main>
      {:else}
        <main class="list">
          <div class="label">
            {device.name} · {project?.name} · actualizado {timeAgo(device.updated_at, now)} · toca una tarea para editarla
          </div>
          {#snippet taskRow(t: ShownTask, line: number, done: boolean)}
            {@const st = statusById.get(t.status_id)}
            {@const due = dueInfo(t.due_date, done)}
            <div class="task" class:done class:deleting={t.deleting}>
              <span class="prio p{t.priority}" aria-hidden="true"></span>
              <button class="open" onclick={() => openEditor(t, line)} disabled={t.deleting} aria-label="Editar: {t.title}">
                <span class="ln">{line}</span>
                <span class="body">
                  <span class="title">{t.title}</span>
                  {#each t.tags as tag (tag)}<span class="tag">{tag}</span>{/each}
                  {#if due}<span class="due {due.tone}">{due.label}</span>{/if}
                  {#if t.notes?.trim()}<span class="notes-mark" aria-label="tiene notas">¶</span>{/if}
                  {#if t.deleting}<span class="pend">eliminando…</span>{:else if t.pending}<span class="pend">editando…</span>{/if}
                </span>
              </button>
              <button
                class="status"
                style:color={colorVar(st?.color ?? 'muted')}
                onclick={() => (statusFor = t)}
                disabled={t.deleting}
                aria-label="Estado: {st?.name ?? 'desconocido'}. Cambiar estado"
              >
                {st?.symbol ?? '?'}<span class="sname">{st?.name ?? ''}</span>
              </button>
            </div>
          {/snippet}

          {#each activeTasks as t, i (t.id)}
            {@render taskRow(t, i + 1, false)}
          {:else}
            <p class="muted">sin pendientes en este proyecto</p>
          {/each}

          {#if doneTasks.length}
            <div class="label done-label">terminadas hace poco · tócalas para reabrirlas</div>
            {#each doneTasks as t, i (t.id)}
              {@render taskRow(t, activeTasks.length + i + 1, true)}
            {/each}
          {/if}

          {#if flash}<p class="flash {flash.tone}" role="status">{flash.text}</p>{/if}
        </main>
      {/if}
    {/if}
  {/if}
</div>

{#if editing && device}
  <TaskEditor
    task={editing.task}
    line={editing.line}
    projectName={device.projects.find((p) => p.id === editing!.task.project_id)?.name ?? ''}
    statuses={device.statuses}
    onsave={saveEdit}
    ondelete={deleteEdited}
    onclose={() => (editing = null)}
  />
{/if}

{#if statusFor && device}
  <div class="sheet-backdrop">
    <button class="scrim" aria-label="Cerrar" tabindex="-1" onclick={() => (statusFor = null)}></button>
    <div class="status-sheet" role="dialog" aria-modal="true" aria-label="Cambiar estado">
      <p class="sheet-title">{statusFor.title}</p>
      {#each device.statuses as s (s.id)}
        <button class="status-option" class:on={s.id === statusFor.status_id} onclick={() => quickStatus(s.id)}>
          <span class="sym" style:color={colorVar(s.color)}>{s.symbol}</span>
          <span class="name">{s.name}</span>
          {#if s.id === statusFor.status_id}<span class="muted">actual</span>{/if}
        </button>
      {/each}
      <button class="status-option cancel" onclick={() => (statusFor = null)}>cancelar</button>
    </div>
  </div>
{/if}

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
  .live {
    margin-left: 10px;
    color: var(--c-green);
    font-size: 0.78em;
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
    grid-template-columns: 3px minmax(0, 1fr) auto;
    gap: 8px;
    align-items: stretch;
    border-bottom: 1px solid var(--hair);
  }
  .task.done {
    background: color-mix(in srgb, var(--c-green) 11%, transparent);
  }
  .task.deleting .title {
    text-decoration: line-through;
    color: var(--muted);
  }
  .open {
    display: flex;
    gap: 10px;
    align-items: baseline;
    min-width: 0;
    padding: 10px 0;
    text-align: left;
  }
  .open:active {
    background: var(--hover);
  }
  .open:disabled,
  .task .status:disabled {
    opacity: 1;
  }
  .ln {
    flex: none;
    width: 2.4ch;
  }
  .pend {
    color: var(--c-yellow);
    font-size: 0.82em;
  }
  .notes-mark {
    color: var(--muted);
  }
  .done-label {
    margin-top: 22px;
  }
  .sheet-backdrop {
    position: fixed;
    inset: 0;
    z-index: 50;
    display: flex;
    align-items: flex-end;
    justify-content: center;
  }
  .scrim {
    position: absolute;
    inset: 0;
    background: var(--scrim);
  }
  .status-sheet {
    position: relative;
    width: 100%;
    max-width: 640px;
    padding: 12px 12px calc(env(safe-area-inset-bottom) + 12px);
    background: var(--pop);
    border: 1px solid var(--border);
    border-bottom: 0;
    border-radius: 16px 16px 0 0;
  }
  .sheet-title {
    margin: 4px 8px 10px;
    color: var(--muted);
    font-size: 0.88em;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .status-option {
    display: flex;
    align-items: center;
    gap: 12px;
    width: 100%;
    min-height: 48px;
    padding: 0 12px;
    border-radius: 10px;
    color: var(--text);
    text-align: left;
  }
  .status-option.on {
    background: var(--line);
  }
  .status-option .sym {
    width: 1.2em;
    text-align: center;
  }
  .status-option .name {
    flex: 1;
  }
  .status-option.cancel {
    justify-content: center;
    margin-top: 6px;
    color: var(--muted);
    border: 1px solid var(--border);
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
    justify-content: center;
    min-width: 48px;
    max-width: 10ch;
    padding: 8px 2px;
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
