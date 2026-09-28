const $ = id => document.getElementById(id);
let state = { jobs: [], statuses: [] };
let key = sessionStorage.getItem('nightshift-key') || '';
async function api(path, options = {}) {
  const response = await fetch(path, { ...options, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}`, ...options.headers } });
  if (response.status === 401) { $('access').hidden = false; throw new Error('Enter your app access key to load your jobs.'); }
  if (response.status === 409) throw new Error('This job changed elsewhere. Refreshing; please try again.');
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || 'Could not complete that request.');
  return body;
}
function element(tag, text, className) { const node = document.createElement(tag); if (text !== undefined) node.textContent = text; if (className) node.className = className; return node; }
const date = value => new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
function render() {
  const query = $('search').value.trim().toLowerCase();
  let rows = state.jobs.filter(j => `${j.title} ${j.company} ${j.location}`.toLowerCase().includes(query) && ($('platform').value === 'all' || j.platform === $('platform').value) && ($('status').value === 'all' || ($('status').value === 'active' ? !['inactive','rejected','ghosted'].includes(j.status) : j.status === $('status').value)));
  const sort = $('sort').value;
  rows.sort((a,b) => sort === 'company' ? a.company.localeCompare(b.company) : Date.parse(b[sort === 'stored' ? 'storedAt' : sort === 'updated' ? 'statusUpdatedAt' : 'postedAt']) - Date.parse(a[sort === 'stored' ? 'storedAt' : sort === 'updated' ? 'statusUpdatedAt' : 'postedAt']));
  $('rows').replaceChildren(...rows.map(job => {
    const row = element('tr'), role = element('td'); role.append(element('strong', job.title), element('small', job.company));
    const posted = element('td', date(job.postedAt)); posted.title = `Posted ${new Date(job.postedAt).toLocaleString()} · Discovered ${new Date(job.storedAt).toLocaleString()}`;
    const status = element('td'), select = element('select'); select.setAttribute('aria-label', `Status for ${job.title} at ${job.company}`); select.dataset.status = job.status;
    for (const value of state.statuses) { const option = element('option', value[0].toUpperCase() + value.slice(1)); option.value = value; select.append(option); } select.value = job.status;
    select.addEventListener('change', async () => { select.disabled = true; try { await api(`/api/jobs/${job.id}`, { method:'PATCH', body:JSON.stringify({status:select.value,updatedAt:job.statusUpdatedAt}) }); $('notice').textContent = `Saved status for ${job.company}.`; } catch(e) { $('notice').textContent = e.message; } finally { await load(); } });
    const checkIn = element('button', 'Check in', 'secondary'); checkIn.type = 'button'; checkIn.setAttribute('aria-label', `Check in on ${job.title} at ${job.company}`);
    checkIn.addEventListener('click', async () => { checkIn.disabled = true; try { await api(`/api/jobs/${job.id}`, {method:'PATCH',body:JSON.stringify({status:job.status,updatedAt:job.statusUpdatedAt})}); $('notice').textContent = `Check-in saved for ${job.company}.`; } catch(e) { $('notice').textContent=e.message; } finally { await load(); } });
    status.append(select, document.createTextNode(' '), checkIn);
    const linkCell = element('td'), link = element('a', 'View job ↗');
    try { const url = new URL(job.url); if (url.protocol === 'https:') link.href = url.href; } catch { /* Never make unsafe URLs clickable. */ }
    link.target = '_blank'; link.rel = 'noopener noreferrer'; link.setAttribute('aria-label', `View ${job.title} at ${job.company}`); linkCell.append(link);
    row.append(role,element('td',job.location),posted,status,element('td',job.platform),linkCell); return row;
  }));
  $('count').textContent = state.jobs.length;
  $('showing').textContent = `${rows.length} of ${state.jobs.length} opportunities`;
  $('empty').hidden = rows.length !== 0;
  $('empty-message').textContent = state.jobs.length ? 'No matches. Try another filter or reset your search.' : 'New roles will appear here.';
  if (state.lastRun) {
    $('last-run').textContent = `Last search ${new Date(state.lastRun.finishedAt).toLocaleString()}`;
  }
}
async function load() {
  try {
    state = await api('/api/jobs'); $('access').hidden = true;
    const previous = $('platform').value;
    $('platform').replaceChildren(new Option('All platforms','all'), ...[...new Set(state.jobs.map(j=>j.platform))].sort().map(p=>new Option(p,p)));
    $('platform').value = [...$('platform').options].some(o=>o.value===previous) ? previous : 'all'; render();
  } catch(e) { $('notice').textContent = e.message; $('showing').textContent = 'Unable to load jobs'; }
}
for (const id of ['search','status','platform','sort']) $(id).addEventListener('input', render);
$('reset').addEventListener('click',()=>{ $('search').value=''; $('status').value='active'; $('platform').value='all'; $('sort').value='newest'; render(); });
$('access').addEventListener('submit',async e=>{ e.preventDefault(); key=$('key').value; sessionStorage.setItem('nightshift-key',key); await load(); });
$('export').addEventListener('click',()=>{ const url=URL.createObjectURL(new Blob([JSON.stringify({version:1,jobs:state.jobs,lastRun:state.lastRun},null,2)],{type:'application/json'})); const a=element('a'); a.href=url;a.download='nightshift-jobs.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000); });
await load(); setInterval(()=>{if (!document.hidden && !document.activeElement?.closest('tbody')) load();},30000);
