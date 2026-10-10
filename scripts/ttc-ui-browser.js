/* global window, document, getComputedStyle */
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
import assert from 'node:assert/strict';
import { mkdir,writeFile } from 'node:fs/promises';
import { createBrowserTiming, resolveTimingFormat } from './lib/browser-timing.js';
import { awaitFixtureReady } from './lib/browser-fixture.js';
const timing=createBrowserTiming();const timingFormat=resolveTimingFormat(process.env);
const out=process.env.TTC_VISUAL_OUTPUT || '.cache/ttc-ui-visual';await mkdir(out,{recursive:true});
const browser=await timing.time('chromium-launch',()=>chromium.launch({headless:true,executablePath:process.env.CHROMIUM_EXECUTABLE}));
const results=[];
try {
for(const width of [320,375,390,430,768,1440]) {
 const page=await browser.newPage({viewport:{width,height:900},deviceScaleFactor:1});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{window.ttcLongTasks=[];new PerformanceObserver(list=>window.ttcLongTasks.push(...list.getEntries().map(e=>e.duration))).observe({type:'longtask',buffered:true});});
 await timing.time(`page-goto:${width}`,()=>page.goto(`${process.env.TTC_UI_URL || 'http://127.0.0.1:8765/'}?mobileAuditFixture=many&mobileAuditSheet=expanded&ttcFixture=confirmed`,{waitUntil:'networkidle'}));
 await timing.time(`fixture-ready:${width}`,()=>awaitFixtureReady(page));
 await page.waitForSelector('.ttc-disruption').catch(async error=>{console.log({width,errors,body:await page.locator('body').innerText()});await page.screenshot({path:`${out}/failure-${width}.png`});throw error;});
 const initialMaxLongTask=await page.evaluate(()=>{const max=Math.max(0,...window.ttcLongTasks);window.ttcLongTasks=[];return max;});
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth),width);
 const diag=()=>page.evaluate(async()=>(await import('./src/ttc/ui.js')).captureTtcRenderState());
 assert.equal((await diag()).parts,2);
 await page.locator('.ttc-disruption > summary').click();
 await page.locator('.ttc-show-map').click();
 assert.equal((await diag()).selected,'fixture-detour');
 if(width<=430) assert.equal(await page.locator('#mobileClosureDetail').isVisible(),true);
 if(width===390) {
  // Exercise the real minute-based summary refresh while a TTC detail is selected.
  await page.waitForTimeout(61000);
  assert.equal(await page.locator('#mobileSheetSummary').textContent(),'504 King');
 }
 for(const theme of ['light','dark']) {
  await page.selectOption('#themePreference',theme);
  await page.locator('#dispatchMap').scrollIntoViewIfNeeded();
  await page.screenshot({path:`${out}/${width}-${theme}.png`});
 }
 // Actual paths retain identities through CSS theme changes and pan/zoom.
 const ids=await page.locator('.ttc-line').evaluateAll(nodes=>nodes.map((n,i)=>{n.dataset.testIdentity=String(i);return n.dataset.testIdentity;}));
 if(width<=430) await page.locator('.closure-detail-back').click();
 for(let i=0;i<12;i++) {
  await page.selectOption('#themePreference',i%2?'dark':'light');
  if(width<=430) {
   await page.locator('button[data-mobile-view="calls"]').click();
   await page.waitForFunction(()=>{const r=document.querySelector('button[data-mobile-view="calls"]').getBoundingClientRect();return r.top>=0&&r.bottom<=window.innerHeight;});
   await page.locator('button[data-mobile-view="map"]').click();
   await page.locator(`[data-sheet-target="${['collapsed','half','expanded'][i%3]}"]`).click({force:true});
  }
  await page.locator('#ttcOverlay').evaluate((el,i)=>{el.checked=i%2===0;el.dispatchEvent(new Event('change',{bubbles:true}));},i);
  await page.locator('#roadOverlay').evaluate((el,i)=>{el.checked=i%2===0;el.dispatchEvent(new Event('change',{bubbles:true}));},i);
  await page.getByLabel('Police Divisions').setChecked(i%2===0,{force:true});
  await page.locator('.leaflet-control-zoom-in').click({force:true});
  await page.locator('.leaflet-control-zoom-out').click({force:true});
 }
 await page.locator('#ttcOverlay').evaluate(el=>{el.checked=true;el.dispatchEvent(new Event('change',{bubbles:true}));});
 assert.deepEqual(await page.locator('.ttc-line').evaluateAll(nodes=>nodes.map(n=>n.dataset.testIdentity)),ids);
 assert.equal((await diag()).layers,4);assert.deepEqual(errors,[]);
 // Map geometry selects the same detail, then an existing emergency card clears it.
 await page.locator('.ttc-hit').first().dispatchEvent('click');
 assert.equal((await diag()).selected,'fixture-detour');
 await page.locator('[data-call-id][role="button"]').first().dispatchEvent('click');
 assert.equal((await diag()).selected,null);
 await page.locator('.ttc-hit').first().dispatchEvent('click');
 assert.equal((await diag()).selected,'fixture-detour');
 assert.equal(await page.locator('[data-call-id].selected').count(),0);
 // Refresh/expiration updates the live renderer without replacing the map.
 await page.evaluate(async()=>{
   const ui=await import('./src/ttc/ui.js'),{loadTtcUiFixture}=await import('./src/ttc/fixture.js');
   const f=await loadTtcUiFixture();window.ttcBrowserFixture=f;
   for(let i=0;i<20;i++) ui.renderTtc(f);
 });
 assert.equal((await diag()).layers,4);
 // Story 57: current, retained and unavailable/retained share the same selected
 // path; visible disclosures survive mobile detail and desktop list layouts.
 for(const outage of [false,true]) {
  await page.evaluate(async outage=>{
   const f=structuredClone(window.ttcBrowserFixture);
   f.ttcDiversions.diversions.forEach(d=>{d.persistenceEarned=true;d.retained=true;});
   if(outage) {f.ttcDiversions.status='unavailable';f.ttcDiversions.checkedAt=new Date(Date.now()-180000).toISOString();}
   (await import('./src/ttc/ui.js')).renderTtc(f);
  },outage);
  await page.waitForFunction(()=>document.querySelector('.ttc-evidence-status')?.textContent.includes('Retained evidence'));
  assert.equal((await diag()).selected,'fixture-detour');assert.equal((await diag()).layers,4);
  const cue=page.locator(width<=430?'#mobileClosureDetail .ttc-evidence-status':'.ttc-disruption .ttc-evidence-status').first();
  await cue.scrollIntoViewIfNeeded();assert.equal(await cue.isVisible(),true);
  const geometry=await cue.evaluate(el=>{const r=el.getBoundingClientRect(),style=getComputedStyle(el);return {width:r.width,height:r.height,overflow:style.overflow,clip:style.clip,color:style.color,background:style.backgroundColor};});
  assert.ok(geometry.width>100&&geometry.height>=16);assert.equal(geometry.clip,'auto');
  assert.match(await cue.textContent(),outage?/Vehicle feed unavailable/:/Retained evidence/);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth),width);
 }
 await page.evaluate(async()=>{
  const f=structuredClone(window.ttcBrowserFixture);f.ttcDiversions.status='unavailable';
  f.ttcDiversions.diversions.forEach(d=>{d.persistenceEarned=true;d.retained=true;d.expiresAt=new Date(Date.now()).toISOString();});
  (await import('./src/ttc/ui.js')).renderTtc(f);
 });
 await page.waitForFunction(()=>!document.querySelector('.ttc-evidence-status'));
 assert.equal((await diag()).layers,2);assert.equal((await diag()).selected,'fixture-detour');
 await page.evaluate(async()=>{const f=structuredClone(window.ttcBrowserFixture);f.ttcDiversions.diversions=[];(await import('./src/ttc/ui.js')).renderTtc(f);});
 assert.equal((await diag()).layers,2);assert.equal(await page.locator('.ttc-disruption').count(),1);
 assert.equal((await diag()).selected,'fixture-detour');
 await page.evaluate(async()=>{const f=structuredClone(window.ttcBrowserFixture);f.ttcAlerts.items=[];f.ttcDiversions.diversions=[];(await import('./src/ttc/ui.js')).renderTtc(f);});
 assert.equal((await diag()).layers,0);assert.equal((await diag()).selected,null);assert.equal(await page.locator('.ttc-disruption').count(),0);
 assert.equal(await page.locator('#ttcLayerControl').isVisible(),false);
 assert.deepEqual(errors,[]);
 const maxLongTask=await page.evaluate(()=>Math.max(0,...window.ttcLongTasks));assert.ok(maxLongTask<2000);
 results.push({width,errors,layers:(await diag()).layers,cycles:12,initialMaxLongTask,maxLongTask});await page.close();
}
// A real confirmed public path with no official references remains selectable.
{
 const page=await browser.newPage({viewport:{width:390,height:900}});
 await page.goto(`${process.env.TTC_UI_URL || 'http://127.0.0.1:8765/'}?mobileAuditFixture=many&ttcFixture=confirmed`,{waitUntil:'networkidle'});
 await page.waitForFunction(()=>document.documentElement.dataset.secondaryLoadState==='ready');
 const id=await page.evaluate(async()=>{
  const observed=await (await fetch('./test/fixtures/ttc-diversions/unassociated-public.json')).json();
  const shift=Date.now()-Date.parse(observed.checkedAt);observed.checkedAt=new Date(Date.now()).toISOString();
  for(const d of observed.diversions) {d.lastObservedAt=new Date(Date.parse(d.lastObservedAt)+shift).toISOString();d.expiresAt=new Date(Date.parse(d.expiresAt)+shift).toISOString();}
  const fixture=await (await import('./src/ttc/fixture.js')).loadTtcUiFixture();
  fixture.ttcAlerts.items=[];fixture.ttcDiversions=observed;
  (await import('./src/ttc/ui.js')).renderTtc(fixture);
  return `sirento-observed:${observed.diversions[0].id}`;
 });
 await page.waitForFunction(id=>document.querySelector('.ttc-disruption')?.dataset.ttcId===id,id);
 assert.equal(await page.locator('.ttc-disruption').count(),1);
 assert.equal(await page.locator('.ttc-detail .section-kicker').textContent(),'SIRENTO OBSERVED DIVERSION');
 assert.equal(await page.locator('#ttcLayerControl').isVisible(),true);
 assert.equal(await page.locator('#ttcLegend-diversion').evaluate(el=>el.hidden),false);
 await page.locator('.ttc-disruption > summary').click();await page.locator('.ttc-show-map').click();
 const diag=await page.evaluate(async()=>(await import('./src/ttc/ui.js')).captureTtcRenderState());
 assert.equal(diag.parts,1);assert.equal(diag.layers,2);assert.equal(diag.selected,id);
 await page.locator('.ttc-hit').first().dispatchEvent('click');
 assert.equal((await page.evaluate(async()=>(await import('./src/ttc/ui.js')).captureTtcRenderState())).selected,id);
 results.push({scenario:'unassociated-public',...diag});await page.close();
}
for(const mode of ['alert-only','multiple','expired','unavailable','empty']) {
 const page=await browser.newPage({viewport:{width:390,height:900}});
 await page.goto(`${process.env.TTC_UI_URL || 'http://127.0.0.1:8765/'}?mobileAuditFixture=many&mobileAuditView=calls&ttcFixture=${mode}`,{waitUntil:'networkidle'});
 await page.waitForFunction(()=>document.documentElement.dataset.secondaryLoadState==='ready');
 const state=await page.evaluate(async()=>({diag:(await import('./src/ttc/ui.js')).captureTtcRenderState(),cards:document.querySelectorAll('.ttc-disruption').length,text:document.querySelector('#ttcContent').textContent,visible:!!document.querySelector('#ttcContent').getClientRects().length}));
 assert.equal(state.cards,mode==='empty'?0:mode==='multiple'?2:1);
 assert.equal(state.diag.parts,mode==='empty'?0:mode==='multiple'?3:1);
 if(mode==='empty') assert.equal(state.visible,false);
 if(mode==='unavailable') assert.match(state.text,/unavailable/);
 await page.locator('#ttcListHome').scrollIntoViewIfNeeded();await page.screenshot({path:`${out}/${mode}.png`});results.push({mode,...state});await page.close();
}
// Story 51D: an active official Service Change that a confirmed observed path
// claims must render once, with its geometry, and must not also appear in the
// citywide transit list.
{
 const page=await browser.newPage({viewport:{width:390,height:900}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(`${process.env.TTC_UI_URL || 'http://127.0.0.1:8765/'}?mobileAuditFixture=many&mobileAuditView=calls&ttcFixture=official-advisory`,{waitUntil:'networkidle'});
 await page.waitForFunction(()=>document.documentElement.dataset.secondaryLoadState==='ready');
 const state=await page.evaluate(async()=>({
   diag:(await import('./src/ttc/ui.js')).captureTtcRenderState(),
   cards:document.querySelectorAll('.ttc-disruption').length,
   ids:[...document.querySelectorAll('.ttc-disruption')].map(n=>n.dataset.ttcId),
   text:document.querySelector('#ttcContent').textContent,
   citywide:document.querySelector('#transitList').textContent,
   citywideCount:document.querySelector('#transitCount').textContent
 }));
 // The official Service Change renders once, keyed by its official id.
 assert.equal(state.cards,1);
 assert.deepEqual(state.ids,['102']);
 assert.match(state.text,/94 Wellesley/);
 assert.match(state.text,/Observed by SirenTO/);
 // The observed path is drawn on the map (route-only advisory: no scheduled segment).
 assert.equal(state.diag.parts,1);
 // The claimed advisory is deduped from the citywide list.
 assert.doesNotMatch(state.citywide,/94 Wellesley/);
 assert.equal(state.citywideCount,'0');
 assert.deepEqual(errors,[]);
 await page.locator('#ttcListHome').scrollIntoViewIfNeeded();await page.screenshot({path:`${out}/official-advisory.png`});
 results.push({mode:'official-advisory',...state});await page.close();
}
} finally {await timing.time('browser-close',()=>browser.close());await writeFile(`${out}/results.json`,JSON.stringify(results,null,2));console.log(timing.format({format:timingFormat,label:'test:ttc-ui:browser'}));}
console.log(JSON.stringify(results.map(result=>({...result,text:undefined})),null,2));
