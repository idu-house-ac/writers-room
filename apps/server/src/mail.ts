// One small module in front of the email provider so it can be swapped (see BRIEF.md).
import nodemailer, { type Transporter } from 'nodemailer';
import type { Config } from './config';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export interface Mailer {
  send(message: MailMessage): Promise<void>;
}

export class MemoryMailer implements Mailer {
  messages: MailMessage[] = [];
  async send(message: MailMessage): Promise<void> {
    this.messages.push(message);
  }
  last(): MailMessage | undefined {
    return this.messages[this.messages.length - 1];
  }
  clear(): void {
    this.messages = [];
  }
}

class ConsoleMailer implements Mailer {
  constructor(private log: (msg: string) => void) {}
  async send(message: MailMessage): Promise<void> {
    this.log(`\n===== EMAIL (not sent: no SMTP_HOST configured) =====\nTo: ${message.to}\nSubject: ${message.subject}\n\n${message.text}\n=====================================================\n`);
  }
}

class SmtpMailer implements Mailer {
  private transport: Transporter;
  constructor(private config: Config) {
    this.transport = nodemailer.createTransport({
      host: config.SMTP_HOST,
      port: config.SMTP_PORT,
      secure: config.SMTP_SECURE,
      auth: config.SMTP_USER ? { user: config.SMTP_USER, pass: config.SMTP_PASS ?? '' } : undefined,
    });
  }
  async send(message: MailMessage): Promise<void> {
    await this.transport.sendMail({ from: this.config.MAIL_FROM, ...message });
  }
}

export function createMailer(config: Config, log: (msg: string) => void = console.log): Mailer {
  switch (config.mailTransport) {
    case 'smtp':
      return new SmtpMailer(config);
    case 'memory':
      return new MemoryMailer();
    default:
      return new ConsoleMailer(log);
  }
}

// ---- Templates ----

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

function layout(title: string, bodyHtml: string): string {
  return `<!doctype html><html><body style="margin:0;background:#121110;color:#f2eee8;font-family:Inter,Helvetica,Arial,sans-serif;padding:32px">
<div style="max-width:520px;margin:0 auto;background:#1b1917;border:1px solid #2e2a27;border-radius:12px;padding:28px">
<p style="margin:0 0 16px;font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:#a39c93">Writers Room</p>
<h1 style="margin:0 0 16px;font-size:22px">${escapeHtml(title)}</h1>
${bodyHtml}
</div></body></html>`;
}

function button(href: string, label: string): string {
  return `<p style="margin:24px 0"><a href="${escapeHtml(href)}" style="background:#E0B04A;color:#1a1408;text-decoration:none;font-weight:600;padding:12px 18px;border-radius:8px;display:inline-block">${escapeHtml(label)}</a></p>
<p style="font-size:13px;color:#a39c93">Or paste this link into your browser:<br><span style="word-break:break-all">${escapeHtml(href)}</span></p>`;
}

export function inviteEmail(opts: {
  to: string;
  inviterName: string;
  projectTitle: string;
  roleLabel: string;
  link: string;
  expiresInDays: number;
}): MailMessage {
  const subject = `${opts.inviterName} invited you to "${opts.projectTitle}" on Writers Room`;
  const text = `${opts.inviterName} invited you to join the project "${opts.projectTitle}" as ${opts.roleLabel}.

Accept the invitation: ${opts.link}

This link works once and expires in ${opts.expiresInDays} days.`;
  const html = layout(
    `You're invited to "${opts.projectTitle}"`,
    `<p>${escapeHtml(opts.inviterName)} invited you to join as <strong>${escapeHtml(opts.roleLabel)}</strong>.</p>${button(opts.link, 'Accept invitation')}<p style="font-size:13px;color:#a39c93">This link works once and expires in ${opts.expiresInDays} days.</p>`,
  );
  return { to: opts.to, subject, text, html };
}

export function passwordResetEmail(opts: { to: string; name: string; link: string; expiresInMinutes: number }): MailMessage {
  const subject = 'Reset your Writers Room password';
  const text = `Hi ${opts.name},

Someone asked to reset the password for this Writers Room account. If that was you, open this link:

${opts.link}

The link expires in ${opts.expiresInMinutes} minutes. If you did not ask for this, you can ignore this email.`;
  const html = layout(
    'Reset your password',
    `<p>Hi ${escapeHtml(opts.name)}, someone asked to reset the password for this account. If that was you, use the button below.</p>${button(opts.link, 'Choose a new password')}<p style="font-size:13px;color:#a39c93">The link expires in ${opts.expiresInMinutes} minutes. If you did not ask for this, ignore this email.</p>`,
  );
  return { to: opts.to, subject, text, html };
}
