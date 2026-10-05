import { readFile, writeFile, rename } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

// Frontend asset tags look like "story-43-1" or "source-states-1".
const ASSET_TAG_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
// The service worker only removes caches whose key starts with this prefix,
// so the cache version must keep that prefix to preserve cache-removal behavior.
const CACHE_PREFIX = 'sirento-shell-';
const CACHE_VERSION_PATTERN = /^sirento-shell-v\d+$/;

// Each rule rewrites one version reference. Patterns are anchored to the exact
// surrounding text so unrelated version strings are never touched. The capture
// group holds the version token that is replaced with the requested value.
const RULES = [
  {
    file: 'index.html',
    replacements: [
      { pattern: /(\.\/styles\.css\?v=)[^"'<>\s]+/g, value: 'assetTag' },
      { pattern: /(\.\/app\.js\?v=)[^"'<>\s]+/g, value: 'assetTag' }
    ]
  },
  {
    file: 'service-worker.js',
    replacements: [
      { pattern: /(CACHE_VERSION = ")[^"]+/g, value: 'cacheVersion' }
    ]
  },
  {
    file: 'test/cluster-asset-versioning.test.js',
    replacements: [
      { pattern: /(app\\\.js\\\?v=)[A-Za-z0-9._-]+/g, value: 'assetTag' },
      { pattern: /(CACHE_VERSION = ")[^"]+/g, value: 'cacheVersion' }
    ]
  },
  {
    file: 'test/mobile-compositing.test.js',
    replacements: [
      { pattern: /(styles\\\.css\\\?v=)[A-Za-z0-9._-]+/g, value: 'assetTag' },
      { pattern: /(CACHE_VERSION = ")[^"]+/g, value: 'cacheVersion' }
    ]
  },
  {
    file: 'test/pwa-metadata.test.js',
    replacements: [
      { pattern: /(app\\\.js\\\?v=)[A-Za-z0-9._-]+/g, value: 'assetTag' }
    ]
  }
];

export function validateAssetVersionInput({ assetTag, cacheVersion } = {}) {
  const errors = [];
  if (typeof assetTag !== 'string' || !ASSET_TAG_PATTERN.test(assetTag)) {
    errors.push(`Invalid asset tag: ${JSON.stringify(assetTag)}`);
  }
  if (typeof cacheVersion !== 'string' || !CACHE_VERSION_PATTERN.test(cacheVersion)) {
    errors.push(`Invalid cache version: ${JSON.stringify(cacheVersion)} (expected ${CACHE_PREFIX}v<number>)`);
  }
  return errors;
}

function applyReplacements(source, replacements, { assetTag, cacheVersion }) {
  let updated = source;
  for (const { pattern, value } of replacements) {
    const replacement = value === 'cacheVersion' ? cacheVersion : assetTag;
    updated = updated.replace(pattern, (_match, ...groups) => {
      // Drop the trailing offset/string arguments RegExp passes to the callback.
      const captured = groups.slice(0, groups.length - 2);
      return captured.join('') + replacement;
    });
  }
  return updated;
}

export async function bumpAssetVersion({ assetTag, cacheVersion, root = process.cwd() } = {}) {
  const errors = validateAssetVersionInput({ assetTag, cacheVersion });
  if (errors.length) throw new Error(errors.join('\n'));

  const planned = [];
  for (const rule of RULES) {
    const path = join(root, rule.file);
    const source = await readFile(path, 'utf8');
    const updated = applyReplacements(source, rule.replacements, { assetTag, cacheVersion });
    if (updated !== source) planned.push({ path, updated });
  }

  // All validation and content generation happens before any write so an
  // invalid invocation leaves every file untouched.
  for (const { path, updated } of planned) {
    const temp = join(dirname(path), `.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`);
    await writeFile(temp, updated);
    await rename(temp, path);
  }
  return planned.map(({ path }) => path);
}

function parseArgs(argv) {
  const args = { assetTag: undefined, cacheVersion: undefined, root: undefined };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === '--asset') args.assetTag = argv[++index];
    else if (flag === '--cache') args.cacheVersion = argv[++index];
    else if (flag === '--root') args.root = argv[++index];
    else if (flag === '--help' || flag === '-h') args.help = true;
    else throw new Error(`Unknown argument: ${flag}`);
  }
  return args;
}

const USAGE = 'Usage: node scripts/bump-asset-version.js --asset <tag> --cache <sirento-shell-vN> [--root <dir>]';

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const args = parseArgs(process.argv.slice(2));
    if (args.help) {
      console.log(USAGE);
    } else {
      const errors = validateAssetVersionInput(args);
      if (errors.length) throw new Error(errors.join('\n'));
      const changed = await bumpAssetVersion({ ...args, root: args.root || process.cwd() });
      console.log(changed.length
        ? `Updated asset version to ${args.assetTag} and cache version to ${args.cacheVersion}:\n${changed.join('\n')}`
        : 'No version references changed');
    }
  } catch (error) {
    console.error(error.message);
    console.error(USAGE);
    process.exitCode = 1;
  }
}
