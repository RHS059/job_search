import test from 'node:test';
import assert from 'node:assert/strict';
import { discover } from '../src/sources.js';
import { discoverBoards } from '../src/boards.js';
const platforms = { Greenhouse: ['job-boards.greenhouse.io'], Lever: ['jobs.lever.co'] };
test('Yandex searches are paced and Retry-After stops all remaining Yandex requests', async () => {
  let calls = 0;
  const waits = [];
  const result = await discover({platforms}, async () => {
    calls++;
    return calls === 1 ? new Response('<a href="https://job-boards.greenhouse.io/acme/jobs/1">Job</a>') : new Response('',{status:429,headers:{'Retry-After':'20000'}});
  }, undefined, {wait: async ms=>waits.push(ms), now:()=>0});
  assert.deepEqual(waits,[10000]);
  assert.equal(result.nextAllowedAt,new Date(20000000).toISOString());
});
test('verification halts Yandex immediately, and saved cooldown prevents the next run', async () => {
  let calls=0;
  const fetcher=async()=>{calls++;return new Response('unusual traffic');};
  const first=await discover({platforms},fetcher,undefined,{now:()=>0});
  assert.equal(calls,1);assert.equal(first.reports[1].skipped,'Yandex cooldown');
  await discover({platforms,yandexNotBefore:first.nextAllowedAt},fetcher,undefined,{now:()=>1});
  assert.equal(calls,1);
});
test('direct APIs discover URLs independently; Greenhouse freshness uses first publication',async()=>{
  const requests=[], waits=[];
  const fetcher=async url=>{requests.push(url);return new Response(JSON.stringify({jobs:[{id:1,title:'Product Designer',company_name:'Acme',absolute_url:'https://job-boards.greenhouse.io/acme/jobs/1',location:{name:'Remote'},first_published:'2026-09-01',updated_at:'2026-09-28'},{id:2,title:'Accountant',absolute_url:'https://job-boards.greenhouse.io/acme/jobs/2'}]}));};
  const result=await discoverBoards({platforms,directBoards:{Greenhouse:['acme','second']}},[],fetcher,async ms=>waits.push(ms));
  assert.equal(result.urls.length,1);assert.equal(result.candidates[0].postedAt,'2026-09-01');assert.equal(result.candidates[0].remote,true);
  assert.ok(requests.every(u=>new URL(u).hostname==='boards-api.greenhouse.io'));
  assert.deepEqual(waits,[1000]);
});
test('direct API rate limit halts that provider but leaves other providers available',async()=>{
  const calls=[];
  const result=await discoverBoards({platforms,directBoards:{Greenhouse:['one','two'],Lever:['acme']}},[],async url=>{calls.push(url);return url.includes('greenhouse')?new Response('',{status:429}):new Response(JSON.stringify([{text:'UX designer',hostedUrl:'https://jobs.lever.co/acme/1'}]));},async()=>{});
  assert.equal(calls.length,2);assert.equal(result.urls.length,1);assert.equal(result.reports[1].skipped,'API rate limit');
});
