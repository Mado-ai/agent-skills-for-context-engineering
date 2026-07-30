/* =========================================================
   Gathering — state, seat availability, bookings, cart
   Persisted to localStorage. No backend required for the demo,
   but every rule here mirrors the real booking policy.
   ========================================================= */

(function () {
  const KEY = 'gathering.state.v1';
  const D = window.GATHERING;

  /* ---------- date helpers ---------- */
  const pad = (n) => String(n).padStart(2, '0');
  const toISO = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const fromISO = (s) => {
    const [y, m, d] = s.split('-').map(Number);
    return new Date(y, m - 1, d);
  };
  const addDays = (d, n) => {
    const x = new Date(d);
    x.setDate(x.getDate() + n);
    return x;
  };
  const startOfToday = () => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  };
  const daysAhead = (iso) => Math.round((fromISO(iso) - startOfToday()) / 86400000);
  const minutesOf = (hhmm) => {
    const [h, m] = hhmm.split(':').map(Number);
    return h * 60 + m;
  };
  const fmtTime = (hhmm) => {
    const [h, m] = hhmm.split(':').map(Number);
    const suffix = h >= 12 ? 'pm' : 'am';
    const hour = h % 12 === 0 ? 12 : h % 12;
    return m === 0 ? `${hour}${suffix}` : `${hour}:${pad(m)}${suffix}`;
  };
  const fmtRange = (svc) => `${fmtTime(svc.start)} – ${fmtTime(svc.end)}`;
  const fmtDate = (iso, opts) =>
    fromISO(iso).toLocaleDateString('en-CA', opts || { weekday: 'long', month: 'long', day: 'numeric' });
  const relDay = (iso) => {
    const n = daysAhead(iso);
    if (n === 0) return 'Today';
    if (n === 1) return 'Tomorrow';
    if (n === -1) return 'Yesterday';
    return fmtDate(iso, { weekday: 'long', month: 'short', day: 'numeric' });
  };
  const money = (n) =>
    n % 1 === 0 ? `$${n.toFixed(0)}` : `$${n.toFixed(2)}`;

  /* ---------- deterministic demand simulation ----------
     Real deployments read this from the reservations table.
     Here we derive a stable, plausible fill per (date, service)
     so scarcity looks the same on every reload.                */
  function hash(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return (h >>> 0);
  }
  const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

  function simulatedTaken(iso, svc) {
    const ahead = daysAhead(iso);
    const curve =
      ahead <= 0 ? 0.84 :
      ahead === 1 ? 0.74 :
      ahead === 2 ? 0.63 :
      ahead <= 4 ? 0.5 :
      ahead <= 7 ? 0.35 :
      ahead <= 10 ? 0.23 : 0.13;
    /* Weekend and dinner services run hotter — the pattern any room manager knows. */
    const dow = fromISO(iso).getDay();
    const weekend = dow === 5 || dow === 6 ? 0.09 : dow === 0 ? 0.04 : 0;
    const prime = svc.id === 'dinner' ? 0.07 : svc.id === 'ranch' ? 0.03 : 0;
    const jitter = ((hash(iso + '|' + svc.id) % 1000) / 1000) * 0.32 - 0.16;
    return Math.round(svc.capacity * clamp(curve + weekend + prime + jitter, 0.04, 1));
  }

  /* ---------- state ---------- */
  const blank = () => ({
    tier: 'guest',
    name: '',
    email: '',
    bookings: [],   // { id, dateISO, serviceId, party, tier, priceEach, createdAt }
    waitlist: [],   // { id, dateISO, serviceId, party, tier, createdAt }
    cart: [],       // { key, kind:'basket'|'addon', id, qty, occasion, daypart, dateISO }
    orders: [],     // { id, items, total, dateISO, daypart, createdAt }
    joinedAt: null,
  });

  let state = load();

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return blank();
      return Object.assign(blank(), JSON.parse(raw));
    } catch (e) {
      return blank();
    }
  }
  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch (e) { /* private mode — session only */ }
    document.dispatchEvent(new CustomEvent('gathering:change', { detail: state }));
  }

  const tierOf = (id) => D.tiers.find((t) => t.id === id) || D.tiers[0];
  const serviceOf = (id) => D.services.find((s) => s.id === id);

  /* ---------- availability engine ---------- */
  function seatsMine(iso, serviceId) {
    return state.bookings
      .filter((b) => b.dateISO === iso && b.serviceId === serviceId)
      .reduce((n, b) => n + b.party, 0);
  }

  /**
   * Everything a UI needs to know about one service on one date.
   */
  function availability(iso, serviceId, tierId) {
    const svc = serviceOf(serviceId);
    const tier = tierOf(tierId || state.tier);
    const ahead = daysAhead(iso);
    const taken = simulatedTaken(iso, svc) + seatsMine(iso, serviceId);
    const capacity = svc.capacity;

    /* The member hold: a slice of the room reserved for members
       until 24 hours before doors. Guests cannot see those seats. */
    const holdActive = ahead >= 1;
    const holdSeats = holdActive ? Math.floor(capacity * svc.memberHold) : 0;
    const publicCap = capacity - holdSeats;

    const seatsLeftTotal = Math.max(0, capacity - taken);
    const seatsLeftForTier = tier.holdAccess
      ? seatsLeftTotal
      : Math.max(0, Math.min(publicCap - taken, seatsLeftTotal));

    /* Time state, for today only */
    const now = new Date();
    const nowMin = now.getHours() * 60 + now.getMinutes();
    let phase = 'future';
    if (ahead === 0) {
      if (nowMin >= minutesOf(svc.end)) phase = 'past';
      else if (nowMin >= minutesOf(svc.start)) phase = 'live';
      else phase = 'today';
    } else if (ahead < 0) phase = 'past';

    /* Booking window by tier */
    const windowOpen = ahead <= tier.window;
    const opensOn = toISO(addDays(fromISO(iso), -tier.window));

    let status;
    if (phase === 'past') status = 'past';
    else if (!windowOpen) status = 'locked';
    else if (seatsLeftTotal === 0) status = 'full';
    else if (seatsLeftForTier === 0) status = 'member-only';
    else if (seatsLeftForTier <= Math.max(2, Math.round(capacity * 0.12))) status = 'last-seats';
    else status = 'open';

    return {
      service: svc,
      dateISO: iso,
      tier,
      ahead,
      phase,
      status,
      capacity,
      taken,
      seatsLeftTotal,
      seatsLeftForTier,
      holdActive,
      holdSeats,
      windowOpen,
      opensOn,
      pct: Math.min(100, Math.round((taken / capacity) * 100)),
      priceEach: tier.holdAccess ? svc.memberPrice : svc.price,
      waitCount: waitlistDepth(iso, serviceId),
      booked: seatsMine(iso, serviceId),
      onWaitlist: state.waitlist.some((w) => w.dateISO === iso && w.serviceId === serviceId),
    };
  }

  /** Waiting-list depth, also simulated so the number feels real. */
  function waitlistDepth(iso, serviceId) {
    const svc = serviceOf(serviceId);
    const a = availabilityRaw(iso, svc);
    if (a.seatsLeftTotal > 0) return (hash(iso + serviceId + 'w') % 4);
    return 3 + (hash(iso + serviceId + 'w') % 14);
  }
  function availabilityRaw(iso, svc) {
    const taken = simulatedTaken(iso, svc) + seatsMine(iso, svc.id);
    return { seatsLeftTotal: Math.max(0, svc.capacity - taken) };
  }

  /** Next service that has not finished yet, today or tomorrow. */
  function nextService() {
    const today = toISO(startOfToday());
    const nowMin = new Date().getHours() * 60 + new Date().getMinutes();
    for (const svc of D.services) {
      if (nowMin < minutesOf(svc.end)) return availability(today, svc.id);
    }
    return availability(toISO(addDays(startOfToday(), 1)), D.services[0].id);
  }

  function liveService() {
    const today = toISO(startOfToday());
    const nowMin = new Date().getHours() * 60 + new Date().getMinutes();
    const svc = D.services.find(
      (s) => nowMin >= minutesOf(s.start) && nowMin < minutesOf(s.end)
    );
    return svc ? availability(today, svc.id) : null;
  }

  function dateRail(days) {
    const out = [];
    for (let i = 0; i < (days || 14); i++) {
      const d = addDays(startOfToday(), i);
      const iso = toISO(d);
      out.push({
        iso,
        dow: d.toLocaleDateString('en-CA', { weekday: 'short' }).slice(0, 3),
        day: d.getDate(),
        mon: d.toLocaleDateString('en-CA', { month: 'short' }),
        ahead: i,
        theme: D.dinnerThemes[d.getDay()],
      });
    }
    return out;
  }

  /* ---------- mutations ---------- */
  const uid = () => Math.random().toString(36).slice(2, 9).toUpperCase();

  function book(iso, serviceId, party, details) {
    const a = availability(iso, serviceId);
    if (a.status === 'past') return { ok: false, reason: 'This service has already finished.' };
    if (!a.windowOpen)
      return {
        ok: false,
        reason: `Your booking window for ${fmtDate(iso)} opens ${relDay(a.opensOn)}.`,
        upsell: true,
      };
    if (party > a.seatsLeftForTier)
      return {
        ok: false,
        reason:
          a.seatsLeftTotal > party
            ? `Only member-held seats remain. ${a.seatsLeftTotal} of them are waiting behind the hold.`
            : `Only ${a.seatsLeftForTier} seat${a.seatsLeftForTier === 1 ? '' : 's'} left for your tier.`,
        waitlist: true,
        upsell: a.seatsLeftTotal > party,
      };

    const rec = {
      id: 'GB-' + uid(),
      dateISO: iso,
      serviceId,
      party,
      tier: state.tier,
      priceEach: a.priceEach,
      name: (details && details.name) || state.name,
      email: (details && details.email) || state.email,
      notes: (details && details.notes) || '',
      createdAt: new Date().toISOString(),
    };
    state.bookings.push(rec);
    if (details && details.name) state.name = details.name;
    if (details && details.email) state.email = details.email;
    state.waitlist = state.waitlist.filter(
      (w) => !(w.dateISO === iso && w.serviceId === serviceId)
    );
    save();
    return { ok: true, booking: rec, availability: availability(iso, serviceId) };
  }

  function joinWaitlist(iso, serviceId, party, details) {
    if (state.waitlist.some((w) => w.dateISO === iso && w.serviceId === serviceId))
      return { ok: false, reason: 'You are already on this list.' };
    const depth = waitlistDepth(iso, serviceId);
    const rank = state.tier === 'premium' ? 1 : state.tier === 'member' ? Math.ceil(depth / 3) + 1 : depth + 1;
    const rec = {
      id: 'GW-' + uid(),
      dateISO: iso,
      serviceId,
      party,
      tier: state.tier,
      rank,
      name: (details && details.name) || state.name,
      email: (details && details.email) || state.email,
      createdAt: new Date().toISOString(),
    };
    state.waitlist.push(rec);
    if (details && details.name) state.name = details.name;
    if (details && details.email) state.email = details.email;
    save();
    return { ok: true, waitlist: rec };
  }

  function cancelBooking(id) {
    state.bookings = state.bookings.filter((b) => b.id !== id);
    save();
  }
  function leaveWaitlist(id) {
    state.waitlist = state.waitlist.filter((w) => w.id !== id);
    save();
  }

  function setTier(id, who) {
    state.tier = id;
    if (who && who.name) state.name = who.name;
    if (who && who.email) state.email = who.email;
    state.joinedAt = id === 'guest' ? null : new Date().toISOString();
    save();
    return tierOf(id);
  }

  /* ---------- basket cart ---------- */
  function cartKey(item) {
    return [item.kind, item.id, item.occasion || '', item.daypart || ''].join('~');
  }
  function addToCart(item) {
    const key = cartKey(item);
    const found = state.cart.find((c) => c.key === key);
    if (found) found.qty += item.qty || 1;
    else state.cart.push(Object.assign({ key, qty: 1 }, item));
    save();
    return state.cart;
  }
  function setQty(key, qty) {
    const found = state.cart.find((c) => c.key === key);
    if (!found) return;
    found.qty = Math.max(0, qty);
    if (found.qty === 0) state.cart = state.cart.filter((c) => c.key !== key);
    save();
  }
  function clearCart() {
    state.cart = [];
    save();
  }
  function cartLine(entry) {
    const src = entry.kind === 'basket' ? D.baskets : D.addons;
    const item = src.find((x) => x.id === entry.id);
    if (!item) return null;
    const occasion = D.occasions.find((o) => o.id === entry.occasion);
    return {
      entry,
      item,
      occasion,
      unit: item.price,
      total: item.price * entry.qty,
    };
  }
  function cartTotals() {
    const lines = state.cart.map(cartLine).filter(Boolean);
    const subtotal = lines.reduce((n, l) => n + l.total, 0);
    const rate = state.tier === 'premium' ? 0.18 : state.tier === 'member' ? 0.1 : 0;
    const discount = +(subtotal * rate).toFixed(2);
    const delivery = state.tier === 'premium' ? 0 : subtotal >= 120 ? 0 : 12;
    const tax = +((subtotal - discount + delivery) * 0.13).toFixed(2);
    return {
      lines,
      count: lines.reduce((n, l) => n + l.entry.qty, 0),
      subtotal,
      rate,
      discount,
      delivery,
      tax,
      total: +(subtotal - discount + delivery + tax).toFixed(2),
    };
  }
  function placeOrder(meta) {
    const t = cartTotals();
    if (!t.lines.length) return { ok: false, reason: 'Your basket list is empty.' };
    const order = {
      id: 'GO-' + uid(),
      items: t.lines.map((l) => ({
        name: l.item.name,
        qty: l.entry.qty,
        occasion: l.occasion ? l.occasion.name : null,
        daypart: l.entry.daypart || null,
        total: l.total,
      })),
      total: t.total,
      dateISO: (meta && meta.dateISO) || toISO(addDays(startOfToday(), 2)),
      daypart: (meta && meta.daypart) || 'midday',
      address: (meta && meta.address) || '',
      createdAt: new Date().toISOString(),
    };
    state.orders.push(order);
    state.cart = [];
    save();
    return { ok: true, order };
  }

  /* ---------- expose ---------- */
  window.G = {
    data: D,
    get state() { return state; },
    reset() { state = blank(); save(); },
    tierOf,
    serviceOf,
    availability,
    nextService,
    liveService,
    dateRail,
    waitlistDepth,
    book,
    joinWaitlist,
    cancelBooking,
    leaveWaitlist,
    setTier,
    addToCart,
    setQty,
    clearCart,
    cartTotals,
    placeOrder,
    fmt: { time: fmtTime, range: fmtRange, date: fmtDate, rel: relDay, money, iso: toISO, fromISO, addDays, daysAhead, startOfToday },
  };
})();
