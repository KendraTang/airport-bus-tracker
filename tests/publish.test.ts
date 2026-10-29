import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { COLLECTOR_AUTHOR, publishData, type PublishOptions } from '../src/collector/publish.ts';

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

// A bare remote with one commit on main, and a function to make working copies of it.
function setup() {
  const root = mkdtempSync(join(tmpdir(), 'publish-'));
  const remote = join(root, 'remote.git');
  git(root, 'init', '--quiet', '--bare', '--initial-branch=main', remote);
  const clone = (name: string) => {
    const dir = join(root, name);
    git(root, 'clone', '--quiet', remote, dir);
    git(dir, 'config', 'user.name', 'Test');
    git(dir, 'config', 'user.email', 'test@example.invalid');
    return dir;
  };
  const seed = clone('seed');
  writeFileSync(join(seed, 'README.md'), 'seed\n');
  git(seed, 'add', '.');
  git(seed, 'commit', '--quiet', '-m', 'seed');
  git(seed, 'push', '--quiet', 'origin', 'HEAD:main');
  return { remote, clone };
}

function writeData(repo: string, source: string, date: string, line: string) {
  const raw = join(repo, 'data', 'raw', source, date);
  mkdirSync(raw, { recursive: true });
  appendFileSync(join(raw, 'a2.jsonl'), line + '\n');
  const usage = join(repo, 'data', 'usage', source);
  mkdirSync(usage, { recursive: true });
  appendFileSync(join(usage, '2026-10.jsonl'), line + '\n');
}

function opts(repoDir: string, overrides: Partial<PublishOptions> = {}): PublishOptions {
  return { repoDir, dataDir: 'data', source: 'local', serviceDate: '2026-10-30', branch: 'main', ...overrides };
}

test('commits the day of data with a fixed author and message, and pushes it', () => {
  const { remote, clone } = setup();
  const repo = clone('collector');
  writeData(repo, 'local', '2026-10-30', '{"n":1}');

  assert.deepEqual(publishData(opts(repo)), { status: 'pushed', committed: true });
  assert.equal(git(remote, 'log', '-1', '--format=%an <%ae>|%s', 'main'), `${COLLECTOR_AUTHOR}|data: local observations for 2026-10-30`);
  assert.deepEqual(git(remote, 'show', '--name-only', '--format=', 'main').split('\n').sort(), [
    'data/raw/local/2026-10-30/a2.jsonl',
    'data/usage/local/2026-10.jsonl',
  ]);
});

test('makes no commit when nothing changed', () => {
  const { remote, clone } = setup();
  const repo = clone('collector');
  writeData(repo, 'local', '2026-10-30', '{"n":1}');
  publishData(opts(repo));
  const head = git(remote, 'rev-parse', 'main');

  assert.deepEqual(publishData(opts(repo)), { status: 'pushed', committed: false });
  assert.equal(git(remote, 'rev-parse', 'main'), head);
});

test('leaves other staged and modified files in the working copy alone', () => {
  const { clone } = setup();
  const repo = clone('collector');
  writeFileSync(join(repo, 'staged.txt'), 'wip\n');
  git(repo, 'add', 'staged.txt');
  writeFileSync(join(repo, 'README.md'), 'edited\n');
  writeData(repo, 'local', '2026-10-30', '{"n":1}');

  assert.equal(publishData(opts(repo)).status, 'pushed');
  assert.equal(git(repo, 'show', '--name-only', '--format=', 'HEAD').includes('staged.txt'), false);
  // git() trims, so the leading space of ' M' is gone.
  assert.equal(git(repo, 'status', '--porcelain'), 'M README.md\nA  staged.txt');
});

test('skips publishing when the working copy is on another branch', () => {
  const { remote, clone } = setup();
  const repo = clone('collector');
  git(repo, 'switch', '--quiet', '-c', 'feature');
  writeData(repo, 'local', '2026-10-30', '{"n":1}');
  const head = git(remote, 'rev-parse', 'main');

  const result = publishData(opts(repo));
  assert.equal(result.status, 'skipped');
  assert.equal(git(repo, 'log', '-1', '--format=%s'), 'seed');
  assert.equal(git(remote, 'rev-parse', 'main'), head);
});

test('rebases onto data another source pushed meanwhile', () => {
  const { remote, clone } = setup();
  const collector = clone('collector');
  const actions = clone('actions');
  writeData(actions, 'actions', '2026-10-30', '{"n":1}');
  assert.equal(publishData(opts(actions, { source: 'actions' })).status, 'pushed');

  writeData(collector, 'local', '2026-10-30', '{"n":2}');
  assert.deepEqual(publishData(opts(collector)), { status: 'pushed', committed: true });
  assert.deepEqual(git(remote, 'log', '--format=%s', 'main').split('\n'), [
    'data: local observations for 2026-10-30',
    'data: actions observations for 2026-10-30',
    'seed',
  ]);
});

test('a failed push keeps the commit, and the next run pushes it', () => {
  const { remote, clone } = setup();
  const repo = clone('collector');
  git(repo, 'remote', 'set-url', 'origin', join(remote, '..', 'missing.git'));
  writeData(repo, 'local', '2026-10-29', '{"n":1}');

  const failed = publishData(opts(repo, { serviceDate: '2026-10-29' }));
  assert.equal(failed.status, 'failed');
  assert.equal(failed.committed, true);
  assert.equal(git(repo, 'log', '-1', '--format=%s'), 'data: local observations for 2026-10-29');

  git(repo, 'remote', 'set-url', 'origin', remote);
  writeData(repo, 'local', '2026-10-30', '{"n":2}');
  assert.deepEqual(publishData(opts(repo)), { status: 'pushed', committed: true });
  assert.deepEqual(git(remote, 'log', '--format=%s', 'main').split('\n'), [
    'data: local observations for 2026-10-30',
    'data: local observations for 2026-10-29',
    'seed',
  ]);
});

test('a conflicting rebase is aborted and the working copy is left usable', () => {
  const { clone } = setup();
  const repo = clone('collector');
  const other = clone('other');
  writeData(other, 'local', '2026-10-30', '{"from":"other"}');
  git(other, 'add', '.');
  git(other, 'commit', '--quiet', '-m', 'conflicting');
  git(other, 'push', '--quiet', 'origin', 'HEAD:main');
  writeData(repo, 'local', '2026-10-30', '{"from":"collector"}');

  const result = publishData(opts(repo));
  assert.equal(result.status, 'failed');
  assert.equal(existsSync(join(repo, '.git', 'rebase-merge')) || existsSync(join(repo, '.git', 'rebase-apply')), false);
  assert.equal(git(repo, 'rev-parse', '--abbrev-ref', 'HEAD'), 'main');
  assert.equal(git(repo, 'log', '-1', '--format=%s'), 'data: local observations for 2026-10-30');
});
