/**
 * "Timbre" en tiempo real sobre ntfy.sh: solo viajan avisos con números (qué nota llegó,
 * qué equipo publicó su lista), nunca el contenido de las tareas, que sigue en GitHub.
 * El canal es un nombre aleatorio guardado en el repo privado; si el timbre falla,
 * las revisiones periódicas cubren igual.
 */

export const DOORBELL_URL = 'https://ntfy.sh';

export type Ring =
  /** El celular dejó la nota `n` para el equipo `d`. */
  | { t: 'note'; n: number; d: string }
  /** El equipo `d` publicó su lista; `a` = notas que acaba de aplicar. */
  | { t: 'snap'; d: string; a?: number[] };

export function newTopic(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return `tasky-${Array.from(bytes, (b) => (b % 36).toString(36)).join('')}`;
}

export function isValidTopic(topic: unknown): topic is string {
  return typeof topic === 'string' && /^tasky-[a-z0-9]{20,64}$/.test(topic);
}

export function parseRing(raw: string): Ring | null {
  try {
    const outer = JSON.parse(raw) as { event?: string; message?: string };
    // Las líneas de ntfy traen el aviso dentro de `message`.
    const inner = outer && typeof outer.message === 'string' ? JSON.parse(outer.message) : outer;
    if (outer.event && outer.event !== 'message') return null;
    if (!inner || typeof inner.d !== 'string') return null;
    if (inner.t === 'note' && Number.isInteger(inner.n) && inner.n > 0) return { t: 'note', n: inner.n, d: inner.d };
    if (inner.t === 'snap') {
      const a = Array.isArray(inner.a) ? inner.a.filter((x: unknown) => Number.isInteger(x)).slice(0, 100) : undefined;
      return a ? { t: 'snap', d: inner.d, a } : { t: 'snap', d: inner.d };
    }
    return null;
  } catch {
    return null;
  }
}

/** Toca el timbre. Nunca lanza: si falla, las revisiones periódicas lo cubren. */
export async function ring(topic: string, msg: Ring): Promise<void> {
  if (!isValidTopic(topic)) return;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 4000);
  try {
    await fetch(`${DOORBELL_URL}/${topic}`, { method: 'POST', body: JSON.stringify(msg), signal: ctrl.signal, cache: 'no-store' });
  } catch {
    /* sin timbre: queda la revisión periódica */
  } finally {
    clearTimeout(timer);
  }
}

/** Escucha el timbre. Devuelve una función para dejar de escuchar. */
export function listen(topic: string, onRing: (r: Ring) => void, onLive?: (live: boolean) => void): () => void {
  if (!isValidTopic(topic) || typeof EventSource === 'undefined') {
    onLive?.(false);
    return () => {};
  }
  const source = new EventSource(`${DOORBELL_URL}/${topic}/sse`);
  source.onopen = () => onLive?.(true);
  source.onerror = () => onLive?.(source.readyState === EventSource.OPEN);
  source.onmessage = (e) => {
    const r = parseRing(e.data);
    if (r) onRing(r);
  };
  return () => {
    source.close();
    onLive?.(false);
  };
}
