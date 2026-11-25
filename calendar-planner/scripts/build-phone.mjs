// Bundles src/phone/entry.mjs into one script (an iife) that iOS JavaScriptCore can load: node scripts/build-phone.mjs [out-file]
// Needs esbuild (a devDependency: npm install). The bundle sets calendarPlan and calendarReplan and imports nothing at run time.
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

export async function buildPhone(outfile) {
  const result = await build({
    entryPoints: [fileURLToPath(new URL('../src/phone/entry.mjs', import.meta.url))],
    bundle: true, format: 'iife', target: 'es2022', write: outfile !== undefined, outfile, logLevel: 'silent',
  });
  return result.outputFiles?.[0]?.text;
}

if (import.meta.url === `file://${process.argv[1]}` || fileURLToPath(import.meta.url) === process.argv[1]) {
  const out = process.argv[2] ?? fileURLToPath(new URL('../dist/calendar-phone.js', import.meta.url));
  await buildPhone(out);
  console.log(`wrote ${out}`);
}
