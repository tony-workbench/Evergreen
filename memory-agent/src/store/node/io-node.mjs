// The Node implementation of the store's io object. This folder (src/store/node/) is the only place that imports
// node:fs and node:crypto; it is used by tests and the demo, never by the core store in src/store/.
// A host that is not Node (for example Swift on the phone) supplies an object with the same methods and passes it
// as `opts.io` to MemoryStore. All methods are synchronous. Errors carry a Node-style `code` (ENOENT, EEXIST, ELOOP, ...).
import fs from 'node:fs';
import { createHash } from 'node:crypto';

/**
 * The io contract (what a host must provide):
 *   platform                 string; 'win32' tolerates the documented directory-sync codes, anything else does not
 *   readFile(path)           text of a file; must not follow a symlink at the last component (ELOOP)
 *   writeFile(path, text)    create a new file exclusively (EEXIST if present), not following a symlink
 *   fsyncFile(path)          flush a file
 *   fsyncDir(path)           flush a directory (raw errors; the store tolerates only the documented codes)
 *   rename(from, to)         atomic replace within one directory
 *   remove(path)             delete a file or symlink; no error when absent
 *   mkdir(path)              create one directory level (EEXIST if present, ENOENT if the parent is missing)
 *   lstat(path)              { isFile, isDirectory, isSymbolicLink, dev, ino } without following links (ENOENT)
 *   realpath(path)           the path with every symlink resolved
 *   readdir(path)            [{ name, isDirectory, isSymbolicLink }]
 *   sha256(text)             lowercase hex digest
 */
export function makeNodeIO(f = fs, platform = process.platform) {
  const NOFOLLOW = fs.constants.O_NOFOLLOW ?? 0;
  const withFd = (p, flags, fn) => {
    const fd = f.openSync(p, flags);
    try { return fn(fd); } finally { f.closeSync(fd); }
  };
  return {
    platform,
    readFile: (p) => withFd(p, fs.constants.O_RDONLY | NOFOLLOW, (fd) => f.readFileSync(fd, 'utf8')),
    writeFile: (p, t) => f.writeFileSync(p, t, { flag: fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | NOFOLLOW }),
    fsyncFile: (p) => withFd(p, fs.constants.O_RDWR | NOFOLLOW, (fd) => f.fsyncSync(fd)),
    fsyncDir: (d) => withFd(d, fs.constants.O_RDONLY, (fd) => f.fsyncSync(fd)),
    rename: (a, b) => f.renameSync(a, b),
    remove: (p) => f.rmSync(p, { force: true }),
    mkdir: (p) => f.mkdirSync(p),
    lstat: (p) => {
      const st = f.lstatSync(p);
      return { isFile: st.isFile(), isDirectory: st.isDirectory(), isSymbolicLink: st.isSymbolicLink(), dev: st.dev, ino: st.ino };
    },
    realpath: (p) => f.realpathSync(p),
    readdir: (p) => f.readdirSync(p, { withFileTypes: true }).map((e) => ({ name: e.name, isDirectory: e.isDirectory(), isSymbolicLink: e.isSymbolicLink() })),
    sha256: (text) => createHash('sha256').update(text).digest('hex'),
  };
}
