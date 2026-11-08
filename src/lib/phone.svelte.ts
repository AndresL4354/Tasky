import { uid } from './ids';
import { isMac } from './platform';
import { DEFAULT_RELAY_REPO } from './relay/config';
import { GitHubRelay } from './relay/github';
import { buildSnapshot, snapshotSignature } from './relay/notes';
import type { Relay } from './relay/types';
import { app, type AppState } from './state.svelte';

const CONFIG_KEY = 'phone.config';
const TOKEN_KEY = 'phone.token';
const POLL_MS = 45_000;
/** Aunque no cambie nada, se republica de vez en cuando para que el celular vea "visto hace…". */
const HEARTBEAT_MS = 30 * 60_000;

interface PhoneConfig {
  enabled: boolean;
  deviceId: string;
  deviceName: string;
  repo: string;
  /** Notas ya agregadas aquí (números de issue), para no duplicarlas. */
  imported: number[];
  /** Notas agregadas cuyo cierre en GitHub falló; se reintenta. */
  pendingAck: number[];
}

export type PhoneStatus = 'off' | 'syncing' | 'ok' | 'error';

/** Conexión con la bandeja del celular: recibe notas y publica la lista de este equipo. */
export class PhoneSync {
  ready = $state(false);
  enabled = $state(false);
  deviceId = $state('');
  deviceName = $state('');
  repo = $state(DEFAULT_RELAY_REPO);
  hasToken = $state(false);
  status = $state<PhoneStatus>('off');
  lastCheck = $state<string | null>(null);
  lastError = $state<string | null>(null);
  receivedToday = $state(0);

  private token: string | null = null;
  private imported: number[] = [];
  private pendingAck: number[] = [];
  private relay: Relay | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private lastSignature = '';
  private lastPublishedAt = 0;
  private receivedDay = '';

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

  private restart() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.relay = null;
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
    this.timer = setInterval(() => void this.sync(), POLL_MS);
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
  async sync(force = false) {
    if (!this.relay || this.running) return;
    this.running = true;
    this.status = 'syncing';
    try {
      await this.receive();
      await this.publish(force);
      this.status = 'ok';
      this.lastError = null;
    } catch (e) {
      this.status = 'error';
      this.lastError = e instanceof Error ? e.message : String(e);
    } finally {
      this.lastCheck = new Date().toISOString();
      this.running = false;
    }
  }

  private async receive() {
    const relay = this.relay!;
    const notes = await relay.listNotes(this.deviceId);
    const arrived: string[] = [];
    for (const note of notes) {
      if (this.imported.includes(note.number)) {
        // Ya está aquí: solo falta cerrarla si antes falló (si no, es demora del listado de GitHub).
        if (!this.pendingAck.includes(note.number)) continue;
      } else {
        const where = this.app.importRemoteNote(note);
        arrived.push(where);
        this.imported.push(note.number);
        this.pendingAck.push(note.number);
        await this.saveConfig();
      }
      try {
        await relay.ackNote(note.number, `✓ Agregada en **${this.deviceName}**.`);
        this.pendingAck = this.pendingAck.filter((n) => n !== note.number);
        await this.saveConfig();
      } catch {
        /* se reintenta en la próxima revisión */
      }
    }
    if (arrived.length) {
      const today = new Date().toDateString();
      if (this.receivedDay !== today) {
        this.receivedDay = today;
        this.receivedToday = 0;
      }
      this.receivedToday += arrived.length;
      const where = [...new Set(arrived)].join(', ');
      this.app.notify(`${arrived.length === 1 ? '1 nota' : `${arrived.length} notas`} desde el celular → ${where}`);
    }
  }

  private async publish(force: boolean) {
    const snapshot = buildSnapshot(
      { id: this.deviceId, name: this.deviceName },
      { statuses: this.app.statuses, projects: this.app.projects, tasks: this.app.tasks },
      new Date().toISOString(),
    );
    const signature = snapshotSignature(snapshot);
    if (!force && signature === this.lastSignature && Date.now() - this.lastPublishedAt < HEARTBEAT_MS) return;
    await this.relay!.publishDevice(snapshot);
    this.lastSignature = signature;
    this.lastPublishedAt = Date.now();
  }
}

export const phone = new PhoneSync(app);
