/**
 * mdreview CLI entry point.
 * Parses argv, dispatches to command handlers, and exits with the appropriate code.
 */

export const Exit = {
  OK: 0,
  USER: 1,
  NOT_FOUND: 2,
  THREAD: 3,
  VALIDATION: 4,
} as const;

export type ExitCode = (typeof Exit)[keyof typeof Exit];

export interface ParsedArgv {
  command: string;
  positional: string[];
  flags: Record<string, string | boolean>;
}

/**
 * Hand-rolled argv parser.
 * Supports:
 *   --flag          → { flag: true }
 *   --flag=value    → { flag: "value" }
 *   --flag value    → { flag: "value" }
 *   positional args (non-flag tokens)
 */
export function parseArgv(args: string[]): ParsedArgv {
  const positional: string[] = [];
  const flags: Record<string, string | boolean> = {};

  let i = 0;
  while (i < args.length) {
    const arg = args[i];
    if (arg.startsWith('--')) {
      const eqIdx = arg.indexOf('=');
      if (eqIdx !== -1) {
        const key = arg.slice(2, eqIdx);
        const value = arg.slice(eqIdx + 1);
        flags[key] = value;
      } else {
        const key = arg.slice(2);
        // Peek: if next token is not a flag, treat it as the value
        if (i + 1 < args.length && !args[i + 1].startsWith('--')) {
          flags[key] = args[i + 1];
          i++;
        } else {
          flags[key] = true;
        }
      }
    } else {
      positional.push(arg);
    }
    i++;
  }

  const command = positional[0] ?? '';
  return { command, positional: positional.slice(1), flags };
}

const USAGE = `Usage: mdreview <command> <args>
Commands: add-comment, export, find-snippet, list-messages, list-threads, update-comment-ref, upload, validate`;

async function notImplemented(): Promise<number> {
  process.stderr.write('error: command not yet implemented\n');
  return Exit.USER;
}

async function dispatch(argv: ParsedArgv): Promise<number> {
  // Help / no-args
  if (argv.command === '' || argv.flags['help'] === true) {
    process.stdout.write(USAGE + '\n');
    return Exit.OK;
  }

  switch (argv.command) {
    case 'export': {
      const { exportCommand } = await import('./commands/export');
      return exportCommand(argv.positional, argv.flags);
    }
    case 'find-snippet': {
      const { findSnippetCommand } = await import('./commands/findSnippet');
      return findSnippetCommand(argv.positional, argv.flags);
    }
    case 'add-comment': {
      const { addCommentCommand } = await import('./commands/addComment');
      return addCommentCommand(argv.positional, argv.flags);
    }
    case 'update-comment-ref': {
      const { updateCommentRefCommand } = await import('./commands/updateCommentRef');
      return updateCommentRefCommand(argv.positional, argv.flags);
    }
    case 'validate': {
      const { validateCommand } = await import('./commands/validate');
      return validateCommand(argv.positional, argv.flags);
    }
    case 'list-threads': {
      const { listThreadsCommand } = await import('./commands/listThreads');
      return listThreadsCommand(argv.positional, argv.flags);
    }
    case 'list-messages': {
      const { listMessagesCommand } = await import('./commands/listMessages');
      return listMessagesCommand(argv.positional, argv.flags);
    }
    case 'upload': {
      const { uploadCommand } = await import('./commands/upload');
      return uploadCommand(argv.positional, argv.flags);
    }
    default:
      process.stderr.write(`error: unknown command\n`);
      return Exit.USER;
  }
}

const argv = parseArgv(process.argv.slice(2));
const code = await dispatch(argv);
process.exit(code);
