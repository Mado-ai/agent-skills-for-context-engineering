import type { Metadata } from "next";
import { Container, Section, Eyebrow, Card } from "@/components/ui";
import { BrandBackdrop } from "@/components/BrandGraphics";
import { Counter } from "@/components/Counter";
import { CtaBanner } from "@/components/CtaBanner";
import { stats } from "@/lib/site";

export const metadata: Metadata = {
  title: "About — A Creative Management Agency",
  description:
    "go overseas is a creative management agency built on three principles: strategy, creativity, and growth — brand, web & apps, ads, PR, and automation under one roof.",
  alternates: { canonical: "/about" },
};

const values = [
  {
    title: "Strategy",
    color: "text-blue",
    bar: "bg-blue",
    body: "We start with evidence, not guesswork. Every brand, campaign, and build traces back to your goals and your audience.",
  },
  {
    title: "Creativity",
    color: "text-purple",
    bar: "bg-purple",
    body: "Attention is earned. We bring the design and creative firepower to make your brand impossible to ignore.",
  },
  {
    title: "Growth",
    color: "text-green",
    bar: "bg-green",
    body: "We measure ourselves on outcomes — leads, sales, and systems that keep working long after launch.",
  },
];

const team = [
  {
    name: "Yazan Alshibi",
    role: "Head of Growth & Brand Development",
    initials: "YA",
  },
  {
    name: "Wafeeq Alshibi",
    role: "Organization Quality Manager",
    initials: "WA",
  },
  {
    name: "Yousef Alhelo",
    role: "Operations Manager",
    initials: "YA",
  },
];

export default function AboutPage() {
  return (
    <>
      <section className="relative overflow-hidden border-b border-line">
        <BrandBackdrop />
        <Container className="relative py-20 sm:py-28">
          <Eyebrow>About</Eyebrow>
          <h1 className="mt-6 max-w-3xl font-display text-4xl font-semibold leading-tight tracking-tight sm:text-5xl">
            We build brands and the systems that grow them.
          </h1>
          <p className="mt-6 max-w-2xl text-lg text-mist">
            go overseas was founded on a simple frustration: too many businesses juggle a
            different vendor for design, web, ads, and operations — with no one owning the
            whole picture. We built one team that handles strategy, creative, and execution
            together, so the brand, the marketing, and the systems behind it actually pull
            in the same direction.
          </p>
        </Container>
      </section>

      <Section>
        <Eyebrow>What we believe</Eyebrow>
        <div className="mt-8 grid gap-6 md:grid-cols-3">
          {values.map((v) => (
            <Card key={v.title}>
              <span className={`mb-5 block h-1 w-10 rounded-full ${v.bar}`} />
              <h3 className={`font-display text-xl font-semibold ${v.color}`}>{v.title}</h3>
              <p className="mt-3 text-sm leading-relaxed text-mist">{v.body}</p>
            </Card>
          ))}
        </div>
      </Section>

      <section className="border-y border-line bg-ink-900">
        <Container className="grid grid-cols-2 gap-px py-4 md:grid-cols-4">
          {stats.map((s, i) => (
            <div key={s.label} className="px-2 py-10 text-center">
              <div
                className={`font-display text-4xl font-semibold ${
                  ["text-blue", "text-green", "text-purple", "text-pink"][i % 4]
                }`}
              >
                <Counter value={s.value} />
              </div>
              <div className="mt-2 text-sm text-mist-dim">{s.label}</div>
            </div>
          ))}
        </Container>
      </section>

      <Section>
        <div className="max-w-2xl">
          <Eyebrow>Leadership</Eyebrow>
          <h2 className="mt-5 font-display text-3xl font-semibold tracking-tight sm:text-4xl">
            Operators, not just advisors.
          </h2>
          <p className="mt-5 text-mist">
            From our base in the Greater Toronto Area, our leadership team has built
            brands, shipped websites and apps, and run campaigns across industries —
            working directly with founders to turn ideas into results.
          </p>
        </div>
        <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {team.map((t) => (
            <Card key={t.name} className="flex flex-col items-start">
              <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-blue to-green font-display text-lg font-semibold text-white">
                {t.initials}
              </span>
              <p className="mt-5 font-display text-lg font-semibold">{t.name}</p>
              <p className="mt-1 text-sm text-mist-dim">{t.role}</p>
            </Card>
          ))}
        </div>
      </Section>

      <CtaBanner
        title="Let's build something worth remembering."
        body="Tell us what you're working on. We'll bring the strategy, creativity, and growth to make it real."
      />
    </>
  );
}
