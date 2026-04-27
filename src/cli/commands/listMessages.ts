import { Exit } from '../mdreview';
import { api } from '../lib/api';
import { mapApiError } from '../lib/errors';
import type { Comment, Thread } from '../../shared/types';

function truncate(s: string, maxLen: number): string {
  return s.length > maxLen ? s.slice(0, maxLen) + '…' : s;
}

function sortCommentsStable(comments: Comment[]): Comment[] {
  const indexed = comments.map((c, i) => ({ c, i }));
  indexed.sort((a, b) => {
    const cmp = a.c.createdAt.localeCompare(b.c.createdAt);
    if (cmp !== 0) return cmp;
    return a.i - b.i;
  });
  return indexed.map(({ c }) => c);
}

interface MessagesResponse {
  file: string;
  thread: Thread;
}

export async function listMessagesCommand(
  positional: string[],
  flags: Record<string, string | boolean>,
): Promise<number> {
  const file = positional[0];
  const threadId = positional[1];

  if (!file || !threadId) {
    process.stderr.write('error: usage: mdreview list-messages <file> <thread-id> [--json]\n');
    return Exit.USER;
  }

  let res: MessagesResponse;
  try {
    res = await api.get<MessagesResponse>('/api/cli/messages', { path: file, threadId });
  } catch (e) {
    const { code, msg } = mapApiError(e, file);
    process.stderr.write(msg);
    return code;
  }

  const thread = res.thread;
  const sortedComments = sortCommentsStable(thread.comments);
  const status = thread.resolved ? 'resolved' : 'open';
  const anchorQuote = thread.comments[0]?.anchor?.quote ?? '';
  const jsonMode = flags['json'] === true;

  if (jsonMode) {
    const payload = {
      file: res.file,
      thread: {
        id: thread.id,
        status,
        anchor: thread.comments[0]?.anchor ?? { quote: '', startOffset: 0, endOffset: 0, xpath: '' },
        comments: sortedComments.map((c) => ({
          id: c.id,
          author: c.author,
          authorType: c.authorType,
          createdAt: c.createdAt,
          text: c.text,
        })),
      },
    };
    process.stdout.write(JSON.stringify(payload, null, 2) + '\n');
    return Exit.OK;
  }

  const lines: string[] = [];
  const quoteTruncated = truncate(anchorQuote, 60);
  lines.push(`thread: ${thread.id} (${status}) — anchor: "${quoteTruncated}"`);
  lines.push(`file:   ${res.file}`);
  lines.push('--');

  for (let i = 0; i < sortedComments.length; i++) {
    const c = sortedComments[i];
    const idx = i + 1;
    const idTruncated = c.id.length > 12 ? c.id.slice(0, 12) + '…' : c.id;
    const lineA = `[${idx}] ${idTruncated}   ${c.author} (${c.authorType})   ${c.createdAt}`;
    const textLines = c.text.split('\n');
    const indentedText = textLines.map((l) => '    ' + l).join('\n');
    if (i > 0) lines.push('');
    lines.push(lineA);
    lines.push(indentedText);
  }

  process.stdout.write(lines.join('\n') + '\n');
  return Exit.OK;
}
