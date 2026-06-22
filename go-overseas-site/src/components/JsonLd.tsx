/**
 * Renders a JSON-LD structured-data block.
 * Server component — safe to inline; data is our own, not user input.
 */
export function JsonLd({ data }: { data: object | object[] }) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }}
    />
  );
}
