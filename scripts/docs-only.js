// Conservative documentation-only classifier for CI.
//
// A change may skip the expensive application test jobs only when every changed
// path is documentation that no executable tooling consumes. The classifier is
// deliberately allow-list based: a Markdown extension alone is not sufficient,
// because a `.md` file can be read by a script, test, workflow, or build step.
//
// The allow-list is intentionally narrow:
//   - documentation extensions: .md, .txt, .rst
//   - documentation locations: the docs/ directory, or an explicit set of
//     well-known root documentation files
// A candidate is rejected when it is referenced by any executable file
// (scripts, tests, workflows, configuration, or package manifests), so a
// documentation file that tooling reads can never be treated as inert.
//
// Renames and deletions are handled conservatively: both the old and the new
// path must independently qualify as documentation-only, otherwise the change
// keeps full validation.

import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// Documentation file extensions that are inert on their own.
export const DOC_EXTENSIONS = ['.md', '.txt', '.rst'];

// Explicit root documentation files. A new root file must be added here on
// purpose; a blanket "*.md" rule is intentionally avoided.
export const ROOT_DOC_FILES = [
  'README.md',
  'AGENTS.md',
  'LICENSE',
  'CHANGELOG.md',
  'CONTRIBUTING.md',
  'CODE_OF_CONDUCT.md',
  'SECURITY.md'
];

// Directory prefixes whose documentation files are inert.
export const DOC_DIRECTORIES = ['docs/'];

// Executable files that could consume a documentation path. These are the
// sources scanned for references before a documentation file is trusted.
export const TOOLING_GLOBS = [
  'scripts',
  'test',
  'src',
  'concourse',
  '.github',
  'package.json',
  'package-lock.json',
  'docker/Dockerfile.test',
  'docker/Dockerfile.test.dockerignore',
  'eslint.config.js',
  'ruff.toml',
  '_config.yml',
  'index.html',
  'src/app/app.js',
  'service-worker.js',
  'manifest.webmanifest'
];

// Configuration files where a bare path token is a real reference (for example
// a YAML list item or an exclude entry). In code files a bare mention is often
// prose, so only quoted/backticked literals count there.
export const CONFIG_EXTENSIONS = ['.yml', '.yaml', '.toml', '.json', '.cfg', '.ini'];

// The classifier's own source and test mention documentation paths as string
// literals, but they do not consume those files. Excluding them prevents the
// classifier from flagging itself and keeps the reference scan meaningful.
export const SELF_FILES = ['scripts/docs-only.js', 'test/docs-only.test.js'];

function hasDocExtension(path) {
  return DOC_EXTENSIONS.some(ext => path.toLowerCase().endsWith(ext));
}

function isInDocDirectory(path) {
  return DOC_DIRECTORIES.some(dir => path.startsWith(dir));
}

function isRootDocFile(path) {
  return ROOT_DOC_FILES.includes(path);
}

function isConfigFile(path) {
  return CONFIG_EXTENSIONS.some(ext => path.toLowerCase().endsWith(ext));
}

// A path is a documentation candidate when it has a documentation extension and
// lives in an allowed documentation location.
export function isDocumentationCandidate(path) {
  if (typeof path !== 'string' || path.length === 0) return false;
  if (!hasDocExtension(path)) return false;
  return isInDocDirectory(path) || isRootDocFile(path);
}

