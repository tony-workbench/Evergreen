// Bundles src/phone/entry.mjs into one script (an iife) that iOS JavaScriptCore can load: node scripts/build-phone.mjs [out-file]
// It sets the six global functions and imports nothing at run time.
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

export const OUT = fileURLToPath(new URL('../dist/recommend-phone.js', import.meta.url));

export async function buildPhone(outfile) {
  const result = await build({
    entryPoints: [fileURLToPath(new URL('../src/phone/entry.mjs', import.meta.url))],
    bundle: true, format: 'iife', target: 'es2022', charset: 'ascii', write: outfile !== undefined, outfile, logLevel: 'silent',
  });
  return result.outputFiles?.[0]?.text;
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('build-phone.mjs')) {
  const out = process.argv[2] ?? OUT;
  await buildPhone(out);
  console.log(`wrote ${out}`);
}
