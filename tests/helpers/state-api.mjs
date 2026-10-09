import { readFileSync } from 'node:fs';
// Preserve the real side-effect module import when loading the Pages handler in Node.
export async function loadStateApi() {
  const shared = readFileSync(new URL('../../artist-exclusions.js', import.meta.url), 'utf8');
  const moduleURL = `data:text/javascript;base64,${Buffer.from(shared).toString('base64')}`;
  const source = readFileSync(new URL('../../functions/api/state.js', import.meta.url), 'utf8')
    .replace('"../../artist-exclusions.js"', JSON.stringify(moduleURL));
  return import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
}
