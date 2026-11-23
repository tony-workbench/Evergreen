// The Node wrapper: opens a MemoryStore with Node's file system. For tests and the demo; the phone supplies its own io.
import { MemoryStore } from '../memory-store.mjs';
import { makeNodeIO } from './io-node.mjs';

/** opts: test hooks (writeFile, fsyncFile, rename, remove, fsyncDir), fsImpl and platform configure the Node io; `io` replaces it. */
export function openNodeStore(root, user, opts = {}) {
  return new MemoryStore(root, user, { ...opts, io: opts.io ?? makeNodeIO(opts.fsImpl, opts.platform) });
}
