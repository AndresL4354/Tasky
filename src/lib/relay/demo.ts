import { DEFAULT_STATUSES } from '../defaults';
import type { DeviceSnapshot, InboxNote, OutgoingNote, Relay } from './types';

/** Bandeja en memoria con datos de ejemplo, para probar la app del celular sin GitHub. */
export class DemoRelay implements Relay {
  private notes: InboxNote[] = [];
  private next = 1;
  private devices: DeviceSnapshot[];

  constructor(now = Date.now()) {
    const statuses = DEFAULT_STATUSES.map(({ id, name, symbol, color, sort_order, is_done }) => ({ id, name, symbol, color, sort_order, is_done }));
    const task = (id: string, project_id: string, title: string, status_id: string, priority = 1, tags: string[] = [], due_date: string | null = null) => ({
      id,
      project_id,
      title,
      status_id,
      priority,
      due_date,
      tags,
      sort_order: Number(id.replace(/\D/g, '')),
    });
    this.devices = [
      {
        v: 1,
        id: 'trabajo1',
        name: 'pc del trabajo',
        updated_at: new Date(now - 60_000).toISOString(),
        statuses,
        projects: [
          { id: 'api', name: 'api-backend', sort_order: 1 },
          { id: 'web', name: 'web-app', sort_order: 2 },
        ],
        tasks: [
          { ...task('t1', 'api', 'Implementar login con OAuth', 'proceso', 3, ['#auth']), notes: '## alcance\n- google y github\n- [ ] pantalla de error' },
          { ...task('t6', 'api', 'Configurar CI', 'lista'), completed_at: new Date(now - 86_400_000).toISOString() },
          task('t2', 'api', 'Fix paginación en /orders', 'deploy', 3, ['#bug']),
          task('t3', 'api', 'Documentar API', 'pendiente'),
          task('t4', 'web', 'Error 500 al subir avatar', 'bloqueada', 2, ['#bug']),
          task('t5', 'web', 'Modo oscuro', 'pendiente', 1, ['#ui']),
        ],
      },
      {
        v: 1,
        id: 'casa1',
        name: 'mac de casa',
        updated_at: new Date(now - 3 * 3600_000).toISOString(),
        statuses,
        projects: [
          { id: 'bandeja', name: 'bandeja', sort_order: 1 },
          { id: 'personal', name: 'personal', sort_order: 2 },
        ],
        tasks: [
          task('c1', 'bandeja', 'Idea: modo foco con temporizador', 'pendiente', 1, ['#idea']),
          task('c2', 'personal', 'Preparar charla de Rust', 'proceso', 2, ['#charla']),
        ],
      },
    ];
    this.notes.push({
      kind: 'create',
      number: this.next++,
      text: 'Llamar a soporte de AWS',
      deviceId: 'trabajo1',
      deviceName: 'pc del trabajo',
      projectId: 'api',
      projectName: 'api-backend',
      createdAt: new Date(now - 5 * 60_000).toISOString(),
    });
  }

  private wait() {
    return new Promise((r) => setTimeout(r, 250));
  }

  async checkAccess() {
    await this.wait();
  }
  async listDevices() {
    await this.wait();
    return structuredClone(this.devices);
  }
  async publishDevice(snapshot: DeviceSnapshot) {
    this.devices = [...this.devices.filter((d) => d.id !== snapshot.id), structuredClone(snapshot)];
  }
  async sendNote(note: OutgoingNote) {
    await this.wait();
    const number = this.next++;
    this.notes.push({ ...note, kind: note.kind ?? 'create', number });
    // Simula que el equipo aplica el cambio un rato después.
    if (note.kind === 'update' || note.kind === 'delete') setTimeout(() => this.applyChange(number), 4000);
    return number;
  }
  private applyChange(number: number) {
    const n = this.notes.find((x) => x.number === number);
    if (!n) return;
    this.notes = this.notes.filter((x) => x.number !== number);
    const device = this.devices.find((d) => d.id === n.deviceId);
    const i = device ? device.tasks.findIndex((t) => t.id === n.taskId) : -1;
    if (!device || i < 0) return;
    if (n.kind === 'delete') device.tasks.splice(i, 1);
    else {
      const done = device.statuses.find((s) => s.id === (n.patch?.status_id ?? device.tasks[i].status_id))?.is_done;
      Object.assign(device.tasks[i], n.patch, { completed_at: done ? new Date().toISOString() : null });
    }
    device.updated_at = new Date().toISOString();
  }
  async listNotes(deviceId?: string) {
    await this.wait();
    return this.notes.filter((n) => !deviceId || n.deviceId === deviceId);
  }
  async ackNote(number: number) {
    this.notes = this.notes.filter((n) => n.number !== number);
  }
}
