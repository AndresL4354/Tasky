import { describe, expect, it } from 'vitest';
import { isValidTopic, newTopic, parseRing } from './doorbell';
import { GitHubRelay } from './github';
import { encodeNoteBody } from './notes';

describe('timbre', () => {
  it('genera canales secretos válidos y distintos', () => {
    const a = newTopic();
    expect(isValidTopic(a)).toBe(true);
    expect(newTopic()).not.toBe(a);
    expect(isValidTopic('cualquiera')).toBe(false);
    expect(isValidTopic('tasky-../otro')).toBe(false);
  });

  it('entiende los avisos que llegan de ntfy', () => {
    const wrap = (m: unknown) => JSON.stringify({ event: 'message', topic: 'x', message: JSON.stringify(m) });
    expect(parseRing(wrap({ t: 'note', n: 12, d: 'abc' }))).toEqual({ t: 'note', n: 12, d: 'abc' });
    expect(parseRing(wrap({ t: 'snap', d: 'abc', a: [1, 'x', 2] }))).toEqual({ t: 'snap', d: 'abc', a: [1, 2] });
    expect(parseRing(wrap({ t: 'snap', d: 'abc' }))).toEqual({ t: 'snap', d: 'abc' });
    expect(parseRing(wrap({ t: 'note', n: -1, d: 'abc' }))).toBeNull();
    expect(parseRing(JSON.stringify({ event: 'keepalive' }))).toBeNull();
    expect(parseRing('no es json')).toBeNull();
  });
});

describe('GitHubRelay: tiempo real', () => {
  function fakeFetch(handler: (url: string, init: RequestInit) => Response) {
    const calls: { url: string; headers: Record<string, string>; method: string }[] = [];
    const impl = (async (url: string, init: RequestInit = {}) => {
      calls.push({ url, headers: init.headers as Record<string, string>, method: init.method ?? 'GET' });
      return handler(url.replace('https://api.github.com', ''), init);
    }) as unknown as typeof fetch;
    return { impl, calls };
  }

  it('repite consultas con If-None-Match y reutiliza la respuesta si GitHub dice 304', async () => {
    let n = 0;
    const { impl, calls } = fakeFetch(() => {
      n++;
      return n === 1
        ? new Response(JSON.stringify([]), { status: 200, headers: { ETag: '"abc"' } })
        : new Response(null, { status: 304 });
    });
    const relay = new GitHubRelay('o/r', 'tok', impl);
    expect(await relay.listNotes()).toEqual([]);
    expect(await relay.listNotes()).toEqual([]);
    expect(calls[0].headers['If-None-Match']).toBeUndefined();
    expect(calls[1].headers['If-None-Match']).toBe('"abc"');
  });

  it('pide una nota por número y descarta las cerradas', async () => {
    const body = encodeNoteBody({
      text: 'x',
      deviceId: 'd',
      deviceName: 'mac',
      projectId: null,
      projectName: null,
      createdAt: '',
    });
    const { impl } = fakeFetch((path) => {
      if (path === '/repos/o/r/issues/5') return new Response(JSON.stringify({ number: 5, title: 'x', body, state: 'open' }));
      if (path === '/repos/o/r/issues/6') return new Response(JSON.stringify({ number: 6, title: 'x', body, state: 'closed' }));
      return new Response(JSON.stringify({ message: 'Not Found' }), { status: 404 });
    });
    const relay = new GitHubRelay('o/r', 'tok', impl);
    expect((await relay.getNote(5))?.number).toBe(5);
    expect(await relay.getNote(6)).toBeNull();
    expect(await relay.getNote(7)).toBeNull();
  });

  it('crea el canal del timbre una sola vez y lo recuerda', async () => {
    let stored: string | null = null;
    const { impl, calls } = fakeFetch((path, init) => {
      if (path === '/repos/o/r/contents/config.json' && (init.method ?? 'GET') === 'GET') {
        return stored ? new Response(stored) : new Response(JSON.stringify({ message: 'Not Found' }), { status: 404 });
      }
      if (path === '/repos/o/r/contents/config.json' && init.method === 'PUT') {
        stored = atob(JSON.parse(init.body as string).content);
        return new Response(JSON.stringify({ content: { sha: 's' } }), { status: 201 });
      }
      return new Response('{}', { status: 404 });
    });
    const relay = new GitHubRelay('o/r', 'tok', impl);
    expect(await relay.doorbellTopic(false)).toBeNull();
    const topic = await relay.doorbellTopic(true);
    expect(isValidTopic(topic)).toBe(true);
    expect(await relay.doorbellTopic(true)).toBe(topic);
    expect(calls.filter((c) => c.method === 'PUT')).toHaveLength(1);
    expect(await new GitHubRelay('o/r', 'tok', impl).doorbellTopic(false)).toBe(topic);
  });
});
