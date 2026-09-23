// Runs only in the privileged promotion job after the read-only test job passes.
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
export function githubApi(repo, path, method = 'GET', body, exec = execFileSync) {
return JSON.parse(exec('gh', ['api', `repos/${repo}/${path}`, '--method', method, ...(body ? ['--input', '-'] : [])], {input:body ? JSON.stringify(body) : undefined,encoding:'utf8'}));
}
export function delay(ms, timer = setTimeout) {
return new Promise(resolve => timer(resolve, ms));
}
export async function main(env = process.env, request = githubApi) {
const repo = env.GITHUB_REPOSITORY;
return promote({api: (...args) => request(repo, ...args), repo, sha:env.GITHUB_SHA, ref:env.GITHUB_REF});
}
export async function promote({api, repo, sha, ref, sleep = delay}) {
if (ref !== 'refs/heads/dev') throw Error('Promotion requires dev');
if (api('git/ref/heads/dev').object.sha !== sha) {
  console.log('A newer dev commit exists; its run will handle promotion.');
  return;
}
const comparison = api('compare/main...dev');
if (!comparison.files.length) { console.log('No changes to promote.'); return; }
const owner = repo.split('/')[0];
const prs = api(`pulls?state=open&base=main&head=${owner}:dev`);
const pr = prs[0] || api('pulls','POST',{base:'main',head:'dev',title:'Promote tested dev changes',body:'Automatically promote dev after both timezone unit suites, syntax checks, and live-source integration tests pass. Main branch protection remains enforced.'});
console.log(`Pull request: ${pr.html_url}`);
// The SHA condition prevents merging commits that arrived after this run tested.
let merged;
for (let attempt=0; attempt<6; attempt++) {
  try { merged = api(`pulls/${pr.number}/merge`,'PUT',{sha,merge_method:'merge'}); break; }
  catch (error) { if (attempt===5) throw error; await sleep(5000); }
}
if (!merged?.merged) throw Error('Protected PR was not merged');
// Fast-forward dev to the merge commit only if nobody has pushed newer work.
if (api('git/ref/heads/dev').object.sha === sha) {
  try { api('git/refs/heads/dev','PATCH',{sha:merged.sha,force:false}); }
  catch { console.warn('Dev advanced concurrently; leaving its history intact.'); }
}
// Branch-based Pages publishing handles the main merge automatically.
console.log(`Merged ${pr.html_url}; Pages publishes from main.`);

}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await main();
}
