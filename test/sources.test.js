import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePostings, getText, discover, parseGoogleUrls } from '../src/sources.js';
import { readFile } from 'node:fs/promises';
const config=JSON.parse(await readFile(new URL('../config.json',import.meta.url)));
test('JSON-LD graph metadata accepted on every supported platform',()=>{
  for(const domains of Object.values(config.platforms)) {
    const html=`<script type="application/ld+json">${JSON.stringify({'@graph':[{'@type':'JobPosting',title:'UX Designer',datePosted:'2026-09-28',jobLocationType:'TELECOMMUTE',hiringOrganization:{name:'Studio'},identifier:{value:'A'}}]})}</script>`;
    const [job]=parsePostings(html,`https://${domains[0]}/job/1`);assert.equal(job.company,'Studio');assert.equal(job.remote,true);assert.equal(job.postedAt,'2026-09-28');
  }
});
test('missing and malformed metadata never manufactures freshness',()=>{assert.deepEqual(parsePostings('<script type="application/ld+json">{bad}</script>','https://jobs.lever.co/a'),[]);const [job]=parsePostings('<script type="application/ld+json">{"@type":"JobPosting","title":"UX designer"}</script>','https://jobs.lever.co/a');assert.equal(job.postedAt,undefined);assert.equal(job.remote,false);});
test('source failures surface and redirect hosts are validated',async()=>{
  await assert.rejects(getText('https://jobs.lever.co/a',()=>true,async()=>new Response('',{status:429})),/429/);
  let calls=0;await assert.rejects(getText('https://jobs.lever.co/a',u=>new URL(u).hostname==='jobs.lever.co',async()=>{calls++;return new Response(null,{status:302,headers:{location:'http://127.0.0.1/secrets'}});}),/Unsupported/);assert.equal(calls,1);
});

test('Google discovery uses requested titles, remote and site restrictions',async()=>{
  const requested=[];
  const fetcher=async raw=>{const url=new URL(raw);requested.push(url);return url.searchParams.get('q').includes('bad.example')?new Response('',{status:429}):new Response('<a href="/url?q=https%3A%2F%2Fjobs.lever.co%2Facme%2F1%3Futm_source%3Dgoogle&amp;sa=U">Job</a><a href="https://jobs.lever.co/acme/1">duplicate</a>');};
  const result=await discover({platforms:{Lever:['jobs.lever.co'],Bad:['bad.example']},seedUrls:[]},fetcher);
  assert.deepEqual(result.urls,['https://jobs.lever.co/acme/1']);
  assert.equal(result.reports[1].errors.length,1);
  assert.ok(requested.every(u=>u.hostname==='www.google.com'));
  for(const term of ['site:jobs.lever.co','"remote"','"UX/UI designer"','"user experience designer"','"UI developer"']) assert.ok(requested[0].searchParams.get('q').includes(term));
});
test('Google URL parser excludes navigation, unsupported domains and unsafe URLs',()=>{
  const html='<a href="/search?q=more">more</a><a href="https://evil.example/jobs">bad</a><a href="javascript:alert(1)">bad</a><a href="/url?url=https%3A%2F%2Fjobs.lever.co%2Facme%2F1">job</a><a href="https://jobs.lever.co/">home</a>';
  assert.deepEqual(parseGoogleUrls(html,config.platforms),['https://jobs.lever.co/acme/1']);
});
test('JavaScript results are rendered before extracting URLs',async()=>{
  let rendered=0;
  const result=await discover({platforms:{Lever:['jobs.lever.co']},seedUrls:[]},async()=>new Response('<a href="/httpservice/retry/enablejs">Enable JavaScript</a>'),async url=>{rendered++;assert.ok(url.startsWith('https://www.google.com/search?'));return '<a href="https://jobs.lever.co/acme/2">Job</a>';});
  assert.equal(rendered,1);assert.deepEqual(result.urls,['https://jobs.lever.co/acme/2']);
});
test('Google challenge is recorded as failure, never mistaken for empty results',async()=>{
  const result=await discover({platforms:{Lever:['jobs.lever.co']},seedUrls:[]},async()=>new Response('<p>Our systems have detected unusual traffic</p>'));
  assert.equal(result.urls.length,0);assert.match(result.reports[0].errors[0],/verification/);
});
