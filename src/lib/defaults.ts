import type { ColorToken, Status } from './types';

/** Mismos estados que siembra la migración de SQLite (src-tauri/src/db.rs). */
export const DEFAULT_STATUSES: Status[] = [
  { id: 'pendiente', name: 'pendiente', symbol: '○', color: 'muted', sort_order: 0, is_done: false },
  { id: 'proceso', name: 'en proceso', symbol: '●', color: 'blue', sort_order: 1, is_done: false },
  { id: 'bloqueada', name: 'bloqueada', symbol: '■', color: 'red', sort_order: 2, is_done: false },
  { id: 'deploy', name: 'por desplegar', symbol: '◆', color: 'purple', sort_order: 3, is_done: false },
  { id: 'lista', name: 'lista', symbol: '✓', color: 'green', sort_order: 4, is_done: true },
];

export const COLOR_TOKENS: ColorToken[] = ['muted', 'blue', 'cyan', 'green', 'yellow', 'orange', 'red', 'purple'];

export const COLOR_NAMES: Record<ColorToken, string> = {
  muted: 'gris',
  blue: 'azul',
  cyan: 'cian',
  green: 'verde',
  yellow: 'amarillo',
  orange: 'naranja',
  red: 'rojo',
  purple: 'morado',
};

export const SYMBOL_CHOICES = ['○', '●', '◐', '■', '□', '◆', '◇', '▲', '★', '✓', '✗', '→', '…', '!', '?'];

export function colorVar(token: string): string {
  return `var(--c-${COLOR_TOKENS.includes(token as ColorToken) ? token : 'muted'})`;
}

export const PRIORITY_LABEL: Record<number, string> = { 1: 'baja', 2: 'media', 3: 'alta' };
