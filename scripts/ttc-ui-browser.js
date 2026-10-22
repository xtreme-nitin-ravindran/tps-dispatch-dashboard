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
 timing.start(`assertions:${width}`);
 await page.waitForSelector('#observedDiversionsList .incident-card',{state:'attached'}).catch(async error=>{console.log({width,errors,body:await page.locator('body').innerText()});await page.screenshot({path:`${out}/failure-${width}.png`});throw error;});
 const initialMaxLongTask=await page.evaluate(()=>{const max=Math.max(0,...window.ttcLongTasks);window.ttcLongTasks=[];return max;});
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth),width);
 const diag=()=>page.evaluate(async()=>(await import('./src/ttc/ui.js')).captureTtcRenderState());
 assert.equal((await diag()).parts,2);
 if(width<=430) {
  // Expanding the ordinary Map sheet must show calls before any pin selection,
  // regardless of TTC layer visibility or a round trip through Calls.
  assert.equal(await page.locator('[data-call-id].selected').count(),0);
  for(const visible of [true,false]) {
   await page.locator('#ttcOverlay').setChecked(visible);
   for(const height of ['half','expanded']) {
    await page.locator(`[data-sheet-target="${height}"]`).click();
    await page.locator('#mobileSheetBody').evaluate(el=>{el.scrollTop=0;});
    const call=page.locator('#mobileSheetCallList .incident-card').first();
    await page.waitForFunction(()=>{const call=document.querySelector('#mobileSheetCallList .incident-card').getBoundingClientRect(),body=document.querySelector('#mobileSheetBody').getBoundingClientRect();return call.top>=body.top&&call.top<body.bottom;});
    assert.equal(await call.isVisible(),true);
    assert.equal(await page.locator('#observedDiversions').isVisible(),false);
   }
  }
  if(width===390) {await page.locator('#dispatchMap').scrollIntoViewIfNeeded();await page.screenshot({path:`${out}/mobile-default-calls.png`});}
  await page.locator('button[data-mobile-view="calls"]').click();
  assert.equal(await page.locator('#observedDiversions').isVisible(),true);
  await page.locator('button[data-mobile-view="map"]').click();
  assert.equal(await page.locator('#observedDiversions').isVisible(),false);
  await page.locator('#mobileDisruptionsControl').click();
  assert.equal(await page.locator('#observedDiversions').isVisible(),true);
 }
 if(width>=768) {
  // On desktop the diversion list sits below the map. Bring the first card into
  // view (as a user reading the list would), then confirm the map has scrolled
  // above the viewport before the card action reveals it.
  await page.locator('#observedDiversionsList .incident-card').first().scrollIntoViewIfNeeded();
  const before=await page.locator('#dispatchMap').boundingBox();assert.ok(before.y+before.height<0,'desktop diversion action starts with map above viewport');
 }
 await page.locator('#observedDiversionsList .incident-card').first().click();
 if(width>=768) {
  await page.waitForFunction(()=>{const r=document.querySelector('#dispatchMap').getBoundingClientRect();return r.top>=0&&r.bottom<=window.innerHeight;});
  const route=await page.locator('.ttc-line--diversion').boundingBox(),map=await page.locator('#dispatchMap').boundingBox();
  assert.ok(route.width>0&&route.height>0);assert.ok(route.x>=map.x&&route.y>=map.y&&route.x+route.width<=map.x+map.width&&route.y+route.height<=map.y+map.height,'selected diversion is inside the visible map');
 }
 assert.equal((await diag()).selected,'fixture-detour');
 if(width<=430) assert.equal(await page.locator('#mobileClosureDetail').isVisible(),true);
 for(const theme of ['light','dark']) {
  await page.selectOption('#themePreference',theme);
  await page.locator('#dispatchMap').scrollIntoViewIfNeeded();
  await page.screenshot({path:`${out}/${width}-${theme}.png`});
 }
 // Actual paths retain identities through CSS theme changes and pan/zoom. The
 // full 12-cycle exercise runs at the canonical mobile (390) and desktop (1440)
 // widths; the remaining widths run a reduced 3-cycle pass so the identity
 // property is still exercised at every width while the six-width suite stays
 // affordable (Story 68 revisit, October 2026).
 const cycles=width===390||width===1440?12:3;
 const ids=await page.locator('.ttc-line').evaluateAll(nodes=>nodes.map((n,i)=>{n.dataset.testIdentity=String(i);return n.dataset.testIdentity;}));
 if(width<=430) {await page.locator('.closure-detail-back').click();assert.equal(await page.locator('#mobileSheetCallList').isVisible(),true);assert.equal(await page.locator('#observedDiversions').isVisible(),false);assert.equal(await page.evaluate(()=>document.activeElement.id),'mobileSheetToggle');}
 for(let i=0;i<cycles;i++) {
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
  const cue=page.locator(width<=430?'#mobileClosureDetail .ttc-evidence-status':'#observedDiversionsList .ttc-evidence-status').first();
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
 assert.equal((await diag()).layers,2);assert.equal(await page.locator('#observedDiversionsList .incident-card').count(),1);
 assert.equal((await diag()).selected,'fixture-detour');
 await page.evaluate(async()=>{const f=structuredClone(window.ttcBrowserFixture);f.ttcAlerts.items=[];f.ttcDiversions.diversions=[];(await import('./src/ttc/ui.js')).renderTtc(f);});
 assert.equal((await diag()).layers,0);assert.equal((await diag()).selected,null);assert.equal(await page.locator('#observedDiversionsList .incident-card').count(),0);
 assert.equal(await page.locator('#ttcLayerControl').isVisible(),false);
 assert.deepEqual(errors,[]);
 const maxLongTask=await page.evaluate(()=>Math.max(0,...window.ttcLongTasks));assert.ok(maxLongTask<2000);
 timing.end(`assertions:${width}`);
 results.push({width,errors,layers:(await diag()).layers,cycles,initialMaxLongTask,maxLongTask});await page.close();
}
// Story 68C: the app's real minute-based summary refresh (setInterval 60000 in
// src/app/app.js) must not clobber a focused TTC detail's summary. This used to
// be exercised with a 61-second wall-clock wait; Playwright clock emulation now
// drives the same interval deterministically. The clock is installed only for
// this isolated page so the six-width loop above keeps real time (Leaflet and
// fixture readiness are unaffected).
{
 const page=await browser.newPage({viewport:{width:390,height:900}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const clockBase=Date.now();
 await page.clock.install({time:clockBase});
 await page.goto(`${process.env.TTC_UI_URL || 'http://127.0.0.1:8765/'}?mobileAuditFixture=many&mobileAuditView=calls&ttcFixture=confirmed`,{waitUntil:'networkidle'});
 await awaitFixtureReady(page);
 await page.waitForSelector('#observedDiversionsList .incident-card',{state:'attached'});
 await page.locator('#observedDiversionsList .incident-card').first().click();
 assert.equal(await page.locator('#mobileClosureDetail').isVisible(),true);
 assert.equal(await page.locator('#mobileSheetSummary').textContent(),'504 King');
 // Advance the emulated clock exactly one minute so the real
 // setInterval(...,60000) fires renderNearbySummary() while the detail is focused.
 await page.clock.runFor(60000);
 assert.equal(await page.locator('#mobileSheetSummary').textContent(),'504 King');
 assert.deepEqual(errors,[]);
 results.push({scenario:'minute-tick-clock',summary:await page.locator('#mobileSheetSummary').textContent()});await page.close();
}
// A real confirmed public path with no official references remains selectable.
{
 const page=await browser.newPage({viewport:{width:390,height:900}});
 await page.goto(`${process.env.TTC_UI_URL || 'http://127.0.0.1:8765/'}?mobileAuditFixture=many&mobileAuditView=calls&ttcFixture=confirmed`,{waitUntil:'networkidle'});
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
 await page.waitForFunction(id=>document.querySelector('#observedDiversionsList .incident-card')?.dataset.ttcId===id,id);
 assert.equal(await page.locator('#observedDiversionsList .incident-card').count(),1);
 assert.equal(await page.locator('#observedDiversionsList .ttc-detail .section-kicker').textContent(),'SIRENTO OBSERVED DIVERSION');
 assert.equal(await page.locator('#ttcLayerControl').evaluate(el=>el.hidden),false);
 assert.equal(await page.locator('#ttcLegend-diversion').evaluate(el=>el.hidden),false);
 await page.locator('#observedDiversionsList .incident-card').first().click();
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
 const state=await page.evaluate(async()=>({diag:(await import('./src/ttc/ui.js')).captureTtcRenderState(),cards:document.querySelectorAll('#observedDiversionsList .incident-card').length,text:document.querySelector('#observedDiversions').textContent,visible:!!document.querySelector('#observedDiversions').getClientRects().length}));
 assert.equal(state.cards,mode==='empty'?0:mode==='multiple'?2:1);
 assert.equal(state.diag.parts,mode==='empty'?0:mode==='multiple'?3:1);
 if(mode==='empty') assert.equal(state.visible,false);
 if(mode==='unavailable') assert.match(state.text,/unavailable/);
 await page.locator('#disruptions').scrollIntoViewIfNeeded();await page.screenshot({path:`${out}/${mode}.png`});results.push({mode,...state});await page.close();
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
   cards:document.querySelectorAll('#observedDiversionsList .incident-card').length,
   ids:[...document.querySelectorAll('#observedDiversionsList .incident-card')].map(n=>n.dataset.ttcId),
   text:document.querySelector('#observedDiversions').textContent,
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
 await page.locator('#observedDiversions').scrollIntoViewIfNeeded();await page.screenshot({path:`${out}/official-advisory.png`});
 results.push({mode:'official-advisory',...state});await page.close();
}
// Story 74 P1: a subway-style advisory with ordered affected stops (including
// same-station platform pairs) draws a deduped dashed affected section that
// follows the selected radius; the renamed map section sits right after roads
// and the complete citywide list stays at the bottom.
{
 const page=await browser.newPage({viewport:{width:1440,height:900}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(`${process.env.TTC_UI_URL || 'http://127.0.0.1:8765/'}?mobileAuditFixture=many&ttcFixture=affected`,{waitUntil:'networkidle'});
 await awaitFixtureReady(page);
 await page.waitForSelector('#observedDiversionsList .incident-card',{state:'attached'});
 const state=await page.evaluate(async()=>({
   diag:(await import('./src/ttc/ui.js')).captureTtcRenderState(),
   cards:document.querySelectorAll('#observedDiversionsList .incident-card').length,
   ids:[...document.querySelectorAll('#observedDiversionsList .incident-card')].map(n=>n.dataset.ttcId),
   scope:document.querySelector('#observedDiversionsScope').textContent,
   citywideCount:document.querySelector('#transitCount').textContent,
   citywide:document.querySelector('#transitList').textContent,
   order:(()=>{const details=[...document.querySelectorAll('#disruptions > details')];const index=selector=>details.findIndex(d=>d.querySelector(selector));return {roads:index('#roadsList'),observed:index('#observedDiversionsList'),transit:index('#transitList')};})()
 }));
 // The deduped affected section renders beside the fixture detour; the renamed
 // section sits right after roads; the complete citywide list stays at the bottom.
 assert.equal(state.cards,2);
 assert.ok(state.ids.includes('mobile-audit-subway'));
 assert.match(state.scope,/TTC disruptions/);
 assert.deepEqual(state.order,{roads:0,observed:1,transit:2});
 assert.equal(state.citywideCount,'1');
 assert.match(state.citywide,/Line 2 Bloor-Danforth/);
 assert.equal(state.diag.parts,3);
 assert.equal(await page.locator('.ttc-line--affected').count(),1);
 const line=await page.locator('.ttc-line--affected').boundingBox(),map=await page.locator('#dispatchMap').boundingBox();
 assert.ok(line.width>0&&line.height>0);assert.ok(line.x>=map.x&&line.y>=map.y&&line.x+line.width<=map.x+map.width&&line.y+line.height<=map.y+map.height,'affected section is inside the visible map');
 // Selecting the subway card reveals and selects the affected section.
 await page.locator('#observedDiversionsList .incident-card[data-ttc-id="mobile-audit-subway"]').click();
 assert.equal((await page.evaluate(async()=>(await import('./src/ttc/ui.js')).captureTtcRenderState())).selected,'mobile-audit-subway');
 // A radius near the fixture detour drops the far affected card but never the
 // complete citywide list.
 await page.evaluate(async()=>{
   const {loadTtcUiFixture}=await import('./src/ttc/fixture.js');
   window.ttcBrowserFixture=await loadTtcUiFixture();
   const f=structuredClone(window.ttcBrowserFixture);
   (await import('./src/ttc/ui.js')).renderTtc(f,undefined,{origin:[43.65,-79.4],radius:1});
 });
 await page.waitForFunction(()=>document.querySelectorAll('#observedDiversionsList .incident-card').length===1);
 assert.match(await page.locator('#observedDiversionsScope').textContent(),/within 1 km/);
 assert.equal(await page.locator('.ttc-line--affected').count(),0);
 assert.equal(await page.locator('#transitCount').textContent(),'1');
 await page.locator('#disruptions').scrollIntoViewIfNeeded();await page.screenshot({path:`${out}/affected.png`});
 assert.deepEqual(errors,[]);
 results.push({mode:'affected',...state});await page.close();
}
} finally {await timing.time('browser-close',()=>browser.close());await writeFile(`${out}/results.json`,JSON.stringify(results,null,2));console.log(timing.format({format:timingFormat,label:'test:ttc-ui:browser'}));}
console.log(JSON.stringify(results.map(result=>({...result,text:undefined})),null,2));
