import { readFile } from 'node:fs/promises';

const sourceRoot = new URL('../src/', import.meta.url).href;

// Vite accepts bare JSON imports in frontend modules. Match that behavior only
// for repository source JSON when those same modules are exercised by Node.
export async function load(url, context, nextLoad) {
  if (url.startsWith(sourceRoot) && url.endsWith('.json')) {
    const value = JSON.parse(await readFile(new URL(url), 'utf8'));
    return { format: 'module', source: `export default ${JSON.stringify(value)};`, shortCircuit: true };
  }
  return nextLoad(url, context);
}
