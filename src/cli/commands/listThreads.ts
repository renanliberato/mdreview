import { Exit } from '../mdreview';
import { api } from '../lib/api';
import { mapApiError } from '../lib/errors';
import type { Thread } from '../../shared/types';

function truncate(s: string, maxLen: number): string {
  return s.length > maxLen ? s.slice(0, maxLen) + '…' : s;
}

interface ThreadsResponse {
  file: string;
  threads: Thread[];
}

interface ThreadRow {
  id: string;
  status: 'open' | 'resolved';
  commentCount: number;
  firstComment: {
    id: string;
    author: string;
    authorType: string;
    createdAt: string;
    text: string;
  };
  anchor: { quote: string };
}

function buildRow(thread: Thread): ThreadRow {
  const first = thread.comments[0];
  return {
    id: thread.id,
    status: thread.resolved ? 'resolved' : 'open',
    commentCount: thread.comments.length,
    firstComment: {
      id: first?.id ?? '',
      author: first?.author ?? '',
      authorType: first?.authorType ?? '',
      createdAt: first?.createdAt ?? '',
      text: first?.text ?? '',
    },
    anchor: { quote: first?.anchor?.quote ?? '' },
  };
}

function sortThreadsStable(threads: Thread[]): Thread[] {
  const indexed = threads.map((t, i) => ({ t, i }));
  indexed.sort((a, b) => {
    const aDate = a.t.comments[0]?.createdAt ?? null;
    const bDate = b.t.comments[0]?.createdAt ?? null;
    if (aDate === null && bDate === null) return a.i - b.i;
    if (aDate === null) return 1;
    if (bDate === null) return -1;
    const cmp = aDate.localeCompare(bDate);
    if (cmp !== 0) return cmp;
    return a.i - b.i;
  });
  return indexed.map(({ t }) => t);
}

export async function listThreadsCommand(
  positional: string[],
  flags: Record<string, string | boolean>,
): Promise<number> {
  const file = positional[0];
  if (!file) {
    process.stderr.write('error: usage: mdreview list-threads <file> [--json]\n');
    return Exit.USER;
  }

  let res: ThreadsResponse;
  try {
    res = await api.get<ThreadsResponse>('/api/cli/threads', { path: file });
  } catch (e) {
    const { code, msg } = mapApiError(e, file);
    process.stderr.write(msg);
    return code;
  }

  const sorted = sortThreadsStable(res.threads);
  const openCount = sorted.filter((t) => !t.resolved).length;
  const resolvedCount = sorted.filter((t) => t.resolved).length;

  const jsonMode = flags['json'] === true;

  if (jsonMode) {
    const rows = sorted.map(buildRow);
    const payload = { file: res.file, threads: rows };
    process.stdout.write(JSON.stringify(payload, null, 2) + '\n');
    return Exit.OK;
  }

  const lines: string[] = [];
  lines.push(`file: ${res.file}`);
  lines.push(`threads: ${sorted.length} (open: ${openCount}, resolved: ${resolvedCount})`);

  if (sorted.length === 0) {
    lines.push('');
    lines.push('(no threads)');
    process.stdout.write(lines.join('\n') + '\n');
    return Exit.OK;
  }

  for (const thread of sorted) {
    const row = buildRow(thread);
    const n = row.commentCount;
    const plural = n === 1 ? 'comment' : 'comments';
    const idPad = row.id.padEnd(10);
    const statusPad = row.status.padEnd(9);
    const commentStr = `[${n} ${plural}]`;
    const line1 = `${idPad}  ${statusPad} ${commentStr} ${row.firstComment.author} (${row.firstComment.authorType}) ${row.firstComment.createdAt}`;

    const indent = ' '.repeat(21);
    const textTruncated = truncate(row.firstComment.text, 80);
    const line2 = `${indent}"${textTruncated}"`;
    const quoteTruncated = truncate(row.anchor.quote, 60);
    const line3 = `${indent}anchor: "${quoteTruncated}"`;

    lines.push('');
    lines.push(line1);
    lines.push(line2);
    lines.push(line3);
  }

  process.stdout.write(lines.join('\n') + '\n');
  return Exit.OK;
}
