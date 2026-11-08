<script lang="ts">
  import { app } from '../lib/state.svelte';
</script>

<div class="toasts" role="status" aria-live="polite">
  {#if app.toast}
    {#key app.toast.id}
      <div class="toast" class:error={app.toast.tone === 'error'}>
        <span>{app.toast.text}</span>
        <button class="icon-btn" aria-label="Cerrar aviso" onclick={() => (app.toast = null)}>×</button>
      </div>
    {/key}
  {/if}
</div>

<style>
  .toasts {
    position: absolute;
    right: 14px;
    bottom: 38px;
    z-index: 70;
    pointer-events: none;
  }
  .toast {
    display: flex;
    align-items: center;
    gap: 10px;
    max-width: 460px;
    padding: 6px 6px 6px 12px;
    background: var(--pop);
    border: 1px solid var(--border);
    border-radius: 6px;
    box-shadow: var(--shadow);
    color: var(--text);
    pointer-events: auto;
    -webkit-user-select: text;
    user-select: text;
  }
  .toast.error {
    border-color: var(--c-red);
  }
</style>
