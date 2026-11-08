<script lang="ts">
  import { addDays, formatShort, todayISO } from '../lib/dates';
  import { colorVar, PRIORITY_LABEL } from '../lib/defaults';
  import { keys } from '../lib/platform';
  import { app } from '../lib/state.svelte';
  import type { Priority, Task } from '../lib/types';
  import Icon from './Icon.svelte';

  const task = $derived(app.selectedTask);
  const status = $derived(task ? app.statusById.get(task.status_id) : undefined);
  const line = $derived(app.selectedIndex >= 0 ? app.selectedIndex + 1 : null);

  let tagDraft = $state('');
  let before: Task | null = null;

  function startText(t: Task) {
    before = app.snapshotTask(t.id);
  }
  function endText(label: string) {
    if (before) app.recordEdit(label, before);
    before = null;
  }

  function stamp(iso: string | null) {
    if (!iso) return '';
    return formatShort(iso.slice(0, 10), todayISO(), true);
  }

  function onFieldKey(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      (e.currentTarget as HTMLElement).blur();
      app.requestFocus('list');
    }
  }

  function onTagKey(e: KeyboardEvent, t: Task) {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      e.stopPropagation();
      if (app.addTag(t.id, tagDraft)) tagDraft = '';
    } else {
      onFieldKey(e);
    }
  }

  const priorities: Priority[] = [3, 2, 1];
</script>

