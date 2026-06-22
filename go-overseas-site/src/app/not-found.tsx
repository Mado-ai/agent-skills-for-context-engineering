import { Container, Button } from "@/components/ui";

export default function NotFound() {
  return (
    <Container className="flex min-h-[60vh] flex-col items-center justify-center py-24 text-center">
      <span className="font-display text-7xl font-semibold text-gradient">404</span>
      <h1 className="mt-6 font-display text-2xl font-semibold">This page went overseas.</h1>
      <p className="mt-3 max-w-sm text-mist">
        We couldn&apos;t find what you were looking for. Let&apos;s get you back on the map.
      </p>
      <div className="mt-8">
        <Button href="/">Back home</Button>
      </div>
    </Container>
  );
}
