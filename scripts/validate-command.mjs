import { readFile } from 'node:fs/promises';

const html = await readFile(new URL('../apps/command/index.html', import.meta.url), 'utf8');
const script = await readFile(new URL('../apps/command/app.js', import.meta.url), 'utf8');
const css = await readFile(new URL('../apps/command/styles.css', import.meta.url), 'utf8');

for (const marker of ['node-rows', 'batch', 'prefs-editor', 'token-form', 'enrollments', 'metric-limits']) {
  if (!html.includes(marker)) throw new Error(`missing Command console surface: ${marker}`);
}
for (const marker of ['commandMany', 'issueTokens', 'limits.clear', 'harness.test', 'preferences.set', 'request.resolve', 'run.cancel', 'escape(']) {
  if (!script.includes(marker)) throw new Error(`missing Command console behavior: ${marker}`);
}
for (const marker of ['table.nodes', '.agent.limited', '.token-form']) {
  if (!css.includes(marker)) throw new Error(`missing Command console style: ${marker}`);
}
await import('../apps/command/api.test.mjs');
console.log('validated the Command console');
