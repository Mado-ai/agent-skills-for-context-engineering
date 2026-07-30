/* =========================================================
   Gathering — service cards + booking dialog
   Used by index.html (today only) and buffets.html (any date).
   ========================================================= */

(function () {
  const D = window.GATHERING;

  /* ---------------- service card ---------------- */
  function serviceCard(a, opts) {
    const svc = a.service;
    const o = opts || {};
    const pct = a.pct;
    const dinnerTheme =
      svc.id === 'dinner' ? D.dinnerThemes[window.G.fmt.fromISO(a.dateISO).getDay()] : null;

    const state = a.phase === 'live' ? 'live' : a.phase === 'past' ? 'past' : 'future';

    return `
    <article class="svc reveal" id="${svc.id}" data-state="${state}" style="--accent:${svc.accent}">
      <div class="svc__when">
        <span class="svc__time">${window.G.fmt.time(svc.start)}</span>
        <span class="svc__dur">${svc.pace}</span>
        <span class="svc__dur">ends ${window.G.fmt.time(svc.end)}</span>
      </div>

      <div class="svc__main">
        <div class="row" style="gap:.5rem;margin-bottom:.35rem">
          ${window.UI.statusBadge(a)}
          ${dinnerTheme ? `<span class="badge badge--blush">${dinnerTheme}</span>` : ''}
          ${a.booked ? `<span class="badge badge--forest">You booked ${a.booked}</span>` : ''}
        </div>
        <h3 class="svc__name">${svc.glyph} ${svc.name}</h3>
        <p class="svc__tag">${svc.tagline}</p>
        <p class="muted" style="font-size:.92rem">${svc.blurb}</p>
        <div class="svc__dishes">${svc.dishes.map((d) => `<span class="chip">${d}</span>`).join('')}</div>
      </div>

      <div class="svc__side">
        <div class="seats">
          <div class="seats__top">
            <span class="muted">Seats taken</span>
            <span class="seats__n">${a.taken}<span class="muted" style="font-size:.8rem">/${a.capacity}</span></span>
          </div>
          <div class="meter"><span class="meter__fill" data-heat="${window.UI.heat(pct)}" style="width:${pct}%"></span></div>
          <p class="seats__note">${seatNote(a)}</p>
        </div>
        <div class="row" style="gap:.4rem;justify-content:space-between;align-items:baseline">
          <span class="muted tiny">${a.tier.holdAccess ? 'Member price' : 'Guest price'}</span>
          <span class="prod__price" style="font-size:1.2rem">${window.G.fmt.money(a.priceEach)}<span class="muted" style="font-size:.72rem"> / seat</span></span>
        </div>
        ${actionFor(a, o)}
      </div>
    </article>`;
  }

  function seatNote(a) {
    if (a.phase === 'past') return 'Doors closed. The counter is still open for walk-ins.';
    if (a.phase === 'live') return 'Doors are open now — walk up and we will seat what is left.';
    if (!a.windowOpen)
      return `Your window opens <b>${window.G.fmt.rel(a.opensOn)}</b>. Circle books 14 days out.`;
    if (a.status === 'full') return `Room is full. <b>${a.waitCount} on the waiting list.</b>`;
    if (a.status === 'member-only')
      return `<b>${a.seatsLeftTotal} seats</b> remain, all inside the member hold until 24h before doors.`;
    if (a.holdActive)
      return `${a.holdSeats} of ${a.capacity} seats held for members until 24h before doors.`;
    return `Member hold released — the full room is open to everyone.`;
  }

  function actionFor(a, o) {
    const key = `${a.dateISO}|${a.service.id}`;
    if (a.phase === 'past')
      return `<a class="btn btn--ghost btn--block btn--sm" href="buffets.html?date=${window.G.fmt.iso(
        window.G.fmt.addDays(window.G.fmt.startOfToday(), 1)
      )}#${a.service.id}">Book tomorrow</a>`;

    if (a.onWaitlist)
      return `<span class="btn btn--ghost btn--block btn--sm" aria-disabled="true">On the waiting list</span>
              <a class="tiny muted" style="text-align:center" href="account.html">Manage in your account</a>`;

    if (a.status === 'full' || a.status === 'member-only') {
      const join = `<button class="btn btn--wait btn--block btn--sm" data-wait="${key}">Join the waiting list</button>`;
      const up =
        a.status === 'member-only'
          ? `<a class="tiny" style="text-align:center;color:var(--gold-text)" href="membership.html">Unlock ${a.seatsLeftTotal} held seats — become a member ${window.UI.ICONS.arrow}</a>`
          : '';
      return join + up;
    }

    if (!a.windowOpen)
      return `<a class="btn btn--gold btn--block btn--sm" href="membership.html">Book ${a.tier.window === 14 ? 'sooner' : 'earlier'} — upgrade</a>
              <button class="btn btn--ghost btn--block btn--sm" data-wait="${key}">Notify me when it opens</button>`;

    const label = a.phase === 'live' ? 'Take a seat now' : o.compact ? 'Book' : 'Book this service';
    return `<button class="btn btn--block btn--sm" data-book="${key}">${label}</button>`;
  }

  /* ---------------- dialog ---------------- */
  let dlg;
  function ensureDialog() {
    if (dlg) return dlg;
    dlg = document.createElement('dialog');
    dlg.className = 'modal';
    dlg.innerHTML = '<div class="modal__panel" data-panel></div>';
    document.body.appendChild(dlg);
    dlg.addEventListener('click', (e) => {
      if (e.target === dlg) dlg.close();
    });
    return dlg;
  }

  function openBooking(dateISO, serviceId, mode) {
    const a = window.G.availability(dateISO, serviceId);
    const d = ensureDialog();
    const panel = d.querySelector('[data-panel]');
    const wait = mode === 'wait';
    const maxParty = wait ? 8 : Math.min(8, Math.max(1, a.seatsLeftForTier));

    panel.innerHTML = `
      <button class="modal__close" type="button" data-close aria-label="Close">${window.UI.ICONS.close}</button>
      <p class="eyebrow">${wait ? 'Waiting list' : 'Reserve seats'}</p>
      <h3 class="d3">${a.service.name}</h3>
      <p class="script" style="margin:.2rem 0 1rem">${window.G.fmt.rel(dateISO)} · ${window.G.fmt.range(a.service)}</p>

      <div class="summary-box" style="margin-bottom:1.1rem">
        <div class="summary-row"><span>Room capacity</span><span class="num">${a.capacity} seats</span></div>
        <div class="summary-row"><span>Currently taken</span><span class="num">${a.taken} seats</span></div>
        <div class="summary-row"><span>Open to ${a.tier.name}</span><span class="num">${a.seatsLeftForTier} seats</span></div>
        ${a.holdActive ? `<div class="summary-row"><span>Held for members</span><span class="num">${a.holdSeats} seats</span></div>` : ''}
        ${wait ? `<div class="summary-row"><span>Ahead of you</span><span class="num">${a.waitCount} ${a.tier.id === 'guest' ? 'parties' : 'parties (you rank above guests)'}</span></div>` : ''}
      </div>

      <form data-form class="stack" novalidate>
        <div class="grid g2" style="gap:.9rem">
          <div class="field">
            <label for="bk-party">Party size</label>
            <select class="input" id="bk-party" name="party">
              ${Array.from({ length: maxParty }, (_, i) => i + 1)
                .map((n) => `<option value="${n}"${n === 2 ? ' selected' : ''}>${n} ${n === 1 ? 'guest' : 'guests'}</option>`)
                .join('')}
            </select>
          </div>
          <div class="field">
            <label for="bk-name">Name on the booking</label>
            <input class="input" id="bk-name" name="name" autocomplete="name" required value="${escapeAttr(window.G.state.name)}" placeholder="Sam Rivera">
          </div>
        </div>
        <div class="field">
          <label for="bk-email">Email for the confirmation</label>
          <input class="input" id="bk-email" name="email" type="email" autocomplete="email" required value="${escapeAttr(window.G.state.email)}" placeholder="you@example.com">
        </div>
        ${wait ? '' : `
        <div class="field">
          <label for="bk-notes">Anything we should know</label>
          <textarea class="input" id="bk-notes" name="notes" rows="2" placeholder="Allergies, high chair, celebrating something"></textarea>
        </div>`}

        ${wait ? '' : `
        <div class="summary-box">
          <div class="summary-row"><span>Seat price (${a.tier.name})</span><span class="num">${window.G.fmt.money(a.priceEach)}</span></div>
          <div class="summary-row"><span>Party</span><span class="num" data-party-echo>2</span></div>
          <div class="summary-row summary-row--total"><span>Due at the table</span><span class="num" data-total-echo>${window.G.fmt.money(a.priceEach * 2)}</span></div>
        </div>`}

        <p data-error class="tiny hide" style="color:var(--stop)"></p>

        <button class="btn btn--block" type="submit">${wait ? 'Join the waiting list' : 'Confirm booking'}</button>
        ${a.tier.id === 'guest'
          ? `<p class="tiny center muted">Booking as a guest. <a href="membership.html" style="color:var(--gold-text)">Members book 7 days ahead</a> and see every seat.</p>`
          : `<p class="tiny center muted">Free changes up to 4 hours before service.</p>`}
      </form>`;

    const form = panel.querySelector('[data-form]');
    const err = panel.querySelector('[data-error]');
    const party = form.querySelector('[name="party"]');

    if (!wait) {
      const echoParty = panel.querySelector('[data-party-echo]');
      const echoTotal = panel.querySelector('[data-total-echo]');
      const sync = () => {
        const n = Number(party.value);
        echoParty.textContent = `${n} × ${window.G.fmt.money(a.priceEach)}`;
        echoTotal.textContent = window.G.fmt.money(a.priceEach * n);
      };
      party.addEventListener('change', sync);
      sync();
    }

    panel.querySelector('[data-close]').addEventListener('click', () => d.close());

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      const details = {
        name: (fd.get('name') || '').toString().trim(),
        email: (fd.get('email') || '').toString().trim(),
        notes: (fd.get('notes') || '').toString().trim(),
      };
      if (!details.name || !details.email.includes('@')) {
        err.textContent = 'We need a name and a working email to hold the seats.';
        err.classList.remove('hide');
        return;
      }
      const n = Number(fd.get('party'));
      const res = wait
        ? window.G.joinWaitlist(dateISO, serviceId, n, details)
        : window.G.book(dateISO, serviceId, n, details);

      if (!res.ok) {
        err.innerHTML =
          res.reason +
          (res.waitlist ? ` <button type="button" class="link" style="border:0;padding:0" data-switch-wait>Join the waiting list instead</button>` : '');
        err.classList.remove('hide');
        const sw = err.querySelector('[data-switch-wait]');
        if (sw) sw.addEventListener('click', () => openBooking(dateISO, serviceId, 'wait'));
        return;
      }

      d.close();
      if (wait) {
        window.UI.toast(
          `You are on the list for ${a.service.name}, ${window.G.fmt.rel(dateISO).toLowerCase()}. Rank ${res.waitlist.rank}.`,
          'clay'
        );
      } else {
        window.UI.toast(
          `Booked — ${n} seat${n === 1 ? '' : 's'} at ${a.service.name}, ${window.G.fmt.rel(dateISO).toLowerCase()}. Ref ${res.booking.id}.`
        );
      }
      document.dispatchEvent(new CustomEvent('gathering:booked'));
    });

    d.showModal();
    setTimeout(() => form.querySelector('[name="name"]').focus(), 60);
  }

  function escapeAttr(s) {
    return String(s || '').replace(/"/g, '&quot;');
  }

  /* ---------------- delegated triggers ---------------- */
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-book]');
    if (b) {
      const [date, svc] = b.dataset.book.split('|');
      openBooking(date, svc, 'book');
      return;
    }
    const w = e.target.closest('[data-wait]');
    if (w) {
      const [date, svc] = w.dataset.wait.split('|');
      openBooking(date, svc, 'wait');
    }
  });

  window.Booking = { serviceCard, openBooking };
})();
