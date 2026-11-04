import nodemailer from "nodemailer";

export interface OutgoingEmail {
  from: string;
  to: string;
  subject: string;
  html: string;
  text: string;
  headers?: Record<string, string>;
}

/**
 * The adapter every provider implements. Locally it is SMTP into the Mailpit
 * of Supabase local; Resend plugs into this same interface in Phase 23.
 */
export interface EmailTransport {
  send(email: OutgoingEmail): Promise<{ messageId: string }>;
  close(): Promise<void>;
}

export interface SmtpOptions {
  host: string;
  port: number;
}

/** Plain SMTP, no auth and no TLS: meant for Mailpit on the local Docker network only. */
export function createSmtpTransport(options: SmtpOptions): EmailTransport {
  const transporter = nodemailer.createTransport({
    host: options.host,
    port: options.port,
    secure: false,
    ignoreTLS: true,
  });
  return {
    async send(email) {
      const info = await transporter.sendMail(email);
      return { messageId: info.messageId };
    },
    async close() {
      transporter.close();
    },
  };
}
