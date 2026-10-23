// Packs one app for release: `node scripts/bundle.mjs <office|command>`
// writes dist/agentux-<name>-<version>.tar.gz (the app's static files, no
// tests, under agentux-<name>/) and its .sha256. The version is the app's
// VERSION file; the archive is reproducible (sorted, fixed owner and time).
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The apps, their directory and their release name. */
export const APPS = {
  office: { dir: 'apps/office', name: 'office' },
  command: { dir: 'apps/command', name: 'console' }
};

const root = fileURLToPath(new URL('..', import.meta.url));

/** The files an app ships: everything but its tests and its VERSION. */
export function shipped(dir) {
  return readdirSync(join(root, dir)).filter((file) => !file.endsWith('.test.mjs') && file !== 'VERSION').sort();
}

export function version(dir) {
  const text = readFileSync(join(root, dir, 'VERSION'), 'utf8').trim();
  if (!/^\d+\.\d+\.\d+([-.][0-9A-Za-z.-]+)?$/.test(text)) throw new Error(`${dir}/VERSION is not a version: ${text}`);
  return text;
}

function bundle(key) {
  const app = APPS[key];
  if (!app) throw new Error(`unknown app ${key}; one of ${Object.keys(APPS).join(', ')}`);
  const v = version(app.dir);
  const base = `agentux-${app.name}`;
  const stage = join(root, 'dist', 'stage', base);
  rmSync(join(root, 'dist', 'stage'), { recursive: true, force: true });
  mkdirSync(stage, { recursive: true });
  for (const file of shipped(app.dir)) cpSync(join(root, app.dir, file), join(stage, file));
  writeFileSync(join(stage, 'VERSION'), `${v}\n`);
  const archive = `${base}-${v}.tar.gz`;
  const out = join(root, 'dist', archive);
  const tar = execFileSync('tar', ['--sort=name', '--owner=0', '--group=0', '--numeric-owner', '--mtime=@0', '-cf', '-', '-C', join(root, 'dist', 'stage'), base]);
  const gz = execFileSync('gzip', ['-9n'], { input: tar, maxBuffer: 64 << 20 });
  writeFileSync(out, gz);
  const sum = createHash('sha256').update(gz).digest('hex');
  writeFileSync(`${out}.sha256`, `${sum}  ${archive}\n`);
  rmSync(join(root, 'dist', 'stage'), { recursive: true, force: true });
  console.log(`${archive} ${sum}`);
  return { archive, sum, version: v };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  bundle(process.argv[2]);
}
