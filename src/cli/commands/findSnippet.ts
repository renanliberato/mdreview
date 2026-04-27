import { Exit } from '../mdreview';
import { api } from '../lib/api';
import { mapApiError } from '../lib/errors';

interface FindSnippetResponse {
  threadId: string;
  quote: string;
  line: number;
  col: number;
  strategy: 'exact' | 'fuzzy' | 'line-search';
  contextBlock: string;
}

export async function findSnippetCommand(
  positional: string[],
  flags: Record<string, string | boolean>,
): Promise<number> {
  const file = positional[0];
  const threadId = positional[1];

  if (!file || !threadId) {
    process.stderr.write(
      'error: usage: mdreview find-snippet <file> <thread-id> [--context=<n>]\n',
    );
    return Exit.USER;
  }

  let contextN = 3;
  if (flags['context'] !== undefined) {
    const raw = flags['context'];
    const parsed = typeof raw === 'string' ? parseInt(raw, 10) : NaN;
    if (isNaN(parsed) || parsed < 0 || String(raw) !== String(parsed)) {
      process.stderr.write('error: --context must be a non-negative integer\n');
      return Exit.USER;
    }
    contextN = parsed;
  }

  try {
    const res = await api.get<FindSnippetResponse>('/api/cli/find-snippet', {
      path: file,
      threadId,
      context: contextN,
    });

    const out = [
      `thread: ${res.threadId}`,
      `quote:  "${res.quote}"`,
      `match:  line ${res.line}, col ${res.col} (strategy: ${res.strategy})`,
      '--',
      res.contextBlock,
    ].join('\n') + '\n';

    process.stdout.write(out);
    return Exit.OK;
  } catch (e) {
    const { code, msg } = mapApiError(e, file);
    process.stderr.write(msg);
    return code;
  }
}
