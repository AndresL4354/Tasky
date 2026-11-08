<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import { addDays, todayISO } from '../src/lib/dates';
  import { colorVar, PRIORITY_LABEL } from '../src/lib/defaults';
  import { normalizeTag } from '../src/lib/parse';
  import type { DeviceSnapshot, SnapshotTask, TaskPatch } from '../src/lib/relay/types';

  let {
    task,
    line,
    projectName,
    statuses,
    onsave,
    ondelete,
    onclose,
  }: {
    task: SnapshotTask;
    line: number;
    projectName: string;
    statuses: DeviceSnapshot['statuses'];
    onsave: (patch: TaskPatch) => void;
    ondelete: () => void;
    onclose: () => void;
  } = $props();

  // Borrador local: copia de la tarea al abrir; se edita aquí y solo se envía lo que cambió.
  const original = untrack(() => ({
    title: task.title,
    status_id: task.status_id,
    priority: task.priority,
    due_date: task.due_date,
    tags: [...task.tags],
    notes: task.notes ?? '',
    notesSupported: task.notes !== undefined,
  }));
  let title = $state(original.title);
  let statusId = $state(original.status_id);
  let priority = $state(original.priority);
  let due = $state(original.due_date ?? '');
  let tags = $state([...original.tags]);
  let notes = $state(original.notes);
  let tagDraft = $state('');
  let confirmDelete = $state(false);
  let error = $state('');
  let sheet: HTMLDivElement | undefined = $state();

  const notesSupported = original.notesSupported;

  onMount(() => {
    sheet?.focus();
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = '';
    };
  });

  function addTag() {
    const tag = normalizeTag(tagDraft);
    if (tag && !tags.includes(tag)) tags = [...tags, tag];
    tagDraft = '';
  }

  function onTagKey(e: KeyboardEvent) {
    if (e.key === 'Enter' || e.key === ',' || e.key === ' ') {
      e.preventDefault();
      addTag();
    }
  }

  function save() {
    if (tagDraft.trim()) addTag();
    const clean = title.trim();
    if (!clean) {
      error = 'El título no puede quedar vacío.';
      return;
    }
    const patch: TaskPatch = {};
    if (clean !== original.title) patch.title = clean;
    if (statusId !== original.status_id) patch.status_id = statusId;
    if (priority !== original.priority) patch.priority = priority;
    const newDue = due || null;
    if (newDue !== original.due_date) patch.due_date = newDue;
    if (tags.join(' ') !== original.tags.join(' ')) patch.tags = tags;
    if (notesSupported && notes !== original.notes) patch.notes = notes;
    if (Object.keys(patch).length === 0) onclose();
    else onsave(patch);
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      onclose();
    }
  }
</script>

