import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import type { Server } from 'http';
import { mkdtemp, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { spawn } from 'bun';
import cliRoute from '../../src/server/routes/cli';

export interface CliHarness {
  /** Absolute path of the docs-root tmpdir backing this harness. */
  docsRoot: string;
  /** Server URL (http://localhost:PORT). Set as MDREVIEW_SERVER_URL when spawning the CLI. */
  baseUrl: string;
  /** Write `content` to `<docsRoot>/<name>` and return `name`. */
  writeDoc: (name: string, content: string) => Promise<string>;
  /** Run the CLI binary with the given args. The harness's server URL and docs root are propagated via env. */
  runCli: (
    args: string[],
    extraEnv?: Record<string, string>,
    stdin?: string,
  ) => Promise<{ stdout: string; stderr: string; code: number }>;
  /** Tear down the server and remove the tmpdir. */
  stop: () => Promise<void>;
}

let nextPort = 4100;

/**
 * Boot a Hono server exposing the `/api/cli` routes against a fresh tmpdir
 * (used as MDREVIEW_DOCS_ROOT). Call `stop()` in `afterAll` to clean up.
 *
 * The harness sets `process.env.MDREVIEW_DOCS_ROOT` for the server's lifetime
 * so the server (running in this process) reads the right root per request.
 */
export async function startCliHarness(label: string): Promise<CliHarness> {
  const docsRoot = await mkdtemp(join(tmpdir(), `mdreview-${label}-`));
  process.env.MDREVIEW_DOCS_ROOT = docsRoot;

  const app = new Hono();
  app.route('/api/cli', cliRoute);

  const port = nextPort++;
  let server: Server;
  await new Promise<void>((resolve) => {
    server = serve({ fetch: app.fetch, port }, () => resolve());
  });
  const baseUrl = `http://localhost:${port}`;

  const cliEntry = join(import.meta.dir, '../../src/cli/mdreview.ts');

  const writeDoc = async (name: string, content: string) => {
    await writeFile(join(docsRoot, name), content, 'utf-8');
    return name;
  };

  const runCli: CliHarness['runCli'] = async (args, extraEnv, stdin) => {
    const proc = spawn({
      cmd: ['bun', 'run', cliEntry, ...args],
      cwd: process.cwd(),
      stdout: 'pipe',
      stderr: 'pipe',
      stdin: stdin !== undefined ? 'pipe' : 'inherit',
      env: {
        ...process.env,
        MDREVIEW_SERVER_URL: baseUrl,
        MDREVIEW_DOCS_ROOT: docsRoot,
        ...(extraEnv ?? {}),
      },
    });
    if (stdin !== undefined && proc.stdin) {
      const sink = proc.stdin as import('bun').FileSink;
      sink.write(new TextEncoder().encode(stdin));
      sink.end();
    }
    const code = await proc.exited;
    return {
      stdout: await new Response(proc.stdout).text(),
      stderr: await new Response(proc.stderr).text(),
      code,
    };
  };

  const stop = async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
    if (process.env.MDREVIEW_DOCS_ROOT === docsRoot) {
      delete process.env.MDREVIEW_DOCS_ROOT;
    }
    await rm(docsRoot, { recursive: true, force: true });
  };

  return { docsRoot, baseUrl, writeDoc, runCli, stop };
}
