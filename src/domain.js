import { createHash } from 'node:crypto';
export const DAY = 86400000;
export const STATUSES = ['discovered', 'in progress', 'applied', 'interviewed', 'rejected', 'offer extended', 'inactive', 'ghosted'];
export function canonicalUrl(raw) {
  const u = new URL(raw);
  if (u.protocol !== 'https:' || u.username || u.password || u.port) throw new Error('Invalid posting URL');
  u.hash = '';
  for (const key of [...u.searchParams.keys()]) if (/^(utm_|source$|ref$|gh_src$|lever-source$|lever-origin$)/i.test(key)) u.searchParams.delete(key);
  u.searchParams.sort();
  u.pathname = u.pathname.replace(/\/+$/, '') || '/';
  if (u.hostname === 'boards.greenhouse.io') u.hostname = 'job-boards.greenhouse.io';
  return u.href;
}
export function platformFor(raw, platforms) {
  try {
    const host = new URL(canonicalUrl(raw)).hostname;
    return Object.entries(platforms).find(([, domains]) => domains.some(d => host === d || host.endsWith('.' + d)))?.[0];
  } catch { return undefined; }
}
export function ageJobs(jobs, now = Date.now(), ghostDays = 14) {
  if (!Number.isFinite(ghostDays) || ghostDays < 1) throw new Error('Invalid ghost threshold');
  for (const job of jobs) {
    let status;
    if (['discovered', 'in progress'].includes(job.status) && !job.appliedAt && now - Date.parse(job.storedAt) >= 3 * DAY) status = 'inactive';
    if (['applied', 'interviewed'].includes(job.status) && now - Date.parse(job.statusUpdatedAt) >= ghostDays * DAY) status = 'ghosted';
    if (status) setStatus(job, status, now, 'automatic');
  }
  return jobs;
}
export function setStatus(job, status, now = Date.now(), actor = 'user') {
  if (!STATUSES.includes(status)) throw new Error('Invalid status');
  job.status = status;
  job.statusUpdatedAt = new Date(now).toISOString();
  if (['applied', 'interviewed', 'rejected', 'offer extended'].includes(status)) job.appliedAt ||= job.statusUpdatedAt;
  (job.history ||= []).push({ status, at: job.statusUpdatedAt, actor });
  return job;
}
export function mergeCandidates(jobs, candidates, platforms, now = Date.now()) {
  const urls = new Set(jobs.map(j => canonicalUrl(j.url)));
  const identities = new Set(jobs.map(j => j.identity).filter(Boolean));
  let added = 0;
  for (const c of candidates) {
    const posted = Date.parse(c.postedAt);
    const platform = platformFor(c.url, platforms);
    if (!platform || !c.remote) continue;
    const verifiedDate = Number.isFinite(posted) && posted <= now;
    if (!/\b(ux(?:\s*\/\s*ui)? designer|ui(?:\s*\/\s*ux)? designer|user experience designer|user interface designer|ui developer|product designer)\b/i.test(c.title)) continue;
    if (c.validThrough && Date.parse(c.validThrough) < now) continue;
    const url = canonicalUrl(c.url);
    const identity = c.requisitionId ? `${platform}:${c.company.toLowerCase().trim()}:${c.requisitionId}` : url;
    if (urls.has(url) || identities.has(identity)) continue;
    const at = new Date(now).toISOString();
    jobs.push({ id: createHash('sha256').update(identity).digest('hex').slice(0, 24), identity, title: c.title, company: c.company || 'Unknown company', location: c.location || 'Remote', platform, url, postedAt: verifiedDate ? new Date(posted).toISOString() : null, storedAt: at, statusUpdatedAt: at, status: 'discovered', history: [{ status: 'discovered', at, actor: 'collector' }] });
    urls.add(url); identities.add(identity); added++;
  }
  return added;
}
