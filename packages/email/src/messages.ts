import type { Locale } from "./contract.js";

type Fill = Record<string, string | number>;

function fill(template: string, values: Fill): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => String(values[key] ?? ""));
}

const MESSAGES = {
  es: {
    common: {
      footer: "Enviado por ScaliaHR en nombre de {tenant}.",
      ignore: "Si no esperabas este correo, puedes ignorarlo.",
      linkFallback: "Si el botón no funciona, copia y pega este enlace en tu navegador:",
    },
    invitation: {
      subject: "{tenant} te invitó a ScaliaHR",
      heading: "Te damos la bienvenida a {tenant}",
      greeting: "Hola {name}:",
      greetingAnonymous: "Hola:",
      bodyWithInviter: "{inviter} te invitó a unirte a {tenant} en ScaliaHR.",
      body: "Te invitaron a unirte a {tenant} en ScaliaHR.",
      cta: "Aceptar invitación",
      expiry: "El enlace vence en {hours} horas.",
    },
    password_reset: {
      subject: "Restablece tu contraseña de {tenant}",
      heading: "Restablece tu contraseña",
      body: "Recibimos una solicitud para restablecer la contraseña de tu cuenta en {tenant}.",
      cta: "Restablecer contraseña",
      expiry: "El enlace vence en {minutes} minutos.",
      notYou: "Si no lo solicitaste, ignora este correo: tu contraseña no cambia.",
    },
    notification: {
      cta: "Ver en ScaliaHR",
    },
  },
  en: {
    common: {
      footer: "Sent by ScaliaHR on behalf of {tenant}.",
      ignore: "If you were not expecting this email, you can ignore it.",
      linkFallback: "If the button does not work, copy and paste this link into your browser:",
    },
    invitation: {
      subject: "{tenant} invited you to ScaliaHR",
      heading: "Welcome to {tenant}",
      greeting: "Hi {name},",
      greetingAnonymous: "Hi,",
      bodyWithInviter: "{inviter} invited you to join {tenant} on ScaliaHR.",
      body: "You were invited to join {tenant} on ScaliaHR.",
      cta: "Accept invitation",
      expiry: "The link expires in {hours} hours.",
    },
    password_reset: {
      subject: "Reset your {tenant} password",
      heading: "Reset your password",
      body: "We received a request to reset the password of your {tenant} account.",
      cta: "Reset password",
      expiry: "The link expires in {minutes} minutes.",
      notYou: "If you did not ask for this, ignore this email: your password stays the same.",
    },
    notification: {
      cta: "View in ScaliaHR",
    },
  },
} as const;

export type Messages = (typeof MESSAGES)["es"];

export function messagesFor(locale: Locale) {
  const m = MESSAGES[locale];
  return { m, t: fill };
}
