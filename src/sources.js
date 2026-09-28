import { canonicalUrl, platformFor } from './domain.js';
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
    if (!response.ok) {
      const error = new Error(`Source returned HTTP ${response.status}`);
      error.status = response.status;
      const retry = response.headers.get('retry-after');
      error.retryAfterMs = retry ? (/^\d+$/.test(retry) ? Number(retry) * 1000 : Math.max(0, Date.parse(retry) - Date.now())) : 0;
      throw error;
    }
    let length = 0; const chunks = [];
    for await (const chunk of response.body) { length += chunk.length; if (length > 4000000) throw new Error('Source response too large'); chunks.push(chunk); }
    return Buffer.concat(chunks).toString('utf8');
  }
  throw new Error('Too many redirects');
}
export function parseGoogleUrls(html, platforms) {
  const urls = new Set();
  for (const match of html.matchAll(/href=["']([^"']+)["']/g)) {
    try {
      let link = new URL(decode(match[1]), 'https://www.google.com');
      if (['www.google.com', 'google.com'].includes(link.hostname) && link.pathname === '/url') {
        link = new URL(link.searchParams.get('q') || link.searchParams.get('url'));
      }
      if (platformFor(link.href, platforms) && link.pathname !== '/') urls.add(canonicalUrl(link.href));
    } catch { /* Ignore navigation and malformed links. */ }
  }
  return [...urls];
}
export function googleBlocked(html) {
  return /unusual traffic|g-recaptcha|recaptcha\/api|Before you continue to Google/i.test(html);
}
export async function discover(config, fetcher = fetch, renderSearch, { wait = ms => new Promise(resolve => setTimeout(resolve, ms)), now = Date.now } = {}) {
  const urls = new Set((config.seedUrls || []).filter(u => platformFor(u, config.platforms)).map(canonicalUrl));
  const reports = [];
  let browser;
  let stopped = Date.parse(config.googleNotBefore || '') > now();
  let nextAllowedAt = stopped ? config.googleNotBefore : null;
  let requested = false;
  const pace = async () => { if (requested) await wait(config.googleDelayMs ?? 10000); requested = true; };
  try {
    for (const [platform, domains] of Object.entries(config.platforms)) {
      const query = '(' + domains.map(d => 'site:' + d).join(' OR ') + ') ("UX designer" OR "UI designer" OR "UX/UI designer" OR "user experience designer" OR "user interface designer" OR "UI developer" OR "product designer") "remote"';
      const searchUrl = 'https://www.google.com/search?' + new URLSearchParams({ q: query, num: '20', hl: 'en' });
      const report = { platform, provider: 'Google', searchUrl, results: 0, errors: [] };
      if (stopped) { report.skipped = 'Google cooldown'; reports.push(report); continue; }
      try {
        await pace();
        let html = await getText(searchUrl, u => { const parsed = new URL(u); return parsed.protocol === 'https:' && parsed.hostname === 'www.google.com'; }, fetcher);
        if (googleBlocked(html)) throw new Error('Google requires an interactive verification');
        let found = parseGoogleUrls(html, config.platforms).filter(u => platformFor(u, config.platforms) === platform);
        if (!found.length && /enablejs|enable javascript/i.test(html)) {
          await pace();
          if (renderSearch) html = await renderSearch(searchUrl);
          else if (fetcher === fetch) {
            const { chromium } = await import('playwright');
            browser ||= await chromium.launch({ headless: true });
            const page = await browser.newPage();
            try {
              const response = await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
              if (response?.status() === 429) { const error = new Error('Source returned HTTP 429'); error.status = 429; const retry = response.headers()['retry-after']; error.retryAfterMs = retry && /^\d+$/.test(retry) ? Number(retry) * 1000 : Math.max(0, Date.parse(retry || '') - now()) || 0; throw error; }
              await page.waitForFunction(() => document.querySelector('#search') || document.querySelector('#rso') || /unusual traffic|Before you continue to Google|did not match any documents/i.test(document.body.innerText), null, { timeout: 15000 }).catch(() => {});
              html = await page.content();
            } finally { await page.close(); }
          }
          if (googleBlocked(html)) throw new Error('Google requires an interactive verification');
          found = parseGoogleUrls(html, config.platforms).filter(u => platformFor(u, config.platforms) === platform);
        }
        found.forEach(u => urls.add(u));
        report.results = found.length;
        if (!found.length && !/did not match any documents|no results found/i.test(html)) throw new Error('Google returned no readable posting links');
      } catch (error) {
        report.errors.push(error.message);
        if ([403, 429].includes(error.status) || /interactive verification/.test(error.message)) {
          stopped = true;
          nextAllowedAt = new Date(now() + Math.max(config.googleCooldownMs ?? 10800000, error.retryAfterMs || 0)).toISOString();
        }
      }
      reports.push(report);
    }
  } finally { await browser?.close(); }
  return { urls: [...urls], reports, nextAllowedAt };
}
