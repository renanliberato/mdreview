import { Exit } from '../mdreview';
import { api } from '../lib/api';
import { mapApiError } from '../lib/errors';
import type { Thread } from '../../shared/types';

interface SnippetInfo {
  quote: string;
  line: number;
  col: number;
  strategy: 'exact' | 'fuzzy' | 'line-search';
  contextBlock: string;
}

interface NextAiMentionResponse {
  thread: Thread;
  snippet: SnippetInfo | null;
}

export async function nextAiMentionCommand(
  positional: string[],
  flags: Record<string, string | boolean>,
): Promise<number> {
  const file = positional[0];

  if (!file) {
    process.stderr.write(
      'error: usage: mdreview next-ai-mention <file> [--context=<n>] [--json]\n',
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
    const res = await api.get<NextAiMentionResponse>('/api/cli/next-ai-mention', {
      path: file,
      context: contextN,
    });

    if (flags['json']) {
      process.stdout.write(JSON.stringify(res) + '\n');
      return Exit.OK;
    }

    const last = res.thread.comments[res.thread.comments.length - 1];
    let out: string;
    if (res.snippet === null) {
      out = [
        `thread: ${res.thread.id}`,
        `prompt: ${last.text}`,
        `(orphan: anchor no longer resolves)`,
      ].join('\n') + '\n';
    } else {
      out = [
        `thread: ${res.thread.id}`,
        `prompt: ${last.text}`,
        `quote:  "${res.snippet.quote}"`,
        `match:  line ${res.snippet.line}, col ${res.snippet.col} (strategy: ${res.snippet.strategy})`,
        '--',
        res.snippet.contextBlock,
      ].join('\n') + '\n';
    }

    process.stdout.write(out);
    return Exit.OK;
  } catch (e) {
    const { code, msg } = mapApiError(e, file);
    if (msg) process.stderr.write(msg);
    return code;
  }
}
