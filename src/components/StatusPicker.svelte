<script lang="ts">
  import { onMount } from 'svelte';
  import { colorVar } from '../lib/defaults';
  import { app } from '../lib/state.svelte';
  import type { Task } from '../lib/types';

  let { task }: { task: Task } = $props();

  let el: HTMLDivElement | undefined = $state();
  let active = $state(Math.max(0, app.sortedStatuses.findIndex((s) => s.id === task.status_id)));
  let up = $state(false);

  onMount(() => {
    el?.focus({ preventScroll: true });
    const rect = el?.getBoundingClientRect();
    if (rect && rect.bottom > window.innerHeight - 34) up = true;
  });

  function pick(statusId: string) {
    app.setStatus(task.id, statusId);
    close();
  }

  function close() {
    app.pickerFor = null;
    app.requestFocus('list');
  }

  function onKey(e: KeyboardEvent) {
    const list = app.sortedStatuses;
    if (e.key === 'ArrowDown' || e.key === 'j') active = (active + 1) % list.length;
    else if (e.key === 'ArrowUp' || e.key === 'k') active = (active - 1 + list.length) % list.length;
    else if (e.key === 'Enter' || e.key === ' ') pick(list[active].id);
    else if (e.key === 'Escape' || e.key === 's') close();
    else if (/^Digit[1-9]$/.test(e.code) && list[Number(e.code.slice(5)) - 1]) pick(list[Number(e.code.slice(5)) - 1].id);
    else return;
    e.preventDefault();
    e.stopPropagation();
  }

  function onWindowDown(e: MouseEvent) {
    const anchor = (e.target as HTMLElement | null)?.closest?.('[data-picker-anchor]');
    if (anchor?.getAttribute('data-picker-anchor') !== task.id) app.pickerFor = null;
  }
</script>

<svelte:window onmousedown={onWindowDown} />

<div
  class="picker"
  class:up
  bind:this={el}
  role="listbox"
  tabindex="-1"
  aria-label="Elegir estado"
  aria-activedescendant="st-{task.id}-{active}"
  onkeydown={onKey}
>
  {#each app.sortedStatuses as status, i (status.id)}
    <button
      id="st-{task.id}-{i}"
      class="option"
      class:active={i === active}
      role="option"
      aria-selected={status.id === task.status_id}
      tabindex="-1"
      onmouseenter={() => (active = i)}
      onclick={() => pick(status.id)}
    >
      <span class="sym" style:color={colorVar(status.color)}>{status.symbol}</span>
      <span class="name">{status.name}</span>
      <span class="hint">{status.id === task.status_id ? 'actual' : i < 9 ? i + 1 : ''}</span>
    </button>
  {/each}
</div>

<style>
  .picker {
    position: absolute;
    top: calc(100% + 2px);
    right: 10px;
    z-index: 30;
    min-width: 220px;
    padding: 4px;
    background: var(--pop);
    border: 1px solid var(--border);
    border-radius: 6px;
    box-shadow: var(--shadow);
    outline: none;
  }
  .picker.up {
    top: auto;
    bottom: calc(100% + 2px);
  }
  .option {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    padding: 4px 10px;
    border-radius: 4px;
    color: var(--text);
  }
  .option.active {
    background: var(--hover);
  }
  .sym {
    width: 1em;
    text-align: center;
  }
  .name {
    flex: 1;
  }
  .hint {
    color: var(--muted);
    font-size: 0.85em;
  }
</style>
