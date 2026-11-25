// Portable path helpers (forward slashes, absolute POSIX-style paths). The core store imports no Node module.

export const isAbsolute = (p) => typeof p === 'string' && p.startsWith('/');

/** Join parts with '/', collapsing repeated slashes. No '..' or '.' handling: the store never builds such paths. */
export function join(...parts) {
  const joined = parts.filter((x) => x !== '').join('/').replace(/\/{2,}/g, '/');
  return joined.length > 1 && joined.endsWith('/') ? joined.slice(0, -1) : joined;
}

export function dirname(p) {
  const i = p.lastIndexOf('/');
  return i <= 0 ? '/' : p.slice(0, i);
}

export function basename(p) {
  return p.slice(p.lastIndexOf('/') + 1);
}
