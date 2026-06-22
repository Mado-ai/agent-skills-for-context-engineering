/**
 * Server-side environment configuration for the API routes.
 *
 * None of these are NEXT_PUBLIC_*, so they stay on the server only.
 * Set them in the hosting provider (Netlify → Site settings → Environment).
 */
export const env = {
  /** Resend API key. Without it the email-sending routes return 503. */
  resendApiKey: process.env.RESEND_API_KEY ?? "",
  /** Verified "from" address (or "Name <addr>"). Must be on a Resend-verified domain. */
  fromEmail: process.env.EMAIL_FROM ?? "go overseas <hello@gooverseas.com>",
  /** Where contact-form enquiries are delivered. */
  contactToEmail: process.env.CONTACT_TO_EMAIL ?? "hello@gooverseas.com",
  /** Where newsletter signups are delivered (falls back to the contact inbox). */
  newsletterToEmail:
    process.env.NEWSLETTER_TO_EMAIL ?? process.env.CONTACT_TO_EMAIL ?? "hello@gooverseas.com",
} as const;

/** True when Resend credentials are present and email can actually be sent. */
export function isEmailConfigured(): boolean {
  return env.resendApiKey.length > 0;
}
