import path from 'path';
import fs from 'fs/promises';
import { Exit } from '../mdreview';
import { api } from '../lib/api';
import { mapApiError } from '../lib/errors';

export async function exportCommand(
  positional: string[],
  flags: Record<string, string | boolean>,
): Promise<number> {
  const filePath = positional[0];
  if (!filePath) {
    process.stderr.write(
      'error: usage: mdreview export <file> [--output=<local-path>]\n',
    );
    return Exit.USER;
  }

  let res: { raw: string };
  try {
    res = await api.get<{ raw: string }>('/api/file', { path: filePath });
  } catch (e) {
    const { code, msg } = mapApiError(e, filePath);
    process.stderr.write(msg);
    return code;
  }

  const outputPath = typeof flags['output'] === 'string' ? flags['output'] : undefined;
  if (outputPath) {
    const absOutput = path.resolve(process.cwd(), outputPath);
    try {
      await fs.writeFile(absOutput, res.raw, 'utf-8');
    } catch {
      process.stderr.write(`error: cannot write file: ${outputPath}\n`);
      return Exit.USER;
    }
    process.stdout.write(`exported to ${absOutput}\n`);
  } else {
    process.stdout.write(res.raw);
  }

  return Exit.OK;
}
