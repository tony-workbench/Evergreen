// The shared contract's checker (contract/src/index.mjs), when it can be found: in this repository, in the sibling
// worktree `Evergreen-contract`, or in the folder EVERGREEN_CONTRACT names. `contract` is null when it is absent.
import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join } from 'node:path';

const here = (rel) => fileURLToPath(new URL(rel, import.meta.url));
const places = [process.env.EVERGREEN_CONTRACT, here('../../../contract'), here('../../../../Evergreen-contract/contract')].filter(Boolean);
const found = places.find((p) => existsSync(join(p, 'src', 'index.mjs')));
export const contract = found ? await import(pathToFileURL(join(found, 'src', 'index.mjs')).href) : null;
// With EVERGREEN_STRICT=1 (the final gate) a missing contract is a failure, never a skip.
if (contract === null && process.env.EVERGREEN_STRICT === '1') throw new Error('EVERGREEN_STRICT=1: the contract folder was not found (set EVERGREEN_CONTRACT to it)');
export const noContract = contract === null ? 'the contract folder was not found (set EVERGREEN_CONTRACT to it)' : false;
