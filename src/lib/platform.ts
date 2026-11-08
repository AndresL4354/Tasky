export const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

export const isMac =
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

/** ⌘ en Mac, Ctrl en Windows/Linux. */
export function modPressed(e: KeyboardEvent | MouseEvent): boolean {
  return isMac ? e.metaKey : e.ctrlKey;
}

/**
 * Muestra un atajo según la plataforma. Usa `Mod`, `Shift`, `Alt` y teclas:
 * `keys('Mod+Shift+N')` → `⌘⇧N` en Mac, `Ctrl+Shift+N` en Windows.
 */
export function keys(combo: string): string {
  const parts = combo.split('+');
  if (isMac) {
    const map: Record<string, string> = {
      Mod: '⌘', Shift: '⇧', Alt: '⌥', Backspace: '⌫', Enter: '↵', Up: '↑', Down: '↓', Esc: 'esc', Space: 'espacio',
    };
    return parts.map((p) => map[p] ?? p).join('');
  }
  const map: Record<string, string> = {
    Mod: 'Ctrl', Backspace: 'Retroceso', Enter: 'Enter', Up: '↑', Down: '↓', Esc: 'Esc', Space: 'Espacio',
  };
  return parts.map((p) => map[p] ?? p).join('+');
}

export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag === 'INPUT') {
    const type = (target as HTMLInputElement).type;
    return !['checkbox', 'radio', 'button', 'submit', 'color', 'range'].includes(type);
  }
  return false;
}
