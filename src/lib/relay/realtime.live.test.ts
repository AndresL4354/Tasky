import { describe, expect, it } from 'vitest';
import { DEFAULT_STATUSES } from '../defaults';
import { listen, ring, type Ring } from './doorbell';
import { GitHubRelay } from './github';
import { buildSnapshot } from './notes';

// Mide la demora real celular → equipo con el timbre. Solo corre con RELAY_LIVE_TOKEN.
const token = process.env.RELAY_LIVE_TOKEN;
const repo = process.env.RELAY_LIVE_REPO ?? 'AndresL4354/tasky-bandeja';

describe.skipIf(!token || typeof EventSource === 'undefined')('tiempo real (en vivo)', () => {
  it('una nota llega al equipo en pocos segundos', async () => {
    const device = { id: 'prueba-automatica', name: 'prueba automática' };
    const phone = new GitHubRelay(repo, token!);
    const desktop = new GitHubRelay(repo, token!);
    const topic = (await desktop.doorbellTopic(true))!;
    expect(await phone.doorbellTopic(false)).toBe(topic);

    // El "equipo" escucha el timbre.
    let resolveRing: (r: Ring) => void = () => {};
    const rung = new Promise<Ring>((r) => (resolveRing = r));
    let resolveLive: () => void = () => {};
    const ready = new Promise<void>((r) => (resolveLive = r));
    const stop = listen(
      topic,
      (r) => r.t === 'note' && r.d === device.id && resolveRing(r),
      (live) => live && resolveLive(),
    );
    await ready;

    // El "celular" envía la nota y toca el timbre.
    const t0 = Date.now();
    const number = await phone.sendNote({
      text: 'Prueba de tiempo real',
      deviceId: device.id,
      deviceName: device.name,
      projectId: null,
      projectName: null,
      createdAt: new Date().toISOString(),
    });
    await ring(topic, { t: 'note', n: number, d: device.id });
    const r = await rung;
    const tRing = Date.now() - t0;
    const note = r.t === 'note' ? await desktop.getNote(r.n) : null;
    const tNote = Date.now() - t0;
    stop();
    expect(note?.text).toBe('Prueba de tiempo real');

    // El equipo publica su lista y el celular la lee enseguida.
    const snap = buildSnapshot(device, { statuses: DEFAULT_STATUSES, projects: [], tasks: [] }, new Date().toISOString());
    const t1 = Date.now();
    await desktop.publishDevice(snap);
    const seen = (await phone.listDevices()).find((d) => d.id === device.id);
    const tSnap = Date.now() - t1;
    expect(seen?.updated_at).toBe(snap.updated_at);

    await desktop.ackNote(number, 'Prueba automática de tiempo real: recibida y cerrada.');
    console.log(`timbre: ${tRing} ms · nota leída: ${tNote} ms · lista publicada y leída: ${tSnap} ms`);
  }, 60_000);
});
