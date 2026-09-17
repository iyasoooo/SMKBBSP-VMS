/**
 * Email templates.
 *
 * Every template receives a flat, already-safe payload. Two rules are enforced
 * by construction rather than by review:
 *
 *   1. Subjects carry the appointment reference and nothing else identifying -
 *      no name, no identity number, no purpose. Mail subjects appear in
 *      notification popups and on lock screens.
 *   2. Bodies never contain an identity number. The private link is the only
 *      secret in the message, and it goes in the body, never the subject.
 */

export type TemplateKey =
  | 'visitor-request-received'
  | 'teacher-new-request'
  | 'visitor-approved'
  | 'visitor-rejected'
  | 'visitor-cancelled'
  | 'host-arrival'
  | 'host-checkout'
  | 'admin-review-required';

export interface RenderedEmail {
  subject: string;
  text: string;
  html: string;
}

/** Values a template may reference. All are safe to persist in the outbox. */
export interface TemplatePayload {
  reference?: string;
  visitorName?: string;
  teacherName?: string;
  schoolName?: string;
  destinationName?: string;
  visitTypeName?: string;
  scheduledAt?: string;
  windowText?: string;
  purpose?: string;
  statusUrl?: string;
  decisionNote?: string;
  badgeNumber?: string;
  checkedInAt?: string;
  checkedOutAt?: string;
  instructions?: string;
  reviewUrl?: string;
  fallbackCode?: string;
  partySize?: number;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Shared HTML shell. Tables and inline styles are used deliberately: mail
 * clients strip <style> blocks and ignore most modern CSS.
 */
function layout(options: {
  schoolName: string;
  heading: string;
  bodyHtml: string;
  footerNote?: string;
}): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>${escapeHtml(options.heading)}</title></head>
<body style="margin:0;padding:0;background:#f7f6f3;font-family:Segoe UI,system-ui,-apple-system,Arial,sans-serif;color:#2c2724;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f7f6f3;padding:24px 12px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:1px solid #e4e0d8;border-radius:12px;overflow:hidden;">
        <tr><td style="background:#a50e26;padding:18px 24px;color:#ffffff;">
          <div style="font-size:15px;font-weight:600;">Visitor Management System</div>
          <div style="font-size:12px;opacity:.85;">${escapeHtml(options.schoolName)}</div>
        </td></tr>
        <tr><td style="padding:24px;">
          <h1 style="margin:0 0 14px;font-size:18px;color:#1a1512;">${escapeHtml(options.heading)}</h1>
          ${options.bodyHtml}
        </td></tr>
        <tr><td style="padding:16px 24px;background:#faf9f6;border-top:1px solid #e4e0d8;font-size:12px;color:#6b625c;">
          ${escapeHtml(options.footerNote ?? 'This is an automated message from the school visitor system. Please do not reply.')}
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

function paragraph(text: string): string {
  return `<p style="margin:0 0 12px;font-size:14px;line-height:1.6;">${escapeHtml(text)}</p>`;
}

function detailTable(rows: Array<[string, string]>): string {
  const cells = rows
    .filter(([, value]) => value && value.length > 0)
    .map(
      ([label, value]) =>
        `<tr>
           <td style="padding:6px 12px 6px 0;font-size:13px;color:#6b625c;white-space:nowrap;vertical-align:top;">${escapeHtml(label)}</td>
           <td style="padding:6px 0;font-size:13px;color:#1a1512;font-weight:600;">${escapeHtml(value)}</td>
         </tr>`,
    )
    .join('');

  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:4px 0 16px;width:100%;">${cells}</table>`;
}

function button(url: string, label: string): string {
  return `<p style="margin:18px 0;">
    <a href="${escapeHtml(url)}" style="display:inline-block;background:#00693e;color:#ffffff;text-decoration:none;padding:11px 20px;border-radius:8px;font-size:14px;font-weight:600;">${escapeHtml(label)}</a>
  </p>
  <p style="margin:0 0 12px;font-size:12px;color:#5a6b85;word-break:break-all;">If the button does not work, copy this address into your browser:<br>${escapeHtml(url)}</p>`;
}

function textLines(lines: Array<string | null | undefined>): string {
  return lines.filter((line): line is string => Boolean(line)).join('\n');
}

/**
 * Render a template.
 *
 * Missing payload fields degrade to a neutral placeholder rather than throwing:
 * a notification must never be the thing that breaks a check-in.
 */
export function renderEmail(templateKey: TemplateKey, payload: TemplatePayload): RenderedEmail {
  const school = payload.schoolName ?? 'SMK Bandar Baru Sri Petaling';
  const reference = payload.reference ?? '-';
  const visitor = payload.visitorName ?? 'Visitor';
  const teacher = payload.teacherName ?? 'the teacher';

  switch (templateKey) {
    case 'visitor-request-received': {
      const heading = 'We received your visit request';
      const body =
        paragraph(`Dear ${visitor}, thank you for submitting a visit request to ${school}.`) +
        paragraph(
          `Your request is now with ${teacher} for approval. You will receive another email once a decision is made.`,
        ) +
        detailTable([
          ['Reference', reference],
          ['Host teacher', teacher],
          ['Requested time', payload.scheduledAt ?? ''],
          ['Destination', payload.destinationName ?? ''],
        ]) +
        (payload.statusUrl
          ? button(payload.statusUrl, 'View or cancel my request')
          : '') +
        paragraph(
          'Keep this link private. Anyone who has it can see and cancel your request.',
        );

      return {
        subject: `Visit request received - ${reference}`,
        html: layout({ schoolName: school, heading, bodyHtml: body }),
        text: textLines([
          `Dear ${visitor},`,
          '',
          `Thank you for submitting a visit request to ${school}.`,
          `Your request is with ${teacher} for approval.`,
          '',
          `Reference: ${reference}`,
          payload.scheduledAt ? `Requested time: ${payload.scheduledAt}` : null,
          payload.destinationName ? `Destination: ${payload.destinationName}` : null,
          '',
          payload.statusUrl ? `View or cancel your request: ${payload.statusUrl}` : null,
          'Keep this link private.',
        ]),
      };
    }

    case 'teacher-new-request': {
      const heading = 'A visitor has requested to meet you';
      const body =
        paragraph(`A new visit request is waiting for your decision.`) +
        detailTable([
          ['Reference', reference],
          ['Visitor', visitor],
          ['Requested time', payload.scheduledAt ?? ''],
          ['Visit type', payload.visitTypeName ?? ''],
          ['Destination', payload.destinationName ?? ''],
          ['People expected', payload.partySize ? String(payload.partySize) : ''],
          ['Purpose', payload.purpose ?? ''],
        ]) +
        (payload.reviewUrl ? button(payload.reviewUrl, 'Review this request') : '');

      return {
        subject: `New visit request awaiting your approval - ${reference}`,
        html: layout({ schoolName: school, heading, bodyHtml: body }),
        text: textLines([
          'A new visit request is waiting for your decision.',
          '',
          `Reference: ${reference}`,
          `Visitor: ${visitor}`,
          payload.scheduledAt ? `Requested time: ${payload.scheduledAt}` : null,
          payload.purpose ? `Purpose: ${payload.purpose}` : null,
          '',
          payload.reviewUrl ? `Review: ${payload.reviewUrl}` : null,
        ]),
      };
    }

    case 'visitor-approved': {
      const heading = 'Your visit has been approved';
      const body =
        paragraph(`Dear ${visitor}, ${teacher} has approved your visit to ${school}.`) +
        detailTable([
          ['Reference', reference],
          ['Host teacher', teacher],
          ['Date and time', payload.scheduledAt ?? ''],
          ['Destination', payload.destinationName ?? ''],
          ['Pass valid', payload.windowText ?? ''],
        ]) +
        (payload.decisionNote
          ? paragraph(`Note from your host: ${payload.decisionNote}`)
          : '') +
        (payload.statusUrl ? button(payload.statusUrl, 'Open my QR visitor pass') : '') +
        (payload.statusUrl
          ? paragraph(
              'Your pass is digital. Open that link on your phone at the guard house - there is nothing to print.',
            )
          : '') +
        (payload.fallbackCode
          ? paragraph(
              `If the guard cannot scan your QR code, give them this code instead: ${payload.fallbackCode}`,
            )
          : '') +
        paragraph(
          'Please bring your physical identification. The guard will check it at the gate before you are checked in.',
        ) +
        (payload.instructions ? paragraph(payload.instructions) : '');

      return {
        subject: `Visit approved - ${reference}`,
        html: layout({ schoolName: school, heading, bodyHtml: body }),
        text: textLines([
          `Dear ${visitor},`,
          '',
          `${teacher} has approved your visit to ${school}.`,
          '',
          `Reference: ${reference}`,
          payload.scheduledAt ? `Date and time: ${payload.scheduledAt}` : null,
          payload.destinationName ? `Destination: ${payload.destinationName}` : null,
          payload.windowText ? `Pass valid: ${payload.windowText}` : null,
          payload.decisionNote ? `Note from your host: ${payload.decisionNote}` : null,
          '',
          payload.statusUrl ? `Open your pass: ${payload.statusUrl}` : null,
          payload.statusUrl
            ? 'Your pass is digital. Show it on your phone at the guard house - there is nothing to print.'
            : null,
          payload.fallbackCode ? `Manual code: ${payload.fallbackCode}` : null,
          '',
          'Please bring your physical identification.',
          payload.instructions ?? null,
        ]),
      };
    }

    case 'visitor-rejected': {
      const heading = 'Your visit request was not approved';
      const body =
        paragraph(`Dear ${visitor}, ${teacher} was unable to approve your visit request.`) +
        detailTable([
          ['Reference', reference],
          ['Requested time', payload.scheduledAt ?? ''],
        ]) +
        (payload.decisionNote ? paragraph(`Reason given: ${payload.decisionNote}`) : '') +
        paragraph(
          'You are welcome to submit a new request for a different time, or contact the school office if you need help.',
        );

      return {
        subject: `Visit request decision - ${reference}`,
        html: layout({ schoolName: school, heading, bodyHtml: body }),
        text: textLines([
          `Dear ${visitor},`,
          '',
          `${teacher} was unable to approve your visit request.`,
          `Reference: ${reference}`,
          payload.decisionNote ? `Reason given: ${payload.decisionNote}` : null,
          '',
          'You may submit a new request for a different time.',
        ]),
      };
    }

    case 'visitor-cancelled': {
      const heading = 'Your visit request has been cancelled';
      const body =
        paragraph(`Dear ${visitor}, your visit request has been cancelled.`) +
        detailTable([
          ['Reference', reference],
          ['Requested time', payload.scheduledAt ?? ''],
        ]) +
        paragraph('If this was not intended, please submit a new request.');

      return {
        subject: `Visit request cancelled - ${reference}`,
        html: layout({ schoolName: school, heading, bodyHtml: body }),
        text: textLines([
          `Dear ${visitor},`,
          '',
          'Your visit request has been cancelled.',
          `Reference: ${reference}`,
        ]),
      };
    }

    case 'host-arrival': {
      const heading = 'Your visitor has arrived';
      const body =
        paragraph(`${visitor} has been checked in at the gate and is on the way to meet you.`) +
        detailTable([
          ['Reference', reference],
          ['Badge number', payload.badgeNumber ?? ''],
          ['Checked in at', payload.checkedInAt ?? ''],
          ['Destination', payload.destinationName ?? ''],
          ['People', payload.partySize ? String(payload.partySize) : ''],
        ]);

      return {
        subject: `Visitor arrived - ${reference}`,
        html: layout({ schoolName: school, heading, bodyHtml: body }),
        text: textLines([
          `${visitor} has been checked in at the gate.`,
          `Reference: ${reference}`,
          payload.badgeNumber ? `Badge: ${payload.badgeNumber}` : null,
          payload.checkedInAt ? `Checked in at: ${payload.checkedInAt}` : null,
        ]),
      };
    }

    case 'host-checkout': {
      const heading = 'Your visitor has checked out';
      const body =
        paragraph(`${visitor} has checked out and left the school.`) +
        detailTable([
          ['Reference', reference],
          ['Badge number', payload.badgeNumber ?? ''],
          ['Checked out at', payload.checkedOutAt ?? ''],
        ]);

      return {
        subject: `Visitor checked out - ${reference}`,
        html: layout({ schoolName: school, heading, bodyHtml: body }),
        text: textLines([
          `${visitor} has checked out.`,
          `Reference: ${reference}`,
          payload.checkedOutAt ? `Checked out at: ${payload.checkedOutAt}` : null,
        ]),
      };
    }

    case 'admin-review-required': {
      const heading = 'A visit request needs administrator review';
      const body =
        paragraph(
          'A submitted visit request requires manual review before it can proceed. It has not been sent to the host teacher for approval.',
        ) +
        detailTable([
          ['Reference', reference],
          ['Requested time', payload.scheduledAt ?? ''],
        ]) +
        (payload.reviewUrl ? button(payload.reviewUrl, 'Open the request') : '') +
        paragraph('Details are available in the administrator area only.');

      return {
        subject: `Visit request requires review - ${reference}`,
        html: layout({ schoolName: school, heading, bodyHtml: body }),
        text: textLines([
          'A submitted visit request requires manual review.',
          `Reference: ${reference}`,
          payload.reviewUrl ? `Open: ${payload.reviewUrl}` : null,
        ]),
      };
    }

    default: {
      // Exhaustiveness guard: adding a key without a case fails to compile.
      const exhaustive: never = templateKey;
      throw new Error(`Unknown email template: ${String(exhaustive)}`);
    }
  }
}
