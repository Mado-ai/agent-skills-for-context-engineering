/* Go Overseas News — site renderer
   Shared chrome (header / category strip / footer) plus per-page
   rendering, driven by <body data-page="...">. Content lives in data.js. */

(function () {
  "use strict";

  const $ = (sel, root) => (root || document).querySelector(sel);

  const icon = (name, cls) =>
    `<span class="${cls || "icon"}" aria-hidden="true">${GON_ICONS[name] || ""}</span>`;

  const catOf = (story) => GON_CATEGORIES[story.cat];

  const chip = (catKey) => {
    const c = GON_CATEGORIES[catKey];
    return `<a class="chip" style="--chip-c:${c.color}" href="category.html?cat=${catKey}">
      ${GON_ICONS[c.icon]}<span>${c.name}</span></a>`;
  };

  const storyMeta = (s) =>
    `<div class="meta"><span>${s.author}</span><span>${s.date}</span><span>${s.read} min read</span></div>`;

  /* ---------- shared chrome ---------- */

  const LOGO = `
    <a class="logo" href="index.html" aria-label="Go Overseas News — home">
      <span class="logo-row">
        <span class="logo-go">go<svg class="go-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 19L19 5M9 5h10v10"/></svg></span>
        <span class="logo-overseas">overseas</span>
      </span>
      <span class="logo-news">NEWS</span>
    </a>`;

  const SOCIALS = [
    ["Instagram", "https://instagram.com/gooverseas.news", '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.2" cy="6.8" r="1" fill="currentColor" stroke="none"/></svg>'],
    ["TikTok", "https://tiktok.com/@gooverseas.news", '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M16.6 3c.4 2.1 1.8 3.6 3.9 3.9v3c-1.5 0-2.9-.5-3.9-1.3v5.9a5.8 5.8 0 11-5.8-5.8c.3 0 .7 0 1 .1v3.1a2.8 2.8 0 101.9 2.6V3h2.9z"/></svg>'],
    ["YouTube", "https://youtube.com/@gooverseas.news", '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="2.5" y="5.5" width="19" height="13" rx="4"/><path d="M10 9.5l5 2.5-5 2.5v-5z" fill="currentColor" stroke="none"/></svg>'],
    ["X", "https://x.com/gooverseasnews", '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 4l16 16M20 4L4 20"/></svg>'],
    ["Facebook", "https://facebook.com/gooverseas.news", '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M14 8h3V4.5h-3c-2.2 0-4 1.8-4 4V11H7v3.5h3V21h3.5v-6.5h3L17 11h-3.5V8.8c0-.5.2-.8.5-.8z"/></svg>']
  ];

  function renderChrome() {
    const page = document.body.dataset.page;

    const header = document.createElement("header");
    header.className = "site-header";
    header.innerHTML = `
      <div class="wrap header-inner">
        ${LOGO}
        <button class="nav-toggle" aria-label="Toggle menu" aria-expanded="false">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 7h16M4 12h16M4 17h16"/></svg>
        </button>
        <nav class="main-nav" aria-label="Main">
          <a href="index.html" ${page === "home" ? 'class="active"' : ""}>Home</a>
          <a href="index.html#categories">Categories</a>
          <a href="about.html" ${page === "about" ? 'class="active"' : ""}>About</a>
          <a href="about.html#contact">Contact</a>
        </nav>
      </div>`;

    const strip = document.createElement("nav");
    strip.className = "cat-strip";
    strip.setAttribute("aria-label", "News categories");
    const activeCat = new URLSearchParams(location.search).get("cat");
    strip.innerHTML = `<div class="cat-strip-inner">${Object.entries(GON_CATEGORIES)
      .map(([key, c]) =>
        `<a class="cat-pill${page === "category" && key === activeCat ? " active" : ""}" style="--pill-c:${c.color}" href="category.html?cat=${key}">${GON_ICONS[c.icon]}${c.name}</a>`)
      .join("")}</div>`;

    const footer = document.createElement("footer");
    footer.className = "site-footer";
    const catLinks = Object.entries(GON_CATEGORIES)
      .map(([key, c]) => `<a href="category.html?cat=${key}">${c.name}</a>`);
    footer.innerHTML = `
      <div class="wrap">
        <div class="footer-grid">
          <div>
            ${LOGO}
            <p class="footer-tagline">Your daily source for global news, emerging trends, technology, music, AI, creators and culture. We cover what matters now — and what comes next.</p>
            <div class="socials">
              ${SOCIALS.map(([label, href, svg]) =>
                `<a href="${href}" target="_blank" rel="noopener" aria-label="${label}">${svg}</a>`).join("")}
            </div>
          </div>
          <div class="footer-col"><h5>Categories</h5>${catLinks.slice(0, 5).join("")}</div>
          <div class="footer-col"><h5>&nbsp;</h5>${catLinks.slice(5).join("")}</div>
          <div class="footer-col">
            <h5>Company</h5>
            <a href="about.html">About us</a>
            <a href="about.html#promise">Our promise</a>
            <a href="about.html#contact">Contact &amp; press</a>
            <a href="mailto:hello@gooverseas.news">hello@gooverseas.news</a>
          </div>
        </div>
        <div class="footer-bottom">
          <span>© 2026 Go Overseas News. All rights reserved.</span>
          <span class="fb-tag">Global perspective. What's next.</span>
          <span>@gooverseas.news</span>
        </div>
      </div>`;

    document.body.prepend(strip);
    document.body.prepend(header);
    document.body.append(footer);

    const toggle = $(".nav-toggle", header);
    const nav = $(".main-nav", header);
    toggle.addEventListener("click", () => {
      const open = nav.classList.toggle("open");
      toggle.setAttribute("aria-expanded", String(open));
    });
  }

  /* ---------- card builders ---------- */

  const storyCard = (s) => {
    const c = catOf(s);
    return `
      <article class="story-card" style="--card-c:${c.color}">
        <a class="story-visual" href="article.html?id=${s.id}" aria-hidden="true" tabindex="-1">
          <span class="dots"></span>
          <span class="glyph">${GON_ICONS[c.icon]}</span>
        </a>
        <div class="story-body">
          ${chip(s.cat)}
          <h3><a href="article.html?id=${s.id}">${s.title}</a></h3>
          <p>${s.dek}</p>
          ${storyMeta(s)}
        </div>
      </article>`;
  };

  /* ---------- pages ---------- */

  function renderHome() {
    const featured = GON_STORIES.filter((s) => s.featured);
    const rest = GON_STORIES.filter((s) => !s.featured);

    // ticker (doubled for a seamless loop)
    const items = GON_STORIES.slice(0, 8).map((s) => {
      const c = catOf(s);
      return `<a href="article.html?id=${s.id}"><span class="t-cat" style="color:${c.color}">${c.name}</span>${s.title}</a>`;
    }).join("");
    $("#ticker-track").innerHTML = items + items;

    // hero
    const [main, ...side] = featured;
    const mc = catOf(main);
    $("#hero-main").style.setProperty("--chip-c", mc.color);
    $("#hero-main").innerHTML = `
      <span class="bg-glyph">${GON_ICONS[mc.icon]}</span>
      <p class="hero-kicker">Global perspective. What's next.</p>
      ${chip(main.cat)}
      <h1><a href="article.html?id=${main.id}">${main.title}</a></h1>
      <p class="dek">${main.dek}</p>
      ${storyMeta(main)}`;

    $("#hero-side").innerHTML = side.map((s) => {
      const c = catOf(s);
      return `
        <article class="hero-card" style="--chip-c:${c.color}; border-color: color-mix(in srgb, ${c.color} 28%, transparent)">
          <span class="bg-glyph" style="color:${c.color}">${GON_ICONS[c.icon]}</span>
          ${chip(s.cat)}
          <h3><a href="article.html?id=${s.id}">${s.title}</a></h3>
          <p>${s.dek}</p>
        </article>`;
    }).join("");

    // category tiles
    $("#cat-grid").innerHTML = Object.entries(GON_CATEGORIES).map(([key, c]) => `
      <a class="cat-tile" style="--tile-c:${c.color}" href="category.html?cat=${key}">
        ${GON_ICONS[c.icon]}
        <div class="cat-name">${c.name}</div>
        <div class="cat-tag">${c.tagline}</div>
      </a>`).join("");

    // latest stories
    $("#latest-grid").innerHTML = rest.map(storyCard).join("");
  }

  function renderCategory() {
    const key = new URLSearchParams(location.search).get("cat");
    const c = GON_CATEGORIES[key];
    if (!c) {
      $("#cat-title").innerHTML = "Category not found";
      $("#cat-stories").innerHTML =
        `<p class="empty-note">That section doesn't exist — head back to the <a href="index.html" style="color:var(--cyan)">front page</a>.</p>`;
      return;
    }
    document.title = `${c.name} — Go Overseas News`;
    $("#cat-kicker").textContent = "Category";
    $("#cat-kicker").style.color = c.color;
    $("#cat-title").innerHTML = `${c.name.replace("GO ", "GO&nbsp;")} <em>— ${c.tagline.replace(/\.$/, "")}</em>`;
    const stories = GON_STORIES.filter((s) => s.cat === key);
    $("#cat-stories").innerHTML = stories.length
      ? stories.map(storyCard).join("")
      : `<p class="empty-note">Fresh ${c.name} stories are on the way. Check back soon.</p>`;
  }

  function renderArticle() {
    const id = new URLSearchParams(location.search).get("id");
    const s = GON_STORIES.find((x) => x.id === id) || GON_STORIES[0];
    const c = catOf(s);
    document.title = `${s.title} — Go Overseas News`;

    $("#article-head").innerHTML = `
      ${chip(s.cat)}
      <h1>${s.title}</h1>
      <p class="dek">${s.dek}</p>
      ${storyMeta(s)}`;

    const banner = $("#article-banner");
    banner.style.setProperty("--card-c", c.color);
    banner.innerHTML = `<span class="dots"></span><span class="glyph">${GON_ICONS[c.icon]}</span>`;

    $("#article-body").innerHTML =
      s.body.map((p) => `<p>${p}</p>`).join("") +
      `<div class="tag-row">${s.tags.map((t) => `<span class="tag">${t}</span>`).join("")}</div>`;

    $("#article-cat-link").innerHTML =
      `More from <a href="category.html?cat=${s.cat}" style="color:${c.color};font-weight:700">${c.name}</a>`;

    const related = GON_STORIES.filter((x) => x.id !== s.id)
      .sort((a, b) => (b.cat === s.cat) - (a.cat === s.cat))
      .slice(0, 3);
    $("#related-grid").innerHTML = related.map(storyCard).join("");
  }

  /* ---------- newsletter ---------- */

  function bindNewsletter() {
    const form = $("#newsletter-form");
    if (!form) return;
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const note = $("#form-note");
      note.textContent = "You're in! Watch your inbox — the next edition lands soon.";
      note.classList.add("success");
      form.reset();
    });
  }

  /* ---------- boot ---------- */

  document.addEventListener("DOMContentLoaded", () => {
    renderChrome();
    const page = document.body.dataset.page;
    if (page === "home") renderHome();
    if (page === "category") renderCategory();
    if (page === "article") renderArticle();
    bindNewsletter();
  });
})();
