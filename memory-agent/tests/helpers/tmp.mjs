import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** A fresh empty temp folder. */
export const makeTmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'tm-test-'));
