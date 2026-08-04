/**
 * No-Docker mail catcher for local development.
 *
 * Mailpit via `docker compose up` (npm run db:up) is the primary, documented
 * path. This script is the fallback for machines without a working Docker
 * daemon: it accepts SMTP on the same port (1025) and serves a minimal
 * inbox UI on the same port (8025), so nothing in the app configuration
 * changes between the two.
 *
 *   npm run local:mail
 *
 * It accepts any sender/recipient, never relays anything, and keeps messages
 * in memory only. Stopping the process discards them.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { SMTPServer } from 'smtp-server';
import { simpleParser } from 'mailparser';

const SMTP_PORT = 1025;
const HTTP_PORT = 8025;
const MAX_MESSAGES = 500;

interface CapturedMessage {
  id: number;
  receivedAt: Date;
  from: string;
  to: string[];
  subject: string;
  text: string;
  html: string | null;
}

const messages: CapturedMessage[] = [];
let nextId = 1;

const smtp = new SMTPServer({
  authOptional: true,
  disabledCommands: ['STARTTLS'],
  onData(stream, _session, callback) {
    simpleParser(stream)
      .then((parsed) => {
        const toList = Array.isArray(parsed.to)
          ? parsed.to.flatMap((entry) => entry.value.map((v) => v.address ?? ''))
          : (parsed.to?.value.map((v) => v.address ?? '') ?? []);

        messages.unshift({
          id: nextId++,
          receivedAt: new Date(),
          from: parsed.from?.value[0]?.address ?? '(unknown)',
          to: toList.filter(Boolean),
          subject: parsed.subject ?? '(no subject)',
          text: parsed.text ?? '',
          html: typeof parsed.html === 'string' ? parsed.html : null,
        });

        if (messages.length > MAX_MESSAGES) messages.length = MAX_MESSAGES;

        const latest = messages[0];
        console.log(`[mail] ${latest?.subject ?? ''}  ->  ${latest?.to.join(', ') ?? ''}`);
        callback();
      })
      .catch((error: unknown) => {
        console.error('[mail] parse failed:', error);
        callback();
      });
  },
});

smtp.on('error', (error) => console.error('[smtp] error:', error));

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderInbox(): string {
  const rows =
    messages.length === 0
      ? '<p class="empty">No messages captured yet.</p>'
      : messages
          .map(
            (m) => `
      <article>
        <header>
          <strong>${escapeHtml(m.subject)}</strong>
          <span>${m.receivedAt.toISOString()}</span>
        </header>
        <p class="meta">From ${escapeHtml(m.from)} &rarr; ${escapeHtml(m.to.join(', '))}</p>
        <details><summary>Message body</summary>
          ${m.html ? `<iframe sandbox srcdoc="${escapeHtml(m.html)}"></iframe>` : `<pre>${escapeHtml(m.text)}</pre>`}
        </details>
      </article>`,
          )
          .join('');

  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<title>VisitorPass local inbox</title>
<meta http-equiv="refresh" content="10">
<style>
  body{font:14px/1.5 system-ui,sans-serif;margin:0;padding:24px;background:#0f172a;color:#e2e8f0}
  h1{font-size:18px;margin:0 0 4px}
  .sub{color:#94a3b8;margin:0 0 20px}
  article{background:#1e293b;border:1px solid #334155;border-radius:8px;padding:14px;margin-bottom:12px}
  header{display:flex;justify-content:space-between;gap:12px;align-items:baseline}
  header span{color:#94a3b8;font-size:12px;white-space:nowrap}
  .meta{color:#94a3b8;font-size:12px;margin:6px 0 8px}
  pre{white-space:pre-wrap;background:#0f172a;padding:10px;border-radius:6px;overflow-x:auto}
  iframe{width:100%;height:420px;border:0;border-radius:6px;background:#fff}
  summary{cursor:pointer;color:#7dd3fc}
  .empty{color:#94a3b8}
</style></head><body>
<h1>VisitorPass local inbox</h1>
<p class="sub">Development fallback for Mailpit. ${messages.length} message(s). Auto-refreshes every 10s.</p>
${rows}
</body></html>`;
}

const http = createServer((req: IncomingMessage, res: ServerResponse) => {
  if (req.url === '/readyz') {
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('ok');
    return;
  }
  if (req.url === '/api/messages') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(messages));
    return;
  }
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(renderInbox());
});

smtp.listen(SMTP_PORT, '127.0.0.1', () => {
  console.log(`SMTP listening on localhost:${SMTP_PORT}`);
});

http.listen(HTTP_PORT, '127.0.0.1', () => {
  console.log(`Inbox UI on http://localhost:${HTTP_PORT}`);
  console.log('Press Ctrl+C to stop.');
});

const shutdown = (): void => {
  smtp.close(() => process.exit(0));
  http.close();
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
