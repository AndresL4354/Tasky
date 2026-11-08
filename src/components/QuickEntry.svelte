<script lang="ts">
  import { formatShort } from '../lib/dates';
  import { PRIORITY_LABEL } from '../lib/defaults';
  import { parseEntry } from '../lib/parse';
  import { app } from '../lib/state.svelte';

  let { line }: { line: number } = $props();

  let text = $state('');
  let input: HTMLInputElement | undefined = $state();

  export function focus() {
    input?.focus();
  }

  const preview = $derived.by(() => {
    if (!text.trim()) return [];
    const p = parseEntry(text);
    const tokens: { text: string; cls: string }[] = [{ text: p.title || '(sin título)', cls: 'title' }];
    for (const t of p.tags) tokens.push({ text: t, cls: 'tag' });
    if (p.priority && p.priority > 1) tokens.push({ text: `!${PRIORITY_LABEL[p.priority]}`, cls: `prio p${p.priority}` });
    if (p.due) tokens.push({ text: `@${formatShort(p.due)}`, cls: 'due' });
    return tokens.length > 1 || p.title !== text.trim() ? tokens : [];
  });

  function onKey(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      if (app.createTaskFromEntry(text)) text = '';
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      text = '';
      app.requestFocus('list');
    } else if (e.key === 'ArrowUp' && !text) {
      e.preventDefault();
      app.selectEdge('last');
      app.requestFocus('list');
    }
  }
</script>

<div class="row">
  <span></span>
  <span class="ln">{line}</span>
  <label class="entry">
    <span class="sr-only">Nueva tarea</span>
    <input
      class="ghost-input"
      bind:this={input}
      bind:value={text}
      onkeydown={onKey}
      placeholder="escribe una tarea…   #etiqueta  !alta  @15/11"
      spellcheck="false"
    />
  </label>
  <span class="hint">{text.trim() ? '↵ crear' : ''}</span>
</div>
{#if preview.length}
  <div class="preview" aria-live="polite">
    <span class="arrow">→</span>
    {#each preview as token, i (i)}
      <span class={token.cls}>{token.text}</span>
    {/each}
  </div>
{/if}

<style>
  .row {
    display: grid;
    grid-template-columns: 3px 52px minmax(0, 1fr) auto;
    align-items: center;
    min-height: 26px;
  }
  .ln {
    padding-right: 16px;
    text-align: right;
    color: var(--ln);
  }
  .row:focus-within .ln {
    color: var(--ln-active);
  }
  .row:focus-within {
    background: var(--line);
  }
  .entry {
    display: flex;
    min-width: 0;
    padding-right: 12px;
  }
  .hint {
    padding-right: 20px;
    color: var(--muted);
    font-size: 0.85em;
  }
  .preview {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 2px 12px;
    padding: 2px 16px 0 55px;
    font-size: 0.9em;
  }
  .arrow,
  .due {
    color: var(--muted);
  }
  .title {
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
  .due {
    color: var(--c-yellow);
  }
</style>
