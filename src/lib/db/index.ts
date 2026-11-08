import { isTauri } from '../platform';
import type { DataAdapter } from './adapter';
import { MemoryAdapter } from './memory';
import { SqliteAdapter } from './sqlite';

export type { DataAdapter } from './adapter';

/** SQLite dentro de la app de escritorio; memoria + localStorage en el navegador. */
export function createAdapter(): DataAdapter {
  return isTauri ? new SqliteAdapter() : new MemoryAdapter();
}
