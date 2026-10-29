// Commit the collector's own data files and push them, so the site rebuilds.
// Never throws: the data is already on disk, and anything not pushed today goes out with the next run.

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

export interface PublishOptions {
  repoDir: string;
  dataDir: string; // relative to repoDir
  source: string;
  serviceDate: string;
  branch: string;
}

export type PublishResult =
  | { status: 'pushed'; committed: boolean }
  | { status: 'skipped'; reason: string; committed: false }
  | { status: 'failed'; committed: boolean; error: string };

export const COLLECTOR_AUTHOR = 'airport-bus-tracker collector <collector@airport-bus-tracker.invalid>';

export function publishData(opts: PublishOptions): PublishResult {
  const git = (...args: string[]) =>
    execFileSync('git', args, { cwd: opts.repoDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

  let committed = false;
  try {
    // Committing onto whatever branch the working copy is on would mix data into unrelated work.
    const branch = git('rev-parse', '--abbrev-ref', 'HEAD');
    if (branch !== opts.branch) {
      return { status: 'skipped', reason: `working copy is on ${branch}, not ${opts.branch}`, committed: false };
    }

    // Only the collector's own directories; anything else staged or modified in the working copy is left alone.
    const paths = ['raw', 'usage']
      .map((kind) => join(opts.dataDir, kind, opts.source))
      .filter((p) => existsSync(join(opts.repoDir, p)));
    if (paths.length > 0) {
      git('add', '--', ...paths);
      if (git('diff', '--cached', '--name-only', '--', ...paths) !== '') {
        git('commit', '--quiet', '--author', COLLECTOR_AUTHOR, '-m', `data: ${opts.source} observations for ${opts.serviceDate}`, '--', ...paths);
        committed = true;
      }
    }

    // Another source may have pushed its own directory meanwhile; those never touch ours, so rebasing is safe.
    git('pull', '--quiet', '--rebase', '--autostash', 'origin', opts.branch);
    git('push', '--quiet', 'origin', `HEAD:${opts.branch}`);
    return { status: 'pushed', committed };
  } catch (err) {
    // A rebase that stopped halfway would leave the working copy unusable for the next run.
    if (existsSync(join(opts.repoDir, '.git', 'rebase-merge')) || existsSync(join(opts.repoDir, '.git', 'rebase-apply'))) {
      try {
        git('rebase', '--abort');
      } catch {}
    }
    const e = err as Error & { stderr?: string };
    return { status: 'failed', committed, error: (e.stderr?.trim() || e.message).split('\n').slice(0, 3).join(' | ') };
  }
}
