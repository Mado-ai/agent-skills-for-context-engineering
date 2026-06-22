# go overseas — website

Marketing site + Insights blog for **go overseas** — *Strategy. Creativity. Growth.*
A business-development and creative-growth firm helping companies expand into
international markets.

Built with **Next.js 15** (App Router), **TypeScript**, and **Tailwind CSS v4**.

## Getting started

```bash
cd go-overseas-site
npm install
npm run dev      # http://localhost:3000
```

## Scripts

| Command         | Description                       |
| --------------- | --------------------------------- |
| `npm run dev`   | Start the dev server              |
| `npm run build` | Production build                  |
| `npm run start` | Serve the production build        |
| `npm run lint`  | Lint with Next.js ESLint config   |

## Project structure

```
src/
  app/                 App Router pages
    page.tsx           Home
    services/          Services
    work/              Case studies
    about/             About
    insights/          Blog index + [slug] post pages
    contact/           Contact form
    globals.css        Brand tokens (Tailwind v4 @theme) + prose styles
  components/          Header, Footer, Logo, UI primitives, ContactForm
  content/posts/       Blog posts as markdown (frontmatter + body)
  lib/
    site.ts            Services, stats, process, sectors data
    posts.ts           Markdown loader (gray-matter + remark)
```

## Adding a blog post

Create a new markdown file in `src/content/posts/`:

```markdown
---
title: "Your title"
excerpt: "One-sentence summary for cards and SEO."
date: "2026-06-01"
author: "go overseas"
category: "Strategy"
---

Your content in **markdown**. Tables, lists, and blockquotes are supported.
```

The post is picked up automatically — sorted by date, with reading time computed.

## Brand

Defined as CSS custom properties in `src/app/globals.css` under `@theme`:

- **Ink** (near-black backgrounds) · **Blue → Cyan → Green** gradient accents
- Display font: **Space Grotesk** · Body font: **Inter**
- The gradient text helper is `.text-gradient`; the logo lives in `components/Logo.tsx`.

## Deploying

This is a standard Next.js app — deploy to **Vercel**, **Netlify**, or any Node host.
For Vercel: import the repo, set the root directory to `go-overseas-site`, and deploy.
