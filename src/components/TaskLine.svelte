<script lang="ts">
  import { tick, untrack } from 'svelte';
  import { dueInfo } from '../lib/dates';
  import { colorVar, PRIORITY_LABEL } from '../lib/defaults';
  import { app } from '../lib/state.svelte';
  import type { Task } from '../lib/types';
  import StatusPicker from './StatusPicker.svelte';

  let { task, line, selected }: { task: Task; line: number; selected: boolean } = $props();

  const status = $derived(app.statusById.get(task.status_id) ?? app.defaultStatus());
  const done = $derived(status.is_done);
  const due = $derived(dueInfo(task.due_date, done));
  const editing = $derived(app.editingTaskId === task.id);
  const pickerOpen = $derived(app.pickerFor === task.id);

  let draft = $state('');
  let input: HTMLInputElement | undefined = $state();

  $effect(() => {
    if (editing) {
      draft = untrack(() => task.title);
      tick().then(() => {
        input?.focus();
        input?.select();
      });
    }
  });

  function commit() {
    if (app.editingTaskId === task.id) app.commitTitleEdit(task.id, draft);
  }

  function onEditKey(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault();
      commit();
      app.requestFocus('list');
    } else if (e.key === 'Escape') {
      e.preventDefault();
      app.editingTaskId = null;
      app.requestFocus('list');
    }
    e.stopPropagation();
  }

  function selectRow() {
    app.select(task.id);
    app.pickerFor = null;
    app.requestFocus('list');
  }

  function togglePicker() {
    app.select(task.id);
    app.pickerFor = pickerOpen ? null : task.id;
  }
</script>

<div class="row" class:on={selected} class:done data-task={task.id}>
  <span class="prio p{task.priority}" title={task.priority > 1 ? `prioridad ${PRIORITY_LABEL[task.priority]}` : undefined}></span>
  <span class="ln" aria-hidden="true">{line}</span>

  {#if editing}
    <label class="edit">
      <span class="sr-only">Editar tarea</span>
      <input class="ghost-input" bind:this={input} bind:value={draft} onkeydown={onEditKey} onblur={commit} spellcheck="false" />
    </label>
  {:else}
    <button
      class="content"
      onmousedown={(e) => e.preventDefault()}
      onclick={selectRow}
      ondblclick={() => (app.editingTaskId = task.id)}
      aria-current={selected ? 'true' : undefined}
    >
      <span class="title">{task.title}</span>
      {#each task.tags as tag (tag)}
        <span class="tag">{tag}</span>
      {/each}
      {#if due}
        <span class="due {due.tone}">{due.label}</span>
      {/if}
      {#if task.notes.trim()}
        <span class="notes" title="tiene notas">¶</span>
      {/if}
    </button>
  {/if}

  <div class="status-cell" data-picker-anchor={task.id}>
    <button
      class="status"
      style:color={colorVar(status.color)}
      onmousedown={(e) => e.preventDefault()}
      onclick={togglePicker}
      aria-haspopup="listbox"
      aria-expanded={pickerOpen}
      aria-label="Estado: {status.name}. Cambiar estado"
    >
      <span class="sym">{status.symbol}</span>
      <span class="name">{status.name}</span>
    </button>
    {#if pickerOpen}
      <StatusPicker {task} />
    {/if}
  </div>
</div>

<style>
  .row {
    position: relative;
    display: grid;
    grid-template-columns: 3px 52px minmax(0, 1fr) auto;
    align-items: center;
    min-height: 26px;
  }
  .row:hover {
    background: var(--hover);
  }
  .row.on {
    background: var(--line);
  }
  /* Terminadas: fondo verde tenue en vez de tachar, para que se siga leyendo. */
  .row.done {
    background: color-mix(in srgb, var(--c-green) 11%, transparent);
  }
  .row.done:hover {
    background: color-mix(in srgb, var(--c-green) 16%, transparent);
  }
  .row.done.on {
    background: color-mix(in srgb, var(--c-green) 21%, transparent);
  }
  .prio {
    align-self: stretch;
  }
  .prio.p3 {
    background: var(--c-red);
  }
  .prio.p2 {
    background: var(--c-yellow);
  }
  .ln {
    padding-right: 16px;
    text-align: right;
    color: var(--ln);
    font-variant-numeric: tabular-nums;
  }
  .row.on .ln {
    color: var(--ln-active);
  }
  .content {
    display: flex;
    align-items: baseline;
    min-width: 0;
    padding: 2px 12px 2px 0;
    color: var(--text);
  }
  .title {
    flex: 0 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .row.done .title {
    color: var(--text2);
  }
  .tag,
  .due,
  .notes {
    flex: none;
    margin-left: 12px;
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
  .notes {
    color: var(--muted);
  }
  .edit {
    display: flex;
    min-width: 0;
    padding-right: 12px;
  }
  .edit input {
    padding: 1px 0;
    border-bottom: 1px solid var(--c-blue);
  }
  .status-cell {
    position: relative;
    display: flex;
    justify-content: flex-end;
    padding-right: 10px;
  }
  .status {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 16ch;
    max-width: 24ch;
    padding: 1px 10px;
    border-radius: 4px;
  }
  .status:hover,
  .status[aria-expanded='true'] {
    background: var(--chip);
  }
  .sym {
    width: 1em;
    text-align: center;
    flex: none;
  }
  .name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  @media (max-width: 820px) {
    .status {
      min-width: 0;
    }
    .status .name {
      display: none;
    }
  }
</style>
