import { parseRepo } from './config';
import { NOTE_LABEL, decodeNote, deviceLabel, encodeNoteBody } from './notes';
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

  private async request<T>(path: string, init: RequestInit & { raw?: boolean } = {}): Promise<T> {
    const { raw, ...rest } = init;
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
          ...rest.headers,
        },
      });
    } catch {
      throw new RelayError('Sin conexión con GitHub.');
    }
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
    return (raw ? await res.text() : await res.json()) as T;
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
        labels: [NOTE_LABEL, deviceLabel(note.deviceId)],
      }),
    });
    return issue.number;
  }

  async listNotes(deviceId?: string): Promise<InboxNote[]> {
    const labels = deviceId ? deviceLabel(deviceId) : NOTE_LABEL;
    const issues = await this.request<{ number: number; title: string; body: string | null; created_at: string; pull_request?: unknown }[]>(
      this.repoPath(`/issues?state=open&per_page=100&sort=created&direction=asc&labels=${encodeURIComponent(labels)}`),
    );
    return issues
      .filter((i) => !i.pull_request)
      .map((i) => decodeNote(i))
      .filter((n): n is InboxNote => n !== null && (!deviceId || n.deviceId === deviceId));
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
