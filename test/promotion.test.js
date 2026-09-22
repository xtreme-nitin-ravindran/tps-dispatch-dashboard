import test from 'node:test';
import assert from 'node:assert/strict';
import { promote } from '../scripts/promote-dev.js';
const defaults = {repo:'owner/repo',sha:'tested',ref:'refs/heads/dev',sleep:async()=>{}};
function mock({head='tested',reject=false,files=[{}]}={}) {
  const calls=[];
  const api=(path,method='GET',body)=>{
    calls.push({path,method,body});
    if(path==='git/ref/heads/dev') return {object:{sha:head}};
    if(path==='compare/main...dev') return {files};
    if(path.startsWith('pulls?')) return [];
    if(path==='pulls') return {number:1,html_url:'https://github.com/owner/repo/pull/1'};
    if(path==='pulls/1/merge') {if(reject) throw Error('Protected'); return {merged:true,sha:'merged'};}
    return {};
  };
  return {api,calls};
}
test('only tested dev SHA can be promoted without a duplicate Pages request',async()=>{
  const {api,calls}=mock(); await promote({...defaults,api});
  assert.equal(calls.find(c=>c.path==='pulls/1/merge').body.sha,'tested');
  assert.deepEqual(calls.find(c=>c.path==='git/refs/heads/dev').body,{sha:'merged',force:false});
  assert.ok(!calls.some(c=>c.path.startsWith('pages/')), 'branch publishing must be the only Pages trigger');
});
test('superseded dev, empty diffs and other branches cannot promote',async()=>{
  for(const options of [{head:'newer'},{files:[]}]) {
    const {api,calls}=mock(options); await promote({...defaults,api});
    assert.ok(calls.every(c=>c.method==='GET'));
  }
  const {api}=mock(); await assert.rejects(promote({...defaults,api,ref:'refs/heads/main'}));
});
test('branch protection rejection never updates branches or deploys',async()=>{
  const {api,calls}=mock({reject:true}); await assert.rejects(promote({...defaults,api}));
  assert.ok(!calls.some(c=>c.path==='pages/builds'||c.method==='PATCH'));
});
