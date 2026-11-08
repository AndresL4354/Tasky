<script lang="ts">
  import { onMount } from 'svelte';
  import { COLOR_NAMES, COLOR_TOKENS, colorVar } from '../lib/defaults';
  import { keys } from '../lib/platform';
  import { app } from '../lib/state.svelte';
  import type { ThemePref } from '../lib/types';
  import Icon from './Icon.svelte';
  import PhoneSettings from './PhoneSettings.svelte';

  let dialog: HTMLDivElement | undefined = $state();
  let deleting = $state<{ id: string; replacement: string } | null>(null);

  onMount(() => dialog?.focus());

  function close() {
    app.settingsOpen = false;
    app.requestFocus('list');
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      if (deleting) deleting = null;
      else close();
    }
    e.stopPropagation();
  }

  function startDelete(id: string) {
    const other = app.sortedStatuses.find((s) => s.id !== id);
    if (other) deleting = { id, replacement: other.id };
  }

  function usage(id: string) {
    return app.tasks.filter((t) => t.status_id === id).length;
  }

  const themes: [ThemePref, string][] = [
    ['system', 'sistema'],
    ['dark', 'oscuro'],
    ['light', 'claro'],
  ];

  const shortcuts: [string, string][] = [
    ['↑ ↓  ·  j k', 'moverse entre tareas'],
    [keys('Enter'), 'editar la tarea'],
    [keys('Space'), 'avanzar estado'],
    ['S  ·  1–9', 'elegir estado'],
    ['P  ·  !', 'cambiar prioridad'],
    [`${keys('Alt+Up')} ${keys('Alt+Down')}`, 'mover tarea'],
    [`${keys('Mod+N')}  ·  O`, 'nueva tarea'],
    [keys('Mod+Backspace'), 'eliminar tarea'],
    [keys('Mod+Z'), 'deshacer'],
    [keys('Mod+K'), 'paleta de comandos'],
    [keys('Mod+P'), 'ir a proyecto'],
    [keys('Mod+Shift+F'), 'buscar en todos los proyectos'],
    [keys('Mod+F'), 'filtrar el proyecto actual'],
    [keys('Mod+Shift+N'), 'nuevo proyecto'],
    [`${keys('Mod+1')}…9  ·  ${keys('Mod+W')}`, 'pestañas'],
    [`${keys('Mod+B')}  ·  ${keys('Mod+I')}`, 'barra lateral · detalle'],
    [keys('Mod+Shift+H'), 'ocultar terminadas'],
    [`${keys('Mod+=')}  ${keys('Mod+-')}`, 'tamaño del texto'],
  ];
</script>

