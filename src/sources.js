import { platformFor } from './domain.js';
export const decode = value => value.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
const plain = value => decode(String(value || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ')).trim();
export function parsePostings(html, url) {
  const found = [];
  function walk(node) {
    if (!node || typeof node !== 'object') return;
    if ([node['@type']].flat().includes('JobPosting')) {
      const locations = [node.jobLocation || []].flat().map(l => [l.address?.addressLocality, l.address?.addressRegion, l.address?.addressCountry].filter(Boolean).join(', ')).filter(Boolean);
      const remote = [node.jobLocationType].flat().includes('TELECOMMUTE') || /\bremote\b/i.test(locations.join(' ') + ' ' + node.title);
      found.push({ title: plain(node.title), company: plain(node.hiringOrganization?.name), location: locations.join(' / ') || 'Remote', remote, postedAt: node.datePosted, validThrough: node.validThrough, requisitionId: node.identifier?.value, url });
      return;
    }
    for (const child of Object.values(node)) if (typeof child === 'object') walk(child);
  }
  for (const match of html.matchAll(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try { walk(JSON.parse(match[1])); } catch { /* Malformed metadata is not evidence of freshness. */ }
  }
  return found;
}
export async function getText(url, allowed, fetcher = fetch) {
  for (let redirects = 0; redirects < 5; redirects++) {
    if (!allowed(url)) throw new Error('Unsupported source URL');
    const response = await fetcher(url, { redirect: 'manual', signal: AbortSignal.timeout(15000), headers: { 'User-Agent': 'NightshiftJobTracker/1.0', Accept: 'text/html, application/rss+xml, application/json' } });
    if ([301, 302, 303, 307, 308].includes(response.status)) { url = new URL(response.headers.get('location'), url).href; continue; }
    if (!response.ok) throw new Error(`Source returned HTTP ${response.status}`);
    let length = 0; const chunks = [];
    for await (const chunk of response.body) { length += chunk.length; if (length > 4000000) throw new Error('Source response too large'); chunks.push(chunk); }
    return Buffer.concat(chunks).toString('utf8');
  }
  throw new Error('Too many redirects');
}
export async function discover(config, fetcher = fetch) {
  const urls = new Set(config.seedUrls || []);
  const reports = [];
  for (const [platform, domains] of Object.entries(config.platforms)) {
    const report = { platform, results: 0, errors: [] };
    for (const terms of ['"UX designer" OR "UI designer" OR "UX/UI designer"', '"user experience designer" OR "user interface designer" OR "UI developer" OR "product designer"']) {
      try {
        const query = `(${domains.map(d => `site:${d}`).join(' OR ')}) (${terms}) remote`;
        const xml = await getText(`https://www.bing.com/search?format=rss&count=50&q=${encodeURIComponent(query)}`, u => new URL(u).hostname === 'www.bing.com', fetcher);
        if (!/<rss\b/i.test(xml)) throw new Error('Search returned no RSS feed');
        for (const item of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
          const link = item[1].match(/<link>([\s\S]*?)<\/link>/)?.[1];
          if (link && platformFor(decode(link), config.platforms) === platform) { urls.add(decode(link)); report.results++; }
        }
      } catch (error) { report.errors.push(error.message); }
    }
    if (report.results === 0) {
      try {
        const query = `site:${domains[0]} ("product designer" OR "UX designer" OR "UI designer" OR "UI developer" OR "user experience designer" OR "user interface designer") remote`;
        const html = await getText(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, u => new URL(u).hostname === 'html.duckduckgo.com', fetcher);
        if (/anomaly|challenge-form|bots use DuckDuckGo/i.test(html)) throw new Error('Search requires an interactive challenge');
        for (const match of html.matchAll(/href=["']([^"']+)["']/g)) {
          let link = decode(match[1]);
          if (link.startsWith('//duckduckgo.com/l/')) link = new URL('https:' + link).searchParams.get('uddg') || '';
          if (platformFor(link, config.platforms) === platform) { urls.add(link); report.results++; }
        }
      } catch (error) { report.errors.push(error.message); }
    }
    reports.push(report);
  }
  return { urls: [...urls], reports };
}
