import test from 'node:test';
import assert from 'node:assert/strict';
import { isRemote } from '../src/remote.js';
test('remote eligibility can appear only in the description',()=>{
  for(const description of ['This role can be based remotely in the US.','This is a fully remote position.','You may work from home.']) assert.equal(isRemote({location:'New York',description}),true);
  assert.equal(isRemote({workplaceType:'remote'}),true);
});
test('negative and incidental remote mentions do not establish eligibility',()=>{
  for(const description of ['This is not a remote role.','Remote work is not available.','You will collaborate with remote teams.']) assert.equal(isRemote({description}),false);
});
