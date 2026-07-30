/* =========================================================
   Gathering — catalogue data
   Single source of truth for services, tiers, baskets, menu.
   ========================================================= */

const GATHERING = {
  brand: {
    name: 'Gathering',
    tagline: 'Because sharing is caring!',
    kicker: 'Food for every moment',
    domain: 'gathering.ca',
    phone: '(647) 555-0142',
    address: '218 Harvest Lane, Toronto, ON',
    email: 'hello@gathering.ca',
    walkInHours: '7:00 – 20:00 daily',
  },

  /* ------------------------------------------------------------------
     THE DAY — five seated buffet services inside a 13-hour window.
     Each service is a ticketed event with hard capacity.
     ------------------------------------------------------------------ */
  services: [
    {
      id: 'breakfast',
      name: 'The Breakfast Buffet',
      tagline: 'Soft light, warm bread, no rush.',
      start: '07:30',
      end: '09:30',
      capacity: 40,
      memberHold: 0.35,
      price: 24,
      memberPrice: 19,
      accent: '#c8a45c',
      glyph: '☕',
      blurb:
        'Croissants pulled at six, folded eggs, cured meats, labneh with olive oil, and a bottomless pour of our house cold brew and filter.',
      dishes: ['Butter croissants', 'Folded eggs', 'Labneh & za’atar', 'Waffle station', 'Fresh juice bar', 'Filter & cold brew'],
      pace: 'Seated 120 min',
    },
    {
      id: 'ranch',
      name: 'The Ranch',
      tagline: 'Midday, generous, hands-on.',
      start: '11:00',
      end: '13:30',
      capacity: 48,
      memberHold: 0.4,
      price: 34,
      memberPrice: 27,
      accent: '#b5765a',
      glyph: '🔥',
      blurb:
        'Our loudest table. Smoked brisket carved to order, buttermilk chicken, skillet cornbread, ranch slaw and four house sauces.',
      dishes: ['Carved brisket', 'Buttermilk chicken', 'Skillet cornbread', 'Ranch slaw', 'Loaded potatoes', 'Four house sauces'],
      pace: 'Seated 150 min',
    },
    {
      id: 'healthy',
      name: 'The Healthy Buffet',
      tagline: 'Bright, clean, built to graze.',
      start: '14:00',
      end: '16:00',
      capacity: 32,
      memberHold: 0.35,
      price: 29,
      memberPrice: 23,
      accent: '#4c6b52',
      glyph: '🌿',
      blurb:
        'Twelve seasonal salads, grain bowls built at the counter, cold-pressed juices, and grilled fish or tofu from the pass.',
      dishes: ['Twelve salads', 'Grain bowl bar', 'Grilled fish & tofu', 'Cold-pressed juice', 'Seed & nut table', 'Herb infusions'],
      pace: 'Seated 120 min',
    },
    {
      id: 'dessert',
      name: 'The Dessert Buffet',
      tagline: 'The sweet hour. Bring someone.',
      start: '16:30',
      end: '18:00',
      capacity: 36,
      memberHold: 0.45,
      price: 26,
      memberPrice: 21,
      accent: '#d8a3a0',
      glyph: '🍫',
      blurb:
        'Chocolate bark broken at the table, dipped strawberries, macarons, warm pistachio kunafa, and a working espresso bar.',
      dishes: ['Chocolate bark', 'Dipped strawberries', 'Macaron tower', 'Warm kunafa', 'Gelato churn', 'Espresso bar'],
      pace: 'Seated 90 min',
    },
    {
      id: 'dinner',
      name: 'The Dinner Buffet',
      tagline: 'The long table, candles lit.',
      start: '18:30',
      end: '20:30',
      capacity: 44,
      memberHold: 0.5,
      price: 46,
      memberPrice: 37,
      accent: '#24422f',
      glyph: '🕯',
      blurb:
        'A rotating regional menu, three mains from the fire, mezze to start, and dessert carried out on shared boards.',
      dishes: ['Mezze table', 'Three fire mains', 'Saffron rice', 'Seasonal roots', 'Shared dessert boards', 'Mint tea service'],
      pace: 'Seated 120 min',
    },
  ],

  /* Rotating theme per weekday, layered over the dinner service */
  dinnerThemes: [
    'Levantine Sunday',
    'Prairie Monday',
    'Coastal Tuesday',
    'Market Wednesday',
    'Slow-Fire Thursday',
    'Feast Friday',
    'Harvest Saturday',
  ],

  /* ------------------------------------------------------------------
     MEMBERSHIP — the booking priority ladder
     ------------------------------------------------------------------ */
  tiers: [
    {
      id: 'guest',
      name: 'Walk-in Guest',
      price: 0,
      priceLabel: 'Free',
      window: 2,
      holdAccess: false,
      note: 'No account needed. Coffee house and counter always open.',
      perks: [
        'Walk in for coffee, pastry and counter plates any day',
        'Buffet seats open to you 48 hours before service',
        'Join the waiting list when a service is full',
        'Order baskets and sharing boxes at list price',
      ],
      cta: 'You are here',
    },
    {
      id: 'member',
      name: 'Gathering Member',
      price: 29,
      priceLabel: '$29',
      window: 7,
      holdAccess: true,
      note: 'Priority booking on every service, seven days ahead.',
      featured: true,
      perks: [
        'Book 7 days ahead — before seats reach the public',
        'Access to the member seat hold on all five daily services',
        'Member pricing on every buffet (save $5–$9 a seat)',
        'Skip-the-line waitlist priority, ranked above guests',
        '10% off baskets and sharing boxes',
        'Free changes up to 4 hours before service',
      ],
      cta: 'Become a Member',
    },
    {
      id: 'premium',
      name: 'Gathering Circle',
      price: 59,
      priceLabel: '$59',
      window: 14,
      holdAccess: true,
      note: 'Premium access to all events, all year.',
      perks: [
        'Everything in Member, plus:',
        'Book 14 days ahead across all five services',
        'Guaranteed seat at any service booked 24h+ ahead',
        'Bring a guest at member price, every service',
        'First refusal on seasonal and occasion buffets',
        '18% off baskets, plus free local delivery',
        'Two chef’s-table invitations each season',
      ],
      cta: 'Join the Circle',
    },
  ],

  /* ------------------------------------------------------------------
     BASKETS — the fixed five, offered across every occasion
     ------------------------------------------------------------------ */
  baskets: [
    {
      id: 'classic-brunch',
      name: 'Classic Brunch Basket',
      serves: 'Serves 4–6',
      price: 89,
      pairs: ['breakfast'],
      includes: 'Finger sandwiches, mini croissant sandwiches, fruit, crackers, two dips, orange juice.',
      glyph: '🥐',
    },
    {
      id: 'deluxe-sharing',
      name: 'Deluxe Sharing Basket',
      serves: 'Serves 6–8',
      price: 129,
      pairs: ['ranch', 'dinner'],
      includes: 'More sandwiches, sliders, pastries, mini quiche, brownies, fruit, cold brew and fresh juice.',
      glyph: '🧺',
    },
    {
      id: 'ultimate-gathering',
      name: 'Ultimate Gathering Basket',
      serves: 'Serves 8–10',
      price: 179,
      pairs: ['dinner'],
      includes: 'Abundant savoury & sweet assortment, croissants, sliders, tarts, waffles, cheeses, crackers, three dips, juice and milkshake.',
      glyph: '✦',
    },
    {
      id: 'savoury-snack',
      name: 'Savoury Snack Basket',
      serves: 'Serves 4–6',
      price: 79,
      pairs: ['ranch'],
      includes: 'Savoury pastries, mini sandwiches, cheese cubes, olives, crackers, three dips.',
      glyph: '🫒',
    },
    {
      id: 'fruit-refreshments',
      name: 'Fruit & Refreshments Basket',
      serves: 'Serves 4–6',
      price: 84,
      pairs: ['healthy', 'dessert'],
      includes: 'Generous fruit, cheeses, yogurt dip, nuts, crackers, fresh juices and milkshake.',
      glyph: '🍓',
    },
  ],

  /* Occasion dressings applied to any of the five baskets */
  occasions: [
    { id: 'everyday', name: 'Everyday Sharing', glyph: '❧', note: 'No dressing, just generous', season: 'all' },
    { id: 'new-year', name: 'New Year Celebration', glyph: '✧', note: 'Gold ribbon, sparkle topper', season: 'winter' },
    { id: 'valentines', name: 'Valentine’s Day', glyph: '♥', note: 'Blush wrap, heart plaque', season: 'winter' },
    { id: 'ramadan', name: 'Ramadan Iftar', glyph: '☾', note: 'Lantern tag, dates & kunafa', season: 'spring' },
    { id: 'eid', name: 'Eid Mubarak', glyph: '✵', note: 'Green & gold, sweets tier', season: 'spring' },
    { id: 'mothers-day', name: 'Mother’s Day', glyph: '❀', note: 'Fresh florals, best-mom plaque', season: 'spring' },
    { id: 'fathers-day', name: 'Father’s Day', glyph: '❖', note: 'Deep green, best-dad plaque', season: 'summer' },
    { id: 'graduation', name: 'Graduation', glyph: '✤', note: 'Cap topper, you-did-it plaque', season: 'summer' },
    { id: 'birthday', name: 'Birthday', glyph: '✹', note: 'Candles, celebration topper', season: 'all' },
    { id: 'gender-reveal', name: 'Gender Reveal', glyph: '◐', note: 'Blue or pink, reveal plaque', season: 'all' },
    { id: 'canada-day', name: 'Canada Day', glyph: '✚', note: 'Red & white, maple plaque', season: 'summer' },
    { id: 'picnic', name: 'Picnic in the Park', glyph: '☘', note: 'Blanket, cushions, flat lid', season: 'summer' },
    { id: 'halloween', name: 'Halloween', glyph: '✷', note: 'Black satin, pumpkin plaque', season: 'autumn' },
    { id: 'christmas', name: 'Christmas', glyph: '❆', note: 'Tree of berries, spiced sweets', season: 'winter' },
  ],

  /* Daypart routing — a basket ordered for a time of day is built to match */
  dayparts: [
    { id: 'morning', name: 'Morning drop', window: '7:00 – 10:30', note: 'Pastry-forward, juice and cold brew', glyph: '☀' },
    { id: 'midday', name: 'Midday drop', window: '11:00 – 14:00', note: 'Sandwiches, sliders, savoury pastry', glyph: '◑' },
    { id: 'afternoon', name: 'Afternoon drop', window: '14:30 – 17:00', note: 'Fruit, cheese, sweets and tea', glyph: '◔' },
    { id: 'evening', name: 'Evening drop', window: '17:30 – 20:00', note: 'Mezze, warm bites, dessert boards', glyph: '☾' },
  ],

  addons: [
    { id: 'juice', name: 'Fresh Juice Bottle', price: 7, glyph: '🧃' },
    { id: 'milkshake', name: 'Milkshake Bottle', price: 8, glyph: '🥛' },
    { id: 'cold-brew', name: 'Cold Brew Coffee', price: 7, glyph: '🧋' },
    { id: 'tea-box', name: 'Tea Box Selection', price: 18, glyph: '🍃' },
    { id: 'dessert-jar', name: 'Dessert Jar (pair)', price: 12, glyph: '🍮' },
    { id: 'card', name: 'Celebration Card', price: 5, glyph: '✉' },
    { id: 'florals', name: 'Floral Touch', price: 24, glyph: '🌸' },
    { id: 'blanket', name: 'Picnic Blanket', price: 34, glyph: '🧶' },
    { id: 'cushions', name: 'Soft Cushion Set', price: 39, glyph: '🛋' },
  ],

  /* ------------------------------------------------------------------
     COFFEE HOUSE — walk-in counter, no booking
     ------------------------------------------------------------------ */
  counter: [
    {
      group: 'Coffee & Espresso',
      note: 'House blend roasted in Scarborough. Single origin rotates weekly.',
      items: [
        { name: 'Filter Coffee', price: 3.5, note: 'Free refill until 10:00' },
        { name: 'Cortado', price: 4.25 },
        { name: 'Flat White', price: 4.75 },
        { name: 'Cardamom Latte', price: 5.5, note: 'House favourite' },
        { name: 'Cold Brew', price: 5, note: '18-hour steep, on nitro Fridays' },
        { name: 'Pistachio Mocha', price: 6.25 },
      ],
    },
    {
      group: 'Not Coffee',
      items: [
        { name: 'Mint Tea Service', price: 4.5, note: 'Fresh leaf, small pot' },
        { name: 'Cold-Pressed Juice', price: 6.5 },
        { name: 'Rose Lemonade', price: 5.25 },
        { name: 'Milkshake', price: 7 },
        { name: 'Hibiscus Agua Fresca', price: 5.5 },
      ],
    },
    {
      group: 'Fast Counter Plates',
      note: 'Ready in the case from 7:00. Ten minutes, in or out.',
      items: [
        { name: 'Butter Croissant', price: 4 },
        { name: 'Croissant Sandwich', price: 9.5, note: 'Turkey, avocado, herb cream' },
        { name: 'Focaccia Slider (2)', price: 11, note: 'From the Ranch kitchen' },
        { name: 'Grain Bowl, Small', price: 12.5, note: 'From the Healthy pass' },
        { name: 'Mini Quiche (3)', price: 9 },
        { name: 'Chocolate Bark Bag', price: 8.5 },
        { name: 'Dipped Strawberries (4)', price: 10 },
      ],
    },
  ],

  faqs: [
    {
      q: 'Why do I need to book a buffet?',
      a: 'Every service has a hard seat count — between 32 and 48 people. We do not overbook it. That is the whole point: the room stays calm, the food stays fresh, and the table is never picked over. Booking is how we protect that.',
    },
    {
      q: 'What happens if a service is full?',
      a: 'You join the waiting list for that exact service. When someone releases a seat we offer it down the list — Circle first, then Members, then guests. You get a notification and two hours to claim it.',
    },
    {
      q: 'What does membership actually change?',
      a: 'Two things: how early you can book, and how many seats you can see. Members book 7 days ahead, Circle books 14, guests book 2. And a share of every service — between 35% and 50% — is held back for members until 24 hours before the doors open.',
    },
    {
      q: 'Can I come to more than one service in a day?',
      a: 'Yes, and people do. Breakfast then Dessert is the common pair. Each service is booked separately because each one has its own seat count.',
    },
    {
      q: 'Do I need a booking for coffee?',
      a: 'Never. The coffee house is walk-in from 7:00 to 20:00 — counter plates, pastry, cold brew, no seat required. Booking is only for the seated buffet services.',
    },
    {
      q: 'How far ahead do baskets need to be ordered?',
      a: 'Standard baskets need 24 hours. Occasion dressing — florals, plaques, custom toppers — needs 48. Same-day is sometimes possible from the counter; call the shop.',
    },
    {
      q: 'Can I change or cancel?',
      a: 'Members and Circle change free up to 4 hours before service. Guests up to 24 hours. Released seats go straight to the waiting list, which is how the list keeps moving.',
    },
  ],
};

if (typeof window !== 'undefined') window.GATHERING = GATHERING;
if (typeof module !== 'undefined') module.exports = GATHERING;
