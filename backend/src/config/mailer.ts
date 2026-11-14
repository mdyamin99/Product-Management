import nodemailer from "nodemailer";
import { env } from "./env.js";

type Transporter = ReturnType<typeof nodemailer.createTransport>;

export interface MailMessage {
  to: string;
  subject: string;
  /** Pre-header text shown next to the subject in most inboxes. */
  preview: string;
  heading: string;
  paragraphs: string[];
  ctaLabel?: string;
  ctaUrl?: string;
  /** One-time verification code, rendered large and monospaced (OTP flows). */
  code?: string;
}

let transporter: Transporter | null = null;

/**
 * SMTP is optional: with `SMTP_HOST` unset the message is printed to the
 * console instead, so registration and login keep working on a fresh clone.
 */
export function isMailConfigured(): boolean {
  return env.SMTP_HOST.trim().length > 0;
}

function getTransporter(): Transporter {
  if (transporter === null) {
    transporter = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_SECURE,
      ...(env.SMTP_USER
        ? { auth: { user: env.SMTP_USER, pass: env.SMTP_PASS } }
        : {}),
    });
  }

  return transporter;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function renderHtml(message: MailMessage): string {
  const paragraphs = message.paragraphs
    .map(
      (text) =>
        `<p style="margin:0 0 16px;color:#334155;font-size:15px;line-height:1.6">${escapeHtml(text)}</p>`,
    )
    .join("");

  const code = message.code
    ? `<table role="presentation" cellspacing="0" cellpadding="0" style="margin:8px 0 16px;width:100%">
             <tr>
               <td align="center" style="border-radius:10px;background:#f1f5f9;border:1px dashed #94a3b8;padding:16px 0">
                 <span style="font-family:Consolas,Menlo,monospace;font-size:32px;font-weight:700;letter-spacing:0.35em;color:#0f172a;padding-left:0.35em">${escapeHtml(message.code)}</span>
               </td>
             </tr>
           </table>`
    : "";

  const cta =
    message.ctaLabel && message.ctaUrl
      ? `<table role="presentation" cellspacing="0" cellpadding="0" style="margin:24px 0 8px">
           <tr>
             <td style="border-radius:8px;background:#2563eb">
               <a href="${escapeHtml(message.ctaUrl)}"
                  style="display:inline-block;padding:12px 24px;color:#ffffff;font-size:15px;font-weight:600;text-decoration:none;border-radius:8px">
                 ${escapeHtml(message.ctaLabel)}
               </a>
             </td>
           </tr>
         </table>`
      : "";

  return `<!doctype html>
<html lang="en">
  <body style="margin:0;padding:0;background:#f1f5f9;font-family:Inter,Segoe UI,Helvetica,Arial,sans-serif">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f1f5f9;padding:32px 16px">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:520px;background:#ffffff;border-radius:16px;border:1px solid #e2e8f0;overflow:hidden">
            <tr>
              <td style="background:#0f172a;padding:24px 32px">
                <span style="font-size:20px;font-weight:700;color:#ffffff">&#128230; Product Monitor</span>
              </td>
            </tr>
            <tr>
              <td style="padding:32px">
                <p style="margin:0 0 8px;font-size:12px;font-weight:700;letter-spacing:0.08em;color:#64748b;text-transform:uppercase">${escapeHtml(message.preview)}</p>
                <h1 style="margin:0 0 16px;font-size:24px;line-height:1.3;color:#0f172a">${escapeHtml(message.heading)}</h1>
                ${paragraphs}
                ${code}
                ${cta}
                <p style="margin:24px 0 0;font-size:13px;color:#94a3b8">
                  If you did not perform this action you can safely ignore this message.
                </p>
              </td>
            </tr>
            <tr>
              <td style="background:#f8fafc;padding:20px 32px;border-top:1px solid #e2e8f0">
                <p style="margin:0;font-size:12px;color:#94a3b8">
                  Product Monitor &middot; Node.js &middot; PostgreSQL &middot; Redis
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

function toPlainText(message: MailMessage): string {
  const lines = [
    message.preview.toUpperCase(),
    "",
    message.heading,
    "",
    ...message.paragraphs,
  ];

  if (message.code) {
    lines.push("", `Your code: ${message.code}`);
  }

  if (message.ctaLabel && message.ctaUrl) {
    lines.push("", `${message.ctaLabel}: ${message.ctaUrl}`);
  }

  return lines.join("\n");
}

/** Errors that mean "no SMTP server reachable", as opposed to a rejection. */
const CONNECTION_ERROR_CODES = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "ENOTFOUND",
  "ESOCKET",
  "ETIMEDOUT",
]);

function smtpErrorCode(error: unknown): string | null {
  if (error !== null && typeof error === "object" && "code" in error) {
    const code = (error as { code?: unknown }).code;

    if (typeof code === "string") return code;
  }

  return null;
}

async function sendWithRetry(
  message: MailMessage,
  attempts = 3,
): Promise<void> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await getTransporter().sendMail({
        from: env.MAIL_FROM,
        to: message.to,
        subject: message.subject,
        text: toPlainText(message),
        html: renderHtml(message),
      });
      return;
    } catch (error) {
      lastError = error;

      if (attempt < attempts) {
        // Exponential backoff: rides out a broker restarting or a short
        // network/DNS blip without stalling the caller for long.
        await new Promise((resolve) =>
          setTimeout(resolve, 500 * 2 ** (attempt - 1)),
        );
      }
    }
  }

  throw lastError;
}

/**
 * Send an e-mail. Resolves once the SMTP handshake and delivery complete, so
 * callers that need delivery guarantees can await it and surface failures.
 */
export async function sendMail(message: MailMessage): Promise<void> {
  if (!isMailConfigured()) {
    console.log(
      `[mail:dev] SMTP_HOST is not set — e-mail to ${message.to} not sent.\n` +
        `  Subject: ${message.subject}\n` +
        `  ${toPlainText(message).replaceAll("\n", "\n  ")}`,
    );
    return;
  }

  try {
    await sendWithRetry(message);
  } catch (error) {
    // Nothing is listening on the SMTP port (fresh clone, Mailpit not
    // started): print instead of failing the flow that triggered the mail.
    const code = smtpErrorCode(error);
    const reason = error instanceof Error ? error.message : String(error);

    if (code !== null && CONNECTION_ERROR_CODES.has(code)) {
      console.log(
        `[mail:dev] SMTP failure (${code}: ${reason}) — e-mail to ${message.to} not sent.\n` +
          `  Start it with "docker compose up -d mailpit", or set SMTP_HOST/SMTP_USER/SMTP_PASS to send via Gmail.\n` +
          `  Subject: ${message.subject}\n` +
          `  ${toPlainText(message).replaceAll("\n", "\n  ")}`,
      );
      return;
    }

    throw error;
  }
}

export async function sendWelcomeEmail(params: {
  to: string;
  name: string;
}): Promise<void> {
  await sendMail({
    to: params.to,
    subject: "Welcome to Product Monitor",
    preview: "Getting started",
    heading: `Welcome, ${params.name}!`,
    paragraphs: [
      "Your account has been created and you are ready to start tracking products.",
      "Sign in to add your first product, and keep an eye on the dashboard for live status updates from PostgreSQL, Redis, Kafka and RabbitMQ.",
    ],
    ctaLabel: "Open Product Monitor",
    ctaUrl: env.FRONTEND_URL,
  });
}

export async function sendWelcomeBackEmail(params: {
  to: string;
  name: string;
  occurredAt: string;
}): Promise<void> {
  await sendMail({
    to: params.to,
    subject: "Welcome back to Product Monitor",
    preview: "New sign-in",
    heading: `Welcome back, ${params.name}!`,
    paragraphs: [
      `We noticed a sign-in to your account on ${new Date(params.occurredAt).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" })} UTC.`,
      "If this was you, no action is needed. If you do not recognise this sign-in, reset your password immediately.",
    ],
    ctaLabel: "Go to your dashboard",
    ctaUrl: env.FRONTEND_URL,
  });
}

export async function sendPasswordResetCodeEmail(params: {
  to: string;
  name: string;
  code: string;
  expiresInMinutes: number;
}): Promise<void> {
  await sendMail({
    to: params.to,
    subject: "Your Product Monitor password reset code",
    preview: "Password reset",
    heading: `Hi ${params.name},`,
    paragraphs: [
      `We received a request to reset the password on your account. Enter the code below within ${params.expiresInMinutes} minutes to choose a new password.`,
      "If you did not ask for this you can safely ignore the message — your password stays exactly as it is.",
    ],
    code: params.code,
  });
}
