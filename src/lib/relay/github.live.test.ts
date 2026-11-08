import { describe, expect, it } from 'vitest';
import { DEFAULT_STATUSES } from '../defaults';
import { GitHubRelay } from './github';
import { buildSnapshot } from './notes';

// Prueba contra GitHub de verdad. Solo corre si se define RELAY_LIVE_TOKEN:
//   RELAY_LIVE_TOKEN=... RELAY_LIVE_REPO=usuario/repo npx vitest run github.live
const token = process.env.RELAY_LIVE_TOKEN;
const repo = process.env.RELAY_LIVE_REPO ?? 'AndresL4354/tasky-bandeja';

describe.skipIf(!token)('GitHubRelay (en vivo)', () => {
  it('publica un equipo, entrega una nota y la cierra', async () => {
    const relay = new GitHubRelay(repo, token!);
    await relay.checkAccess();

    const device = { id: 'prueba-automatica', name: 'prueba automática' };
    const snapshot = buildSnapshot(device, { statuses: DEFAULT_STATUSES, projects: [], tasks: [] }, new Date().toISOString());
    await relay.publishDevice(snapshot);
    await relay.publishDevice({ ...snapshot, updated_at: new Date().toISOString() });
    expect((await relay.listDevices()).some((d) => d.id === device.id)).toBe(true);

    const number = await relay.sendNote({
      text: 'Nota de prueba automática ñandú #prueba',
      deviceId: device.id,
      deviceName: device.name,
      projectId: null,
      projectName: 'bandeja',
      createdAt: new Date().toISOString(),
    });
    // El listado filtrado por etiqueta de GitHub tarda unos segundos en reflejar issues nuevos.
    let found;
    for (let i = 0; i < 10 && !found; i++) {
      found = (await relay.listNotes(device.id)).find((n) => n.number === number);
      if (!found) await new Promise((r) => setTimeout(r, 2000));
    }
    expect(found?.text).toBe('Nota de prueba automática ñandú #prueba');

    await relay.ackNote(number, 'Prueba automática: recibida y cerrada.');
    let stillOpen = true;
    for (let i = 0; i < 10 && stillOpen; i++) {
      stillOpen = (await relay.listNotes(device.id)).some((n) => n.number === number);
      if (stillOpen) await new Promise((r) => setTimeout(r, 2000));
    }
    expect(stillOpen).toBe(false);
  }, 60_000);
});
