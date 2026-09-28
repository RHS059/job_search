import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
export const dataPath = resolve(process.env.DATA_FILE || 'data/jobs.json');
let queue = Promise.resolve();
const repository = process.env.JOBS_REPOSITORY;
async function github(method = 'GET', body) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository)) throw new Error('Invalid JOBS_REPOSITORY');
  const response = await fetch(`https://api.github.com/repos/${repository}/contents/data/jobs.json`, {
    method, signal: AbortSignal.timeout(15000),
    headers: { Accept: 'application/vnd.github+json', ...(process.env.GITHUB_TOKEN ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}), 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {})
  });
  if (!response.ok) { const error = new Error(`GitHub storage returned HTTP ${response.status}`); error.status = response.status; throw error; }
  return response.json();
}
export async function readStore(path = dataPath) {
  const data = JSON.parse(repository ? Buffer.from((await github()).content, 'base64').toString('utf8') : await readFile(path, 'utf8'));
  if (data.version !== 1 || !Array.isArray(data.jobs)) throw new Error('Invalid job store');
  return data;
}
export function transaction(change, path = dataPath) {
  const run = queue.then(async () => {
    if (repository) {
      for (let attempt = 0; attempt < 5; attempt++) {
        const remote = await github();
        const data = JSON.parse(Buffer.from(remote.content, 'base64').toString('utf8'));
        if (data.version !== 1 || !Array.isArray(data.jobs)) throw new Error('Invalid job store');
        const result = await change(data);
        const content = Buffer.from(JSON.stringify(data, null, 2) + '\n').toString('base64');
        if (content === remote.content.replace(/\s/g, '')) return result;
        try { await github('PUT', { message: 'Update job tracker data', content, sha: remote.sha }); return result; }
        catch (error) { if (![409, 422].includes(error.status) || attempt === 4) throw error; }
      }
    }
    const data = await readStore(path);
    const result = await change(data);
    await mkdir(dirname(path), { recursive: true });
    const temp = `${path}.${process.pid}.tmp`;
    await writeFile(temp, JSON.stringify(data, null, 2) + '\n');
    await rename(temp, path);
    return result;
  });
  queue = run.catch(() => {});
  return run;
}
