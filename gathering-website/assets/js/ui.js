/* =========================================================
   Gathering — shared chrome, icons, toasts, reveal
   ========================================================= */

(function () {
  const D = window.GATHERING;

  /* ---------- icons ---------- */
  const ICONS = {
    leaf: '<svg class="leaf" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 21c0-6 3-11 9-13-1 8-4 12-9 13Z"/><path d="M11 21c-4 0-7-3-7-7 0-4 3-6 7-6"/><path d="M11 21V9"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>',
    arrow: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14m-6-6 6 6-6 6"/></svg>',
    close: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>',
    clock: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
    star: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="m12 3 2.6 5.7 6.2.7-4.6 4.2 1.2 6.1L12 16.8 6.6 19.7l1.2-6.1L3.2 9.4l6.2-.7Z"/></svg>',
  };

  /* ---------- chrome ---------- */
  const NAV = [
    { href: 'buffets.html', label: 'The Day' },
    { href: 'membership.html', label: 'Membership' },
    { href: 'baskets.html', label: 'Baskets' },
    { href: 'coffee-house.html', label: 'Coffee House' },
    { href: 'about.html', label: 'About' },
  ];

  function brandMark(cls) {
    return `<a class="brand ${cls || ''}" href="index.html" aria-label="Gathering — home">
      ${ICONS.leaf.replace('class="leaf"', 'class="brand__mark"')}
      <span class="brand__type">
        <span class="brand__name">Gathering</span>
        <span class="brand__tag">Food for every moment</span>
      </span>
    </a>`;
  }

  function renderHeader() {
    const host = document.querySelector('[data-chrome="header"]');
    if (!host) return;
    const page = document.body.dataset.page;
    const next = window.G.nextService();
    const live = window.G.liveService();

    const strip = live
      ? `<span class="badge badge--live"><span class="dot dot--pulse"></span>Serving now</span>
         <span><b>${live.service.name}</b> until ${window.G.fmt.time(live.service.end)}</span>
         <span class="sep">·</span><span>${live.seatsLeftTotal} seat${live.seatsLeftTotal === 1 ? '' : 's'} left in the room</span>`
      : `<span class="badge badge--gold">Up next</span>
         <span><b>${next.service.name}</b> ${window.G.fmt.rel(next.dateISO).toLowerCase()} at ${window.G.fmt.time(next.service.start)}</span>
         <span class="sep">·</span><span>${next.seatsLeftTotal} of ${next.capacity} seats open</span>`;

    host.innerHTML = `
      <div class="strip"><div class="wrap"><div class="strip__inner">${strip}</div></div></div>
      <header class="site-head">
        <div class="wrap">
          <div class="site-head__bar">
            ${brandMark()}
            <nav class="nav" id="nav" aria-label="Primary">
              ${NAV.map(
                (n) =>
                  `<a href="${n.href}"${page && n.href.startsWith(page) ? ' aria-current="page"' : ''}>${n.label}</a>`
              ).join('')}
            </nav>
            <button class="nav-toggle" type="button" aria-expanded="false" aria-controls="nav" aria-label="Menu">
              <span></span><span></span><span></span>
            </button>
            <div class="head-actions">
              <a class="tier-chip" href="account.html" data-tier-chip>
                <span class="tier-chip__dot"></span><span data-tier-name>Guest</span>
              </a>
              <a class="btn btn--sm" href="buffets.html">Book a seat</a>
            </div>
          </div>
        </div>
      </header>`;

    const toggle = host.querySelector('.nav-toggle');
    const nav = host.querySelector('#nav');
    toggle.addEventListener('click', () => {
      const open = toggle.getAttribute('aria-expanded') === 'true';
      toggle.setAttribute('aria-expanded', String(!open));
      nav.dataset.open = String(!open);
    });
    nav.addEventListener('click', (e) => {
      if (e.target.tagName === 'A') {
        toggle.setAttribute('aria-expanded', 'false');
        nav.dataset.open = 'false';
      }
    });
    paintTier();
  }

  function paintTier() {
    const tier = window.G.tierOf(window.G.state.tier);
    document.querySelectorAll('[data-tier-chip]').forEach((el) => {
      el.dataset.tier = tier.id;
      const name = el.querySelector('[data-tier-name]');
      if (name) name.textContent = tier.id === 'guest' ? 'Guest' : tier.name.replace('Gathering ', '');
    });
  }

  function renderFooter() {
    const host = document.querySelector('[data-chrome="footer"]');
    if (!host) return;
    host.innerHTML = `
      <footer class="site-foot">
        <div class="wrap">
          <div class="foot-grid">
            <div class="foot-brand">
              ${brandMark()}
              <p class="tiny" style="margin-top:1rem;max-width:26ch">${D.brand.tagline} Five buffets a day, baskets for every occasion, and a coffee house that never asks you to book.</p>
            </div>
            <div>
              <h4>The Day</h4>
              <ul>
                ${D.services
                  .map(
                    (s) =>
                      `<li><a href="buffets.html#${s.id}">${s.name}<span class="muted"> · ${window.G.fmt.time(s.start)}</span></a></li>`
                  )
                  .join('')}
              </ul>
            </div>
            <div>
              <h4>Order & Join</h4>
              <ul>
                <li><a href="baskets.html">Baskets &amp; sharing boxes</a></li>
                <li><a href="baskets.html#occasions">Occasion collection</a></li>
                <li><a href="membership.html">Membership</a></li>
                <li><a href="coffee-house.html">Walk-in counter</a></li>
                <li><a href="account.html">My bookings</a></li>
              </ul>
            </div>
            <div>
              <h4>Visit</h4>
              <ul>
                <li>${D.brand.address}</li>
                <li><a href="tel:+16475550142">${D.brand.phone}</a></li>
                <li><a href="mailto:${D.brand.email}">${D.brand.email}</a></li>
                <li>Counter open ${D.brand.walkInHours}</li>
              </ul>
            </div>
          </div>
          <div class="foot-bottom">
            <span>© ${new Date().getFullYear()} Gathering — ${D.brand.domain}</span>
            <span>Seated services are ticketed. Every room has a hard seat count, and we keep it.</span>
          </div>
        </div>
      </footer>`;
  }

  /* ---------- toasts ---------- */
  let toastHost;
  function toast(msg, kind) {
    if (!toastHost) {
      toastHost = document.createElement('div');
      toastHost.className = 'toasts';
      toastHost.setAttribute('role', 'status');
      toastHost.setAttribute('aria-live', 'polite');
      document.body.appendChild(toastHost);
    }
    const el = document.createElement('div');
    el.className = 'toast' + (kind ? ` toast--${kind}` : '');
    el.innerHTML = `${ICONS.check}<span>${msg}</span>`;
    toastHost.appendChild(el);
    setTimeout(() => {
      el.style.transition = 'opacity .3s ease, transform .3s ease';
      el.style.opacity = '0';
      el.style.transform = 'translateY(8px)';
      setTimeout(() => el.remove(), 320);
    }, 3600);
  }

  /* ---------- reveal on scroll ---------- */
  function reveal() {
    const els = document.querySelectorAll('.reveal:not(.in)');
    if (!('IntersectionObserver' in window)) {
      els.forEach((e) => e.classList.add('in'));
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((en) => {
          if (en.isIntersecting) {
            en.target.classList.add('in');
            io.unobserve(en.target);
          }
        });
      },
      { rootMargin: '0px 0px -8% 0px', threshold: 0.08 }
    );
    els.forEach((e, i) => {
      e.style.transitionDelay = `${Math.min(i % 6, 5) * 70}ms`;
      io.observe(e);
    });
  }

  /* ---------- status vocabulary shared by all seat UI ---------- */
  function statusBadge(a) {
    if (a.phase === 'live') {
      return a.seatsLeftTotal > 0
        ? `<span class="badge badge--live"><span class="dot dot--pulse"></span>Serving now · ${a.seatsLeftTotal} left</span>`
        : '<span class="badge badge--live"><span class="dot dot--pulse"></span>Serving now · full room</span>';
    }
    switch (a.status) {
      case 'past':
        return '<span class="badge badge--outline">Closed for today</span>';
      case 'full':
        return `<span class="badge badge--stop">Full · ${a.waitCount} waiting</span>`;
      case 'member-only':
        return `<span class="badge badge--gold">${ICONS.star.replace('<svg', '<svg width="10" height="10"')}Member seats only</span>`;
      case 'last-seats':
        return `<span class="badge badge--warn">Last ${a.seatsLeftForTier} seat${a.seatsLeftForTier === 1 ? '' : 's'}</span>`;
      case 'locked':
        return `<span class="badge badge--outline">Opens ${window.G.fmt.rel(a.opensOn)}</span>`;
      default:
        return `<span class="badge badge--live">${a.seatsLeftForTier} seats open</span>`;
    }
  }

  function heat(pct) {
    return pct >= 88 ? 'hot' : pct >= 65 ? 'warm' : 'cool';
  }

  /* ---------- boot ---------- */
  function boot() {
    renderHeader();
    renderFooter();
    reveal();
    document.addEventListener('gathering:change', paintTier);
  }

  window.UI = { ICONS, toast, reveal, statusBadge, heat, paintTier, renderHeader };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
