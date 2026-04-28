import path from 'path';
import fs from 'fs/promises';
import { Exit } from '../mdreview';
import { api } from '../lib/api';
import { mapApiError } from '../lib/errors';

export async function uploadCommand(
  positional: string[],
  flags: Record<string, string | boolean>,
): Promise<number> {
  const localPath = positional[0];
  if (!localPath) {
    process.stderr.write(
      'error: usage: mdreview upload <local-file.md> [--name=<saved-name.md>]\n',
    );
    return Exit.USER;
  }

  const absLocal = path.resolve(process.cwd(), localPath);

  let content: string;
  try {
    content = await fs.readFile(absLocal, 'utf-8');
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'ENOTDIR') {
      process.stderr.write(`error: not_found: ${localPath}\n`);
      return Exit.NOT_FOUND;
    }
    process.stderr.write(`error: cannot read file: ${localPath}\n`);
    return Exit.NOT_FOUND;
  }

  const name = typeof flags['name'] === 'string' ? flags['name'] : path.basename(absLocal);
  if (!name.endsWith('.md')) {
    process.stderr.write('error: --name must end with .md\n');
    return Exit.USER;
  }

  try {
    const res = await api.post<{ path: string }>('/api/cli/upload', { name, content });
    const serverUrl = (process.env.MDREVIEW_SERVER_URL ?? 'http://localhost:3001').replace(/\/+$/, '');
    const docUrl = `${serverUrl}/?file=${encodeURIComponent(res.path)}`;
    process.stdout.write(docUrl + '\n');
    return Exit.OK;
  } catch (e) {
    const { code, msg } = mapApiError(e, localPath);
    process.stderr.write(msg);
    return code;
  }
}
