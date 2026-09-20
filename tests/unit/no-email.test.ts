import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * AT-025: the system sends no email.
 *
 * The application cannot open an SMTP connection if no library for it is
 * installed, so the durable way to pin that is at the dependency list. This
 * fails the moment someone adds a mail transport back - which is the point:
 * doing so reverses a specified product decision, and should be a conscious
 * change to the spec rather than a quiet `npm install`.
 */
const MAIL_LIBRARIES = [
  'nodemailer',
  'smtp-server',
  'mailparser',
  'emailjs',
  '@sendgrid/mail',
  'resend',
  'mailgun.js',
  'postmark',
];

describe('no email', () => {
  it('has no mail library among its dependencies', () => {
    const pkg = JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const installed = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });

    const found = installed.filter(
      (name) => MAIL_LIBRARIES.includes(name) || MAIL_LIBRARIES.includes(name.replace(/^@types\//, '')),
    );
    expect(found).toEqual([]);
  });

  it('reads no SMTP configuration', () => {
    const env = readFileSync(resolve(process.cwd(), 'lib/env.ts'), 'utf8');
    expect(env).not.toMatch(/SMTP_|MAIL_FROM/);
  });
});
