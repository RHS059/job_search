import { canonicalUrl, platformFor } from './domain.js';
import { getText } from './sources.js';

const designTitle = /\b(ux(?:\s*\/\s*ui)? designer|ui(?:\s*\/\s*ux)? designer|user experience designer|user interface designer|ui developer|product designer)\b/i;

// Public, read-only ATS endpoints. Company boards are explicit and can also be
// learned from previously discovered URLs; this is not an internet-wide index.
export async function discoverBoards(config, savedUrls = [], fetcher = fetch, wait = ms => new Promise(resolve => setTimeout(resolve, ms))) {
  const boards = { Greenhouse: new Set(config.directBoards?.Greenhouse || []), Lever: new Set(config.directBoards?.Lever || []) };
  for (const entry of savedUrls) {
    try {
      const url = new URL(entry.url || entry), platform = platformFor(url.href, config.platforms);
      const slug = url.pathname.split('/')[1];
      if (boards[platform] && /^[\w-]+$/.test(slug)) boards[platform].add(slug);
    } catch { /* Ignore invalid historical URLs. */ }
  }
  const urls = new Set(), candidates = [], reports = [];
  for (const [platform, slugs] of Object.entries(boards)) {
    let blocked = false, requested = false;
    for (const slug of slugs) {
      const report = { platform, board: slug, provider: 'Public board API', results: 0, errors: [] };
      reports.push(report);
      if (blocked) { report.skipped = 'API rate limit'; continue; }
      try {
        if (!/^[\w-]+$/.test(slug)) throw new Error('Invalid board name');
        const host = platform === 'Greenhouse' ? 'boards-api.greenhouse.io' : 'api.lever.co';
        for (let page = 0; page < 20; page++) {
          if (requested) await wait(config.boardDelayMs ?? 1000);
          requested = true;
          const endpoint = platform === 'Greenhouse'
            ? `https://${host}/v1/boards/${slug}/jobs`
            : `https://${host}/v0/postings/${slug}?mode=json&limit=100&skip=${page * 100}`;
          const data = JSON.parse(await getText(endpoint, u => new URL(u).protocol === 'https:' && new URL(u).hostname === host, fetcher));
          const jobs = platform === 'Greenhouse' ? data.jobs : data;
          if (!Array.isArray(jobs)) throw new Error('Invalid board response');
          for (const job of jobs) {
            const title = job.title || job.text;
            if (!designTitle.test(title || '')) continue;
            const rawUrl = job.absolute_url || job.hostedUrl;
            if (platformFor(rawUrl, config.platforms) !== platform) continue;
            const url = canonicalUrl(rawUrl);
            if (!urls.has(url)) { urls.add(url); report.results++; }
            if (platform === 'Greenhouse') {
              const location = job.location?.name || '';
              candidates.push({ url, title, company: job.company_name || slug, location, remote: /\bremote\b/i.test(location), postedAt: job.first_published, requisitionId: job.requisition_id || String(job.id), validThrough: job.application_deadline });
            }
          }
          if (platform === 'Greenhouse' || jobs.length < 100) break;
          if (page === 19) report.errors.push('Pagination safety limit reached');
        }
      } catch (error) { report.errors.push(error.message); if ([403, 429].includes(error.status)) blocked = true; }
    }
  }
  return { urls: [...urls], candidates, reports };
}
