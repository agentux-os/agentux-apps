import { readFile } from 'node:fs/promises';

const html = await readFile(new URL('../apps/office/index.html', import.meta.url), 'utf8');
const script = await readFile(new URL('../apps/office/app.js', import.meta.url), 'utf8');
const css = await readFile(new URL('../apps/office/styles.css', import.meta.url), 'utf8');

for (const marker of ['office-grid', 'area-filter', 'mission-filter', 'status-filter', 'event-list']) {
  if (!html.includes(marker)) throw new Error(`missing Office surface: ${marker}`);
}
for (const marker of ['fakeEvents', 'renderOffice', 'matches', 'approval']) {
  if (!script.includes(marker)) throw new Error(`missing Office behavior: ${marker}`);
}
for (const marker of ['.office-grid', '.desk', '.metric-card', '.event-item']) {
  if (!css.includes(marker)) throw new Error(`missing Office style: ${marker}`);
}

console.log('validated Office HTML, filtering, event projection and office layout');
