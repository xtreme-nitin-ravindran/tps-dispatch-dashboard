import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { delay, githubApi, main, promote } from '../scripts/promote-dev.js';
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
test('[INFRA-CI] GitHub API wrapper serializes requests and retry delays use the supplied timer',async()=>{
  const calls=[];
  const result=githubApi('owner/repo','pulls','POST',{head:'dev'},(...args)=>{
    calls.push(args);
    return '{"number": 7}';
  });
  assert.deepEqual(result,{number:7});
  assert.deepEqual(calls[0],[
    'gh',
    ['api','repos/owner/repo/pulls','--method','POST','--input','-'],
    {input:'{"head":"dev"}',encoding:'utf8'}
  ]);
  assert.deepEqual(githubApi('owner/repo','pulls','GET',undefined,()=>'{"total_count":0}'),{total_count:0});
  assert.equal(githubApi('owner/repo','actions/workflows/codeql.yml/dispatches','POST',{ref:'main'},()=>''),null);
  let waited;
  await delay(5000,(resolve,ms)=>{waited=ms;resolve();});
  assert.equal(waited,5000);
  const requests=[];
  await main({GITHUB_REPOSITORY:'owner/repo',GITHUB_SHA:'tested',GITHUB_REF:'refs/heads/dev'},(repo,path)=>{
    requests.push({repo,path});
    return {object:{sha:'newer'}};
  });
  assert.deepEqual(requests,[{repo:'owner/repo',path:'git/ref/heads/dev'}]);
});
test('[INFRA-CI] only tested dev SHA can be promoted without a duplicate Pages request',async()=>{
  const {api,calls}=mock(); await promote({...defaults,api});
  assert.equal(calls.find(c=>c.path==='pulls/1/merge').body.sha,'tested');
  assert.deepEqual(calls.find(c=>c.path==='git/refs/heads/dev').body,{sha:'merged',force:false});
  assert.ok(!calls.some(c=>c.path.startsWith('pages/')), 'branch publishing must be the only Pages trigger');
  const scan=calls.findIndex(c=>c.path==='actions/workflows/codeql.yml/dispatches');
  assert.ok(scan>calls.findIndex(c=>c.path==='pulls/1/merge'));
  assert.deepEqual(calls[scan].body,{ref:'main'});
  assert.match(calls.find(c=>c.path==='pulls').body.body, /Live-source integration tests are excluded from this promotion gate/);
});
test('[INFRA-CI] superseded dev, empty diffs and other branches cannot promote',async()=>{
  for(const options of [{head:'newer'},{files:[]}]) {
    const {api,calls}=mock(options); await promote({...defaults,api});
    assert.ok(calls.every(c=>c.method==='GET'));
  }
  const {api}=mock(); await assert.rejects(promote({...defaults,api,ref:'refs/heads/main'}));
});
test('[INFRA-CI] branch protection rejection never updates branches or deploys',async()=>{
  const {api,calls}=mock({reject:true}); await assert.rejects(promote({...defaults,api}));
  assert.ok(!calls.some(c=>c.path==='pages/builds'||c.method==='PATCH'));
  assert.ok(!calls.some(c=>c.path==='actions/workflows/codeql.yml/dispatches'));
});

test('[INFRA-CI] reuses existing PR, retries a transient rejection and protects concurrent dev changes', async()=>{
 const calls=[]; let reads=0, merges=0, sleeps=0;
 const api=(path,method,body)=>{
  calls.push({path,method,body});
  if(path==='git/ref/heads/dev') return {object:{sha:++reads===1?'tested':'newer'}};
  if(path==='compare/main...dev') return {files:[{}]};
  if(path.startsWith('pulls?')) return [{number:7,html_url:'https://example.test/7'}];
  if(path==='pulls/7/merge') {if(++merges===1) throw Error('pending');return {merged:true,sha:'merged'};}
  if(path==='actions/workflows/codeql.yml/dispatches') return null;
  throw Error(`Unexpected mutation ${path}`);
 };
 await promote({...defaults,api,sleep:async ms=>{assert.equal(ms,5000);sleeps++;}});
 assert.equal(sleeps,1);assert.equal(merges,2);
 assert.ok(!calls.some(c=>(c.path==='pulls'&&c.method==='POST')||c.method==='PATCH'));
 assert.equal(calls.filter(c=>c.path==='actions/workflows/codeql.yml/dispatches').length,1);
 assert.throws(()=>api('unexpected'), /Unexpected mutation unexpected/);
});

test('[INFRA-CI] unsuccessful merge responses never advance dev; concurrent fast-forward rejection is safe',async()=>{
 for(const merged of [false,true]) {
  const base=mock(), writes=[];
  const api=(path,method,body)=>{
   if(path==='pulls/1/merge') return {merged,sha:'merged'};
   if(method==='PATCH') {writes.push(body);throw Error('concurrent update');}
   return base.api(path,method,body);
  };
  if(merged) await promote({...defaults,api});
  else await assert.rejects(promote({...defaults,api}), /not merged/);
  assert.equal(writes.length,merged?1:0);
 }
});

test('[INFRA-CI] promotion CLI rejects runs outside dev',()=>{
 const result=spawnSync(process.execPath,['scripts/promote-dev.js'],{
  encoding:'utf8',env:{...process.env,GITHUB_REPOSITORY:'owner/repo',GITHUB_SHA:'tested',GITHUB_REF:'refs/heads/main'}
 });
 assert.notEqual(result.status,0);
 assert.match(result.stderr,/Promotion requires dev/);
});

test('[INFRA-CI] promotion CLI completes a successful dev promotion',()=>{
 const bin=mkdtempSync(join(tmpdir(),'promotion-cli-'));
 try {
  const gh=join(bin,'gh');
  const requests=join(bin,'requests.jsonl');
  writeFileSync(gh,`#!/bin/sh
# Read request bodies before responding, matching gh api --input -.
case "$*" in
 *'--input -'*) cat >> "$PROMOTION_REQUESTS"; printf '\\n' >> "$PROMOTION_REQUESTS" ;;
esac
case "$*" in
 *git/ref/heads/dev*) echo '{"object":{"sha":"tested"}}' ;;
 *compare/main...dev*) echo '{"files":[{}]}' ;;
 *'pulls?state=open'*) echo '[{"number":1,"html_url":"https://example.test/1"}]' ;;
 *pulls/1/merge*) echo '{"merged":true,"sha":"merged"}' ;;
 *) echo '{}' ;;
esac
`);
  chmodSync(gh,0o755);
  const result=spawnSync(process.execPath,['scripts/promote-dev.js'],{
   encoding:'utf8',env:{...process.env,PATH:`${bin}:${process.env.PATH}`,PROMOTION_REQUESTS:requests,GITHUB_REPOSITORY:'owner/repo',GITHUB_SHA:'tested',GITHUB_REF:'refs/heads/dev'}
  });
  assert.equal(result.status,0,result.stderr);
  assert.match(result.stdout,/Merged https:\/\/example.test\/1/);
  assert.deepEqual(readFileSync(requests,'utf8').trim().split('\n').map(line=>JSON.parse(line)),[
   {sha:'tested',merge_method:'merge'},
   {ref:'main'},
   {sha:'merged',force:false}
  ]);
 } finally { rmSync(bin,{recursive:true,force:true}); }
});
