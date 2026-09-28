import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { timingSafeEqual } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { transaction } from './store.js';
import { ageJobs, setStatus, STATUSES } from './domain.js';
import { collect, config } from './collect.js';
const files = { '/': ['index.html', 'text/html'], '/app.js': ['app.js', 'text/javascript'], '/style.css': ['style.css', 'text/css'] };
export function createServer({ transact = transaction, collector = collect, accessToken = process.env.APP_TOKEN } = {}) {
  return http.createServer(async (req, res) => {
    const send = (status, value) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(value)); };
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    try {
      const path = new URL(req.url, 'http://localhost').pathname;
      if (path.startsWith('/api/')) {
        if (accessToken) {
          const supplied = Buffer.from((req.headers.authorization || '').replace(/^Bearer /, ''));
          const expected = Buffer.from(accessToken);
          if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return send(401, { error: 'Enter your app access key to continue.' });
        }
        if (req.method !== 'GET' && req.headers.origin !== `http://${req.headers.host}` && req.headers.origin !== `https://${req.headers.host}`) return send(403, { error: 'Request origin rejected.' });
        if (req.method === 'GET' && path === '/api/jobs') {
          return send(200, await transact(data => { ageJobs(data.jobs, Date.now(), config.ghostAfterDays); return { ...data, statuses: STATUSES, ghostAfterDays: config.ghostAfterDays }; }));
        }
        if (req.method === 'POST' && path === '/api/collect') { collector().catch(error => console.error('Collection failed:', error.message)); return send(202, { message: 'Search started. Results refresh automatically.' }); }
        if (req.method === 'PATCH' && path.startsWith('/api/jobs/')) {
          let raw = '';
          for await (const chunk of req) { raw += chunk; if (raw.length > 4096) return send(413, { error: 'Request too large.' }); }
          let body; try { body = JSON.parse(raw); } catch { return send(400, { error: 'Invalid JSON.' }); }
          if (!STATUSES.includes(body.status)) return send(400, { error: 'Invalid status.' });
          const result = await transact(data => {
            const job = data.jobs.find(j => j.id === path.slice('/api/jobs/'.length));
            if (!job) return null;
            if (body.updatedAt !== job.statusUpdatedAt) return { conflict: true };
            return setStatus(job, body.status);
          });
          return send(!result ? 404 : result.conflict ? 409 : 200, result || { error: 'Job not found.' });
        }
        return send(404, { error: 'Not found.' });
      }
      if (req.method === 'GET' && files[path]) {
        const [file, type] = files[path];
        res.writeHead(200, { 'Content-Type': `${type}; charset=utf-8` });
        return res.end(await readFile(new URL(`../public/${file}`, import.meta.url)));
      }
      send(404, { error: 'Not found.' });
    } catch (error) { console.error(error.message); send(503, { error: 'Could not save or load jobs. Please retry.' }); }
  });
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const host = process.env.HOST || '127.0.0.1';
  if (!['127.0.0.1', 'localhost', '::1'].includes(host) && !process.env.APP_TOKEN) throw new Error('APP_TOKEN is required for network hosting');
  const port = Number(process.env.PORT || 3000);
  createServer().listen(port, host, () => console.log(`Nightshift is ready at http://${host}:${port}`));
  if (process.env.ENABLE_SCHEDULER === 'true') {
    const run = () => collect().catch(error => console.error(error.message));
    run(); setInterval(run, 3 * 60 * 60 * 1000).unref();
  }
}
