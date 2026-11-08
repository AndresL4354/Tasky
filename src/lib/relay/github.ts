import { parseRepo } from './config';
import { isValidTopic, newTopic } from './doorbell';
import { NOTE_LABEL, changeLabel, decodeNote, deviceLabel, encodeNoteBody, labelsFor } from './notes';
import { RelayError, type DeviceSnapshot, type InboxNote, type OutgoingNote, type Relay } from './types';

const API = 'https://api.github.com';
const DEVICES_DIR = 'devices';

type Fetch = typeof fetch;

/** Texto UTF-8 → base64 (la API de contenidos lo pide así). */
export function toBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

/**
 * Bandeja sobre un repo privado de GitHub:
 * - cada nota es un issue con la etiqueta `para:<equipo>`; al entregarse se cierra;
 * - cada equipo publica `devices/<id>.json` con sus proyectos y pendientes.
 */
export class GitHubRelay implements Relay {
  private readonly owner: string;
  private readonly repo: string;
  private shas = new Map<string, string>();

  constructor(
    repoFullName: string,
    private readonly token: string,
    private readonly fetchImpl: Fetch = (...args) => fetch(...args),
  ) {
    const parsed = parseRepo(repoFullName);
    if (!parsed) throw new RelayError(`"${repoFullName}" no es un repo válido (usa usuario/repo).`);
    this.owner = parsed.owner;
    this.repo = parsed.repo;
  }

  /**
   * Respuestas GET con su ETag: se vuelven a pedir con If-None-Match y, si no cambiaron,
   * GitHub responde 304, que no cuenta para su límite de consultas.
   */
  private etags = new Map<string, { etag: string; data: unknown }>();
  private topic: string | null = null;

  private async request<T>(path: string, init: RequestInit & { raw?: boolean } = {}): Promise<T> {
    const { raw, ...rest } = init;
    const isGet = (rest.method ?? 'GET').toUpperCase() === 'GET';
    const key = `${raw ? 'raw' : 'json'} ${path}`;
    const cached = isGet ? this.etags.get(key) : undefined;
    let res: Response;
    try {
      res = await this.fetchImpl(`${API}${path}`, {
        ...rest,
        cache: 'no-store',
        headers: {
          Accept: raw ? 'application/vnd.github.raw+json' : 'application/vnd.github+json',
          Authorization: `Bearer ${this.token}`,
          'X-GitHub-Api-Version': '2022-11-28',
          ...(rest.body ? { 'Content-Type': 'application/json' } : {}),
          ...(cached ? { 'If-None-Match': cached.etag } : {}),
          ...rest.headers,
        },
      });
    } catch {
      throw new RelayError('Sin conexión con GitHub.');
    }
    if (res.status === 304 && cached) return cached.data as T;
    if (!res.ok) {
      let detail = '';
      try {
        detail = ((await res.json()) as { message?: string }).message ?? '';
      } catch {
        /* sin cuerpo */
      }
      throw new RelayError(this.explain(res.status, detail), res.status);
    }
    if (res.status === 204) return undefined as T;
    const data = raw ? await res.text() : await res.json();
    const etag = isGet ? res.headers.get('ETag') : null;
    if (etag) this.etags.set(key, { etag, data });
    return data as T;
  }

  private explain(status: number, detail: string): string {
    if (status === 401) return 'El token no es válido o expiró.';
    if (status === 403 && /rate limit/i.test(detail)) return 'GitHub limitó las consultas por un rato; vuelve a intentar en unos minutos.';
    if (status === 403) return 'El token no tiene permiso para esta acción (necesita Contents e Issues de lectura y escritura).';
    if (status === 404) return `No encuentro ${this.owner}/${this.repo}, o el token no tiene acceso a ese repo.`;
    return `GitHub respondió ${status}${detail ? `: ${detail}` : ''}.`;
  }

  private repoPath(rest = ''): string {
    return `/repos/${encodeURIComponent(this.owner)}/${encodeURIComponent(this.repo)}${rest}`;
  }

  async checkAccess(): Promise<void> {
    const info = await this.request<{ permissions?: { push?: boolean } }>(this.repoPath());
    if (info.permissions && info.permissions.push === false) {
      throw new RelayError('El token solo puede leer el repo; necesita permiso de escritura.', 403);
    }
  }

  async listDevices(): Promise<DeviceSnapshot[]> {
    let files: { name: string; type: string }[];
    try {
      files = await this.request(this.repoPath(`/contents/${DEVICES_DIR}`));
    } catch (e) {
      if (e instanceof RelayError && e.status === 404) return [];
      throw e;
    }
    const jsons = files.filter((f) => f.type === 'file' && f.name.endsWith('.json'));
    const snapshots = await Promise.all(
      jsons.map(async (f) => {
        try {
          const text = await this.request<string>(this.repoPath(`/contents/${DEVICES_DIR}/${encodeURIComponent(f.name)}`), { raw: true });
          const s = JSON.parse(text) as DeviceSnapshot;
          return s && s.v === 1 && typeof s.id === 'string' ? s : null;
        } catch {
          return null;
        }
      }),
    );
    return snapshots.filter((s): s is DeviceSnapshot => s !== null).sort((a, b) => a.name.localeCompare(b.name));
  }

