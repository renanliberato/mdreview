import type { MiddlewareHandler } from 'hono';

function decode(token: string): { user: string; pass: string } | null {
  try {
    const decoded = atob(token);
    const idx = decoded.indexOf(':');
    if (idx === -1) return null;
    return { user: decoded.slice(0, idx), pass: decoded.slice(idx + 1) };
  } catch {
    return null;
  }
}

export function basicAuth(): MiddlewareHandler {
  return async (c, next) => {
    const expectedUser = process.env.MDREVIEW_USERNAME;
    const expectedPass = process.env.MDREVIEW_PASSWORD;

    if (!expectedUser || !expectedPass) {
      return next();
    }

    const header = c.req.header('authorization') ?? '';
    const m = header.match(/^Basic\s+(.+)$/i);
    if (!m) {
      return c.json({ error: 'unauthorized' }, 401, {
        'WWW-Authenticate': 'Basic realm="mdreview"',
      });
    }

    const creds = decode(m[1]);
    if (!creds || creds.user !== expectedUser || creds.pass !== expectedPass) {
      return c.json({ error: 'unauthorized' }, 401, {
        'WWW-Authenticate': 'Basic realm="mdreview"',
      });
    }

    return next();
  };
}
