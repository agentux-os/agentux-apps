import { readFile } from 'node:fs/promises';

const html = await readFile(new URL('../apps/office/index.html', import.meta.url), 'utf8');
const script = await readFile(new URL('../apps/office/app.js', import.meta.url), 'utf8');
const css = await readFile(new URL('../apps/office/styles.css', import.meta.url), 'utf8');

for (const marker of ['office-grid', 'area-filter', 'mission-filter', 'status-filter', 'event-list', 'approval-list', 'state-banner', 'organization-name', '/config.js']) {
  if (!html.includes(marker)) throw new Error(`missing Office surface: ${marker}`);
}
for (const marker of ['fixtureProjection', 'officeModel', 'matches', 'createCommandApi', 'resolveApproval', 'follow', 'escape(']) {
  if (!script.includes(marker)) throw new Error(`missing Office behavior: ${marker}`);
}
for (const marker of ['.office-grid', '.desk', '.metric-card', '.event-item']) {
  if (!css.includes(marker)) throw new Error(`missing Office style: ${marker}`);
}

for (const marker of ['createCommandApi', 'createFixtureApi', 'loadProjection', 'resolveApproval', 'follow']) {
  const api = await readFile(new URL('../apps/office/api.js', import.meta.url), 'utf8');
  if (!api.includes(marker)) throw new Error(`missing Office API adapter: ${marker}`);
}

await import('../apps/office/api.test.mjs');
await import('../apps/office/model.test.mjs');
await import('../apps/office/detail.test.mjs');
await import('../apps/office/harden.test.mjs');
await import('../apps/office/editor.test.mjs');
await import('./serve-office.test.mjs');

const editor = await readFile(new URL('../apps/office/editor.html', import.meta.url), 'utf8');
for (const marker of ['sections', 'problems', 'changes', 'reviews', 'history', 'publish', 'state-banner', '/editor.js']) {
  if (!editor.includes(marker)) throw new Error(`missing editor surface: ${marker}`);
}

console.log('validated Office HTML, filtering, event projection and office layout');