  private async currentSha(path: string): Promise<string | undefined> {
    try {
      const file = await this.request<{ sha: string }>(this.repoPath(`/contents/${path}`));
      return file.sha;
    } catch (e) {
      if (e instanceof RelayError && e.status === 404) return undefined;
      throw e;
    }
  }

  async publishDevice(snapshot: DeviceSnapshot): Promise<void> {
    const path = `${DEVICES_DIR}/${snapshot.id}.json`;
    const put = (sha: string | undefined) =>
      this.request<{ content: { sha: string } }>(this.repoPath(`/contents/${path}`), {
        method: 'PUT',
        body: JSON.stringify({
          message: `${snapshot.name}: actualiza su lista`,
          content: toBase64(JSON.stringify(snapshot, null, 1)),
          ...(sha ? { sha } : {}),
        }),
      });
    let sha = this.shas.has(path) ? this.shas.get(path) : await this.currentSha(path);
    try {
      const res = await put(sha);
      this.shas.set(path, res.content.sha);
    } catch (e) {
      // El archivo cambió por otro lado (o el sha guardado es viejo): reintenta una vez.
      if (!(e instanceof RelayError) || (e.status !== 409 && e.status !== 422)) throw e;
      sha = await this.currentSha(path);
      const res = await put(sha);
      this.shas.set(path, res.content.sha);
    }
  }

  async sendNote(note: OutgoingNote): Promise<number> {
    const issue = await this.request<{ number: number }>(this.repoPath('/issues'), {
      method: 'POST',
      body: JSON.stringify({
        title: note.text.slice(0, 250),
        body: encodeNoteBody(note),
        labels: labelsFor(note),
      }),
    });
    return issue.number;
  }

  private async openIssues(label: string) {
    const issues = await this.request<{ number: number; title: string; body: string | null; created_at: string; pull_request?: unknown }[]>(
      this.repoPath(`/issues?state=open&per_page=100&sort=created&direction=asc&labels=${encodeURIComponent(label)}`),
    );
    return issues.filter((i) => !i.pull_request);
  }

  async listNotes(deviceId?: string): Promise<InboxNote[]> {
    const issues = deviceId
      ? (await Promise.all([this.openIssues(deviceLabel(deviceId)), this.openIssues(changeLabel(deviceId))])).flat()
      : await this.openIssues(NOTE_LABEL);
    return issues
      .map((i) => decodeNote(i))
      .filter((n): n is InboxNote => n !== null && (!deviceId || n.deviceId === deviceId))
      .sort((a, b) => a.number - b.number);
  }

  async getNote(number: number): Promise<InboxNote | null> {
    try {
      const issue = await this.request<{ number: number; title: string; body: string | null; created_at: string; state: string; pull_request?: unknown }>(
        this.repoPath(`/issues/${number}`),
      );
      if (issue.state !== 'open' || issue.pull_request) return null;
      return decodeNote(issue);
    } catch (e) {
      if (e instanceof RelayError && (e.status === 404 || e.status === 410)) return null;
      throw e;
    }
  }

  async doorbellTopic(create: boolean): Promise<string | null> {
    if (this.topic) return this.topic;
    const path = this.repoPath('/contents/config.json');
    const read = async (): Promise<string | null> => {
      try {
        const cfg = JSON.parse(await this.request<string>(path, { raw: true })) as { doorbell?: unknown };
        return isValidTopic(cfg.doorbell) ? cfg.doorbell : null;
      } catch (e) {
        if (e instanceof RelayError && e.status === 404) return null;
        if (e instanceof SyntaxError) return null;
        throw e;
      }
    };
    let topic = await read();
    if (!topic && create) {
      const candidate = newTopic();
      try {
        await this.request(path, {
          method: 'PUT',
          body: JSON.stringify({
            message: 'Configura el timbre en tiempo real',
            content: toBase64(JSON.stringify({ v: 1, doorbell: candidate }, null, 1)),
          }),
        });
        topic = candidate;
      } catch (e) {
        // Otro equipo lo creó al mismo tiempo: se usa el suyo.
        if (e instanceof RelayError && (e.status === 409 || e.status === 422)) topic = await read();
        else throw e;
      }
    }
    if (topic) this.topic = topic;
    return topic;
  }

  async ackNote(number: number, message: string): Promise<void> {
    await this.request(this.repoPath(`/issues/${number}/comments`), {
      method: 'POST',
      body: JSON.stringify({ body: message }),
    });
    await this.request(this.repoPath(`/issues/${number}`), {
      method: 'PATCH',
      body: JSON.stringify({ state: 'closed', state_reason: 'completed' }),
    });
  }
}
