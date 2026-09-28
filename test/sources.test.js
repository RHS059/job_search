import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePostings, getText, discover } from '../src/sources.js';
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
test('discovery reports independent failures and deduplicates search results',async()=>{
  const fetcher=async url=>new URL(url).searchParams.get('q').includes('LeverBad')?new Response('',{status:500}):new Response('<rss><channel><item><link>https://jobs.lever.co/acme/1</link></item></channel></rss>');
  const result=await discover({platforms:{Lever:['jobs.lever.co'],LeverBad:['LeverBad']},seedUrls:[]},fetcher);assert.equal(result.urls.length,1);assert.equal(result.reports[1].errors.length,3);
});
