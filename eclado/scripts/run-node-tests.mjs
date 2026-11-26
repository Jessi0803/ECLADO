import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));

async function discover(directory) {
  const files = [];
  for (const entry of await readdir(join(root, directory), { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await discover(path));
    else if (/\.test\.(?:cjs|mjs)$/.test(entry.name)) files.push(path);
  }
  return files;
}

const files = (await discover('tests')).sort();
if (!files.length) throw new Error('No Node test files found');
const bootstrap = fileURLToPath(new URL('./node-test-bootstrap.mjs', import.meta.url));
const child = spawn(process.execPath, ['--import', bootstrap, '--test', ...process.argv.slice(2), ...files], {
  cwd: root,
  stdio: 'inherit',
});
child.on('error', error => { console.error(error); process.exitCode = 1; });
child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exitCode = code;
});
