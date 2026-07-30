/* =========================================================
   Gathering — per-page controllers
   Dispatches on <body data-page="...">
   ========================================================= */

(function () {
  const D = window.GATHERING;
  const F = () => window.G.fmt;
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  /* ================= shared partials ================= */

  function renderNow(host) {
    if (!host) return;
    const live = window.G.liveService();
    const a = live || window.G.nextService();
    const svc = a.service;
    host.innerHTML = `
      <div>
        <p class="now__label">${live ? 'Serving right now' : 'Up next'}</p>
        <p class="now__title">${svc.glyph} ${svc.name}</p>
        <p class="now__meta">
          ${F().rel(a.dateISO)} · ${F().range(svc)} · ${svc.pace}
          ${a.phase === 'live' ? ' · doors open' : ''}
        </p>
      </div>
      <div class="row" style="gap:1rem">
        <div class="now__count">
          <b class="num">${a.seatsLeftTotal}</b>
          <span class="muted tiny">of ${a.capacity}<br>seats left</span>
        </div>
        ${
          a.phase === 'live'
            ? `<a class="btn btn--sm" href="buffets.html#${svc.id}">Walk up &amp; sit</a>`
            : a.seatsLeftForTier > 0 && a.windowOpen
            ? `<button class="btn btn--sm" data-book="${a.dateISO}|${svc.id}">Book a seat</button>`
            : `<button class="btn btn--wait btn--sm" data-wait="${a.dateISO}|${svc.id}">Join the list</button>`
        }
      </div>`;
  }

  function tierCard(t, opts) {
    const o = opts || {};
    const current = window.G.state.tier === t.id;
    return `
      <article class="card tier reveal ${t.featured ? 'tier--feature' : ''}">
        ${t.featured ? '<span class="tier__flag">Most booked</span>' : ''}
        <div>
          <h3 class="d3">${t.name}</h3>
          <div class="tier__price" style="margin-top:.5rem">${t.priceLabel}<small>${t.price ? '/ month' : 'always'}</small></div>
          <p class="tiny ${t.featured ? '' : 'muted'}" style="margin-top:.5rem">${t.note}</p>
        </div>
        <ul class="perks">
          ${t.perks.map((p) => `<li>${window.UI.ICONS.check}<span>${p}</span></li>`).join('')}
        </ul>
        <div class="spacer"></div>
        ${
          current
            ? `<span class="btn ${t.featured ? 'btn--light' : 'btn--ghost'} btn--block btn--sm" aria-disabled="true">Your current tier</span>`
            : `<button class="btn ${t.featured ? 'btn--light' : t.id === 'guest' ? 'btn--ghost' : 'btn--gold'} btn--block btn--sm" data-pick-tier="${t.id}">${
                t.id === 'guest' ? 'Continue as guest' : t.cta
              }</button>`
        }
        ${o.footnote ? `<p class="tiny center ${t.featured ? '' : 'muted'}">${o.footnote}</p>` : ''}
      </article>`;
  }

  function renderFaq(host, list) {
    if (!host) return;
    host.innerHTML = (list || D.faqs)
      .map(
        (f) => `<details class="faq reveal"><summary>${f.q}</summary><p>${f.a}</p></details>`
      )
      .join('');
  }

  function holdTable(host) {
    if (!host) return;
    host.innerHTML = D.services
      .map((s) => {
        const held = Math.floor(s.capacity * s.memberHold);
        return `<tr><td>${s.name.replace('The ', '')}</td><td class="num">${s.capacity}</td><td class="num">${held} <span class="muted tiny">(${Math.round(
          s.memberHold * 100
        )}%)</span></td><td class="num">${s.capacity - held}</td></tr>`;
      })
      .join('');
  }

  /* ================= tier switching (global) ================= */
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-pick-tier]');
    if (!b) return;
    const t = window.G.setTier(b.dataset.pickTier);
    window.UI.toast(
      t.id === 'guest'
        ? 'Switched to guest. Booking window is now 48 hours.'
        : `Welcome to ${t.name} — you now book ${t.window} days ahead.`,
      t.id === 'guest' ? 'clay' : 'gold'
    );
    rerender();
  });

  /* ================= HOME ================= */
  function home() {
    const today = F().iso(F().startOfToday());

    renderNow($('[data-now]'));

    const list = $('[data-today-list]');
    if (list) {
      list.innerHTML = D.services
        .map((s) => window.Booking.serviceCard(window.G.availability(today, s.id), { compact: true }))
        .join('');
    }

    const tiers = $('[data-tiers]');
    if (tiers) tiers.innerHTML = D.tiers.map((t) => tierCard(t)).join('');

    const strip = $('[data-basket-strip]');
    if (strip) {
      strip.innerHTML = D.baskets
        .map(
          (b) => `
        <article class="card card--hover reveal">
          <div class="prod__head">
            <h3 class="d4">${b.glyph} ${b.name}</h3>
            <span class="prod__price">${F().money(b.price)}</span>
          </div>
          <p class="prod__serves">${b.serves}</p>
          <p class="prod__incl">${b.includes}</p>
          <a class="link" style="margin-top:1rem" href="baskets.html#build">Dress it for an occasion &rarr;</a>
        </article>`
        )
        .join('');
    }

    const dp = $('[data-daypart-strip]');
    if (dp) {
      dp.innerHTML = D.dayparts
        .map(
          (d) => `
        <div class="swatch reveal">
          <div class="swatch__glyph">${d.glyph}</div>
          <div class="swatch__name">${d.name}</div>
          <div class="swatch__note">${d.window}</div>
          <div class="swatch__note" style="margin-top:.3rem;color:var(--gold-text)">${d.note}</div>
        </div>`
        )
        .join('');
    }

    const heroSeats = $('[data-hero-seats]');
    if (heroSeats) {
      const open = D.services.reduce(
        (n, s) => n + window.G.availability(today, s.id).seatsLeftTotal,
        0
      );
      heroSeats.textContent = `(${open} open)`;
    }

    window.UI.reveal();
  }

  /* ================= BUFFETS ================= */
  let selectedDate = null;

  function buffets() {
    const rail = $('[data-dates]');
    const params = new URLSearchParams(location.search);
    const days = window.G.dateRail(14);
    selectedDate = selectedDate || params.get('date') || days[0].iso;
    if (!days.some((d) => d.iso === selectedDate)) selectedDate = days[0].iso;

    if (rail) {
      rail.innerHTML = days
        .map((d) => {
          const openSeats = D.services.reduce(
            (n, s) => n + window.G.availability(d.iso, s.id).seatsLeftForTier,
            0
          );
          const locked = d.ahead > window.G.tierOf(window.G.state.tier).window;
          return `
          <button class="date-btn" type="button" data-date="${d.iso}" aria-pressed="${d.iso === selectedDate}">
            <div class="date-btn__dow">${d.ahead === 0 ? 'Today' : d.dow}</div>
            <div class="date-btn__d num">${d.day}</div>
            <div class="date-btn__m">${d.mon}</div>
            <div class="date-btn__flag">${locked ? 'locked' : openSeats === 0 ? 'full' : openSeats + ' open'}</div>
          </button>`;
        })
        .join('');
      $$('[data-date]', rail).forEach((b) =>
        b.addEventListener('click', () => {
          selectedDate = b.dataset.date;
          history.replaceState(null, '', `?date=${selectedDate}`);
          buffets();
        })
      );
    }

    const tier = window.G.tierOf(window.G.state.tier);
    const wn = $('[data-window-note]');
    if (wn)
      wn.innerHTML = `Booking as <b>${tier.name}</b> — ${tier.window} day window. <a href="membership.html" style="color:var(--gold-text)">Change tier</a>`;

    const title = $('[data-day-title]');
    if (title) title.textContent = F().rel(selectedDate);
    const theme = $('[data-day-theme]');
    if (theme)
      theme.textContent = `Dinner tonight is ${D.dinnerThemes[F().fromISO(selectedDate).getDay()]}`;

    const avails = D.services.map((s) => window.G.availability(selectedDate, s.id));
    /* Seats you could actually take right now — a seat behind a closed
       booking window is not open to you, however many are left in the room. */
    const bookable = avails.reduce((n, a) => n + (a.windowOpen && a.phase !== 'past' ? a.seatsLeftForTier : 0), 0);
    const dayLocked = avails.every((a) => !a.windowOpen);
    const heldTotal = avails.reduce((n, a) => n + (a.tier.holdAccess ? 0 : a.holdSeats), 0);
    const roomTotal = avails.reduce((n, a) => n + a.seatsLeftTotal, 0);

    const dayOpen = $('[data-day-open]');
    if (dayOpen)
      dayOpen.textContent = dayLocked
        ? `Your window opens ${F().rel(avails[0].opensOn)}`
        : `${bookable} seat${bookable === 1 ? '' : 's'} open to you`;

    const dayTier = $('[data-day-tier]');
    if (dayTier)
      dayTier.textContent = dayLocked
        ? `${roomTotal} seats still unsold`
        : heldTotal
        ? `${heldTotal} more held for members`
        : 'Full room visible to you';

    const list = $('[data-service-list]');
    if (list) list.innerHTML = avails.map((a) => window.Booking.serviceCard(a)).join('');

    holdTable($('[data-hold-table]'));
    renderFaq($('[data-faq]'));
    heatTable($('[data-heat-table]'), days);

    window.UI.reveal();

    if (location.hash) {
      const target = document.getElementById(location.hash.slice(1));
      if (target) target.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  }

  function heatTable(host, days) {
    if (!host) return;
    const glyph = (a) => {
      if (a.phase === 'past') return { g: '·', t: 'closed', c: 'var(--ink-soft)' };
      if (!a.windowOpen) return { g: '○', t: 'outside your booking window', c: 'var(--ink-soft)' };
      if (a.seatsLeftTotal === 0) return { g: '✕', t: `full · ${a.waitCount} waiting`, c: 'var(--stop)' };
      if (a.pct >= 88) return { g: '◕', t: `last seats · ${a.seatsLeftForTier} for you`, c: 'var(--stop)' };
      if (a.pct >= 65) return { g: '◐', t: `filling · ${a.seatsLeftForTier} for you`, c: 'var(--warn)' };
      return { g: '●', t: `open · ${a.seatsLeftForTier} for you`, c: 'var(--ok)' };
    };
    host.innerHTML = `
      <thead><tr><th>Date</th>${D.services
        .map((s) => `<th>${s.glyph}<br>${s.name.replace('The ', '')}</th>`)
        .join('')}</tr></thead>
      <tbody>
        ${days
          .map(
            (d) => `<tr>
          <td><b>${d.ahead === 0 ? 'Today' : d.dow + ' ' + d.day}</b> <span class="muted tiny">${d.mon}</span></td>
          ${D.services
            .map((s) => {
              const a = window.G.availability(d.iso, s.id);
              const g = glyph(a);
              return `<td><button type="button" data-jump="${d.iso}|${s.id}" title="${s.name} — ${g.t}" style="color:${g.c};font-size:1.05rem;line-height:1">${g.g}</button></td>`;
            })
            .join('')}
        </tr>`
          )
          .join('')}
      </tbody>`;
    $$('[data-jump]', host).forEach((b) =>
      b.addEventListener('click', () => {
        const [iso, svc] = b.dataset.jump.split('|');
        selectedDate = iso;
        history.replaceState(null, '', `?date=${iso}#${svc}`);
        buffets();
        const el = document.getElementById(svc);
        if (el) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      })
    );
  }

  /* ================= MEMBERSHIP ================= */
  function membership() {
    const tiers = $('[data-tiers-full]');
    if (tiers)
      tiers.innerHTML = D.tiers
        .map((t) => tierCard(t, { footnote: t.price ? 'Cancel any time, keeps existing bookings' : '' }))
        .join('');

    const hold = $('[data-hold-summary]');
    if (hold)
      hold.innerHTML = D.services
        .map(
          (s) =>
            `<div class="row row--between"><span>${s.name.replace('The ', '')}</span><b class="num" style="color:var(--gold-text)">${Math.floor(
              s.capacity * s.memberHold
            )} of ${s.capacity}</b></div>`
        )
        .join('');

    const cmp = $('[data-compare]');
    if (cmp) {
      const rows = [
        ['Booking window', (t) => `${t.window} days ahead`],
        ['Sees member-held seats', (t) => (t.holdAccess ? '✓' : '—')],
        ['Breakfast seat', (t) => F().money(t.holdAccess ? D.services[0].memberPrice : D.services[0].price)],
        ['Ranch seat', (t) => F().money(t.holdAccess ? D.services[1].memberPrice : D.services[1].price)],
        ['Dinner seat', (t) => F().money(t.holdAccess ? D.services[4].memberPrice : D.services[4].price)],
        ['Waitlist priority', (t) => (t.id === 'premium' ? 'First' : t.id === 'member' ? 'Above guests' : 'Standard')],
        ['Guaranteed seat 24h+ ahead', (t) => (t.id === 'premium' ? '✓' : '—')],
        ['Basket discount', (t) => (t.id === 'premium' ? '18% + free delivery' : t.id === 'member' ? '10%' : '—')],
        ['Free changes until', (t) => (t.id === 'guest' ? '24h before' : '4h before')],
        ['Chef’s table invitations', (t) => (t.id === 'premium' ? '2 per season' : '—')],
      ];
      cmp.innerHTML = `
        <thead><tr><th></th>${D.tiers
          .map(
            (t) =>
              `<th${t.featured ? ' style="color:var(--forest)"' : ''}>${t.name}<br><span class="muted" style="letter-spacing:0;text-transform:none">${t.priceLabel}${
                t.price ? '/mo' : ''
              }</span></th>`
          )
          .join('')}</tr></thead>
        <tbody>${rows
          .map(
            (r) =>
              `<tr><td><b>${r[0]}</b></td>${D.tiers.map((t) => `<td>${r[1](t)}</td>`).join('')}</tr>`
          )
          .join('')}</tbody>`;
    }

    const lw = $('[data-live-wait]');
    if (lw) {
      const today = F().iso(F().startOfToday());
      const tomorrow = F().iso(F().addDays(F().startOfToday(), 1));
      lw.innerHTML = [today, tomorrow]
        .flatMap((iso) =>
          D.services.map((s) => ({ iso, a: window.G.availability(iso, s.id) }))
        )
        .filter((x) => x.a.phase !== 'past')
        .slice(0, 6)
        .map(
          (x) => `<div class="row row--between" style="font-size:.9rem">
            <span>${x.a.service.name.replace('The ', '')} <span style="opacity:.6">${F().rel(x.iso).toLowerCase()}</span></span>
            <b style="color:${x.a.seatsLeftForTier ? 'var(--gold)' : '#e6b0a4'}">${
              x.a.seatsLeftForTier ? x.a.seatsLeftForTier + ' bookable' : 'list of ' + x.a.waitCount
            }</b>
          </div>`
        )
        .join('');
    }

    renderFaq($('[data-faq]'));
    window.UI.reveal();
  }

  /* ================= BASKETS ================= */
  const build = { occasion: 'everyday', daypart: 'midday', dateISO: null, address: '' };

  function baskets() {
    const dateInput = $('[data-delivery-date]');
    if (dateInput && !build.dateISO) {
      build.dateISO = F().iso(F().addDays(F().startOfToday(), 2));
      dateInput.min = F().iso(F().addDays(F().startOfToday(), 1));
      dateInput.value = build.dateISO;
      dateInput.addEventListener('change', () => {
        build.dateISO = dateInput.value;
        paintLead();
      });
    }
    const addr = $('[data-delivery-address]');
    if (addr && !addr.dataset.bound) {
      addr.dataset.bound = '1';
      addr.addEventListener('input', () => (build.address = addr.value));
    }

    const occ = $('[data-occasions]');
    if (occ) {
      occ.innerHTML = D.occasions
        .map(
          (o) =>
            `<button class="filter" type="button" data-occ="${o.id}" aria-pressed="${o.id === build.occasion}">${o.glyph} ${o.name}</button>`
        )
        .join('');
      $$('[data-occ]', occ).forEach((b) =>
        b.addEventListener('click', () => {
          build.occasion = b.dataset.occ;
          baskets();
        })
      );
    }

    const dps = $('[data-dayparts]');
    if (dps) {
      dps.innerHTML = D.dayparts
        .map((d) => {
          const svc = pairedService(d.id);
          return `<button class="swatch" type="button" data-dp="${d.id}" aria-pressed="${d.id === build.daypart}"
            style="${d.id === build.daypart ? 'box-shadow:inset 0 0 0 2px var(--forest)' : ''}">
            <div class="swatch__glyph">${d.glyph}</div>
            <div class="swatch__name">${d.name}</div>
            <div class="swatch__note">${d.window}</div>
            <div class="swatch__note" style="color:var(--gold-text);margin-top:.3rem">built from ${svc}</div>
          </button>`;
        })
        .join('');
      $$('[data-dp]', dps).forEach((b) =>
        b.addEventListener('click', () => {
          build.daypart = b.dataset.dp;
          baskets();
        })
      );
    }

    paintLead();

    const occObj = D.occasions.find((o) => o.id === build.occasion);
    const dpObj = D.dayparts.find((d) => d.id === build.daypart);
    const echo = $('[data-build-echo]');
    if (echo)
      echo.innerHTML = `Packing for <b style="color:var(--forest)">${occObj.name}</b> · ${dpObj.name.toLowerCase()} (${dpObj.window}) · ${occObj.note.toLowerCase()}`;

    const host = $('[data-baskets]');
    if (host) {
      host.innerHTML = D.baskets
        .map((b) => {
          const pairs = b.pairs
            .map((p) => window.G.serviceOf(p).name.replace('The ', '').replace(' Buffet', ''))
            .join(' & ');
          const discount = window.G.state.tier === 'premium' ? 0.18 : window.G.state.tier === 'member' ? 0.1 : 0;
          return `
          <article class="card card--hover reveal">
            <div class="prod__head">
              <h3 class="d4">${b.glyph} ${b.name}</h3>
              <span class="prod__price">${F().money(b.price)}</span>
            </div>
            <p class="prod__serves">${b.serves}</p>
            <p class="prod__incl">${b.includes}</p>
            <p class="tiny" style="margin-top:.8rem;color:var(--moss)">Kitchen source: ${pairs} buffet</p>
            <p class="tiny muted">Dressed as: ${occObj.glyph} ${occObj.name} · ${dpObj.name}</p>
            ${
              discount
                ? `<p class="tiny" style="color:var(--gold-text)">Your price ${F().money(
                    +(b.price * (1 - discount)).toFixed(2)
                  )} after ${Math.round(discount * 100)}% member discount</p>`
                : ''
            }
            <div class="prod__foot">
              <button class="btn btn--sm" data-add-basket="${b.id}">Add to delivery</button>
              <a class="tiny muted" href="#order">view list</a>
            </div>
          </article>`;
        })
        .join('');
      $$('[data-add-basket]', host).forEach((b) =>
        b.addEventListener('click', () => {
          window.G.addToCart({
            kind: 'basket',
            id: b.dataset.addBasket,
            occasion: build.occasion,
            daypart: build.daypart,
            qty: 1,
          });
          const bk = D.baskets.find((x) => x.id === b.dataset.addBasket);
          window.UI.toast(`${bk.name} added — ${occObj.name}, ${dpObj.name.toLowerCase()}.`);
          renderCart();
        })
      );
    }

    const ad = $('[data-addons]');
    if (ad) {
      ad.innerHTML = D.addons
        .map(
          (a) => `
        <button class="swatch" type="button" data-add-addon="${a.id}">
          <div class="swatch__glyph">${a.glyph}</div>
          <div class="swatch__name">${a.name}</div>
          <div class="swatch__note">${F().money(a.price)}</div>
          <div class="swatch__note" style="color:var(--gold-text);margin-top:.25rem">Add +</div>
        </button>`
        )
        .join('');
      $$('[data-add-addon]', ad).forEach((b) =>
        b.addEventListener('click', () => {
          window.G.addToCart({ kind: 'addon', id: b.dataset.addAddon, daypart: build.daypart, qty: 1 });
          window.UI.toast(`${D.addons.find((x) => x.id === b.dataset.addAddon).name} added.`, 'gold');
          renderCart();
        })
      );
    }

    const og = $('[data-occasion-grid]');
    if (og) {
      og.innerHTML = D.occasions
        .map(
          (o) => `
        <button class="swatch reveal" type="button" data-occ-jump="${o.id}">
          <div class="swatch__glyph" style="color:var(--clay)">${o.glyph}</div>
          <div class="swatch__name">${o.name}</div>
          <div class="swatch__note">${o.note}</div>
          <div class="swatch__note" style="margin-top:.3rem;color:var(--gold-text);text-transform:capitalize">${o.season === 'all' ? 'all year' : o.season}</div>
        </button>`
        )
        .join('');
      $$('[data-occ-jump]', og).forEach((b) =>
        b.addEventListener('click', () => {
          build.occasion = b.dataset.occJump;
          baskets();
          $('#build').scrollIntoView({ behavior: 'smooth' });
        })
      );
    }

    renderCart();
    window.UI.reveal();
  }

  function pairedService(daypartId) {
    const map = { morning: 'breakfast', midday: 'ranch', afternoon: 'healthy', evening: 'dinner' };
    return window.G.serviceOf(map[daypartId]).name.replace('The ', '');
  }

  function paintLead() {
    const note = $('[data-lead-note]');
    if (!note) return;
    const ahead = build.dateISO ? F().daysAhead(build.dateISO) : 2;
    const dressed = build.occasion !== 'everyday';
    const need = dressed ? 2 : 1;
    note.innerHTML =
      ahead >= need
        ? `<span style="color:var(--ok)">✓ ${ahead} day${ahead === 1 ? '' : 's'} of lead time — ${
            dressed ? 'enough for occasion dressing' : 'enough for a standard basket'
          }.</span>`
        : `<span style="color:var(--stop)">Needs ${need * 24} hours. ${
            dressed ? 'Occasion dressing takes 48h' : 'Standard baskets take 24h'
          } — pick a later date or call the shop for same-day.</span>`;
  }

  function renderCart() {
    const host = $('[data-cart]');
    if (!host) return;
    const t = window.G.cartTotals();
    if (!t.lines.length) {
      host.innerHTML = `<div class="empty">
        <p class="d4" style="color:var(--forest)">Nothing in the delivery yet</p>
        <p class="muted tiny" style="margin-top:.5rem">Pick an occasion and a drop window above, then add one of the five.</p>
        <a class="btn btn--ghost btn--sm" style="margin-top:1rem" href="#build">Start building</a>
      </div>`;
      return;
    }
    const dpObj = D.dayparts.find((d) => d.id === build.daypart);
    host.innerHTML = `
      <div class="card">
        <div class="grid" style="gap:.8rem">
          ${t.lines
            .map(
              (l) => `
            <div class="row row--between" style="gap:1rem;padding-bottom:.7rem;border-bottom:1px solid var(--gold-line)">
              <div>
                <b style="font-family:var(--font-display);font-size:1.1rem;color:var(--forest)">${l.item.glyph} ${l.item.name}</b>
                <div class="tiny muted">
                  ${l.occasion ? l.occasion.glyph + ' ' + l.occasion.name + ' · ' : ''}${
                (D.dayparts.find((d) => d.id === l.entry.daypart) || dpObj).name
              } · ${F().money(l.unit)} each
                </div>
              </div>
              <div class="row" style="gap:.7rem">
                <span class="qty">
                  <button type="button" data-q="${l.entry.key}|-1" aria-label="One fewer">−</button>
                  <output class="num">${l.entry.qty}</output>
                  <button type="button" data-q="${l.entry.key}|1" aria-label="One more">+</button>
                </span>
                <b class="num" style="min-width:4rem;text-align:right">${F().money(l.total)}</b>
              </div>
            </div>`
            )
            .join('')}
        </div>

        <div class="summary-box" style="margin-top:1.2rem">
          <div class="summary-row"><span>Subtotal (${t.count} item${t.count === 1 ? '' : 's'})</span><span class="num">${F().money(t.subtotal)}</span></div>
          ${t.discount ? `<div class="summary-row"><span>${window.G.tierOf(window.G.state.tier).name} discount (${Math.round(t.rate * 100)}%)</span><span class="num" style="color:var(--ok)">−${F().money(t.discount)}</span></div>` : ''}
          <div class="summary-row"><span>Delivery${t.delivery === 0 ? ' (included)' : ''}</span><span class="num">${t.delivery ? F().money(t.delivery) : 'Free'}</span></div>
          <div class="summary-row"><span>HST</span><span class="num">${F().money(t.tax)}</span></div>
          <div class="summary-row summary-row--total"><span>Total</span><span class="num">${F().money(t.total)}</span></div>
        </div>

        <div class="summary-box" style="margin-top:.8rem;background:var(--sand)">
          <div class="summary-row"><span>Drop date</span><span><b>${build.dateISO ? F().date(build.dateISO) : '—'}</b></span></div>
          <div class="summary-row"><span>Drop window</span><span><b>${dpObj.name} · ${dpObj.window}</b></span></div>
          <div class="summary-row"><span>Address</span><span><b>${build.address || 'Add an address above'}</b></span></div>
        </div>

        ${!t.discount ? `<p class="tiny center" style="margin-top:.9rem"><a href="membership.html" style="color:var(--gold-text)">Members save 10% on this order — the Circle saves 18% and pays no delivery &rarr;</a></p>` : ''}

        <div class="row" style="margin-top:1.2rem;gap:.6rem">
          <button class="btn" data-checkout>Confirm delivery</button>
          <button class="btn btn--ghost btn--sm" data-clear-cart>Clear list</button>
        </div>
      </div>`;

    $$('[data-q]', host).forEach((b) =>
      b.addEventListener('click', () => {
        const [key, delta] = b.dataset.q.split('|');
        const line = window.G.state.cart.find((c) => c.key === key);
        if (line) window.G.setQty(key, line.qty + Number(delta));
        renderCart();
      })
    );
    $('[data-clear-cart]', host).addEventListener('click', () => {
      window.G.clearCart();
      renderCart();
      window.UI.toast('Delivery list cleared.', 'clay');
    });
    $('[data-checkout]', host).addEventListener('click', () => {
      if (!build.address) {
        window.UI.toast('We need a delivery address first.', 'clay');
        $('[data-delivery-address]').focus();
        return;
      }
      const ahead = F().daysAhead(build.dateISO);
      const need = build.occasion !== 'everyday' ? 2 : 1;
      if (ahead < need) {
        window.UI.toast(`That date is inside our ${need * 24}h lead time. Pick a later drop.`, 'clay');
        $('[data-delivery-date]').focus();
        return;
      }
      const res = window.G.placeOrder({
        dateISO: build.dateISO,
        daypart: build.daypart,
        address: build.address,
      });
      if (!res.ok) return window.UI.toast(res.reason, 'clay');
      window.UI.toast(`Delivery confirmed — ${res.order.id}, ${F().rel(res.order.dateISO).toLowerCase()}.`);
      renderCart();
    });
  }

  /* ================= COFFEE HOUSE ================= */
  function coffee() {
    renderNow($('[data-now]'));

    const host = $('[data-counter]');
    if (host) {
      host.innerHTML = D.counter
        .map(
          (g) => `
        <section class="card reveal">
          <h3 class="d3">${g.group}</h3>
          ${g.note ? `<p class="tiny muted" style="margin:.4rem 0 .8rem">${g.note}</p>` : '<div style="height:.6rem"></div>'}
          <div class="menu-list">
            ${g.items
              .map(
                (i) => `<div class="menu-item">
                  <span class="menu-item__name">${i.name}</span>
                  <span class="menu-item__price">${F().money(i.price)}</span>
                  ${i.note ? `<span class="menu-item__note">${i.note}</span>` : ''}
                </div>`
              )
              .join('')}
          </div>
        </section>`
        )
        .join('');
    }

    const today = F().iso(F().startOfToday());
    const pass = $('[data-pass-list]');
    if (pass) {
      pass.innerHTML = D.services
        .map((s) => {
          const a = window.G.availability(today, s.id);
          const state = a.phase === 'live' ? 'live' : a.phase === 'past' ? 'past' : 'future';
          return `
          <article class="svc reveal" data-state="${state}" style="--accent:${s.accent}">
            <div class="svc__when">
              <span class="svc__time">${F().time(s.start)}</span>
              <span class="svc__dur">to ${F().time(s.end)}</span>
            </div>
            <div>
              <div class="row" style="gap:.5rem;margin-bottom:.3rem">${window.UI.statusBadge(a)}</div>
              <h3 class="svc__name" style="font-size:1.35rem">${s.glyph} ${s.name}</h3>
              <p class="muted tiny" style="margin-top:.3rem">At the counter while it runs: ${s.dishes
                .slice(0, 3)
                .join(', ').toLowerCase()}.</p>
            </div>
            <div class="svc__side" style="min-width:10rem">
              ${
                a.phase === 'past'
                  ? '<span class="tiny muted">Pass closed for today</span>'
                  : a.phase === 'live'
                  ? '<span class="badge badge--live"><span class="dot dot--pulse"></span>On the pass now</span>'
                  : `<span class="tiny muted">On the pass from ${F().time(s.start)}</span>`
              }
              <a class="btn btn--ghost btn--sm" href="buffets.html#${s.id}">Book the room instead</a>
            </div>
          </article>`;
        })
        .join('');
    }

    const addr = $('[data-addr]');
    if (addr) addr.textContent = D.brand.address;
    const hours = $('[data-hours]');
    if (hours) hours.textContent = D.brand.walkInHours;
    const tel = $('[data-tel]');
    if (tel) {
      tel.href = 'tel:' + D.brand.phone.replace(/[^\d+]/g, '');
      tel.textContent = D.brand.phone;
    }

    const rhythm = $('[data-rhythm]');
    if (rhythm) {
      rhythm.innerHTML = D.services
        .map((s) => {
          const a = window.G.availability(today, s.id);
          return `<div class="row row--between" style="font-size:.9rem;opacity:${a.phase === 'past' ? '.5' : '1'}">
            <span>${F().time(s.start)} · ${s.name.replace('The ', '')}</span>
            <b style="color:var(--gold-text)">${a.phase === 'past' ? 'done' : a.phase === 'live' ? 'now' : a.seatsLeftTotal + ' seats'}</b>
          </div>`;
        })
        .join('');
    }

    window.UI.reveal();
  }

  /* ================= ACCOUNT ================= */
  function account() {
    const s = window.G.state;
    const tier = window.G.tierOf(s.tier);

    const greet = $('[data-greeting]');
    if (greet) greet.textContent = s.name ? `${s.name.split(' ')[0]}’s table` : 'Your table';

    const badges = $('[data-account-badges]');
    if (badges)
      badges.innerHTML = `
        <span class="badge badge--gold">${tier.name}</span>
        <span class="badge badge--outline" style="color:rgba(251,246,236,.8)">${tier.window}-day booking window</span>
        <span class="badge badge--outline" style="color:rgba(251,246,236,.8)">${s.bookings.length} booking${s.bookings.length === 1 ? '' : 's'}</span>
        <span class="badge badge--outline" style="color:rgba(251,246,236,.8)">${s.waitlist.length} on list</span>`;

    const bk = $('[data-bookings]');
    if (bk) {
      const sorted = s.bookings.slice().sort((a, b) => a.dateISO.localeCompare(b.dateISO));
      bk.innerHTML = sorted.length
        ? sorted
            .map((b) => {
              const svc = window.G.serviceOf(b.serviceId);
              const d = F().fromISO(b.dateISO);
              const past = F().daysAhead(b.dateISO) < 0;
              return `<div class="record" style="${past ? 'opacity:.6' : ''}">
                <div class="record__date"><b>${d.getDate()}</b><span>${d.toLocaleDateString('en-CA', { month: 'short' })}</span></div>
                <div>
                  <b style="font-family:var(--font-display);font-size:1.2rem;color:var(--forest)">${svc.glyph} ${svc.name}</b>
                  <div class="tiny muted">${F().rel(b.dateISO)} · ${F().range(svc)} · ${b.party} guest${b.party === 1 ? '' : 's'} · ${F().money(
                b.priceEach * b.party
              )} due at the table</div>
                  <div class="tiny" style="color:var(--gold-text)">Ref ${b.id}${b.notes ? ' · ' + b.notes : ''}</div>
                </div>
                <button class="btn btn--ghost btn--sm" data-cancel="${b.id}">Release seats</button>
              </div>`;
            })
            .join('')
        : emptyBlock('No seated bookings yet', 'Five services run every day. Pick one.', 'buffets.html', 'See the day');
      $$('[data-cancel]', bk).forEach((b) =>
        b.addEventListener('click', () => {
          window.G.cancelBooking(b.dataset.cancel);
          window.UI.toast('Seats released — they go to the waiting list now.', 'clay');
          account();
        })
      );
    }

    const wl = $('[data-waitlist]');
    if (wl) {
      wl.innerHTML = s.waitlist.length
        ? s.waitlist
            .map((w) => {
              const svc = window.G.serviceOf(w.serviceId);
              const a = window.G.availability(w.dateISO, w.serviceId);
              return `<div class="record">
                <div class="record__date" style="background:var(--blush-soft)"><b>${w.rank}</b><span>rank</span></div>
                <div>
                  <b style="font-family:var(--font-display);font-size:1.2rem;color:var(--forest)">${svc.glyph} ${svc.name}</b>
                  <div class="tiny muted">${F().rel(w.dateISO)} · ${F().range(svc)} · party of ${w.party}</div>
                  <div class="tiny" style="color:var(--clay)">${
                    a.seatsLeftForTier > 0
                      ? `${a.seatsLeftForTier} seats just opened — book now`
                      : `${a.waitCount} parties on this list · released seats offered ${
                          w.tier === 'premium' ? 'to you first' : w.tier === 'member' ? 'above guests' : 'after members'
                        }`
                  }</div>
                </div>
                <div class="row" style="gap:.4rem">
                  ${a.seatsLeftForTier > 0 ? `<button class="btn btn--sm" data-book="${w.dateISO}|${w.serviceId}">Claim</button>` : ''}
                  <button class="btn btn--ghost btn--sm" data-leave="${w.id}">Leave</button>
                </div>
              </div>`;
            })
            .join('')
        : emptyBlock('Not waiting on anything', 'When a service is full, the list is the way in.', 'buffets.html', 'Check the rooms');
      $$('[data-leave]', wl).forEach((b) =>
        b.addEventListener('click', () => {
          window.G.leaveWaitlist(b.dataset.leave);
          window.UI.toast('Left the list.', 'clay');
          account();
        })
      );
    }

    const or = $('[data-orders]');
    if (or) {
      or.innerHTML = s.orders.length
        ? s.orders
            .map((o) => {
              const d = F().fromISO(o.dateISO);
              const dp = D.dayparts.find((x) => x.id === o.daypart);
              return `<div class="record">
                <div class="record__date"><b>${d.getDate()}</b><span>${d.toLocaleDateString('en-CA', { month: 'short' })}</span></div>
                <div>
                  <b style="font-family:var(--font-display);font-size:1.2rem;color:var(--forest)">${o.items.length} item${o.items.length === 1 ? '' : 's'} · ${F().money(o.total)}</b>
                  <div class="tiny muted">${o.items.map((i) => `${i.qty}× ${i.name}`).join(', ')}</div>
                  <div class="tiny" style="color:var(--gold-text)">${dp ? dp.name + ' · ' + dp.window : ''} · ${o.address || 'address pending'} · ${o.id}</div>
                </div>
                <span class="badge badge--live">Scheduled</span>
              </div>`;
            })
            .join('')
        : emptyBlock('No deliveries booked', 'Five baskets, fourteen occasions, four drop windows.', 'baskets.html', 'Build a basket');
    }

    const tc = $('[data-tier-card]');
    if (tc)
      tc.innerHTML = `
        <h3 class="d3" style="margin-top:.3rem">${tier.name}</h3>
        <div class="tier__price" style="font-size:1.9rem;margin:.3rem 0 .6rem">${tier.priceLabel}<small>${tier.price ? '/ month' : 'always'}</small></div>
        <p class="tiny muted">${tier.note}</p>
        ${s.joinedAt ? `<p class="tiny" style="color:var(--gold-text);margin-top:.5rem">Member since ${F().date(s.joinedAt.slice(0, 10), { month: 'long', day: 'numeric', year: 'numeric' })}</p>` : ''}
        <ul class="perks" style="margin-top:1rem">${tier.perks
          .slice(0, 4)
          .map((p) => `<li>${window.UI.ICONS.check}<span>${p}</span></li>`)
          .join('')}</ul>`;

    const ts = $('[data-tier-switch]');
    if (ts)
      ts.innerHTML = D.tiers
        .map((t) =>
          t.id === s.tier
            ? `<span class="btn btn--sm btn--block" style="cursor:default">${window.UI.ICONS.check}Current · ${t.name}</span>`
            : `<button class="btn btn--ghost btn--sm btn--block" data-pick-tier="${t.id}">Switch to ${t.name}</button>`
        )
        .join('');

    const pf = $('[data-profile]');
    if (pf) {
      const nameEl = $('#ac-name', pf);
      const mailEl = $('#ac-email', pf);
      nameEl.value = s.name;
      mailEl.value = s.email;
      if (!pf.dataset.bound) {
        pf.dataset.bound = '1';
        pf.addEventListener('submit', (e) => {
          e.preventDefault();
          window.G.setTier(window.G.state.tier, {
            name: nameEl.value.trim(),
            email: mailEl.value.trim(),
          });
          window.UI.toast('Details saved.');
          account();
        });
      }
    }

    const rs = $('[data-reset]');
    if (rs && !rs.dataset.bound) {
      rs.dataset.bound = '1';
      rs.addEventListener('click', () => {
        window.G.reset();
        window.UI.toast('Demo data cleared.', 'clay');
        account();
      });
    }

    window.UI.reveal();
  }

  function emptyBlock(title, note, href, cta) {
    return `<div class="empty">
      <p class="d4" style="color:var(--forest)">${title}</p>
      <p class="muted tiny" style="margin-top:.4rem">${note}</p>
      <a class="btn btn--ghost btn--sm" style="margin-top:1rem" href="${href}">${cta}</a>
    </div>`;
  }

  /* ================= ABOUT ================= */
  function about() {
    const caps = $('[data-caps]');
    if (caps)
      caps.innerHTML = `
        <thead><tr><th>Service</th><th>Window</th><th>Seats</th><th>Guest</th><th>Member</th></tr></thead>
        <tbody>${D.services
          .map(
            (s) =>
              `<tr><td><b>${s.name.replace('The ', '')}</b></td><td>${F().range(s)}</td><td class="num">${s.capacity}</td><td class="num">${F().money(
                s.price
              )}</td><td class="num" style="color:var(--gold-text)">${F().money(s.memberPrice)}</td></tr>`
          )
          .join('')}</tbody>`;
    const v = $('[data-visit]');
    if (v)
      v.innerHTML = `${D.brand.address} · counter ${D.brand.walkInHours} · <a href="tel:${D.brand.phone.replace(
        /[^\d+]/g,
        ''
      )}" class="link" style="border:0">${D.brand.phone}</a>`;
    renderFaq($('[data-faq]'));
    window.UI.reveal();
  }

  /* ================= dispatch ================= */
  const ROUTES = { index: home, buffets, membership, baskets, 'coffee-house': coffee, account, about };

  function rerender() {
    const fn = ROUTES[document.body.dataset.page];
    if (fn) fn();
    window.UI.paintTier();
  }

  function init() {
    rerender();
    document.addEventListener('gathering:booked', rerender);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
