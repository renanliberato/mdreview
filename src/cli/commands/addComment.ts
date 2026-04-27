import { Exit } from '../mdreview';
import { api } from '../lib/api';
import { mapApiError } from '../lib/errors';

export async function addCommentCommand(
  positional: string[],
  flags: Record<string, string | boolean>,
): Promise<number> {
  const file = positional[0];
  const threadId = positional[1];

  if (!file || !threadId) {
    process.stderr.write(
      'error: usage: mdreview add-comment <file> <thread-id> --text=<str> [--author=<name>] [--type=human|llm]\n',
    );
    return Exit.USER;
  }

  if (flags['text'] === undefined) {
    process.stderr.write('error: --text is required\n');
    return Exit.USER;
  }

  let text: string;
  if (flags['text'] === '-') {
    const stdinBuf = await Bun.stdin.bytes();
    if (stdinBuf.byteLength === 0) {
      process.stderr.write('error: --text=- supplied but stdin is empty\n');
      return Exit.USER;
    }
    text = new TextDecoder().decode(stdinBuf);
  } else {
    text = flags['text'] as string;
  }

  if (text === '') {
    process.stderr.write('error: --text must not be empty\n');
    return Exit.USER;
  }

  const author = typeof flags['author'] === 'string' ? flags['author'] : 'claude';
  const rawType = typeof flags['type'] === 'string' ? flags['type'] : 'llm';
  if (rawType !== 'human' && rawType !== 'llm') {
    process.stderr.write("error: --type must be 'human' or 'llm'\n");
    return Exit.USER;
  }

  try {
    const res = await api.post<{ id: string }>('/api/cli/comments', {
      path: file,
      threadId,
      text,
      author,
      authorType: rawType,
    });
    process.stdout.write(res.id + '\n');
    return Exit.OK;
  } catch (e) {
    const { code, msg } = mapApiError(e, file);
    process.stderr.write(msg);
    return code;
  }
}
