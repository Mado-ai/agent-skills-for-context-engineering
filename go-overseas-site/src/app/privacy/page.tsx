import type { Metadata } from "next";
import { LegalPage } from "@/components/LegalPage";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description:
    "How go overseas collects, uses, and protects your personal information.",
  alternates: { canonical: "/privacy" },
};

export default function PrivacyPage() {
  return (
    <LegalPage
      title="Privacy Policy"
      updated="June 22, 2026"
      intro="This policy explains what information go overseas collects, why we collect it, and the choices you have. We aim to be plain-spoken — no dark patterns, no surprises."
    >
      <h2>1. Who we are</h2>
      <p>
        “go overseas” (“we”, “us”, “our”) is a creative management agency. We are the data
        controller for the personal information
        described in this policy. Questions can be sent to{" "}
        <a href="mailto:privacy@gooverseas.com">privacy@gooverseas.com</a>.
      </p>

      <h2>2. Information we collect</h2>
      <ul>
        <li>
          <strong>Information you give us.</strong> Your name, work email, company, target
          markets, and the details of any message you send through our contact form or by
          email.
        </li>
        <li>
          <strong>Information collected automatically.</strong> Basic technical data such as
          browser type, device, approximate location (from IP), and pages visited, gathered
          through privacy-respecting analytics.
        </li>
        <li>
          <strong>Cookies.</strong> We use a small number of cookies that are strictly
          necessary for the site to function and, where consented, for analytics.
        </li>
      </ul>

      <h2>3. How we use your information</h2>
      <ul>
        <li>To respond to enquiries and provide our services.</li>
        <li>To operate, maintain, and improve our website.</li>
        <li>To send service-related communications you have requested.</li>
        <li>To comply with legal obligations and protect against fraud or misuse.</li>
      </ul>
      <p>
        We do <strong>not</strong> sell your personal information.
      </p>

      <h2>4. Our legal bases</h2>
      <p>
        As a Canadian business, we handle personal information in accordance with Canada&apos;s
        <strong> Personal Information Protection and Electronic Documents Act (PIPEDA)</strong>{" "}
        and applicable provincial privacy laws — which means we collect, use, and disclose
        personal information only for purposes a reasonable person would consider appropriate,
        and with your knowledge and consent.
      </p>
      <p>
        Where the EU/UK <strong>GDPR</strong> applies to international clients, we additionally
        rely on your <strong>consent</strong> (e.g. analytics cookies), the{" "}
        <strong>performance of a contract</strong> (delivering services you engage us for), our{" "}
        <strong>legitimate interests</strong> (running and securing our business), and{" "}
        <strong>legal obligations</strong>.
      </p>

      <h2>5. Sharing your information</h2>
      <p>
        We share data only with trusted service providers who process it on our behalf
        (e.g. hosting, email, analytics), under contracts that require appropriate
        safeguards. We may also disclose information where required by law.
      </p>

      <h2>6. International transfers</h2>
      <p>
        We may use service providers located in other countries, which can involve
        transferring data internationally. Where we do, we use recognized safeguards such as
        Standard Contractual Clauses.
      </p>

      <h2>7. Data retention</h2>
      <p>
        We keep personal information only as long as necessary for the purposes above, then
        delete or anonymize it. Enquiry records are typically retained for up to 24 months.
      </p>

      <h2>8. Your rights</h2>
      <p>
        Depending on your location, you may have the right to access, correct, delete, or
        port your data, and to object to or restrict certain processing. To exercise any of
        these, email{" "}
        <a href="mailto:privacy@gooverseas.com">privacy@gooverseas.com</a>. You may
        also lodge a complaint with the Office of the Privacy Commissioner of Canada, or with
        your local data-protection authority.
      </p>

      <h2>9. Security</h2>
      <p>
        We use appropriate technical and organizational measures to protect your
        information. No method of transmission is perfectly secure, but we work to keep your
        data safe.
      </p>

      <h2>10. Changes to this policy</h2>
      <p>
        We may update this policy from time to time. Material changes will be reflected by
        the “Last updated” date above.
      </p>

      <h2>11. Contact</h2>
      <p>
        Questions about this policy? Write to{" "}
        <a href="mailto:privacy@gooverseas.com">privacy@gooverseas.com</a>.
      </p>
    </LegalPage>
  );
}
