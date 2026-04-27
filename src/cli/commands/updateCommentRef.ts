import { Exit } from '../mdreview';
import { api } from '../lib/api';
import { mapApiError } from '../lib/errors';
import type { SelectionAnchor } from '../../shared/types';

export async function updateCommentRefCommand(
  positional: string[],
  flags: Record<string, string | boolean>,
): Promise<number> {
  const file = positional[0];
  const threadId = positional[1];

  if (!file || !threadId) {
    process.stderr.write(
      'error: usage: mdreview update-comment-ref <file> <thread-id> [--quote=<str>] [--start=<n>] [--end=<n>] [--xpath=<str>]\n',
    );
    return Exit.USER;
  }

  const hasQuote = flags['quote'] !== undefined;
  const hasStart = flags['start'] !== undefined;
  const hasEnd = flags['end'] !== undefined;
  const hasXpath = flags['xpath'] !== undefined;

  if (!hasQuote && !hasStart && !hasEnd && !hasXpath) {
    process.stderr.write(
      'error: at least one of --quote, --start, --end, --xpath is required\n',
    );
    return Exit.USER;
  }

  const body: Record<string, unknown> = { path: file, threadId };

  if (hasQuote) body.quote = flags['quote'] as string;
  if (hasXpath) body.xpath = flags['xpath'] as string;

  if (hasStart) {
    const rawStart = flags['start'] as string;
    const parsed = Number(rawStart);
    if (!Number.isInteger(parsed) || parsed < 0 || String(parsed) !== rawStart) {
      process.stderr.write('error: --start must be a non-negative integer\n');
      return Exit.USER;
    }
    body.start = parsed;
  }

  if (hasEnd) {
    const rawEnd = flags['end'] as string;
    const parsed = Number(rawEnd);
    if (!Number.isInteger(parsed) || parsed < 0 || String(parsed) !== rawEnd) {
      process.stderr.write('error: --end must be a non-negative integer\n');
      return Exit.USER;
    }
    body.end = parsed;
  }

  if (typeof body.start === 'number' && typeof body.end === 'number' && body.end < body.start) {
    process.stderr.write('error: --end must be >= --start\n');
    return Exit.USER;
  }

  try {
    const res = await api.patch<{ anchor: SelectionAnchor }>('/api/cli/anchor', body);
    process.stdout.write(JSON.stringify(res.anchor) + '\n');
    return Exit.OK;
  } catch (e) {
    const { code, msg } = mapApiError(e, file);
    process.stderr.write(msg);
    return code;
  }
}
