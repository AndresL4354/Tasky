<script lang="ts">
  import qrcode from 'qrcode-generator';
  import { onMount } from 'svelte';
  import { phone } from '../lib/phone.svelte';
  import { openExternal } from '../lib/platform';
  import { DEFAULT_RELAY_REPO, MOBILE_URL, NEW_TOKEN_URL } from '../lib/relay/config';
  import { timeAgo } from '../lib/relay/notes';

  let tokenDraft = $state('');
  let editingToken = $state(false);
  let now = $state(Date.now());

  onMount(() => {
    const t = setInterval(() => (now = Date.now()), 10_000);
    return () => clearInterval(t);
  });

  const mobileLink = $derived(phone.repo === DEFAULT_RELAY_REPO ? MOBILE_URL : `${MOBILE_URL}#repo=${encodeURIComponent(phone.repo)}`);

  const qrSvg = $derived.by(() => {
    const qr = qrcode(0, 'M');
    qr.addData(mobileLink);
    qr.make();
    return qr.createSvgTag({ cellSize: 3, margin: 2, scalable: true });
  });

  const statusText = $derived.by(() => {
    void now;
    if (!phone.enabled) return 'desactivado';
    if (phone.status === 'error') return phone.lastError ?? 'error';
    if (phone.status === 'syncing') return 'revisando…';
    const checked = phone.lastCheck ? `revisó ${timeAgo(phone.lastCheck, now)}` : 'conectando…';
    const got = phone.receivedToday ? ` · ${phone.receivedToday} ${phone.receivedToday === 1 ? 'nota recibida' : 'notas recibidas'} hoy` : '';
    const speed = phone.live ? 'en vivo' : 'revisa cada 20 s';
    return `conectado · ${speed} · ${checked}${got}`;
  });

  async function saveToken() {
    if (!tokenDraft.trim()) return;
    await phone.configure({ token: tokenDraft, enabled: true });
    tokenDraft = '';
    editingToken = false;
  }

  function onTokenKey(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault();
      void saveToken();
    }
  }
</script>

<section>
  <h3>celular</h3>
  <p class="hint">
    Recibe las notas que escribes en el iPhone para este equipo y publica sus pendientes en tu bandeja privada de
    GitHub para verlos desde allá.
  </p>

  <div class="row">
    <label class="key" for="phone-enabled">recibir notas del celular</label>
    <input id="phone-enabled" type="checkbox" checked={phone.enabled} onchange={(e) => phone.configure({ enabled: e.currentTarget.checked })} />
  </div>

  <div class="grid">
    <label class="key" for="phone-name">nombre de este equipo</label>
    <input
      id="phone-name"
      class="field"
      value={phone.deviceName}
      placeholder="pc del trabajo"
      maxlength="40"
      onchange={(e) => phone.configure({ deviceName: e.currentTarget.value })}
      spellcheck="false"
    />

    <label class="key" for="phone-repo">bandeja (repo privado)</label>
    <input
      id="phone-repo"
      class="field"
      value={phone.repo}
      onchange={(e) => phone.configure({ repo: e.currentTarget.value })}
      spellcheck="false"
    />

    <label class="key" for="phone-token">token de GitHub</label>
    <div class="token">
      {#if phone.hasToken && !editingToken}
        <span class="saved">guardado en este equipo</span>
        <button class="btn" onclick={() => (editingToken = true)}>cambiar</button>
        <button class="btn" onclick={() => phone.configure({ token: null })}>quitar</button>
      {:else}
        <input
          id="phone-token"
          class="field"
          type="password"
          placeholder="github_pat_…"
          autocomplete="off"
          bind:value={tokenDraft}
          onkeydown={onTokenKey}
        />
        <button class="btn primary" onclick={saveToken}>guardar</button>
        {#if editingToken}<button class="btn" onclick={() => (editingToken = false)}>cancelar</button>{/if}
      {/if}
    </div>
  </div>
  <p class="hint small">
    El token solo necesita acceso al repo de la bandeja, con permisos de <b>Contents</b> e <b>Issues</b> en lectura y
    escritura. <button class="link" onclick={() => openExternal(NEW_TOKEN_URL)}>Crear token en GitHub</button>
  </p>

  <div class="status">
    <span class="dot {phone.enabled ? phone.status : 'off'}" aria-hidden="true">●</span>
    <span class="text">{statusText}</span>
    {#if phone.enabled && phone.hasToken}
      <button class="btn" onclick={() => phone.sync(true)} disabled={phone.status === 'syncing'}>revisar ahora</button>
    {/if}
  </div>

  <div class="mobile">
    <div class="qr" aria-hidden="true">{@html qrSvg}</div>
    <div>
      <p>Escanea con la cámara del iPhone, ábrelo en Safari y usa <b>Compartir → Agregar a inicio</b>.</p>
      <button class="link" onclick={() => openExternal(mobileLink)}>{mobileLink}</button>
      <p class="hint small">En el iPhone pega el mismo token una vez. Cada equipo aparece allá con su nombre.</p>
    </div>
  </div>
</section>

<style>
  section {
    padding: 14px 0;
    border-bottom: 1px solid var(--hair);
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
  .hint.small {
    margin: 8px 0 0;
    font-size: 0.88em;
  }
  b {
    font-weight: 500;
    color: var(--text2);
  }
  .row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    padding: 4px 0 10px;
  }
  .key {
    color: var(--text2);
  }
  .grid {
    display: grid;
    grid-template-columns: max-content minmax(0, 1fr);
    align-items: center;
    gap: 8px 16px;
  }
  .token {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .saved {
    flex: 1;
    color: var(--c-green);
  }
  .btn {
    padding: 3px 10px;
    white-space: nowrap;
  }
  .btn:disabled {
    opacity: 0.5;
    cursor: default;
  }
  .link {
    color: var(--c-blue);
    text-decoration: underline;
    text-underline-offset: 2px;
    word-break: break-all;
  }
  .status {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 14px;
  }
  .status .text {
    flex: 1;
    color: var(--text2);
  }
  .dot.ok {
    color: var(--c-green);
  }
  .dot.syncing {
    color: var(--c-yellow);
  }
  .dot.error {
    color: var(--c-red);
  }
  .dot.off {
    color: var(--muted);
  }
  .mobile {
    display: flex;
    gap: 14px;
    align-items: center;
    margin-top: 14px;
    padding-top: 14px;
    border-top: 1px solid var(--hair);
  }
  .mobile p {
    margin: 0 0 6px;
    color: var(--text2);
  }
  .qr {
    flex: none;
    width: 112px;
    height: 112px;
    padding: 4px;
    background: #fff;
    border-radius: 6px;
  }
  .qr :global(svg) {
    display: block;
    width: 100%;
    height: 100%;
  }
  @media (max-width: 640px) {
    .grid {
      grid-template-columns: 1fr;
    }
  }
</style>
