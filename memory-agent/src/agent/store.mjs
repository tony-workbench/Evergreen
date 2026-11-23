// The memory agent's file: <user folder>/agent.json, through the host's io object (the one the memory store uses).
// Saving writes a temporary file, flushes it, reads it back, renames it over the old file, syncs the folder and reads
// the result, so a crash leaves either the old file or the new one. An invalid file is refused, not repaired.
import { freshState } from './engine.mjs';
import { STATES } from './schema.mjs';

const TOLERATED = ['ENOTSUP', 'EOPNOTSUPP'];
export const AGENT_FILE = 'agent.json';

function valid(s, user) {
  const obj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
  return obj(s) && s.v === 1 && s.user === user && Number.isInteger(s.seq) && typeof s.off === 'boolean'
    && obj(s.evidence) && obj(s.outcomes) && obj(s.extras) && obj(s.processed) && obj(s.stopped) && Array.isArray(s.reviews) && Array.isArray(s.events)
    && Array.isArray(s.memories) && s.memories.every((m) => obj(m) && typeof m.id === 'string' && typeof m.slot === 'string' && STATES.includes(m.state) && Array.isArray(m.versions) && m.versions.length > 0);
}

/** { load() -> state, save(state) }. Both throw when the file cannot be read, is invalid, or cannot be written and read back. */
export function openAgentFile({ io, dir, user }) {
  const path = `${dir}/${AGENT_FILE}`;
  const tmp = `${dir}/.${AGENT_FILE}.tmp`;
  const read = (p) => { try { return io.readFile(p); } catch (e) { if (e && e.code === 'ENOENT') return null; throw e; } };
  return {
    load() {
      io.remove(tmp);
      const text = read(path);
      if (text === null) return freshState(user);
      const state = JSON.parse(text);
      if (state !== null && typeof state === 'object' && state.extras === undefined) state.extras = {};
      if (!valid(state, user)) throw new Error('agent.json is invalid');
      return state;
    },
    save(state) {
      if (!valid(state, user)) throw new Error('agent state is invalid');
      const text = JSON.stringify(state);
      io.remove(tmp);
      io.writeFile(tmp, text);
      io.fsyncFile(tmp);
      if (io.readFile(tmp) !== text) { io.remove(tmp); throw new Error('agent.json could not be written'); }
      io.rename(tmp, path);
      try { io.fsyncDir(dir); } catch (e) { if (!TOLERATED.includes(e && e.code)) throw e; }
      if (io.readFile(path) !== text) throw new Error('agent.json could not be read back');
    },
  };
}
