// Bundles src/phone/entry.mjs into one script (an iife) that iOS JavaScriptCore can load: node scripts/build-phone.mjs [out-file] (default dist/memory-phone.js)
// Needs esbuild (a devDependency: npm install). It sets the global functions and imports nothing at run time.
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

export async function buildPhone(outfile) {
  const result = await build({
    entryPoints: [fileURLToPath(new URL('../src/phone/entry.mjs', import.meta.url))],
    bundle: true, format: 'iife', target: 'es2022', write: outfile !== undefined, outfile, logLevel: 'silent',
  });
  return result.outputFiles?.[0]?.text;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const out = process.argv[2] ?? fileURLToPath(new URL('../dist/memory-phone.js', import.meta.url));
  await buildPhone(out);
  console.log('wrote the phone bundle');
}
