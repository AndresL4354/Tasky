import { uid } from './ids';
import { isMac } from './platform';
import { DEFAULT_RELAY_REPO } from './relay/config';
import { listen, ring, type Ring } from './relay/doorbell';
import { GitHubRelay } from './relay/github';
import { buildSnapshot, snapshotSignature } from './relay/notes';
import type { InboxNote, Relay } from './relay/types';
import { app, type AppState } from './state.svelte';

const CONFIG_KEY = 'phone.config';
const TOKEN_KEY = 'phone.token';
/** Revisión de respaldo (por si se pierde un aviso del timbre). */
const POLL_VISIBLE_MS = 20_000;
const POLL_HIDDEN_MS = 60_000;
/** Espera tras un cambio local antes de publicar la lista (agrupa cambios seguidos). */
const PUBLISH_DEBOUNCE_MS = 1_200;
/** Aunque no cambie nada, se republica de vez en cuando para que el celular vea "visto hace…". */
const HEARTBEAT_MS = 30 * 60_000;

interface PhoneConfig {
  enabled: boolean;
  deviceId: string;
  deviceName: string;
  repo: string;
  /** Notas ya aplicadas aquí (números de issue), para no repetirlas. */
  imported: number[];
  /** Notas aplicadas cuyo cierre en GitHub falló; se reintenta. */
  pendingAck: number[];
}

export type PhoneStatus = 'off' | 'syncing' | 'ok' | 'error';

/** Conexión con la bandeja del celular: recibe notas y cambios, y publica la lista de este equipo. */
export class PhoneSync {
  ready = $state(false);
  enabled = $state(false);
  deviceId = $state('');
  deviceName = $state('');
  repo = $state(DEFAULT_RELAY_REPO);
  hasToken = $state(false);
  status = $state<PhoneStatus>('off');
  /** true cuando el timbre en tiempo real está conectado. */
  live = $state(false);
  lastCheck = $state<string | null>(null);
  lastError = $state<string | null>(null);
  receivedToday = $state(0);

  private token: string | null = null;
  private imported: number[] = [];
  private pendingAck: number[] = [];
  private relay: Relay | null = null;
  private topic: string | null = null;
  private stopListening: (() => void) | null = null;
  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private publishTimer: ReturnType<typeof setTimeout> | null = null;
  private lastSignature = '';
  private lastPublishedAt = 0;
  private receivedDay = '';
  private generation = 0;
  /** Todo lo que toca la bandeja pasa por esta fila, de a uno. */
  private queue: Promise<unknown> = Promise.resolve();
  /** Respuesta a dejar en cada nota aplicada, mientras no se haya podido cerrar. */
  private replies = new Map<number, string>();
  /** Notas aplicadas desde la última publicación (se avisan al celular con el timbre). */
  private appliedSincePublish: number[] = [];

  constructor(private readonly app: AppState) {}

