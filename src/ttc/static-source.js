import { readFile, writeFile, mkdir, rename, rm, stat } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { STATIC_URL, zipTables, buildStaticIndex, digest } from './static-gtfs.js';

const MAX_BYTES = 128 * 1024 * 1024;
async function download(fetchImpl) {
  const response = await fetchImpl(STATIC_URL,{signal:AbortSignal.timeout(60000)});
  if (!response.ok) throw new Error(`TTC static HTTP ${response.status}`);
  const chunks = []; let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > MAX_BYTES) throw new Error('TTC static ZIP exceeds size limit');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
export async function loadStaticGtfs({cachePath = process.env.TTC_STATIC_CACHE || '.cache/ttc/surface.zip', now = new Date(), fetchImpl = fetch, maxAgeMs = 86400000, log = () => {}} = {}) {
  const start = performance.now();
  const parse = bytes => buildStaticIndex(zipTables(bytes),digest(bytes));
  let cached, modified;
  try { cached = await readFile(cachePath); modified = (await stat(cachePath)).mtime; }
  catch (error) { if (error.code !== 'ENOENT') log({source:'ttc-static',cacheError:error.message}); }
  let prior;
  if (cached) {
    try { prior = parse(cached); }
    catch (error) { log({source:'ttc-static',cacheError:error.message}); }
  }
  const result = (index,status,fetchedAt) => ({index,metadata:{status,fetchedAt:fetchedAt.toISOString(),checkedAt:now.toISOString()},metrics:{loadMs:Math.round(performance.now()-start),rssBytes:process.memoryUsage().rss,...index.counts}});
  if (prior && now-modified >= 0 && now-modified < maxAgeMs) return result(prior,'ok',modified);
  let failure;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const bytes = await download(fetchImpl);
      // Validate every table and internal reference before replacing known-good bytes.
      const index = parse(bytes);
      await mkdir(dirname(cachePath),{recursive:true});
      const temporary = `${cachePath}.${randomUUID()}.tmp`;
      try { await writeFile(temporary,bytes); await rename(temporary,cachePath); }
      finally { await rm(temporary,{force:true}); }
      return result(index,'ok',now);
    } catch (error) { failure = error; }
  }
  log({source:'ttc-static',status:prior ? 'stale' : 'unavailable',error:failure.message});
  if (prior) return result(prior,'stale',modified);
  throw failure;
}
