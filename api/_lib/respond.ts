import type { VercelResponse } from '@vercel/node';
import { ConfigError, HttpError } from './env';

export function ok(res: VercelResponse, body: unknown, cacheSeconds = 0) {
  res.setHeader('Cache-Control', cacheSeconds ? `private, max-age=${cacheSeconds}` : 'no-store');
  res.status(200).json(body);
}

/** Never leaks a stack trace or a Google error body to the browser. Anything
 *  unexpected is logged server-side and returned as a generic 500. */
export function fail(res: VercelResponse, e: unknown) {
  if (e instanceof HttpError) return res.status(e.status).json({ error: e.message });
  if (e instanceof ConfigError) {
    console.error('[config]', e);
    return res.status(500).json({ error: 'This deployment is misconfigured. Contact an administrator.' });
  }
  console.error('[api]', e);
  return res.status(500).json({ error: 'Something went wrong handling that request.' });
}
