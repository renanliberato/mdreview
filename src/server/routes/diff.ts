import { Hono } from 'hono';
import { resolve, join, normalize } from 'path';
import { spawnSync } from 'child_process';

const diff = new Hono();

const DOCS_ROOT = resolve(process.cwd(), 'docs');

function resolveSafePath(relativePath: string): string | null {
  const resolved = normalize(join(DOCS_ROOT, relativePath));
  if (!resolved.startsWith(DOCS_ROOT + '/') && resolved !== DOCS_ROOT) return null;
  return resolved;
}

export interface DiffHunk {
  // 1-based line numbers in the new file that were added or modified
  startLine: number;
  lineCount: number;
}

/**
 * Parse unified diff output and return hunks of added/modified lines
 * in terms of the new file's line numbers.
 */
function parseUnifiedDiff(diffOutput: string): DiffHunk[] {
  const hunks: DiffHunk[] = [];
  const lines = diffOutput.split('\n');

  let newLine = 0;
  let inHunk = false;
  let hunkStart = 0;
  let hunkLines = 0;

  for (const line of lines) {
    const hunkHeader = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/);
    if (hunkHeader) {
      if (inHunk && hunkLines > 0) {
        hunks.push({ startLine: hunkStart, lineCount: hunkLines });
      }
      newLine = parseInt(hunkHeader[1], 10);
      inHunk = true;
      hunkStart = newLine;
      hunkLines = 0;
      continue;
    }

    if (!inHunk) continue;

    if (line.startsWith('+') && !line.startsWith('+++')) {
      if (hunkLines === 0) hunkStart = newLine;
      hunkLines++;
      newLine++;
    } else if (line.startsWith('-') && !line.startsWith('---')) {
      // deleted line — don't advance newLine
    } else if (!line.startsWith('\\')) {
      // context line
      if (hunkLines > 0) {
        hunks.push({ startLine: hunkStart, lineCount: hunkLines });
        hunkLines = 0;
      }
      newLine++;
    }
  }

  if (inHunk && hunkLines > 0) {
    hunks.push({ startLine: hunkStart, lineCount: hunkLines });
  }

  return hunks;
}

/**
 * GET /api/diff?path=
 * Returns { hunks: DiffHunk[] } — line ranges (1-based) in the current file
 * that differ from HEAD.
 */
diff.get('/', async (c) => {
  const filePath = c.req.query('path');
  if (!filePath) {
    return c.json({ error: 'missing_path' }, 400);
  }

  const absPath = resolveSafePath(filePath);
  if (!absPath) {
    return c.json({ error: 'forbidden' }, 403);
  }

  // Find the git root for this file's directory (supports nested repos under docs/)
  const fileDir = resolve(absPath, '..');
  const gitRootResult = spawnSync('git', ['rev-parse', '--show-toplevel'], {
    cwd: fileDir,
    encoding: 'utf-8',
    timeout: 5000,
  });
  const gitCwd = gitRootResult.stdout ? gitRootResult.stdout.trim() : process.cwd();

  // Run git diff HEAD against the file using its own repo root as cwd
  const result = spawnSync('git', ['diff', 'HEAD', '--', absPath], {
    cwd: gitCwd,
    encoding: 'utf-8',
    timeout: 5000,
  });

  if (result.error) {
    return c.json({ error: 'git_error', detail: result.error.message }, 500);
  }

  // Empty output means no diff (file is clean vs HEAD)
  if (!result.stdout) {
    // Also try comparing against index (untracked / new files show nothing with HEAD)
    // Try git diff --cached and git status to detect new/untracked files
    const statusResult = spawnSync('git', ['status', '--porcelain', '--', absPath], {
      cwd: gitCwd,
      encoding: 'utf-8',
      timeout: 5000,
    });

    const statusLine = (statusResult.stdout ?? '').trim();
    // '??' = untracked, 'A' = newly staged — treat entire file as added
    if (statusLine.startsWith('??') || statusLine.startsWith('A')) {
      // Return a single hunk covering everything (caller will clamp to actual line count)
      return c.json({ hunks: [{ startLine: 1, lineCount: 999999 }] });
    }

    return c.json({ hunks: [] });
  }

  const hunks = parseUnifiedDiff(result.stdout);
  return c.json({ hunks });
});

export default diff;