<div class="overlay">
  <button class="scrim" aria-label="Cerrar ajustes" tabindex="-1" onclick={close}></button>
  <div class="dialog" role="dialog" aria-modal="true" aria-labelledby="settings-title" tabindex="-1" bind:this={dialog} onkeydown={onKey}>
    <div class="head">
      <h2 id="settings-title"><Icon name="gear" size={14} /> ajustes</h2>
      <button class="icon-btn" aria-label="Cerrar ajustes" onclick={close}><Icon name="x" size={10} /></button>
    </div>

    <div class="scroll">
      <section>
        <h3>apariencia</h3>
        <div class="row">
          <span class="key">tema</span>
          <div class="segmented" role="group" aria-label="Tema">
            {#each themes as [value, label] (value)}
              <button class="seg" class:on={app.theme === value} aria-pressed={app.theme === value} onclick={() => (app.theme = value)}>{label}</button>
            {/each}
          </div>
        </div>
        <div class="row">
          <span class="key">tamaño del texto</span>
          <div class="stepper">
            <button class="btn" aria-label="Achicar texto" onclick={() => app.setFontSize(app.fontSize - 1)}>−</button>
            <span class="value">{app.fontSize}px</span>
            <button class="btn" aria-label="Agrandar texto" onclick={() => app.setFontSize(app.fontSize + 1)}>+</button>
          </div>
        </div>
      </section>

      <section>
        <h3>estados</h3>
        <p class="hint">Son los mismos para todos los proyectos. Los marcados como "terminado" se atenúan y se pueden ocultar.</p>
        <div class="statuses">
          {#each app.sortedStatuses as status, i (status.id)}
            <div class="status-row">
              <label class="sr-only" for="sym-{status.id}">Símbolo de {status.name}</label>
              <input
                id="sym-{status.id}"
                class="field sym"
                style:color={colorVar(status.color)}
                value={status.symbol}
                maxlength="2"
                onchange={(e) => e.currentTarget.value.trim() && app.updateStatus(status.id, { symbol: e.currentTarget.value.trim() })}
              />
              <label class="sr-only" for="name-{status.id}">Nombre del estado</label>
              <input
                id="name-{status.id}"
                class="field name"
                value={status.name}
                onchange={(e) => e.currentTarget.value.trim() && app.updateStatus(status.id, { name: e.currentTarget.value.trim() })}
                spellcheck="false"
              />
              <div class="swatches" role="radiogroup" aria-label="Color de {status.name}">
                {#each COLOR_TOKENS as token (token)}
                  <button
                    class="swatch"
                    class:on={status.color === token}
                    style:background={colorVar(token)}
                    role="radio"
                    aria-checked={status.color === token}
                    aria-label={COLOR_NAMES[token]}
                    title={COLOR_NAMES[token]}
                    onclick={() => app.updateStatus(status.id, { color: token })}
                  ></button>
                {/each}
              </div>
              <label class="done">
                <input type="checkbox" checked={status.is_done} onchange={(e) => app.updateStatus(status.id, { is_done: e.currentTarget.checked })} />
                terminado
              </label>
              <div class="actions">
                <button class="icon-btn" aria-label="Subir {status.name}" disabled={i === 0} onclick={() => app.moveStatus(status.id, -1)}><Icon name="up" size={12} /></button>
                <button class="icon-btn" aria-label="Bajar {status.name}" disabled={i === app.sortedStatuses.length - 1} onclick={() => app.moveStatus(status.id, 1)}><Icon name="down" size={12} /></button>
                <button class="icon-btn" aria-label="Eliminar {status.name}" disabled={app.statuses.length <= 1} onclick={() => startDelete(status.id)}><Icon name="trash" size={12} /></button>
              </div>
            </div>
            {#if deleting?.id === status.id}
              {@const n = usage(status.id)}
              <div class="delete-row">
                <span>
                  eliminar "{status.name}"{n ? ` y mover sus ${n} ${n === 1 ? 'tarea' : 'tareas'} a` : ''}
                </span>
                {#if n}
                  <select class="field" bind:value={deleting.replacement} aria-label="Estado de reemplazo">
                    {#each app.sortedStatuses.filter((s) => s.id !== status.id) as s (s.id)}
                      <option value={s.id}>{s.symbol} {s.name}</option>
                    {/each}
                  </select>
                {/if}
                <button
                  class="btn danger"
                  onclick={() => {
                    if (deleting) app.deleteStatus(deleting.id, deleting.replacement);
                    deleting = null;
                  }}>eliminar</button
                >
                <button class="btn" onclick={() => (deleting = null)}>cancelar</button>
              </div>
            {/if}
          {/each}
        </div>
        <button class="btn add" onclick={() => app.addStatus()}><Icon name="plus" size={12} /> agregar estado</button>
      </section>

      <PhoneSettings />

      <section>
        <h3>datos</h3>
        <p class="hint">
          Tus tareas se guardan solo en este equipo ({app.db.kind === 'sqlite' ? 'base SQLite local' : 'almacenamiento del navegador'}).
          Usa un respaldo para guardarlas aparte o llevarlas a otro equipo.
        </p>
        <div class="buttons">
          <button class="btn" onclick={() => app.exportBackup()}>exportar respaldo…</button>
          <button class="btn" onclick={() => app.confirmImportBackup()}>importar respaldo…</button>
        </div>
      </section>

      <section>
        <h3>atajos</h3>
        <dl class="shortcuts">
          {#each shortcuts as [combo, label] (label)}
            <dt class="kbd">{combo}</dt>
            <dd>{label}</dd>
          {/each}
        </dl>
      </section>
    </div>
  </div>
</div>

<style>
  .overlay {
    position: absolute;
    inset: 0;
    z-index: 55;
    display: flex;
    align-items: flex-start;
    justify-content: center;
    padding: 48px 16px 16px;
  }
  .scrim {
    position: absolute;
    inset: 0;
    background: var(--scrim);
    cursor: default;
  }
  .dialog {
    position: relative;
    display: flex;
    flex-direction: column;
    width: 720px;
    max-width: 100%;
    max-height: calc(100% - 24px);
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 8px;
    box-shadow: var(--shadow);
    outline: none;
  }
  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 10px 10px 18px;
    border-bottom: 1px solid var(--hair);
  }
  h2 {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 0;
    color: var(--text);
    font-size: 1em;
    font-weight: 500;
  }
  .scroll {
    overflow-y: auto;
    padding: 4px 18px 18px;
  }
  section {
    padding: 14px 0;
    border-bottom: 1px solid var(--hair);
  }
  section:last-child {
    border-bottom: 0;
  }
  h3 {
    margin: 0 0 10px;
    color: var(--c-purple);
    font-size: 0.95em;
    font-weight: 500;
  }
  h3::before {
    content: '## ';
    color: var(--muted);
  }
  .hint {
    margin: 0 0 12px;
    color: var(--muted);
    font-size: 0.92em;
  }
  .row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    padding: 4px 0;
  }
  .key {
    color: var(--text2);
  }
  .segmented {
    display: flex;
    gap: 6px;
  }
  .seg {
    padding: 3px 12px;
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
  .stepper {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .stepper .btn {
    padding: 1px 10px;
  }
  .value {
    min-width: 4ch;
    text-align: center;
    color: var(--text);
  }
  .statuses {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .status-row {
    display: grid;
    grid-template-columns: 3.2em minmax(0, 1fr) auto auto auto;
    align-items: center;
    gap: 10px;
  }
  .field.sym {
    text-align: center;
    padding: 4px 0;
  }
  .field.name {
    padding: 4px 8px;
  }
  .swatches {
    display: flex;
    gap: 4px;
  }
  .swatch {
    width: 16px;
    height: 16px;
    border-radius: 50%;
    border: 2px solid transparent;
    outline: 1px solid transparent;
  }
  .swatch.on {
    border-color: var(--panel);
    outline-color: var(--text);
  }
  .done {
    display: flex;
    align-items: center;
    gap: 6px;
    color: var(--text2);
    white-space: nowrap;
  }
  .actions {
    display: flex;
    gap: 2px;
  }
  .actions :global(button:disabled) {
    opacity: 0.35;
    cursor: default;
    background: none;
  }
  .delete-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    padding: 8px 10px;
    border: 1px solid var(--c-red);
    border-radius: 4px;
    color: var(--text);
  }
  .delete-row select {
    width: auto;
  }
  .add {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    margin-top: 10px;
  }
  .buttons {
    display: flex;
    gap: 8px;
  }
  .shortcuts {
    display: grid;
    grid-template-columns: max-content 1fr;
    gap: 4px 24px;
    margin: 0;
  }
  .shortcuts dd {
    margin: 0;
    color: var(--text2);
  }
  @media (max-width: 760px) {
    .status-row {
      grid-template-columns: 3.2em minmax(0, 1fr) auto;
    }
    .swatches {
      grid-column: 1 / -1;
    }
  }
</style>
