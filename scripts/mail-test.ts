/**
 * Prove the configured SMTP server accepts and delivers a message.
 *
 *   npm run mail:test                 send to MAIL_FROM_ADDRESS
 *   npm run mail:test you@gmail.com   send to a specific inbox
 *
 * This talks to whatever SMTP_* the current .env points at - Mailpit locally,
 * or a real provider (Gmail, Brevo, ...) once those variables are switched
 * over. It first runs `verify()`, which opens the connection and authenticates
 * without sending anything, so a wrong host, port, or App Password fails here
 * with a clear reason instead of silently queueing a FAILED notification.
 *
 * It deliberately does NOT touch the database or the outbox: it is a plumbing
 * check for the mail server, not a test of the notification pipeline.
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

// Runs outside Next.js, so .env has to be loaded explicitly.
const envPath = resolve(process.cwd(), '.env');
if (existsSync(envPath)) process.loadEnvFile(envPath);

import nodemailer from 'nodemailer';
import { getEnv } from '@/lib/env';

/** Show that auth is configured without printing the secret itself. */
function describeAuth(user: string, password: string): string {
  if (!user && !password) return 'anonymous (no SMTP_USER / SMTP_PASSWORD - fine for Mailpit)';
  if (user && password) return `user "${user}", password set (${password.length} chars)`;
  return user ? `user "${user}" but SMTP_PASSWORD is EMPTY` : 'SMTP_PASSWORD set but SMTP_USER is EMPTY';
}

async function main(): Promise<void> {
  const env = getEnv();
  const recipient = process.argv[2]?.trim() || env.MAIL_FROM_ADDRESS;

  console.log('Using SMTP configuration:');
  console.log(`  host    ${env.SMTP_HOST}:${env.SMTP_PORT}`);
  console.log(`  secure  ${env.SMTP_SECURE}`);
  console.log(`  auth    ${describeAuth(env.SMTP_USER, env.SMTP_PASSWORD)}`);
  console.log(`  from    ${env.MAIL_FROM_NAME} <${env.MAIL_FROM_ADDRESS}>`);
  console.log(`  to      ${recipient}`);
  console.log('');

  const transport = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_SECURE,
    auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASSWORD } : undefined,
    connectionTimeout: 8000,
    greetingTimeout: 8000,
    socketTimeout: 10_000,
  });

  process.stdout.write('Connecting and authenticating... ');
  await transport.verify();
  console.log('ok');

  process.stdout.write('Sending test message...          ');
  const info = await transport.sendMail({
    from: { name: env.MAIL_FROM_NAME, address: env.MAIL_FROM_ADDRESS },
    to: recipient,
    subject: 'VisitorPass SMTP test',
    text: 'This is a VisitorPass SMTP connectivity test. If you can read this, delivery works.',
    html: '<p>This is a <strong>VisitorPass</strong> SMTP connectivity test. If you can read this, delivery works.</p>',
  });
  console.log('ok');

  console.log('');
  console.log(`Accepted by the server (id ${info.messageId}).`);
  console.log(
    env.SMTP_HOST === 'localhost' || env.SMTP_HOST === 'mailpit'
      ? 'Mailpit captured it - open http://localhost:8025 to view. Nothing was delivered to a real inbox.'
      : `Delivered to the provider - check the ${recipient} inbox (and its spam folder).`,
  );
}

main().catch((error: unknown) => {
  console.log('');
  console.error('SMTP test FAILED:', error instanceof Error ? error.message : error);
  console.error(
    '\nCommon causes: wrong SMTP_HOST/SMTP_PORT, SMTP_SECURE mismatch (Gmail wants port 465 + secure=true,\n' +
      'or port 587 + secure=false), or an incorrect Gmail App Password in SMTP_PASSWORD.',
  );
  process.exitCode = 1;
});
