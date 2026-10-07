// Extract a named inline Concourse task config from a pipeline YAML file.
//
// Concourse pipelines may define a task either inline (`config:` with the task
// config nested beneath it) or by reference (`file:` pointing at a real YAML
// file). AGENTS.md requires that a change affecting a Concourse task be verified
// with `fly execute` against the working tree, and forbids maintaining a
// duplicate `concourse/*.yml` task definition because it would drift from the
// pipeline. This module is the single source of truth for locating a task in the
// pipeline and producing the config `fly execute -c` needs, so the extraction is
// never hand-copied.
//
// The extraction is deliberately structural, not a general YAML parser: it
// locates the `- task: <name>` list item, then captures the block nested under
// that task's `config:` key by indentation. This is sufficient for the pipeline
// shape this repository uses and avoids a YAML dependency. It fails clearly
// rather than guessing when the task is missing or the shape is unexpected.

import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// A task list item is `- task: <name>` (optionally quoted). The leading dash may
// be indented; the name is the rest of the line with surrounding quotes removed.
const TASK_ITEM = /^(\s*)-\s+task:\s*(.+?)\s*$/;

const stripQuotes = value => {
  const trimmed = value.trim();
  if (trimmed.length >= 2 && ((trimmed[0] === '"' && trimmed.endsWith('"')) || (trimmed[0] === "'" && trimmed.endsWith("'")))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
};

const indentOf = line => line.length - line.trimStart().length;
const isBlank = line => line.trim() === '';
const isComment = line => line.trimStart().startsWith('#');

// Locate the named task item and return its line index plus the indentation of
// the `- task:` dash. Returns null when no such task exists.
function findTask(lines, name) {
  for (let i = 0; i < lines.length; i++) {
    const match = TASK_ITEM.exec(lines[i]);
    if (match && stripQuotes(match[2]) === name) {
      return { index: i, dashIndent: match[1].length };
    }
  }
  return null;
}

// Within a task item, find the `config:` or `file:` key that belongs to it. The
// key must be indented deeper than the task dash and shallower than any nested
// block, and must be the first such key before the next task item.
function findTaskKey(lines, start, dashIndent) {
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i];
    if (isBlank(line) || isComment(line)) continue;
    const indent = indentOf(line);
    // A new task item at the same or shallower indentation ends this task.
    if (TASK_ITEM.test(line) && indent <= dashIndent) return null;
    // A sibling list item (e.g. `- get:`) at the dash indentation ends this task.
    if (indent <= dashIndent && line.trimStart().startsWith('- ')) return null;
    const keyMatch = /^(\s*)(config|file):\s*(.*)$/.exec(line);
    if (keyMatch && indent > dashIndent) {
      return { index: i, indent, key: keyMatch[2], inline: keyMatch[3].trim() };
    }
  }
  return null;
}

// Capture the block nested under a `config:` key: every following line that is
// blank or indented deeper than the key, de-indented by (keyIndent + 2). Stops
// at the first non-blank line at or below the key indentation.
function captureBlock(lines, keyIndex, keyIndent) {
  const body = [];
  for (let i = keyIndex + 1; i < lines.length; i++) {
    const line = lines[i];
    if (isBlank(line)) { body.push(''); continue; }
    const indent = indentOf(line);
    if (indent <= keyIndent) break;
    const remove = Math.min(keyIndent + 2, indent);
    body.push(line.slice(remove));
  }
  // Trim trailing blank lines so the extracted config ends cleanly.
  while (body.length && body[body.length - 1] === '') body.pop();
  return body.join('\n') + '\n';
}

// Extract the config for a named task.
//
// Returns one of:
//   { kind: 'inline', config }  — the de-indented inline config text
//   { kind: 'file', path }      — the referenced task file path (relative)
//
// Throws a clear Error when the task is missing or has neither `config:` nor
// `file:`.
export function extractTaskConfig(pipelineText, name) {
  const lines = pipelineText.split('\n');
  const task = findTask(lines, name);
  if (!task) throw new Error(`task not found: ${name}`);
  const key = findTaskKey(lines, task.index, task.dashIndent);
  if (!key) throw new Error(`task has no config: or file: key: ${name}`);
  if (key.key === 'file') {
    if (!key.inline) throw new Error(`task file: path is empty: ${name}`);
    return { kind: 'file', path: stripQuotes(key.inline) };
  }
  const config = captureBlock(lines, key.index, key.indent);
  if (!config.trim()) throw new Error(`task config: block is empty: ${name}`);
  return { kind: 'inline', config };
}

// Run the CLI for the given argv. Exported so argument handling and output are
// covered in-process; a spawned CLI's coverage is not captured by the runner.
//
// Usage: node scripts/lib/extract-task.js <pipeline> <task-name> <scratch-path>
//
// Prints `inline:<scratch-path>` after writing the inline config there, or
// `file:<path>` for a `file:` task. Exits 2 on a usage error and 3 on an
// extraction failure, with a clear message on stderr.
export async function runCli({
  argv = process.argv,
  readFileImpl = readFile,
  writeFileImpl = writeFile,
  out = line => console.log(line),
  err = line => console.error(line),
  exit = code => process.exit(code)
} = {}) {
  const [, , pipelinePath, name, scratchPath] = argv;
  if (!pipelinePath || !name || !scratchPath) {
    err('usage: node scripts/lib/extract-task.js <pipeline> <task-name> <scratch-path>');
    return exit(2);
  }
  let result;
  try {
    const text = await readFileImpl(pipelinePath, 'utf8');
    result = extractTaskConfig(text, name);
  } catch (error) {
    err(`extract-task: ${error.message}`);
    return exit(3);
  }
  if (result.kind === 'file') {
    out(`file:${result.path}`);
    return result;
  }
  await writeFileImpl(scratchPath, result.config);
  out(`inline:${scratchPath}`);
  return result;
}

// True when this module is the process entry point (run directly, not imported).
// Exported so the guard is covered in-process: a spawned CLI's coverage is not
// merged by the test runner, so the guard cannot be covered by a subprocess.
export function isMainModule(argv = process.argv, moduleUrl = import.meta.url) {
  return Boolean(argv[1]) && moduleUrl === pathToFileURL(resolve(argv[1])).href;
}

// Entry point. Exported so the guard's body is covered in-process rather than
// only via a subprocess whose coverage the runner does not merge.
export async function main(argv = process.argv, moduleUrl = import.meta.url) {
  if (isMainModule(argv, moduleUrl)) {
    return runCli({ argv });
  }
  return undefined;
}

await main();
