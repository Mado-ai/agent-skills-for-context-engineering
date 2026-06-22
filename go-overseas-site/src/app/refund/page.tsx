import type { Metadata } from "next";
import { LegalPage } from "@/components/LegalPage";

export const metadata: Metadata = {
  title: "Money-Back Policy",
  description:
    "Our satisfaction guarantee and refund policy for go overseas engagements.",
  alternates: { canonical: "/refund" },
};

export default function RefundPage() {
  return (
    <LegalPage
      title="Money-Back Policy"
      updated="June 22, 2026"
      intro="We measure ourselves on traction, not slide decks — so we stand behind our work. This policy explains our satisfaction guarantee and how refunds work."
    >
      <h2>1. Our commitment</h2>
      <p>
        We want you to feel confident engaging go overseas. If our work doesn&apos;t meet
        the standard we promised, we&apos;ll make it right — first by fixing it, and where
        appropriate, with a refund.
      </p>

      <h2>2. 14-day satisfaction guarantee</h2>
      <p>
        For new engagements, if you are not satisfied with the quality or direction of our
        work within the <strong>first 14 days</strong>, let us know. We will either revise
        the work at no extra cost or refund fees paid for that initial period, less any
        pre-approved third-party costs (e.g. licensing, media spend, partner fees) already
        committed on your behalf.
      </p>

      <h2>3. Milestone-based refunds</h2>
      <p>
        Many engagements are structured around milestones defined in your statement of work
        (“SOW”). If a milestone deliverable is not provided as agreed and cannot be remedied
        within a reasonable cure period, the fees allocated to that milestone are
        refundable.
      </p>

      <h2>4. What is covered</h2>
      <ul>
        <li>Professional fees for services we have not yet delivered.</li>
        <li>Fees for delivered work that materially fails to meet the agreed scope.</li>
      </ul>

      <h2>5. What is not covered</h2>
      <ul>
        <li>
          Third-party and pass-through costs already incurred (e.g. government/licensing
          fees, advertising spend, partner commissions, travel).
        </li>
        <li>
          Completed work that met the agreed scope, even if commercial outcomes differ from
          expectations — markets carry inherent risk we cannot guarantee against.
        </li>
        <li>
          Delays or shortfalls caused primarily by lack of timely client input, access, or
          decisions.
        </li>
        <li>Custom or success-fee arrangements expressly stated as non-refundable in the SOW.</li>
      </ul>

      <h2>6. How to request a refund</h2>
      <p>
        Email <a href="mailto:billing@gooverseas.com">billing@gooverseas.com</a>{" "}
        with your engagement name and the reason for your request. We aim to acknowledge
        within <strong>2 business days</strong> and resolve within{" "}
        <strong>14 business days</strong>.
      </p>

      <h2>7. How refunds are issued</h2>
      <p>
        Approved refunds are returned via the original payment method where possible. Bank
        or currency-conversion fees charged by third parties are non-refundable.
      </p>

      <h2>8. Relationship to other terms</h2>
      <p>
        This policy works alongside our Terms &amp; Conditions and your SOW. Where a signed
        SOW specifies different refund terms for a particular engagement, those terms
        prevail.
      </p>

      <h2>9. Contact</h2>
      <p>
        Questions about refunds? Write to{" "}
        <a href="mailto:billing@gooverseas.com">billing@gooverseas.com</a>.
      </p>
    </LegalPage>
  );
}