// Build a list of { file, text } pairs for the executable files to scan. The
// caller supplies the file list and reader so this stays deterministic and
// testable.
export function collectToolingFiles(files, readFile) {
  const collected = [];
  for (const file of files) {
    try {
      collected.push({ file, text: readFile(file) });
    } catch {
      // A missing or unreadable tooling file cannot reference anything.
    }
  }
  return collected;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// True when the documentation path is referenced by executable tooling.
//   - In configuration files a bare path token counts (for example a YAML list
//     item or an exclude entry).
//   - In code/markup files only a quoted or backticked literal counts, so a
//     prose mention in a user-facing string does not keep full validation.
// The match is deliberately conservative: any real path reference keeps full
// validation.
export function isReferencedByTooling(path, toolingFiles) {
  if (!path) return false;
  const escaped = escapeRegExp(path);
  const quoted = new RegExp(`["'\`]${escaped}["'\`]`);
  const bare = new RegExp(`(^|[\\s"'\\[,(])${escaped}([\\s"'\\],)]|$)`);
  for (const { file, text } of toolingFiles) {
    if (quoted.test(text)) return true;
    if (isConfigFile(file) && bare.test(text)) return true;
  }
  return false;
}

// Classify a single changed path. Returns { docsOnly, reason }.
export function classifyPath(path, toolingFiles) {
  if (!isDocumentationCandidate(path)) {
    return { docsOnly: false, reason: `not documentation: ${path}` };
  }
  if (isReferencedByTooling(path, toolingFiles)) {
    return { docsOnly: false, reason: `documentation consumed by tooling: ${path}` };
  }
  return { docsOnly: true, reason: `documentation-only: ${path}` };
}

// Classify a whole change set. `paths` is a flat list of every path touched by
// the change, including both sides of a rename and the path of a deletion.
export function classifyChanges(paths, toolingFiles) {
  if (!Array.isArray(paths) || paths.length === 0) {
    return { docsOnly: false, reason: 'no changed paths detected' };
  }
  for (const path of paths) {
    const result = classifyPath(path, toolingFiles);
    if (!result.docsOnly) return { docsOnly: false, reason: result.reason };
  }
  return { docsOnly: true, reason: `documentation-only change (${paths.length} file(s))` };
}

// Parse `git diff --name-status` output into a flat list of touched paths.
// Renames (Rxxx) contribute both the old and new path; deletions (D) contribute
// the deleted path. This keeps renames and deletions conservative.
export function parseNameStatus(output) {
  const paths = [];
  for (const line of output.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const parts = trimmed.split('\t');
    const status = parts[0];
    if (status.startsWith('R') || status.startsWith('C')) {
      // Rename/copy: old path then new path.
      if (parts[1]) paths.push(parts[1]);
      if (parts[2]) paths.push(parts[2]);
    } else if (parts[1]) {
      paths.push(parts[1]);
    }
  }
  return paths;
}

// Read the changed paths for a push or pull request from git.
export function changedPaths(base, head, cwd = process.cwd()) {
  const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8' });
  const range = base && head ? `${base}...${head}` : 'HEAD^...HEAD';
  return parseNameStatus(git('diff', '--name-status', '--find-renames', range));
}

// Recursively list regular files under a directory, returning repository-relative
// paths. Used to enumerate tooling files without depending on git, so the
// classifier works both in CI and inside the read-only Docker test mount. An
// unreadable directory contributes no files rather than failing the run.
export function listFilesUnder(root, relative) {
  const absolute = join(root, relative);
  let entries;
  try {
    entries = readdirSync(absolute, { withFileTypes: true });
  } catch {
    return [];
  }
  const files = [];
  for (const entry of entries) {
    const child = relative ? `${relative}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      files.push(...listFilesUnder(root, child));
    } else if (entry.isFile()) {
      files.push(child);
    }
  }
  return files;
}

// Enumerate the executable tooling files in the repository. Directory globs are
// walked recursively; file globs are included when present. The classifier's own
// files are excluded because their string literals are not real consumers.
export function listToolingFiles(cwd = process.cwd()) {
  const files = [];
  for (const glob of TOOLING_GLOBS) {
    const absolute = resolve(cwd, glob);
    let stats;
    try {
      stats = statSync(absolute);
    } catch {
      continue;
    }
    if (stats.isDirectory()) {
      files.push(...listFilesUnder(cwd, glob));
    } else if (stats.isFile()) {
      files.push(glob);
    }
  }
  return files.filter(file => !SELF_FILES.includes(file));
}

// Read the executable tooling files in the repo as { file, text } pairs.
export function readToolingFiles(cwd = process.cwd()) {
  const files = listToolingFiles(cwd);
  return collectToolingFiles(files, file => readFileSync(resolve(cwd, file), 'utf8'));
}

// Full classification for the current repository state.
export function classifyRepository({ base, head, cwd = process.cwd() } = {}) {
  const paths = changedPaths(base, head, cwd);
  const toolingFiles = readToolingFiles(cwd);
  return classifyChanges(paths, toolingFiles);
}

function main() {
  const base = process.env.DOCS_ONLY_BASE || process.argv[2];
  const head = process.env.DOCS_ONLY_HEAD || process.argv[3];
  let result;
  try {
    result = classifyRepository({ base, head });
  } catch (error) {
    // Fail safe: an unexpected classification error must keep full validation
    // rather than skip it, and must never leave a required context unreported.
    result = { docsOnly: false, reason: `classification failed; keeping full validation: ${error.message}` };
  }
  console.log(result.reason);
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `docs_only=${result.docsOnly}\n`);
  }
  process.exitCode = 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main();
}
