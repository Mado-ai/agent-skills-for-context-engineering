import type { Metadata } from "next";
import { LegalPage } from "@/components/LegalPage";

export const metadata: Metadata = {
  title: "Terms & Conditions",
  description:
    "The terms governing your use of the go overseas website and services.",
  alternates: { canonical: "/terms" },
};

export default function TermsPage() {
  return (
    <LegalPage
      title="Terms & Conditions"
      updated="June 22, 2026"
      intro="These terms govern your use of the go overseas website and the engagement of our services. By using this site or working with us, you agree to them."
    >
      <h2>1. Agreement</h2>
      <p>
        These Terms &amp; Conditions (“Terms”) form a binding agreement between you and go
        overseas (“we”, “us”). If you do not agree, please do not use our website or
        services.
      </p>

      <h2>2. Our services</h2>
      <p>
        We provide creative management and growth services, including brand identity and
        design, website and app development, paid advertising, public relations, automation,
        and analytics. The specific scope, deliverables, fees, and
        timelines for any engagement are set out in a separate written proposal or
        statement of work (“SOW”), which prevails over these Terms in the event of a
        conflict.
      </p>

      <h2>3. Use of the website</h2>
      <ul>
        <li>You may use the site for lawful, informational purposes only.</li>
        <li>
          You may not attempt to disrupt the site, gain unauthorized access, or scrape it at
          scale.
        </li>
        <li>
          Content on this site is provided for general information and does not constitute
          legal, financial, or tax advice.
        </li>
      </ul>

      <h2>4. Intellectual property</h2>
      <p>
        All content, branding, logos, and materials on this site are owned by go overseas or
        our licensors and are protected by intellectual-property laws. You may not reproduce
        or reuse them without written permission. Ownership of deliverables produced during
        a paid engagement is addressed in the applicable SOW.
      </p>

      <h2>5. Fees and payment</h2>
      <p>
        Fees, payment schedules, and currencies are defined in each SOW. Unless stated
        otherwise, invoices are due within 14 days. Late amounts may accrue reasonable
        interest. Refunds are governed by our Money-Back Policy.
      </p>

      <h2>6. Client responsibilities</h2>
      <p>
        Successful engagements depend on your timely cooperation — providing accurate
        information, access to relevant stakeholders, and decisions within agreed
        timeframes. Delays caused by these may affect timelines and outcomes.
      </p>

      <h2>7. Confidentiality</h2>
      <p>
        Each party agrees to protect the other&apos;s confidential information and use it
        only for the purposes of the engagement. This obligation survives termination.
      </p>

      <h2>8. Disclaimers</h2>
      <p>
        We bring experience, diligence, and best efforts to every engagement, but we cannot
        guarantee specific commercial outcomes — market success depends on many factors
        outside our control. The website and its content are provided “as is” without
        warranties of any kind.
      </p>

      <h2>9. Limitation of liability</h2>
      <p>
        To the maximum extent permitted by law, our total liability arising from an
        engagement is limited to the fees paid for that engagement. We are not liable for
        indirect, incidental, or consequential losses, including lost profits or revenue.
      </p>

      <h2>10. Termination</h2>
      <p>
        Either party may terminate an engagement as described in the relevant SOW. On
        termination, you remain responsible for fees for work performed up to the
        termination date, subject to our Money-Back Policy.
      </p>

      <h2>11. Governing law</h2>
      <p>
        These Terms are governed by the laws of the Province of Ontario and the federal laws
        of Canada applicable therein, unless a different jurisdiction is stated in your SOW.
        Disputes will be resolved in the courts of that jurisdiction.
      </p>

      <h2>12. Changes</h2>
      <p>
        We may update these Terms from time to time. The version in effect is the one
        published here, dated above.
      </p>

      <h2>13. Contact</h2>
      <p>
        Questions about these Terms? Write to{" "}
        <a href="mailto:hello@gooverseas.com">hello@gooverseas.com</a>.
      </p>
    </LegalPage>
  );
}