<aside class="detail" aria-label="Detalle de la tarea">
  <div class="head">
    <span class="label">detalle{line ? ` · Ln ${line}` : ''}</span>
    <button class="icon-btn" aria-label="Cerrar el panel de detalle" title={keys('Mod+I')} onclick={() => (app.showDetail = false)}>
      <Icon name="x" size={10} />
    </button>
  </div>

  {#if task}
    {#key task.id}
      <div class="body">
        <label class="group">
          <span class="label">título</span>
          <input
            class="field"
            value={task.title}
            oninput={(e) => app.updateTask(task.id, { title: e.currentTarget.value }, { debounce: true })}
            onfocus={() => startText(task)}
            onblur={() => endText('editar título')}
            onkeydown={onFieldKey}
            spellcheck="false"
          />
        </label>

        <label class="group">
          <span class="label">estado</span>
          <div class="select-wrap">
            <span class="sym" style:color={status ? colorVar(status.color) : undefined}>{status?.symbol}</span>
            <select class="field" value={task.status_id} onchange={(e) => app.setStatus(task.id, e.currentTarget.value)} onkeydown={onFieldKey}>
              {#each app.sortedStatuses as s (s.id)}
                <option value={s.id}>{s.name}</option>
              {/each}
            </select>
          </div>
        </label>

        <div class="group" role="group" aria-label="Prioridad">
          <span class="label">prioridad</span>
          <div class="segmented">
            {#each priorities as p (p)}
              <button class="seg p{p}" class:on={task.priority === p} aria-pressed={task.priority === p} onclick={() => app.setPriority(task.id, p)}>
                {PRIORITY_LABEL[p]}
              </button>
            {/each}
          </div>
        </div>

        <div class="group">
          <label class="label" for="due-{task.id}">fecha límite</label>
          <input
            id="due-{task.id}"
            class="field"
            type="date"
            value={task.due_date ?? ''}
            onchange={(e) => app.updateTask(task.id, { due_date: e.currentTarget.value || null }, { undo: 'cambiar fecha' })}
            onkeydown={onFieldKey}
          />
          <div class="quick">
            <button class="text-btn" onclick={() => app.updateTask(task.id, { due_date: todayISO() }, { undo: 'cambiar fecha' })}>hoy</button>
            <button class="text-btn" onclick={() => app.updateTask(task.id, { due_date: addDays(todayISO(), 1) }, { undo: 'cambiar fecha' })}>mañana</button>
            <button class="text-btn" onclick={() => app.updateTask(task.id, { due_date: addDays(todayISO(), 7) }, { undo: 'cambiar fecha' })}>+1 semana</button>
            {#if task.due_date}
              <button class="text-btn" onclick={() => app.updateTask(task.id, { due_date: null }, { undo: 'quitar fecha' })}>quitar</button>
            {/if}
          </div>
        </div>

        <div class="group">
          <label class="label" for="tag-{task.id}">etiquetas</label>
          {#if task.tags.length}
            <div class="tags">
              {#each task.tags as tag (tag)}
                <span class="tag">
                  <button class="tag-name" title="buscar {tag} en todos los proyectos" onclick={() => app.openSearch(tag)}>{tag}</button>
                  <button class="tag-remove" aria-label="Quitar {tag}" title="quitar etiqueta" onclick={() => app.removeTag(task.id, tag)}>
                    <Icon name="x" size={8} />
                  </button>
                </span>
              {/each}
            </div>
          {/if}
          <input
            id="tag-{task.id}"
            class="field"
            placeholder="+ etiqueta y ↵"
            bind:value={tagDraft}
            onkeydown={(e) => onTagKey(e, task)}
            spellcheck="false"
          />
        </div>

        <label class="group grow">
          <span class="label">notas · markdown</span>
          <textarea
            class="field notes"
            value={task.notes}
            placeholder={'- detalles, enlaces, checklist…\n- [ ] subtarea'}
            oninput={(e) => app.updateTask(task.id, { notes: e.currentTarget.value }, { debounce: true })}
            onfocus={() => startText(task)}
            onblur={() => endText('editar notas')}
            onkeydown={onFieldKey}
            spellcheck="false"
          ></textarea>
        </label>

        <div class="meta">
          <span class="label">
            creada {stamp(task.created_at)}{task.completed_at ? ` · terminada ${stamp(task.completed_at)}` : ''}
          </span>
          <button class="text-btn danger" onclick={() => app.deleteTask(task.id)} title={keys('Mod+Backspace')}>eliminar</button>
        </div>
      </div>
    {/key}
  {:else}
    <p class="empty">selecciona una tarea para ver su detalle</p>
  {/if}
</aside>

<style>
  .detail {
    flex: 0 0 300px;
    min-height: 0;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    background: var(--panel);
    border-left: 1px solid var(--hair);
  }
  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex: none;
    min-height: 32px;
    padding: 0 8px 0 14px;
    border-bottom: 1px solid var(--hair);
  }
  .body {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 14px;
    padding: 14px;
  }
  .group {
    display: flex;
    flex-direction: column;
    gap: 5px;
  }
  .grow {
    flex: 1;
    min-height: 160px;
  }
  .select-wrap {
    position: relative;
  }
  .select-wrap .sym {
    position: absolute;
    left: 9px;
    top: 50%;
    transform: translateY(-50%);
    pointer-events: none;
  }
  .select-wrap select {
    padding-left: 26px;
    appearance: none;
    background-image: linear-gradient(45deg, transparent 50%, var(--muted) 50%), linear-gradient(135deg, var(--muted) 50%, transparent 50%);
    background-position: calc(100% - 14px) 50%, calc(100% - 10px) 50%;
    background-size: 4px 4px;
    background-repeat: no-repeat;
  }
  .segmented {
    display: flex;
    gap: 6px;
  }
  .seg {
    flex: 1;
    padding: 3px 0;
    text-align: center;
    border: 1px solid var(--border);
    border-radius: 4px;
    color: var(--text2);
  }
  .seg:hover {
    background: var(--hover);
  }
  .seg.on {
    background: var(--line);
    border-color: var(--c-blue);
    color: var(--text);
  }
  .seg.p3 {
    color: var(--c-red);
  }
  .seg.p2 {
    color: var(--c-yellow);
  }
  .quick {
    display: flex;
    flex-wrap: wrap;
    gap: 2px;
    margin: 0 -8px;
    font-size: 0.9em;
  }
  .tags {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .tag {
    display: inline-flex;
    align-items: stretch;
    border: 1px solid var(--border);
    border-radius: 4px;
    color: var(--c-cyan);
    overflow: hidden;
  }
  .tag-name {
    padding: 1px 4px 1px 8px;
  }
  .tag-name:hover {
    background: var(--chip);
    text-decoration: underline;
  }
  .tag-remove {
    display: inline-flex;
    align-items: center;
    padding: 0 6px;
    margin-left: 2px;
    border-left: 1px solid var(--border);
    color: var(--muted);
  }
  .tag-remove:hover {
    background: var(--chip);
    color: var(--c-red);
  }
  .notes {
    flex: 1;
    min-height: 140px;
    resize: none;
    line-height: 1.6;
  }
  .meta {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
  }
  .danger {
    color: var(--c-red);
  }
  .danger:hover {
    color: var(--c-red);
  }
  .empty {
    margin: 14px;
    color: var(--muted);
  }
</style>
