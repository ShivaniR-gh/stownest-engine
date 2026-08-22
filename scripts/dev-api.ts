/**
 * Local API server for development.
 *
 * Mounts the same handler functions Vercel runs in production, over a plain
 * node:http server. `vercel dev` is convenient when it works, but it bundles
 * each function in a child process and swallows the stack trace when that
 * fails. This runs the handlers in-process, so a crash prints a real trace.
 *
 *   npm run dev:api
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFileSync } from 'node:fs';
import sessionHandler from '../api/auth/session';
import dataHandler from '../api/data/[dataset]';
import configDatasetsHandler from '../api/config/datasets';
import configSourcesHandler from '../api/config/sources';
import configDepartmentsHandler from '../api/config/departments';

/* Load .env before any handler reads process.env. */
try {
  for (const line of readFileSync('.env', 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (!(m[1] in process.env)) process.env[m[1]] = v;
  }
} catch { console.warn('No .env file found — relying on the ambient environment.'); }

const PORT = Number(process.env.API_PORT ?? 3001);

/** Adapts node's req/res to the shape the Vercel handlers expect. */
function adapt(req: IncomingMessage, res: ServerResponse, query: Record<string, string>, body: unknown) {
  const vreq = Object.assign(req, { query, cookies: {}, body });
  const vres = Object.assign(res, {
    status(code: number) { res.statusCode = code; return vres; },
    json(payload: unknown) {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(payload));
      return vres;
    },
    send(payload: string) { res.end(payload); return vres; },
    setHeader: res.setHeader.bind(res),
  });
  return { vreq, vres };
}

const readBody = (req: IncomingMessage) => new Promise<unknown>(resolve => {
  const chunks: Buffer[] = [];
  req.on('data', c => chunks.push(c));
  req.on('end', () => {
    const raw = Buffer.concat(chunks).toString('utf8');
    if (!raw) return resolve(undefined);
    try { resolve(JSON.parse(raw)); } catch { resolve(raw); }
  });
});

createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);
  const query: Record<string, string> = Object.fromEntries(url.searchParams);
  const body = req.method === 'GET' || req.method === 'HEAD' ? undefined : await readBody(req);

  const started = Date.now();
  const log = (status: number, note = '') =>
    console.log(`${String(req.method).padEnd(6)} ${url.pathname.padEnd(28)} ${status}  ${Date.now() - started}ms ${note}`);

  try {
    if (url.pathname === '/api/auth/session') {
      const { vreq, vres } = adapt(req, res, query, body);
      await sessionHandler(vreq as never, vres as never);
      return log(res.statusCode);
    }

    if (url.pathname === '/api/config/datasets') {
      const { vreq, vres } = adapt(req, res, query, body);
      await configDatasetsHandler(vreq as never, vres as never);
      return log(res.statusCode);
    }

    if (url.pathname === '/api/config/departments') {
      const { vreq, vres } = adapt(req, res, query, body);
      await configDepartmentsHandler(vreq as never, vres as never);
      return log(res.statusCode);
    }

    if (url.pathname === '/api/config/sources') {
      const { vreq, vres } = adapt(req, res, query, body);
      await configSourcesHandler(vreq as never, vres as never);
      return log(res.statusCode);
    }

    const m = url.pathname.match(/^\/api\/data\/([^/]+)$/);
    if (m) {
      const { vreq, vres } = adapt(req, res, { ...query, dataset: decodeURIComponent(m[1]) }, body);
      await dataHandler(vreq as never, vres as never);
      return log(res.statusCode, m[1]);
    }

    res.statusCode = 404;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: `No API route matches ${url.pathname}` }));
    log(404);
  } catch (e) {
    // The whole point of this server: show the actual failure.
    console.error('\n--- handler threw ---');
    console.error(e);
    console.error('---------------------\n');
    if (!res.headersSent) {
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: (e as Error).message }));
    }
    log(500);
  }
}).listen(PORT, () => {
  const need = ['GOOGLE_CLIENT_ID', 'GOOGLE_SA_EMAIL', 'GOOGLE_SA_PRIVATE_KEY', 'SHEETS_SPREADSHEET_ID'];
  const missing = need.filter(k => !process.env[k]);
  console.log(`\nAPI listening on http://localhost:${PORT}`);
  console.log(missing.length
    ? `MISSING ENV: ${missing.join(', ')} — requests will fail until these are set.\n`
    : 'All required environment variables present.\n');
});
