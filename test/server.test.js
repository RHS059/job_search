import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { transaction } from '../src/store.js';
import { createServer } from '../src/server.js';
test('HTTP journey persists status, protects writes, detects conflicts, serves UI',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'nightshift-')),path=join(dir,'jobs.json');
  const at=new Date().toISOString();await writeFile(path,JSON.stringify({version:1,jobs:[{id:'1',status:'discovered',storedAt:at,statusUpdatedAt:at}],lastRun:null}));
  const server=createServer({transact:fn=>transaction(fn,path),accessToken:'test-secret',collector:async()=>({})});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}`;
  const headers={Authorization:'Bearer test-secret','Content-Type':'application/json',Origin:base};
  try {
    assert.equal((await fetch(base+'/api/jobs')).status,401);
    assert.equal((await fetch(base+'/')).status,200);
    assert.equal((await fetch(base+'/api/jobs',{headers})).status,200);
    const patch=origin=>fetch(base+'/api/jobs/1',{method:'PATCH',headers:{...headers,Origin:origin},body:JSON.stringify({status:'applied',updatedAt:at})});
    assert.equal((await patch('https://evil.example')).status,403);
    assert.equal((await patch(base)).status,200);
    assert.equal(JSON.parse(await readFile(path)).jobs[0].status,'applied');
    assert.equal((await patch(base)).status,409);
    assert.equal((await fetch(base+'/api/jobs/1',{method:'PATCH',headers,body:'{"status":"bad"}'})).status,400);
    assert.equal((await fetch(base+'/api/collect',{method:'POST',headers})).status,202);
    await Promise.all(Array.from({length:10},()=>transaction(data=>{data.count=(data.count||0)+1;},path)));
    assert.equal(JSON.parse(await readFile(path)).count,10);
  } finally {await new Promise(resolve=>server.close(resolve));await rm(dir,{recursive:true});}
});
