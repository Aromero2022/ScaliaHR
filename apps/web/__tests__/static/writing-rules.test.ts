import { describe, expect, it } from "vitest";
import { sourceFiles } from "./source-exports";
import { visibleTexts } from "./visible-texts";

/**
 * D48: the writing rules of the interface, over every string and JSX text of
 * src (read with the TypeScript parser, as in D42).
 * 1. A text that greets or addresses a person does not take a gender: "Te damos
 *    la bienvenida, Ana", never "Bienvenido, Ana" or "Estimada Ana". Role and
 *    field labels keep the standard HR terms ("Jefe directo", "Empleados",
 *    "administrador") and are not checked.
 * 2. The interface speaks to the person as tú: "Selecciona", "Contacta",
 *    "No tienes permisos", never "Seleccione", "Contacte", "No tiene permisos".
 */

const letters = (word: string) => `(?<!\\p{L})(?:${word})(?!\\p{L})`;

/**
 * Greetings and forms of address that agree with the person. "la bienvenida"
 * (the noun) is neutral; "estimado" and "querido" count only where a sentence
 * starts, so "Fecha estimada" (an adjective of a field) does not.
 */
const sentenceStart = (word: string) => `(?:^|[.!?¡¿:\\n])\\s*${letters(word)}`;
const ADDRESS = [
  { name: "bienvenido/a", pattern: new RegExp(`(?<!(?:la|una|tu|su|de)\\s)${letters("bienvenid[oa]s?")}`, "iu") },
  { name: "estimado/a", pattern: new RegExp(sentenceStart("estimad[oa]s?"), "iu") },
  { name: "querido/a", pattern: new RegExp(sentenceStart("querid[oa]s?"), "iu") },
];

/** The most common usted forms: imperatives, "usted", "¿desea" and "no tiene permisos". */
const USTED_WORDS = [
  "seleccione", "ingrese", "introduzca", "contacte", "comuníquese", "intente", "inténtelo", "verifique",
  "escriba", "elija", "confirme", "espere", "presione", "pulse", "escanee", "asegúrese", "utilice",
  "agregue", "proporcione", "indique", "descargue", "consulte", "capture", "haga clic",
  "usted", "ustedes", "desea", "no tiene permisos?", "su contraseña", "su cuenta", "su sesión",
];
const USTED = USTED_WORDS.map((word) => ({ name: word, pattern: new RegExp(letters(word.replace(/ /g, "\\s+")), "iu") }));

type Rule = { name: string; pattern: RegExp };

function findings(texts: string[], rules: Rule[]): string[] {
  return texts.flatMap((text) => rules.filter(({ pattern }) => pattern.test(text)).map(({ name }) => `${name} → "${text.replace(/\s+/g, " ").slice(0, 70)}"`));
}

const inSource = (rules: Rule[]) =>
  sourceFiles().flatMap(({ rel, source }) => findings(visibleTexts(source, rel, true), rules).map((hit) => `${rel}: ${hit}`));

const names = (texts: string[], rules: Rule[]) => findings(texts, rules).map((hit) => hit.split(" → ")[0]);

describe("writing rules of the interface (D48)", () => {
  it("no text greets or addresses a person with a gender", () => {
    expect(inSource(ADDRESS)).toEqual([]);
  });

  it("negative controls: gendered greetings and forms of address are reported", () => {
    const texts = ["Bienvenido, Ana", "¡Bienvenida, Ana!", "Bienvenidos al portal", "Estimado Juan:", "Estimada colaboradora", "Querido equipo"];
    expect(names(texts, ADDRESS)).toEqual(["bienvenido/a", "bienvenido/a", "bienvenido/a", "estimado/a", "estimado/a", "querido/a"]);
    const source = "export const m = { welcome: (name: string) => `Bienvenido, ${name}` };";
    expect(names(visibleTexts(source, "lib/i18n/x.ts", true), ADDRESS)).toEqual(["bienvenido/a"]);
  });

  it("positive controls: the neutral greeting and the standard HR labels pass", () => {
    const texts = [
      "Te damos la bienvenida, Ana",
      "Te damos la bienvenida a Acme",
      "Correo de bienvenida",
      "Jefe directo",
      "Evaluación del jefe directo:",
      "Rechazada por administrador",
      "Empleados",
      "Contacta al administrador.",
      "Fecha estimada de cierre",
    ];
    expect(names(texts, ADDRESS)).toEqual([]);
  });

  it("every text speaks to the person as tú", () => {
    expect(inSource(USTED)).toEqual([]);
  });

  it("negative controls: the common usted forms are reported", () => {
    const texts = [
      "Seleccione el tipo de acción:",
      "No tiene permisos para gestionar solicitudes ARCO. Contacte al administrador del tenant.",
      "Ingrese su contraseña",
      "Intente de nuevo.",
      "Verifique su identidad",
      "¿Desea continuar?",
      "Usted no tiene acceso",
      "Escanee el código QR",
      "Haga clic aquí",
      "Comuníquese con soporte",
    ];
    expect(names(texts, USTED)).toEqual([
      "seleccione",
      "contacte",
      "no tiene permisos?",
      "ingrese",
      "su contraseña",
      "intente",
      "verifique",
      "desea",
      "usted",
      "escanee",
      "haga clic",
      "comuníquese",
    ]);
  });

  it("positive controls: tú forms and impersonal texts pass", () => {
    const texts = [
      "Selecciona el tipo de acción:",
      "— Seleccionar —",
      "No tienes permisos para gestionar solicitudes ARCO. Contacta al administrador del tenant.",
      "Ingresa el código de 6 dígitos de tu aplicación de autenticación.",
      "No se pudo iniciar sesión. Intenta de nuevo.",
      "Verifica tu identidad con MFA para cambiar la configuración",
      "Escanea el código QR con tu aplicación de autenticación",
      "Demasiados intentos. Espera un momento y vuelve a intentarlo.",
      "La fecha de fin no puede ser anterior a la de inicio",
      "El nombre debe tener al menos 2 caracteres",
      "Sin permiso para gestionar ARCO",
      "Usuario no encontrado",
    ];
    expect(names(texts, USTED)).toEqual([]);
  });
});
