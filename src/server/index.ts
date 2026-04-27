import { Hono } from 'hono';
import { readFile } from 'fs/promises';
import { resolve, extname } from 'path';
import fileRoute from './routes/file';
import diffRoute from './routes/diff';
import cliRoute from './routes/cli';
import { basicAuth } from './middleware/basicAuth';

const app = new Hono();

app.use('/api/*', basicAuth());
app.route('/api/file', fileRoute);
app.route('/api/diff', diffRoute);
app.route('/api/cli', cliRoute);

const DIST = resolve(import.meta.dir, '../client/dist');

const MIME: Record<string, string> = {
  '.html': 'text/html',
  '.js':   'application/javascript',
  '.css':  'text/css',
  '.svg':  'image/svg+xml',
  '.png':  'image/png',
  '.ico':  'image/x-icon',
};

app.get('/*', async (c) => {
  const urlPath = new URL(c.req.url).pathname;
  const filePath = resolve(DIST, '.' + urlPath);

  // Safety: don't escape DIST
  if (!filePath.startsWith(DIST)) return c.notFound();

  try {
    const content = await readFile(filePath);
    const mime = MIME[extname(filePath)] ?? 'application/octet-stream';
    return new Response(content, { headers: { 'Content-Type': mime } });
  } catch {
    // Fall back to index.html for SPA routing
    const html = await readFile(resolve(DIST, 'index.html'));
    return new Response(html, { headers: { 'Content-Type': 'text/html' } });
  }
});

const port = Number(process.env.MDREVIEW_PORT ?? 3001);

Bun.serve({ port, fetch: app.fetch });

console.log(`mdreview server listening on http://localhost:${port}`);

export { app };
