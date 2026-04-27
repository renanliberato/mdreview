import { Exit } from '../mdreview';
import { api } from '../lib/api';
import { mapApiError } from '../lib/errors';

interface ValidateThreadResult {
  id: string;
  resolved: boolean;
  strategy: 'exact' | 'fuzzy' | 'line-search' | null;
  line: number | null;
  quote: string;
  issues: string[];
}

interface ValidateResponse {
  file: string;
  openCount: number;
  resolvedCount: number;
  threads: ValidateThreadResult[];
  errors: string[];
  warnings: string[];
}

function truncate(s: string, maxLen = 60): string {
  return s.length > maxLen ? s.slice(0, maxLen) + '…' : s;
}

export async function validateCommand(
  positional: string[],
  flags: Record<string, string | boolean>,
): Promise<number> {
  const file = positional[0];
  if (!file) {
    process.stderr.write('error: usage: mdreview validate <file> [--json]\n');
    return Exit.USER;
  }

  let res: ValidateResponse;
  try {
    res = await api.get<ValidateResponse>('/api/cli/validate', { path: file });
  } catch (e) {
    const { code, msg } = mapApiError(e, file);
    process.stderr.write(msg);
    return code;
  }

  const jsonMode = flags['json'] === true;

  if (jsonMode) {
    const payload = {
      file: res.file,
      threads: res.threads,
      errors: res.errors,
      warnings: res.warnings,
    };
    process.stdout.write(JSON.stringify(payload, null, 2) + '\n');
  } else {
    const total = res.threads.length;
    const lines: string[] = [];
    lines.push(`file: ${res.file}`);
    lines.push(`threads: ${total} (open: ${res.openCount}, resolved: ${res.resolvedCount})`);
    lines.push('');

    for (const err of res.errors.filter((e) => e.startsWith('malformed'))) {
      lines.push(`[ERROR] (file) ${err}`);
    }

    for (const tr of res.threads) {
      const isOrphan = tr.strategy === null;
      if (isOrphan) {
        lines.push(`[WARN] ${tr.id} orphan: quote not found`);
      } else {
        const stratStr = `match=${tr.strategy}`.padEnd(20);
        const lineStr = `line=${tr.line}`.padEnd(9);
        const quoteStr = `"${truncate(tr.quote)}"`;
        lines.push(`[OK] ${tr.id}  ${stratStr} ${lineStr} ${quoteStr}`);
      }
    }

    for (const err of res.errors.filter((e) => !e.startsWith('malformed'))) {
      lines.push(`[ERROR] ${err}`);
    }

    lines.push('');
    lines.push(
      `result: ${res.warnings.length} warning${res.warnings.length !== 1 ? 's' : ''}, ${res.errors.length} error${res.errors.length !== 1 ? 's' : ''}`,
    );

    process.stdout.write(lines.join('\n') + '\n');
  }

  const hasIssues = res.errors.length > 0 || res.warnings.length > 0;
  return hasIssues ? Exit.VALIDATION : Exit.OK;
}
