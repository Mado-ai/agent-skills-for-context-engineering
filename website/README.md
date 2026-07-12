# Go Overseas News — Website

Official website for **Go Overseas News** — *Global perspective. What's next.*

A fully static site built on the official brand system: no build step, no framework, no dependencies. Open `index.html` in a browser and it works.

## Pages

| Page | Purpose |
|---|---|
| `index.html` | Front page — breaking ticker, featured stories, the 10-category system, latest stories, newsletter |
| `category.html?cat=go-ai` | Category feed (works for all ten `go-*` category keys) |
| `article.html?id=<story-id>` | Full article layout with related stories |
| `about.html` | Mission, values ("Our promise"), founder & contact |

## Structure

```
website/
├── index.html
├── category.html
├── article.html
├── about.html
├── css/style.css      # brand design system (colors, type, components)
└── js/
    ├── data.js        # categories + stories (edit this to publish content)
    └── main.js        # shared header/footer chrome + page rendering
```

## Publishing content

All content lives in `js/data.js`:

- **Add a story**: append an object to `GON_STORIES` with `id`, `cat` (one of the ten category keys), `title`, `dek`, `author`, `date`, `read`, `tags`, and `body` (array of paragraphs). Set `featured: true` on exactly three stories to control the front-page hero.
- **Current stories are launch placeholders** — replace them with real editorial before going live.

## Brand system

- **Colors**: `#7A3FD0` purple · `#078FDD` blue · `#0A1633` navy · `#64E572` green · `#F04BB8` pink · `#43CBF5` cyan · `#FFFFFF` white
- **Typography**: Manrope ExtraBold (display) · Cormorant Garamond SemiBold (serif accents) · Inter (body) · Caveat (logo script), loaded from Google Fonts
- **Categories**: GO NOW · GO TREND · GO SOUND · GO AI · GO CREATOR · GO TECH · GO BUSINESS · GO CULTURE · GO PLAY · GO DISCOVER

## Deploying

Any static host works:

- **GitHub Pages**: point Pages at this folder (or copy its contents to a `gh-pages` branch / `docs/` folder of a dedicated repo)
- **Netlify / Vercel / Cloudflare Pages**: drag-and-drop the `website/` folder or set it as the publish directory
- Local preview: `python3 -m http.server 8000` from this folder, then open `http://localhost:8000`
