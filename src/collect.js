import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { ageJobs, mergeCandidates, platformFor } from './domain.js';
import { transaction } from './store.js';
import { discover, getText, parsePostings } from './sources.js';
export const config = JSON.parse(await readFile(new URL('../config.json', import.meta.url), 'utf8'));
let running;
export function collect() {
  if (running) return running;
  running = run().finally(() => { running = undefined; });
  return running;
}
async function run() {
  const startedAt = new Date().toISOString();
  const { urls, reports } = await discover(config);
  // Keep discovery evidence even when a posting cannot be verified or a later fetch fails.
  await transaction(data => {
    data.discoveredUrls ||= [];
    const known = new Map(data.discoveredUrls.map(entry => [entry.url, entry]));
    for (const url of urls) {
      if (known.has(url)) known.get(url).lastSeenAt = startedAt;
      else {
        const entry = { url, platform: platformFor(url, config.platforms), source: config.seedUrls.includes(url) ? 'seed' : 'Google', firstSeenAt: startedAt, lastSeenAt: startedAt };
        data.discoveredUrls.push(entry); known.set(url, entry);
      }
    }
  });
  const candidates = [], failures = [];
  let noMetadata = 0;
  for (let i = 0; i < urls.length; i += 4) {
    await Promise.all(urls.slice(i, i + 4).map(async url => {
      try {
        const html = await getText(url, u => !!platformFor(u, config.platforms));
        const parsed = parsePostings(html, url);
        if (!parsed.length) noMetadata++;
        candidates.push(...parsed);
      } catch (error) { failures.push({ url, error: error.message }); }
    }));
  }
  return transaction(data => {
    ageJobs(data.jobs, Date.now(), config.ghostAfterDays);
    const added = mergeCandidates(data.jobs, candidates, config.platforms);
    data.lastRun = { provider: 'Google', startedAt, finishedAt: new Date().toISOString(), added, discovered: urls.length, inspected: urls.length, noMetadata, reports, failures };
    return data.lastRun;
  });
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await collect();
  console.log(JSON.stringify(result, null, 2));
  if (result.discovered === 0 && result.reports.some(report => report.errors.length)) process.exitCode = 1;
}
