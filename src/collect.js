import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { ageJobs, mergeCandidates, platformFor } from './domain.js';
import { readStore, transaction } from './store.js';
import { discoverBoards } from './boards.js';
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
  const previous = await readStore();
  const google = await discover({ ...config, googleNotBefore: previous.googleNotBefore });
  // This source remains available even when Google pauses for verification.
  const direct = await discoverBoards(config, [...(previous.discoveredUrls || []), ...google.urls]);
  const urls = [...new Set([...google.urls, ...direct.urls])];
  const reports = [...google.reports, ...direct.reports];
  // Keep discovery evidence even when a posting cannot be verified or a later fetch fails.
  await transaction(data => {
    data.googleNotBefore = google.nextAllowedAt;
    data.discoveredUrls ||= [];
    const known = new Map(data.discoveredUrls.map(entry => [entry.url, entry]));
    for (const url of urls) {
      if (known.has(url)) known.get(url).lastSeenAt = startedAt;
      else {
        const entry = { url, platform: platformFor(url, config.platforms), source: config.seedUrls.includes(url) ? 'seed' : direct.urls.includes(url) ? 'Public board API' : 'Google', firstSeenAt: startedAt, lastSeenAt: startedAt };
        data.discoveredUrls.push(entry); known.set(url, entry);
      }
    }
  });
  const candidates = [...direct.candidates], failures = [];
  let noMetadata = 0;
  const blockedHosts = new Set();
  let fetched = false;
  for (const url of urls) {
      const host = new URL(url).hostname;
      if (blockedHosts.has(host)) continue;
      if (direct.candidates.some(candidate => candidate.url === url && candidate.remote && Number.isFinite(Date.parse(candidate.postedAt)))) continue;
      try {
        if (fetched) await new Promise(resolve => setTimeout(resolve, config.boardDelayMs ?? 1000));
        fetched = true;
        const html = await getText(url, u => !!platformFor(u, config.platforms));
        const parsed = parsePostings(html, url);
        if (!parsed.length) noMetadata++;
        candidates.push(...parsed);
      } catch (error) { failures.push({ url, error: error.message }); if ([403, 429].includes(error.status)) blockedHosts.add(host); }
  }
  return transaction(data => {
    ageJobs(data.jobs, Date.now(), config.ghostAfterDays);
    const added = mergeCandidates(data.jobs, candidates, config.platforms);
    data.lastRun = { provider: 'Google + public board APIs', startedAt, finishedAt: new Date().toISOString(), added, discovered: urls.length, inspected: urls.length, noMetadata, reports, failures };
    return data.lastRun;
  });
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await collect();
  console.log(JSON.stringify(result, null, 2));
  if (result.discovered === 0 && result.reports.some(report => report.errors.length)) process.exitCode = 1;
}
