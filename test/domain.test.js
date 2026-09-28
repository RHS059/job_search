import test from 'node:test';
import assert from 'node:assert/strict';
import { DAY, ageJobs, canonicalUrl, mergeCandidates, setStatus } from '../src/domain.js';
const now = Date.parse('2026-09-28T12:00:00Z');
const platforms = { Lever:['jobs.lever.co'], Greenhouse:['job-boards.greenhouse.io'] };
const candidate = (overrides={}) => ({ title:'Senior Product Designer',company:'Acme',url:'https://jobs.lever.co/acme/123',remote:true,postedAt:new Date(now-DAY).toISOString(), ...overrides });
test('posting age is advisory and missing or future dates stay unknown',()=>{
  for(const age of [0,1,3*DAY-1]) assert.equal(mergeCandidates([],[candidate({postedAt:new Date(now-age).toISOString()})],platforms,now),1);
  for(const postedAt of [new Date(now-3*DAY).toISOString(),new Date(now+1).toISOString(),'unknown',undefined]) assert.equal(mergeCandidates([],[candidate({postedAt})],platforms,now),1);
  const jobs=[];mergeCandidates(jobs,[candidate({postedAt:undefined})],platforms,now);assert.equal(jobs[0].postedAt,null);
});
test('rejects irrelevant titles, nonremote roles, expired and unsupported posts',()=>{
  for(const change of [{title:'Engineer'},{remote:false},{url:'https://evil.example/job'},{validThrough:new Date(now-1).toISOString()}]) assert.equal(mergeCandidates([],[candidate(change)],platforms,now),0);
});
test('canonical URLs and requisition IDs deduplicate without overwriting progress',()=>{
  const jobs=[]; mergeCandidates(jobs,[candidate()],platforms,now); setStatus(jobs[0],'applied',now);
  assert.equal(mergeCandidates(jobs,[candidate({url:'https://jobs.lever.co/acme/123/?utm_source=test#apply'})],platforms,now),0);
  assert.equal(jobs[0].status,'applied');
  assert.equal(mergeCandidates([],[candidate({requisitionId:'42'}),candidate({url:'https://jobs.lever.co/acme/other',requisitionId:'42'})],platforms,now),1);
  assert.equal(canonicalUrl('https://boards.greenhouse.io/acme/jobs/1?gh_src=test'),'https://job-boards.greenhouse.io/acme/jobs/1');
});
test('inactive starts exactly 72 hours after storage',()=>{
  const jobs=[];mergeCandidates(jobs,[candidate()],platforms,now);setStatus(jobs[0],'in progress',now+DAY);
  ageJobs(jobs,now+3*DAY-1);assert.equal(jobs[0].status,'in progress');
  ageJobs(jobs,now+3*DAY);assert.equal(jobs[0].status,'inactive');assert.equal(jobs[0].history.at(-1).actor,'automatic');
});
test('ghost clock resets on updates; terminal results never ghost',()=>{
  for(const status of ['applied','interviewed','rejected','offer extended']) {
    const jobs=[];mergeCandidates(jobs,[candidate()],platforms,now);setStatus(jobs[0],status,now);
    ageJobs(jobs,now+14*DAY-1);assert.equal(jobs[0].status,status);
    setStatus(jobs[0],status,now+DAY);ageJobs(jobs,now+14*DAY);assert.equal(jobs[0].status,status);
    ageJobs(jobs,now+15*DAY);assert.equal(jobs[0].status,['applied','interviewed'].includes(status)?'ghosted':status);
  }
});
test('all requested job titles match',()=>{
  for(const title of ['UX designer','UI designer','UX/UI designer','user experience designer','user interface designer','UI developer','product designer']) assert.equal(mergeCandidates([],[candidate({title})],platforms,now),1);
});
test('unknown statuses and unsafe URLs rejected',()=>{assert.throws(()=>setStatus({},'hacked'));for(const url of ['javascript:alert(1)','http://jobs.lever.co/a','https://user:pass@jobs.lever.co/a'])assert.throws(()=>canonicalUrl(url));});
