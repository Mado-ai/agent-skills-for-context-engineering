/* Go Overseas News — site renderer
   Shared chrome (topbar / masthead / section nav / ticker / footer)
   plus per-page rendering, driven by <body data-page="...">.
   Content lives in data.js. */

(function () {
  "use strict";

  const $ = (sel, root) => (root || document).querySelector(sel);

  const catOf = (story) => GON_CATEGORIES[story.cat];
  const byId = (id) => GON_STORIES.find((s) => s.id === id);

  const shortName = (c) => c.name.replace(/^GO /, "");

  const chip = (catKey) => {
    const c = GON_CATEGORIES[catKey];
    return `<a class="chip" style="--chip-c:${c.color}; --chip-ink:${c.ink || "#FFFFFF"}" href="category.html?cat=${catKey}">
      ${GON_ICONS[c.icon]}<span>${c.name}</span></a>`;
  };

  const kicker = (catKey) => {
    const c = GON_CATEGORIES[catKey];
    return `<a class="kicker-cat" style="--kc-c:${c.color}" href="category.html?cat=${catKey}">${c.name}</a>`;
  };

  const byline = (s, full) =>
    `<div class="byline"><span class="b-author">${full ? "By " : ""}${s.author}</span><span class="b-sep">·</span><span>${s.date}</span><span class="b-sep">·</span><span>${s.read} min read</span></div>`;

  /* ---------- generated cover art ---------- */

  const hash = (str) => [...str].reduce((a, ch) => a + ch.charCodeAt(0), 0);

  /* flowing wave pairs (main wave, front accent wave) — card motif */
  const WAVES = [
    ["M0 118 C 70 70, 130 170, 205 128 S 340 66, 400 118 L400 220 0 220 Z",
     "M0 168 C 80 128, 150 208, 235 168 S 350 128, 400 165 L400 220 0 220 Z"],
    ["M0 96 C 90 150, 170 60, 250 110 S 370 160, 400 100 L400 220 0 220 Z",
     "M0 150 C 100 195, 180 120, 270 160 S 370 200, 400 150 L400 220 0 220 Z"],
    ["M0 130 C 60 92, 150 176, 230 120 S 350 70, 400 128 L400 220 0 220 Z",
     "M0 178 C 70 140, 160 210, 250 168 S 360 132, 400 176 L400 220 0 220 Z"]
  ];

  const DARK_CATS = new Set(["#0A1633", "#10151F"]);

  function coverArt(story, extraClass) {
    const c = catOf(story);
    const h = hash(story.id);
    const [wMain, wFront] = WAVES[h % 3];
    // dark categories pair with blue; blue categories pair with black
    const front = DARK_CATS.has(c.color) ? "#078FDD" : "#10151F";
    const flip = h % 2 ? "transform:scaleX(-1);" : "";
    return `
      <a class="cover-art ${extraClass || ""}" href="article.html?id=${story.id}" style="--ca-c:${c.color}" aria-hidden="true" tabindex="-1">
        <span class="ca-dots"></span>
        <svg class="ca-sweep" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21L21 3M9 3h12v12"/></svg>
        <span class="ca-glyph">${GON_ICONS[c.icon]}</span>
        <svg class="ca-wave" viewBox="0 0 400 220" preserveAspectRatio="none" style="${flip}">
          <path d="${wMain}" fill="${c.color}" opacity="0.94"/>
          <path d="${wFront}" fill="${front}" opacity="0.92"/>
        </svg>
      </a>`;
  }

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

  const socialLinks = () =>
    SOCIALS.map(([label, href, svg]) =>
      `<a href="${href}" target="_blank" rel="noopener" aria-label="${label}">${svg}</a>`).join("");

  function renderChrome() {
    const page = document.body.dataset.page;
    const activeCat = new URLSearchParams(location.search).get("cat");

    // top utility bar
    const topbar = document.createElement("div");
    topbar.className = "topbar";
    const today = new Date().toLocaleDateString("en-US", {
      weekday: "long", month: "long", day: "numeric", year: "numeric"
    });
    topbar.innerHTML = `
      <div class="wrap topbar-inner">
        <div class="edition">
          <span class="ed-date">${today}</span>
          <span class="sep">|</span>
          <span class="ed-name">Global Edition</span>
        </div>
        <div class="topbar-social">
          <span class="follow">Follow us</span>
          ${socialLinks()}
        </div>
      </div>`;

    // masthead (front page only)
    let masthead = null;
    if (page === "home") {
      masthead = document.createElement("header");
      masthead.className = "masthead";
      masthead.innerHTML = `
        <div class="wrap">
          ${LOGO}
          <p class="masthead-tag">Global perspective. What's next.</p>
        </div>`;
    }

    // sticky section nav
    const nav = document.createElement("nav");
    nav.className = "section-nav";
    nav.setAttribute("aria-label", "Sections");
    const catLinks = Object.entries(GON_CATEGORIES).map(([key, c]) => {
      const active = (page === "category" && key === activeCat) ? " class=\"active\"" : "";
      return `<a href="category.html?cat=${key}" style="--nd-c:${c.color}"${active}><span class="nd"></span>${shortName(c)}</a>`;
    }).join("");
    nav.innerHTML = `
      <div class="section-nav-inner">
        <a class="nav-logo" href="index.html" aria-label="Go Overseas News — home">go<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 19L19 5M9 5h10v10"/></svg></a>
        <div class="nav-links">
          <a href="index.html" style="--nd-c:#FFFFFF"${page === "home" ? ' class="active"' : ""}>Home</a>
          ${catLinks}
          <a href="about.html" style="--nd-c:#43CBF5"${page === "about" ? ' class="active"' : ""}><span class="nd"></span>About</a>
        </div>
      </div>`;

    // breaking ticker (doubled for a seamless loop)
    const ticker = document.createElement("div");
    ticker.className = "ticker";
    ticker.setAttribute("aria-label", "Latest headlines");
    const items = GON_STORIES.slice(0, 8).map((s) => {
      const c = catOf(s);
      return `<a href="article.html?id=${s.id}"><span class="t-cat" style="color:${c.color}">${c.name}</span>${s.title}</a>`;
    }).join("");
    ticker.innerHTML = `
      <span class="ticker-label"><span class="dot"></span>GO NOW</span>
      <div class="ticker-track">${items}${items}</div>`;

    const chrome = [topbar, masthead, nav, ticker].filter(Boolean);
    const skip = $(".skip-link");
    chrome.reverse().forEach((el) => skip.after(el));

    // footer
    const footer = document.createElement("footer");
    footer.className = "site-footer";
    const footLinks = Object.entries(GON_CATEGORIES)
      .map(([key, c]) => `<a href="category.html?cat=${key}">${c.name}</a>`);
    footer.innerHTML = `
      <div class="wrap">
        <div class="footer-grid">
          <div>
            ${LOGO}
            <p class="footer-tagline">Your daily source for global news, emerging trends, technology, music, AI, creators and culture. We cover what matters now — and what comes next.</p>
            <div class="socials">${socialLinks()}</div>
          </div>
          <div class="footer-col"><h5>Categories</h5>${footLinks.slice(0, 5).join("")}</div>
          <div class="footer-col"><h5>&nbsp;</h5>${footLinks.slice(5).join("")}</div>
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
    document.body.append(footer);

    // masthead logo hand-off on scroll (front page)
    if (page === "home") {
      const onScroll = () =>
        document.body.classList.toggle("scrolled", window.scrollY > 150);
      window.addEventListener("scroll", onScroll, { passive: true });
      onScroll();
    }
  }

  /* ---------- building blocks ---------- */

  const storyRow = (s) => `
    <article class="story-row">
      ${coverArt(s)}
      <div>
        ${kicker(s.cat)}
        <h4><a href="article.html?id=${s.id}">${s.title}</a></h4>
        <div class="r-date">${s.date}</div>
      </div>
    </article>`;

  const storyCard = (s) => {
    const c = catOf(s);
    return `
      <article class="story-card" style="--card-c:${c.color}">
        ${coverArt(s)}
        <div class="story-body">
          ${chip(s.cat)}
          <h3><a href="article.html?id=${s.id}">${s.title}</a></h3>
          <p>${s.dek}</p>
          ${byline(s)}
        </div>
      </article>`;
  };

  /* ---------- front page ---------- */

  function renderHome() {
    const lead = GON_STORIES.find((s) => s.featured) || GON_STORIES[0];
    const stack = GON_STORIES.filter((s) => s.id !== lead.id).slice(0, 4);
    const used = new Set([lead.id, ...stack.map((s) => s.id)]);

    // lead story
    $("#front-lead").innerHTML = `
      ${coverArt(lead)}
      ${kicker(lead.cat)}
      <h1><a href="article.html?id=${lead.id}">${lead.title}</a></h1>
      <p class="dek">${lead.dek}</p>
      ${byline(lead, true)}`;

    // secondary stack
    $("#front-stack").innerHTML = stack.map(storyRow).join("");

    // right rail: trending + briefing + newsletter CTA
    const trending = GON_TRENDING.map(byId).filter(Boolean);
    const brief = GON_STORIES.filter((s) => !used.has(s.id)).slice(0, 5);
    $("#front-rail").innerHTML = `
      <div class="rail-box">
        <div class="rail-head"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"><path d="M13 2L4.5 13.5H11L9.5 22 19 10h-6.5L13 2z"/></svg>Trending now</div>
        <ol class="trend-list">
          ${trending.map((s, i) => `
            <li>
              <span class="trend-num">${String(i + 1).padStart(2, "0")}</span>
              <div>${kicker(s.cat)}<h4><a href="article.html?id=${s.id}">${s.title}</a></h4></div>
            </li>`).join("")}
        </ol>
      </div>
      <div class="rail-box rail-brief">
        <div class="rail-head"><svg viewBox="0 0 24 24" fill="none" stroke="#078FDD" stroke-width="1.7" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/></svg>The briefing</div>
        ${brief.map((s) => `
          <div class="brief-item">
            <h4><a href="article.html?id=${s.id}">${s.title}</a></h4>
            <span class="r-date">${catOf(s).name} · ${s.date}</span>
          </div>`).join("")}
      </div>
      <div class="rail-cta">
        <div class="script">Go beyond the scroll.</div>
        <p>The whole world in one sharp daily email.</p>
        <a class="btn btn-sm" href="#newsletter">Subscribe free</a>
      </div>`;

    // category section fronts
    const marquee = ["go-now", "go-trend", "go-sound", "go-ai", "go-creator", "go-culture"];
    $("#sections-grid").innerHTML = marquee.map((key) => {
      const c = GON_CATEGORIES[key];
      const stories = GON_STORIES.filter((s) => s.cat === key);
      if (!stories.length) return "";
      const [feature, ...rest] = stories;
      return `
        <section class="section-front" style="--sf-c:${c.color}">
          <div class="sf-head">
            <a class="sf-name" href="category.html?cat=${key}">${c.name}</a>
            <span class="sf-tagline">${c.tagline}</span>
            <a class="sf-more" href="category.html?cat=${key}">More →</a>
          </div>
          <div class="sf-feature">
            ${coverArt(feature)}
            <h3><a href="article.html?id=${feature.id}">${feature.title}</a></h3>
            <p>${feature.dek}</p>
            ${byline(feature)}
          </div>
          ${rest.slice(0, 2).map(storyRow).join("")}
        </section>`;
    }).join("");

    // magazine covers strip — white top, wave break, blue face (card motif)
    $("#covers-strip").innerHTML = GON_COVERS.map((cv, i) => {
      const s = byId(cv.story);
      if (!s) return "";
      const c = catOf(s);
      const flip = i % 2 ? "transform:scaleX(-1);" : "";
      return `
        <a class="cover-card" style="--cc-c:${c.color}; background:#FFFFFF" href="article.html?id=${s.id}">
          <svg class="cc-waves" viewBox="0 0 300 200" preserveAspectRatio="none" style="${flip}" aria-hidden="true">
            <path d="M0 52 C 50 12, 115 88, 175 48 S 262 6, 300 46 L300 200 0 200 Z" fill="#10151F"/>
            <path d="M0 64 C 50 22, 115 98, 175 58 S 262 16, 300 56 L300 200 0 200 Z" fill="#2FA9E5"/>
            <path d="M0 100 C 60 64, 130 130, 195 96 S 270 60, 300 92 L300 200 0 200 Z" fill="#0768B8"/>
          </svg>
          <span class="cover-masthead"><span class="logo-go">go</span><span class="logo-overseas">overseas</span></span>
          <span class="cover-spacer"></span>
          <span class="chip" style="--chip-c:#FFFFFF; --chip-ink:${DARK_CATS.has(c.color) ? "#10151F" : c.color}">${c.name}</span>
          <span class="cover-title">${cv.coverTitle}</span>
          <span class="cover-issue">${cv.issue}</span>
        </a>`;
    }).join("");

    // explore all sections
    $("#cat-grid").innerHTML = Object.entries(GON_CATEGORIES).map(([key, c]) => `
      <a class="cat-tile" style="--tile-c:${c.color}" href="category.html?cat=${key}">
        ${GON_ICONS[c.icon]}
        <div class="cat-name">${c.name}</div>
        <div class="cat-tag">${c.tagline}</div>
      </a>`).join("");

    // more headlines (desk sections not shown above)
    const deskCats = ["go-tech", "go-business", "go-play", "go-discover"];
    const headlines = GON_STORIES.filter((s) => deskCats.includes(s.cat));
    $("#headlines-grid").innerHTML = headlines.map((s) => `
      <div class="headline-item">
        ${kicker(s.cat)}
        <h4><a href="article.html?id=${s.id}">${s.title}</a></h4>
        <span class="r-date">${s.date}</span>
      </div>`).join("");
  }

  /* ---------- category page ---------- */

  function renderCategory() {
    const key = new URLSearchParams(location.search).get("cat");
    const c = GON_CATEGORIES[key];
    if (!c) {
      $("#cat-title").innerHTML = "Section not found";
      $("#cat-stories").innerHTML =
        `<p class="empty-note">That section doesn't exist — head back to the <a href="index.html" style="color:var(--cyan)">front page</a>.</p>`;
      return;
    }
    document.title = `${c.name} — Go Overseas News`;
    const stories = GON_STORIES.filter((s) => s.cat === key);
    $("#cat-kicker").textContent = "Section";
    $("#cat-kicker").style.color = c.color;
    $("#cat-title").innerHTML = `${c.name.replace("GO ", "GO&nbsp;")} <em>— ${c.tagline.replace(/\.$/, "")}</em>`;
    $("#cat-count").textContent = `${stories.length} ${stories.length === 1 ? "story" : "stories"} · updated daily`;
    $("#cat-stories").innerHTML = stories.length
      ? stories.map(storyCard).join("")
      : `<p class="empty-note">Fresh ${c.name} stories are on the way. Check back soon.</p>`;
  }

  /* ---------- article page ---------- */

  function renderArticle() {
    const id = new URLSearchParams(location.search).get("id");
    const s = byId(id) || GON_STORIES[0];
    const c = catOf(s);
    document.title = `${s.title} — Go Overseas News`;

    const pageUrl = encodeURIComponent(location.href);
    const shareText = encodeURIComponent(`${s.title} — Go Overseas News`);

    $("#article-head").innerHTML = `
      ${chip(s.cat)}
      <h1>${s.title}</h1>
      <p class="dek">${s.dek}</p>
      <div class="byline-row">
        <span class="byline-avatar" aria-hidden="true">go</span>
        ${byline(s, true)}
        <div class="share-row">
          <a href="https://x.com/intent/tweet?text=${shareText}&url=${pageUrl}" target="_blank" rel="noopener" aria-label="Share on X"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 4l16 16M20 4L4 20"/></svg></a>
          <a href="https://www.facebook.com/sharer/sharer.php?u=${pageUrl}" target="_blank" rel="noopener" aria-label="Share on Facebook"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M14 8h3V4.5h-3c-2.2 0-4 1.8-4 4V11H7v3.5h3V21h3.5v-6.5h3L17 11h-3.5V8.8c0-.5.2-.8.5-.8z"/></svg></a>
          <a href="https://wa.me/?text=${shareText}%20${pageUrl}" target="_blank" rel="noopener" aria-label="Share on WhatsApp"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3a9 9 0 00-7.8 13.5L3 21l4.7-1.2A9 9 0 1012 3z"/><path d="M9 8.5c0 4 2.5 6.5 6.5 6.5l1-2-2.2-1.1-1 1c-1.2-.5-1.9-1.2-2.4-2.4l1-1L10.8 7l-1.8 1.5z"/></svg></a>
          <button type="button" id="copy-link" aria-label="Copy link"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M10 14a4.5 4.5 0 006.4 0l3-3a4.5 4.5 0 00-6.4-6.4l-1.5 1.5"/><path d="M14 10a4.5 4.5 0 00-6.4 0l-3 3a4.5 4.5 0 006.4 6.4l1.5-1.5"/></svg></button>
        </div>
      </div>`;

    const banner = $("#article-banner");
    banner.outerHTML = coverArt(s, "article-banner").replace('tabindex="-1"', "");

    $("#article-body").innerHTML =
      s.body.map((p) => `<p>${p}</p>`).join("") +
      `<div class="tag-row">${s.tags.map((t) => `<span class="tag">${t}</span>`).join("")}</div>`;

    $("#article-cat-link").innerHTML =
      `More from <a href="category.html?cat=${s.cat}" style="color:${c.color};font-weight:700">${c.name}</a>`;

    const related = GON_STORIES.filter((x) => x.id !== s.id)
      .sort((a, b) => (b.cat === s.cat) - (a.cat === s.cat))
      .slice(0, 3);
    $("#related-grid").innerHTML = related.map(storyCard).join("");

    // copy-link feedback
    $("#copy-link").addEventListener("click", async (e) => {
      try {
        await navigator.clipboard.writeText(location.href);
        e.currentTarget.style.borderColor = "var(--blue)";
        e.currentTarget.style.color = "var(--blue)";
      } catch { /* clipboard unavailable — ignore */ }
    });

    // reading progress bar
    const bar = document.createElement("div");
    bar.className = "progress-bar";
    document.body.append(bar);
    const onScroll = () => {
      const max = document.documentElement.scrollHeight - window.innerHeight;
      bar.style.width = max > 0 ? `${(window.scrollY / max) * 100}%` : "0";
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
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
