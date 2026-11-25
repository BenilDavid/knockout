import nodemailer from "nodemailer";
import { Resend } from "resend";
import { ApiError } from "./tournaments.js";

export type OutgoingMail = {
  to: string;
  subject: string;
  text: string;
  html?: string;
};

/**
 * Which delivery backend is configured. MAIL_FROM is required for both.
 * Resend wins when RESEND_API_KEY and SMTP_URL are both set.
 */
export function mailProvider(): "resend" | "smtp" | null {
  if (!process.env.MAIL_FROM) return null;
  if (process.env.RESEND_API_KEY) return "resend";
  if (process.env.SMTP_URL) return "smtp";
  return null;
}

/**
 * When MANUAL_VERIFICATION is "true" (or "1"), an administrator can verify
 * accounts by hand, and an email that cannot be delivered no longer blocks
 * registration. Leave it unset once real email delivery works for everyone.
 */
export const manualVerification = () =>
  ["true", "1"].includes(
    (process.env.MANUAL_VERIFICATION ?? "").trim().toLowerCase(),
  );

/** Shown instead of "verify your email" when approval is manual. */
export const pendingApprovalMessage =
  "Account created. We couldn't send a verification email, so an administrator will approve your account.";

/**
 * Sends one email. Returns false when no provider is configured so the caller
 * can decide on a fallback (the development preview link). Throws an ApiError
 * when a configured provider fails to deliver.
 */
export async function sendMail(mail: OutgoingMail): Promise<boolean> {
  const provider = mailProvider();
  const from = process.env.MAIL_FROM!;
  if (provider === "resend") {
    try {
      // The Resend SDK resolves with { data, error } instead of throwing on
      // API errors (bad key, unverified domain, rate limit), so check `error`.
      const { error } = await new Resend(process.env.RESEND_API_KEY).emails.send(
        { from, ...mail },
      );
      if (error) throw new Error(`${error.name}: ${error.message}`);
    } catch (err) {
      console.error("Resend email delivery failed:", err);
      throw new ApiError(
        502,
        "We could not send the email. Please try again shortly.",
      );
    }
    return true;
  }
  if (provider === "smtp") {
    await nodemailer
      .createTransport(process.env.SMTP_URL!)
      .sendMail({ from, ...mail });
    return true;
  }
  return false;
}

const escapeHtml = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );

/** Plain-text and HTML bodies for a single-button account email. */
export function actionEmail(o: {
  heading: string;
  intro: string;
  button: string;
  url: string;
}) {
  const text = `${o.heading}\n\n${o.intro}\n\n${o.button}: ${o.url}\n\nIf you did not request this, ignore this email.`;
  const html = `<!doctype html>
<html>
  <body style="margin:0;padding:24px;background:#f4f4f5;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#18181b;">
    <div style="max-width:480px;margin:0 auto;padding:32px;background:#ffffff;border-radius:12px;">
      <h1 style="margin:0 0 16px;font-size:20px;line-height:1.3;">${escapeHtml(o.heading)}</h1>
      <p style="margin:0 0 24px;font-size:15px;line-height:1.5;">${escapeHtml(o.intro)}</p>
      <p style="margin:0 0 24px;">
        <a href="${escapeHtml(o.url)}" style="display:inline-block;padding:12px 20px;background:#18181b;color:#ffffff;text-decoration:none;border-radius:8px;font-size:15px;font-weight:600;">${escapeHtml(o.button)}</a>
      </p>
      <p style="margin:0 0 8px;font-size:13px;line-height:1.5;color:#52525b;">Or copy this link into your browser:</p>
      <p style="margin:0 0 24px;font-size:13px;line-height:1.5;word-break:break-all;"><a href="${escapeHtml(o.url)}" style="color:#52525b;">${escapeHtml(o.url)}</a></p>
      <p style="margin:0;font-size:13px;line-height:1.5;color:#52525b;">If you did not request this, you can safely ignore this email.</p>
    </div>
  </body>
</html>`;
  return { text, html };
}
