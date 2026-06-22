/**
 * Lightweight, dependency-free input validation for the API routes.
 * Returns either trimmed, typed data or a map of field errors.
 */

export type FieldErrors = Record<string, string>;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isEmail(value: string): boolean {
  return EMAIL_RE.test(value);
}

function str(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export type ContactInput = {
  name: string;
  email: string;
  company: string;
  market: string;
  message: string;
  /** Honeypot — must be empty for a genuine submission. */
  botField: string;
};

export function validateContact(
  body: unknown,
): { data: ContactInput; errors: null } | { data: null; errors: FieldErrors } {
  const b = (body ?? {}) as Record<string, unknown>;
  const errors: FieldErrors = {};

  const name = str(b.name);
  const email = str(b.email);
  const company = str(b.company);
  const market = str(b.market);
  const message = str(b.message);
  const botField = str(b["bot-field"] ?? b.botField);

  if (!name) errors.name = "Name is required.";
  else if (name.length > 120) errors.name = "Name is too long.";

  if (!email) errors.email = "Email is required.";
  else if (!isEmail(email)) errors.email = "Enter a valid email address.";
  else if (email.length > 200) errors.email = "Email is too long.";

  if (!message) errors.message = "Please tell us what you're trying to do.";
  else if (message.length > 5000) errors.message = "Message is too long (5000 char max).";

  if (company.length > 200) errors.company = "Company name is too long.";
  if (market.length > 200) errors.market = "Target market is too long.";

  if (Object.keys(errors).length > 0) return { data: null, errors };
  return { data: { name, email, company, market, message, botField }, errors: null };
}

export type SubscribeInput = { email: string; botField: string };

export function validateSubscribe(
  body: unknown,
): { data: SubscribeInput; errors: null } | { data: null; errors: FieldErrors } {
  const b = (body ?? {}) as Record<string, unknown>;
  const errors: FieldErrors = {};

  const email = str(b.email);
  const botField = str(b["bot-field"] ?? b.botField);

  if (!email) errors.email = "Email is required.";
  else if (!isEmail(email)) errors.email = "Enter a valid email address.";
  else if (email.length > 200) errors.email = "Email is too long.";

  if (Object.keys(errors).length > 0) return { data: null, errors };
  return { data: { email, botField }, errors: null };
}
