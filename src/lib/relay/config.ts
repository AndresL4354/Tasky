/** Repo privado que hace de bandeja entre el celular y los equipos. */
export const DEFAULT_RELAY_REPO = 'AndresL4354/tasky-bandeja';

/** Dónde vive la app del celular (GitHub Pages del repo público de Tasky). */
export const MOBILE_URL = 'https://andresl4354.github.io/Tasky/';

/** Página de GitHub para crear el token de acceso a la bandeja. */
export const NEW_TOKEN_URL = 'https://github.com/settings/personal-access-tokens/new';

export function parseRepo(full: string): { owner: string; repo: string } | null {
  const m = full
    .trim()
    .replace(/^https?:\/\/github\.com\//i, '')
    .replace(/\.git$/i, '')
    .replace(/\/+$/, '')
    .match(/^([A-Za-z0-9-]+)\/([A-Za-z0-9._-]+)$/);
  return m ? { owner: m[1], repo: m[2] } : null;
}
