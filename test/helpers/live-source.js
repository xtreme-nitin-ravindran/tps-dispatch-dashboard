import assert from 'node:assert/strict';

export const options = { timeout: 45000 };
export async function response(url) {
  const result = await fetch(url, { signal: AbortSignal.timeout(30000), headers: {
    'User-Agent': 'SirenTO-source-check/1.0 (+https://github.com/xtreme-nitin-ravindran/tps-dispatch-dashboard)'
  }});
  assert.ok(result.ok, `${url}: HTTP ${result.status}`);
  return result;
}
export async function json(url) {
  const data = await (await response(url)).json();
  assert.ok(!data.error, `${url}: ${JSON.stringify(data.error)}`);
  return data;
}