  async init() {
    let cfg: Partial<PhoneConfig> = {};
    const raw = await this.app.db.getLocal(CONFIG_KEY);
    try {
      cfg = raw ? JSON.parse(raw) : {};
    } catch {
      cfg = {};
    }
    this.deviceId = cfg.deviceId || uid().replace(/-/g, '').slice(0, 10);
    this.deviceName = cfg.deviceName || (isMac ? 'mac' : 'pc');
    this.repo = cfg.repo || DEFAULT_RELAY_REPO;
    this.imported = cfg.imported ?? [];
    this.pendingAck = cfg.pendingAck ?? [];
    this.enabled = !!cfg.enabled;
    this.token = await this.app.db.getLocal(TOKEN_KEY);
    this.hasToken = !!this.token;
    if (!raw) await this.saveConfig();

    window.addEventListener('focus', () => void this.sync());
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') void this.sync();
      this.schedulePoll();
    });

    // Publica la lista poco después de cada cambio local, sin esperar a la próxima revisión.
    $effect.root(() => {
      $effect(() => {
        JSON.stringify(this.app.tasks);
        JSON.stringify(this.app.projects);
        JSON.stringify(this.app.statuses);
        void this.deviceName;
        this.schedulePublish();
      });
    });

    this.ready = true;
    this.restart();
  }

  private async saveConfig() {
    const cfg: PhoneConfig = {
      enabled: this.enabled,
      deviceId: this.deviceId,
      deviceName: this.deviceName,
      repo: this.repo,
      imported: this.imported.slice(-500),
      pendingAck: this.pendingAck,
    };
    await this.app.db.setLocal(CONFIG_KEY, JSON.stringify(cfg));
  }

  /** Corre una tarea en la fila, después de las anteriores. */
  private exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.queue.then(fn, fn);
    this.queue = next.catch(() => undefined);
    return next;
  }

  private restart() {
    this.generation++;
    if (this.pollTimer) clearTimeout(this.pollTimer);
    this.pollTimer = null;
    this.stopListening?.();
    this.stopListening = null;
    this.relay = null;
    this.topic = null;
    this.live = false;
    this.lastSignature = '';
    this.lastError = null;
    if (!this.enabled) {
      this.status = 'off';
      return;
    }
    if (!this.token) {
      this.status = 'error';
      this.lastError = 'Falta el token de GitHub.';
      return;
    }
    try {
      this.relay = new GitHubRelay(this.repo, this.token);
    } catch (e) {
      this.status = 'error';
      this.lastError = e instanceof Error ? e.message : String(e);
      return;
    }
    void this.sync();
    void this.connectDoorbell(this.generation);
  }

  private async connectDoorbell(generation: number) {
    try {
      const topic = await this.relay?.doorbellTopic(true);
      if (!topic || generation !== this.generation) return;
      this.topic = topic;
      this.stopListening = listen(
        topic,
        (r) => this.onRing(r),
        (live) => (this.live = live),
      );
    } catch {
      /* sin timbre: queda la revisión periódica */
    }
  }

  private onRing(r: Ring) {
    if (r.t !== 'note' || r.d !== this.deviceId || this.imported.includes(r.n)) return;
    void this.exclusive(async () => {
      if (!this.relay || this.imported.includes(r.n)) return;
      try {
        const note = await this.relay.getNote(r.n);
        if (note && note.deviceId === this.deviceId) {
          await this.applyNotes([note]);
          await this.publish(true);
        }
      } catch {
        /* lo toma la próxima revisión */
      }
    });
  }

  private schedulePoll() {
    if (this.pollTimer) clearTimeout(this.pollTimer);
    this.pollTimer = null;
    if (!this.relay) return;
    const delay = document.visibilityState === 'visible' ? POLL_VISIBLE_MS : POLL_HIDDEN_MS;
    this.pollTimer = setTimeout(() => void this.sync(), delay);
  }

  private schedulePublish() {
    if (!this.relay) return;
    if (this.publishTimer) clearTimeout(this.publishTimer);
    this.publishTimer = setTimeout(() => {
      void this.exclusive(() => this.publish(false)).catch(() => undefined);
    }, PUBLISH_DEBOUNCE_MS);
  }

  async configure(patch: { enabled?: boolean; deviceName?: string; repo?: string; token?: string | null }) {
    if (patch.token !== undefined) {
      this.token = patch.token?.trim() || null;
      await this.app.db.setLocal(TOKEN_KEY, this.token);
      this.hasToken = !!this.token;
    }
    if (patch.deviceName !== undefined && patch.deviceName.trim()) this.deviceName = patch.deviceName.trim().slice(0, 40);
    if (patch.repo !== undefined) this.repo = patch.repo.trim() || DEFAULT_RELAY_REPO;
    if (patch.enabled !== undefined) this.enabled = patch.enabled;
    await this.saveConfig();
    this.restart();
  }

  /** Revisa la bandeja y publica la lista de este equipo. */
  sync(force = false): Promise<void> {
    if (!this.relay) return Promise.resolve();
    return this.exclusive(async () => {
      if (!this.relay) return;
      this.status = 'syncing';
      try {
        const notes = await this.relay.listNotes(this.deviceId);
        await this.applyNotes(notes);
        await this.publish(force);
        this.status = 'ok';
        this.lastError = null;
      } catch (e) {
        this.status = 'error';
        this.lastError = e instanceof Error ? e.message : String(e);
      } finally {
        this.lastCheck = new Date().toISOString();
        this.schedulePoll();
      }
    });
  }

  /** Aplica notas nuevas (crear, cambiar, eliminar) y las cierra en la bandeja. */
  private async applyNotes(notes: InboxNote[]) {
    const relay = this.relay!;
    const created: string[] = [];
    let changed = 0;
    let deleted = 0;
    let missing = 0;
    for (const note of notes) {
      if (this.imported.includes(note.number)) {
        // Ya se aplicó: solo falta cerrarla si antes falló (si no, es demora del listado de GitHub).
        if (!this.pendingAck.includes(note.number)) continue;
      } else {
        let reply: string;
        if (note.kind === 'update') {
          const ok = this.app.applyRemotePatch(note.taskId!, note.patch ?? {});
          if (ok) changed++;
          else missing++;
          reply = ok ? `✓ Cambio aplicado en **${this.deviceName}**.` : `La tarea ya no existe en **${this.deviceName}**; no se aplicó el cambio.`;
        } else if (note.kind === 'delete') {
          const ok = this.app.removeTaskRemote(note.taskId!);
          if (ok) deleted++;
          else missing++;
          reply = ok ? `✓ Eliminada en **${this.deviceName}**.` : `La tarea ya no existía en **${this.deviceName}**.`;
        } else {
          const where = this.app.importRemoteNote(note);
          created.push(where);
          reply = `✓ Agregada en **${this.deviceName}** · proyecto **${where}**.`;
        }
        this.replies.set(note.number, reply);
        this.imported.push(note.number);
        this.pendingAck.push(note.number);
        this.appliedSincePublish.push(note.number);
        await this.saveConfig();
      }
      try {
        await relay.ackNote(note.number, this.replies.get(note.number) ?? `✓ Recibida en **${this.deviceName}**.`);
        this.pendingAck = this.pendingAck.filter((n) => n !== note.number);
        this.replies.delete(note.number);
        await this.saveConfig();
      } catch {
        /* se reintenta en la próxima revisión */
      }
    }

    const total = created.length + changed + deleted;
    if (total) {
      const today = new Date().toDateString();
      if (this.receivedDay !== today) {
        this.receivedDay = today;
        this.receivedToday = 0;
      }
      this.receivedToday += total;
    }
    const parts: string[] = [];
    if (created.length) parts.push(`${created.length === 1 ? '1 nota nueva' : `${created.length} notas nuevas`} → ${[...new Set(created)].join(', ')}`);
    if (changed) parts.push(changed === 1 ? '1 cambio' : `${changed} cambios`);
    if (deleted) parts.push(deleted === 1 ? '1 eliminada' : `${deleted} eliminadas`);
    if (missing) parts.push(missing === 1 ? '1 sobre una tarea que ya no existe' : `${missing} sobre tareas que ya no existen`);
    if (parts.length) this.app.notify(`Desde el celular: ${parts.join(' · ')}`);
  }

  /** Publica la lista si cambió (o si toca el latido) y avisa al celular por el timbre. */
  private async publish(force: boolean) {
    if (!this.relay) return;
    const snapshot = buildSnapshot(
      { id: this.deviceId, name: this.deviceName },
      { statuses: this.app.statuses, projects: this.app.projects, tasks: this.app.tasks },
      new Date().toISOString(),
    );
    const signature = snapshotSignature(snapshot);
    const applied = this.appliedSincePublish;
    const changed = signature !== this.lastSignature;
    if (!force && !changed && !applied.length && Date.now() - this.lastPublishedAt < HEARTBEAT_MS) return;
    if (changed || Date.now() - this.lastPublishedAt >= HEARTBEAT_MS) {
      await this.relay.publishDevice(snapshot);
      this.lastSignature = signature;
      this.lastPublishedAt = Date.now();
    }
    this.appliedSincePublish = [];
    if (this.topic && (changed || applied.length)) {
      void ring(this.topic, applied.length ? { t: 'snap', d: this.deviceId, a: applied } : { t: 'snap', d: this.deviceId });
    }
  }
}

export const phone = new PhoneSync(app);
