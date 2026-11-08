<script lang="ts">
  import { onMount } from 'svelte';
  import { app } from '../lib/state.svelte';

  const req = $derived(app.confirmRequest);
  let confirmBtn: HTMLButtonElement | undefined = $state();

  onMount(() => confirmBtn?.focus());

  function cancel() {
    app.confirmRequest = null;
    app.requestFocus('list');
  }

  async function confirm() {
    const r = app.confirmRequest;
    app.confirmRequest = null;
    app.requestFocus('list');
    await r?.onConfirm();
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      cancel();
    }
    e.stopPropagation();
  }
</script>

{#if req}
  <div class="overlay">
    <button class="scrim" aria-label="Cancelar" tabindex="-1" onclick={cancel}></button>
    <div class="dialog" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title" aria-describedby="confirm-msg" tabindex="-1" onkeydown={onKey}>
      <h2 id="confirm-title">{req.title}</h2>
      <p id="confirm-msg">{req.message}</p>
      <div class="actions">
        <button class="btn" onclick={cancel}>cancelar</button>
        <button class="btn" class:danger={req.danger} class:primary={!req.danger} bind:this={confirmBtn} onclick={confirm}>
          {req.confirmLabel}
        </button>
      </div>
    </div>
  </div>
{/if}

<style>
  .overlay {
    position: absolute;
    inset: 0;
    z-index: 60;
    display: flex;
    align-items: flex-start;
    justify-content: center;
    padding-top: 110px;
  }
  .scrim {
    position: absolute;
    inset: 0;
    background: var(--scrim);
    cursor: default;
  }
  .dialog {
    position: relative;
    width: 440px;
    max-width: calc(100% - 32px);
    padding: 18px 20px 16px;
    background: var(--pop);
    border: 1px solid var(--border);
    border-radius: 8px;
    box-shadow: var(--shadow);
    outline: none;
  }
  h2 {
    margin: 0 0 8px;
    color: var(--text);
    font-size: 1em;
    font-weight: 500;
  }
  p {
    margin: 0 0 18px;
    color: var(--text2);
  }
  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
  }
</style>
