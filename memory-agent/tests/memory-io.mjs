// A fake in-memory io object (the contract in src/store/io-node.mjs). It never touches the real disk.
import path from 'node:path';
import { createHash } from 'node:crypto';

export function makeMemoryIO() {
  const nodes = new Map([['/', { type: 'dir', ino: 1 }]]);
  let nextIno = 2;
  const used = new Set();
  const err = (code, p) => Object.assign(new Error(`${code}: ${p}`), { code });
  const norm = (p) => path.posix.normalize(p).replace(/(.)\/+$/, '$1');
  const get = (p) => nodes.get(norm(p));
  const needDir = (p) => { const n = get(path.posix.dirname(norm(p))); if (!n || n.type !== 'dir') throw err('ENOENT', p); };
  const real = (p) => {
    let cur = '/';
    for (const part of norm(p).split('/').filter(Boolean)) {
      const next = path.posix.join(cur, part);
      const n = nodes.get(next);
      if (!n) throw err('ENOENT', p);
      cur = n.type === 'symlink' ? real(n.target) : next;
    }
    return cur;
  };
  const methods = {
    platform: 'posix',
    readFile(p) {
      const n = get(p);
      if (!n) throw err('ENOENT', p);
      if (n.type === 'symlink') throw err('ELOOP', p);
      if (n.type === 'dir') throw err('EISDIR', p);
      return n.text;
    },
    writeFile(p, text) {
      if (get(p)) throw err('EEXIST', p);
      needDir(p);
      nodes.set(norm(p), { type: 'file', text, ino: nextIno++ });
    },
    fsyncFile(p) { if (get(p)?.type !== 'file') throw err('ENOENT', p); },
    fsyncDir(p) { if (get(p)?.type !== 'dir') throw err('ENOENT', p); },
    rename(a, b) {
      const n = get(a);
      if (!n) throw err('ENOENT', a);
      needDir(b);
      nodes.delete(norm(a));
      nodes.set(norm(b), n);
    },
    remove(p) {
      const n = get(p);
      if (!n) return;
      if (n.type === 'dir' && [...nodes.keys()].some((k) => k !== norm(p) && path.posix.dirname(k) === norm(p))) throw err('ENOTEMPTY', p);
      nodes.delete(norm(p));
    },
    mkdir(p) {
      if (get(p)) throw err('EEXIST', p);
      needDir(p);
      nodes.set(norm(p), { type: 'dir', ino: nextIno++ });
    },
    lstat(p) {
      const n = get(p);
      if (!n) throw err('ENOENT', p);
      return { isFile: n.type === 'file', isDirectory: n.type === 'dir', isSymbolicLink: n.type === 'symlink', dev: 0, ino: n.ino };
    },
    realpath: (p) => real(p),
    readdir(p) {
      if (get(p)?.type !== 'dir') throw err('ENOENT', p);
      return [...nodes.entries()].filter(([k]) => k !== norm(p) && path.posix.dirname(k) === norm(p))
        .map(([k, n]) => ({ name: path.posix.basename(k), isDirectory: n.type === 'dir', isSymbolicLink: n.type === 'symlink' }));
    },
    sha256: (text) => createHash('sha256').update(text).digest('hex'),
  };
  const io = {};
  for (const [name, fn] of Object.entries(methods)) {
    io[name] = typeof fn === 'function' ? (...a) => { used.add(name); return fn(...a); } : fn;
  }
  return {
    io,
    used,
    /** Every file as { path: text }, relative to a root. */
    dump: (root) => Object.fromEntries([...nodes.entries()].filter(([k, n]) => n.type === 'file' && k.startsWith(`${root}/`)).map(([k, n]) => [k.slice(root.length + 1), n.text]).sort()),
    exists: (p) => nodes.has(norm(p)),
    plant: (p, text) => nodes.set(norm(p), { type: 'file', text, ino: nextIno++ }),
  };
}