<div class="backdrop">
  <div class="sheet" role="dialog" aria-modal="true" aria-label="Editar tarea" tabindex="-1" bind:this={sheet} onkeydown={onKey}>
    <div class="bar">
      <button class="link" onclick={onclose}>cancelar</button>
      <span class="where">Ln {line} · {projectName}</span>
      <button class="link strong" onclick={save}>guardar</button>
    </div>

    <div class="body">
      <label class="lbl" for="ed-title">título</label>
      <textarea id="ed-title" rows="2" bind:value={title} oninput={() => (error = '')}></textarea>
      {#if error}<p class="error" role="alert">{error}</p>{/if}

      <div class="lbl" id="ed-status">estado</div>
      <div class="chips" role="radiogroup" aria-labelledby="ed-status">
        {#each statuses as s (s.id)}
          <button
            class="chip"
            class:on={statusId === s.id}
            role="radio"
            aria-checked={statusId === s.id}
            style:color={statusId === s.id ? colorVar(s.color) : undefined}
            onclick={() => (statusId = s.id)}
          >
            {s.symbol} {s.name}
          </button>
        {/each}
      </div>

      <div class="lbl" id="ed-prio">prioridad</div>
      <div class="seg" role="radiogroup" aria-labelledby="ed-prio">
        {#each [3, 2, 1] as p (p)}
          <button class="chip p{p}" class:on={priority === p} role="radio" aria-checked={priority === p} onclick={() => (priority = p)}>
            {PRIORITY_LABEL[p]}
          </button>
        {/each}
      </div>

      <label class="lbl" for="ed-due">fecha límite</label>
      <div class="row">
        <input id="ed-due" type="date" bind:value={due} />
        {#if due}<button class="chip" onclick={() => (due = '')}>quitar</button>{/if}
      </div>
      <div class="row quick">
        <button class="chip" onclick={() => (due = todayISO())}>hoy</button>
        <button class="chip" onclick={() => (due = addDays(todayISO(), 1))}>mañana</button>
        <button class="chip" onclick={() => (due = addDays(todayISO(), 7))}>+1 semana</button>
      </div>

      <label class="lbl" for="ed-tag">etiquetas</label>
      {#if tags.length}
        <div class="chips">
          {#each tags as tag (tag)}
            <button class="chip tag" aria-label="Quitar {tag}" onclick={() => (tags = tags.filter((t) => t !== tag))}>{tag} ×</button>
          {/each}
        </div>
      {/if}
      <input
        id="ed-tag"
        bind:value={tagDraft}
        onkeydown={onTagKey}
        onblur={() => tagDraft.trim() && addTag()}
        placeholder="+ etiqueta"
        autocapitalize="off"
        autocomplete="off"
        enterkeyhint="done"
      />

      <label class="lbl" for="ed-notes">notas · markdown</label>
      {#if notesSupported}
        <textarea id="ed-notes" rows="7" bind:value={notes} placeholder="- detalles, enlaces, checklist…"></textarea>
      {:else}
        <p class="muted">Actualiza Tasky en ese equipo para ver y editar las notas desde aquí.</p>
      {/if}

      <button
        class="delete"
        class:confirm={confirmDelete}
        onclick={() => (confirmDelete ? ondelete() : (confirmDelete = true))}
      >
        {confirmDelete ? 'toca otra vez para eliminar' : 'eliminar tarea'}
      </button>
    </div>
  </div>
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 50;
    background: var(--scrim);
    display: flex;
    align-items: flex-end;
    justify-content: center;
  }
  .sheet {
    width: 100%;
    max-width: 640px;
    height: calc(100dvh - env(safe-area-inset-top) - 24px);
    display: flex;
    flex-direction: column;
    background: var(--bg);
    border-radius: 16px 16px 0 0;
    border: 1px solid var(--border);
    border-bottom: 0;
    outline: none;
  }
  .bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    min-height: 52px;
    padding: 0 8px;
    border-bottom: 1px solid var(--hair);
  }
  .where {
    color: var(--muted);
    font-size: 0.85em;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .link {
    min-height: 44px;
    padding: 0 10px;
    color: var(--muted);
  }
  .link.strong {
    color: var(--c-blue);
    font-weight: 500;
  }
  .body {
    flex: 1;
    overflow-y: auto;
    padding: 4px 16px calc(env(safe-area-inset-bottom) + 24px);
    -webkit-overflow-scrolling: touch;
  }
  .lbl {
    display: block;
    margin: 16px 0 6px;
    color: var(--muted);
    font-size: 0.82em;
  }
  textarea,
  input {
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
    resize: vertical;
    line-height: 1.5;
  }
  textarea:focus,
  input:focus {
    border-color: var(--c-blue);
  }
  input[type='date'] {
    flex: 1;
    min-height: 44px;
  }
  .chips,
  .row,
  .seg {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .row {
    align-items: center;
    flex-wrap: nowrap;
  }
  .quick {
    margin-top: 6px;
  }
  .seg .chip {
    flex: 1;
  }
  .chip {
    min-height: 40px;
    padding: 6px 12px;
    border: 1px solid var(--border);
    border-radius: 8px;
    color: var(--text2);
    text-align: center;
  }
  .chip.on {
    border-color: var(--c-blue);
    background: var(--line);
    color: var(--text);
  }
  .chip.p3 {
    color: var(--c-red);
  }
  .chip.p2 {
    color: var(--c-yellow);
  }
  .chip.tag {
    color: var(--c-cyan);
  }
  .chips + input {
    margin-top: 8px;
  }
  .error {
    margin: 6px 0 0;
    color: var(--c-red);
    font-size: 0.88em;
  }
  .muted {
    color: var(--muted);
    margin: 0;
  }
  .delete {
    width: 100%;
    min-height: 48px;
    margin-top: 28px;
    border: 1px solid var(--border);
    border-radius: 10px;
    color: var(--c-red);
  }
  .delete.confirm {
    border-color: var(--c-red);
    background: color-mix(in srgb, var(--c-red) 14%, transparent);
  }
</style>
