/* Go Overseas News — shared content data
   Categories follow the official brand category system.
   Stories are launch placeholder editorial content. */

/* White / blue / black theme — every category maps to the
   blue-navy-black spectrum; `ink` is the text color used on chips. */
const GON_CATEGORIES = {
  "go-now": {
    name: "GO NOW",
    tagline: "What matters now.",
    color: "#078FDD",
    ink: "#FFFFFF",
    icon: "globe"
  },
  "go-trend": {
    name: "GO TREND",
    tagline: "What's moving the internet.",
    color: "#0A1633",
    ink: "#FFFFFF",
    icon: "arrow"
  },
  "go-sound": {
    name: "GO SOUND",
    tagline: "The sound shaping culture.",
    color: "#29ABE2",
    ink: "#0A1633",
    icon: "wave"
  },
  "go-ai": {
    name: "GO AI",
    tagline: "Tomorrow is already here.",
    color: "#0857A6",
    ink: "#FFFFFF",
    icon: "chip"
  },
  "go-creator": {
    name: "GO CREATOR",
    tagline: "The people behind the movement.",
    color: "#43CBF5",
    ink: "#0A1633",
    icon: "mic"
  },
  "go-tech": {
    name: "GO TECH",
    tagline: "Smarter tools, simpler lives.",
    color: "#10151F",
    ink: "#FFFFFF",
    icon: "bolt"
  },
  "go-business": {
    name: "GO BUSINESS",
    tagline: "Ideas becoming opportunities.",
    color: "#078FDD",
    ink: "#FFFFFF",
    icon: "case"
  },
  "go-culture": {
    name: "GO CULTURE",
    tagline: "What the world is watching.",
    color: "#0A1633",
    ink: "#FFFFFF",
    icon: "burst"
  },
  "go-play": {
    name: "GO PLAY",
    tagline: "Where digital worlds move.",
    color: "#0857A6",
    ink: "#FFFFFF",
    icon: "play"
  },
  "go-discover": {
    name: "GO DISCOVER",
    tagline: "People, places and possibilities.",
    color: "#29ABE2",
    ink: "#0A1633",
    icon: "pin"
  }
};

const GON_STORIES = [
  {
    id: "world-in-motion",
    cat: "go-now",
    featured: true,
    title: "A World in Motion: The Stories Shaping Global Tomorrow",
    dek: "From new trade corridors to a generation that works from anywhere, the map of what matters is being redrawn in real time. Here is where to look first.",
    author: "Go Overseas Newsroom",
    date: "July 12, 2026",
    read: 6,
    tags: ["Global News", "Analysis", "Market Watch"],
    body: [
      "The pace of global change no longer waits for the evening bulletin. Supply routes shift in a quarter, cultural moments cross oceans in an afternoon, and policies drafted in one capital echo through markets on three continents before the week is out.",
      "That speed is the story. The countries growing fastest today are the ones treating connectivity — digital, financial and human — as core infrastructure rather than a luxury. New rail and shipping corridors across Asia, Africa and Latin America are quietly rewiring who trades with whom, while remote-first visas keep pulling young professionals toward cities that barely registered on relocation lists five years ago.",
      "The same acceleration is reshaping information itself. Audiences increasingly meet world events through creators and community feeds before traditional wires catch up, which makes verification — not access — the scarce resource. The winners in this environment are newsrooms and readers who slow down just long enough to ask: who is telling me this, and how do they know?",
      "Meanwhile, the climate transition has moved from pledge to procurement. Grid-scale storage, cross-border power interconnects and heat-resilient city design are now line items in national budgets, not conference talking points. The money is real, and so are the jobs following it.",
      "None of this means the world is calmer — it means the world is faster. The useful response is not anxiety but literacy: knowing which signals matter, which are noise, and which are someone else's marketing. That is the job of this newsroom, every day.",
      "Global perspective. What's next. That is not a slogan — it is the assignment."
    ]
  },
  {
    id: "age-of-intelligence",
    cat: "go-ai",
    featured: true,
    title: "The Age of Intelligence: How AI Quietly Became Everyday Infrastructure",
    dek: "The most important AI stories of the year are not demos — they are the invisible systems now scheduling ports, screening scans and translating classrooms.",
    author: "Go Overseas Newsroom",
    date: "July 11, 2026",
    read: 7,
    tags: ["AI", "Breakthroughs", "Future Ready"],
    body: [
      "The spectacle phase of artificial intelligence is ending. The infrastructure phase has begun. The systems that matter most this year are not the ones generating headlines with flashy demos — they are the ones that disappeared into ports, hospitals, classrooms and power grids.",
      "Consider logistics. AI scheduling now routes a meaningful share of global container traffic, trimming idle days from shipping cycles that once absorbed them as a cost of doing business. Nobody posts about it. Everybody pays less for freight because of it.",
      "Healthcare tells a similar story. Screening models are working alongside radiologists in dozens of public health systems, not replacing judgment but widening its reach — flagging the scan worth a second look in places where a second specialist simply does not exist.",
      "In classrooms from Jakarta to Lagos, live translation and adaptive tutoring are doing something subtler: making the language of instruction less of a gatekeeper. The technology is imperfect, and the debates about it are healthy. But for a student who understands the lesson for the first time, imperfect is a big upgrade over absent.",
      "The open questions have shifted accordingly. The interesting arguments are no longer about whether AI works, but about who audits it, who profits from it, and what happens to the skills it displaces. Those are governance questions, and they will be answered by people — in parliaments, union halls and school boards — not by models.",
      "Tomorrow is already here. The task now is making sure it is distributed fairly."
    ]
  },
  {
    id: "sound-of-culture",
    cat: "go-sound",
    featured: true,
    title: "The Sound of Culture: Music Without Borders Is the New Mainstream",
    dek: "Afrobeats sells out arenas in Seoul, regional Mexican tops charts in Toronto, and the idea of 'world music' as a niche shelf is officially over.",
    author: "Go Overseas Newsroom",
    date: "July 10, 2026",
    read: 5,
    tags: ["Music", "Rising Artists", "Global Sound"],
    body: [
      "For decades, the global music industry had a center and a periphery. Songs traveled outward from a handful of capitals, and everything else was filed under 'world music.' That map is gone.",
      "Streaming data tells the story bluntly: the fastest-growing listening markets are also the fastest-growing exporters. Afrobeats tours sell out arenas across Asia. Regional Mexican music tops playlists in Canada. K-pop's production playbook is being studied — and remixed — from São Paulo to Stockholm.",
      "What changed is not taste but plumbing. When distribution went global by default, artists stopped needing permission from legacy gatekeepers to find audiences abroad. A hit can now begin in a bedroom studio in Accra, catch fire on short-form video in Manila, and land a sync deal in Los Angeles within a month.",
      "Producers describe a new creative economics: collaboration across time zones is cheaper than renting a studio across town. Language is less of a barrier than it has ever been — audiences stream songs they cannot literally understand, because rhythm and feeling never needed translation.",
      "The industry is racing to keep up. Labels are opening A&R offices in cities they ignored a decade ago, and touring infrastructure is following the streams. The next generation of superstars will be global on day one — not as a marketing strategy, but as a starting condition.",
      "The sound shaping culture no longer has a single address. It has a passport."
    ]
  },
  {
    id: "internet-never-sleeps",
    cat: "go-trend",
    featured: false,
    title: "The Internet Never Sleeps: Micro-Communities Are the New Mainstream",
    dek: "The monoculture feed is fading. The sharpest trends of 2026 are born in group chats, niche servers and 10,000-member forums — then everywhere at once.",
    author: "Go Overseas Newsroom",
    date: "July 9, 2026",
    read: 5,
    tags: ["Trends", "Social Pulse", "Viral Now"],
    body: [
      "Ask a trend forecaster where the next big thing starts and they will no longer point at a single platform. They will point at ten thousand small rooms.",
      "The defining shift of this internet era is the migration of cultural energy from broadcast feeds to micro-communities: group chats, niche servers, invite-only forums and regional apps. Trends incubate in these rooms for weeks — developing vocabulary, in-jokes and aesthetics — before surfacing in public feeds looking suddenly, mysteriously fully formed.",
      "For brands and newsrooms, this changes the job. Watching the biggest platforms now means watching the last stage of a trend's life, not the first. The organizations that read culture well in 2026 are the ones with genuine members — not monitors — inside the small rooms where it begins.",
      "There is a healthy side effect: context. In a community of ten thousand, misinformation gets challenged by people who know each other. Moderation is social, not just algorithmic. It is not a utopia — insularity has its own failure modes — but it is a correction to the context-free virality of the last decade.",
      "The internet never sleeps. It has just moved the party to smaller rooms — and the most interesting conversations are happening where the follower counts are lowest.",
      "Why everyone is talking about it: because 'everyone' was never the point. The right ten thousand people were."
    ]
  },
  {
    id: "creators-change-everything",
    cat: "go-creator",
    featured: false,
    title: "Creators Change Everything: Inside the Mindset of the One-Person Studio",
    dek: "They write, shoot, edit, publish and run the business — from anywhere on earth. Meet the professional class that media companies now compete with.",
    author: "Go Overseas Newsroom",
    date: "July 8, 2026",
    read: 6,
    tags: ["Creators", "Interviews", "Growth Tips"],
    body: [
      "The word 'influencer' undersells what is actually happening. The people reshaping media in 2026 are closer to one-person studios: writer, producer, editor, analyst and CEO in a single chair — often a chair that moves between countries.",
      "Talk to full-time creators across three continents and the same themes repeat. First, consistency beats virality: the ones who last treat publishing like a broadcast schedule, not a lottery ticket. Second, direct relationships beat rented reach — newsletters, memberships and communities they own outlive any algorithm change. Third, the niche is the moat. The generalist creator is squeezed; the specialist with real expertise compounds.",
      "The economics have matured with the craft. Ad revenue is now the smallest slice for many working creators, behind products, services, licensing and brand partnerships negotiated like the media buys they are. The middle class of the creator economy — not the ten superstars, the hundred thousand professionals — is the real story.",
      "Geography is the quiet advantage. A creator in Nairobi or Medellín can serve a global audience at local costs, and increasingly does. The next wave of breakout media brands will come from cities the old industry never scouted.",
      "Real stories, real impact — made by people who never asked permission to start. That is the movement, and it is still early."
    ]
  },
  {
    id: "ambient-computing",
    cat: "go-tech",
    featured: false,
    title: "The Quiet Rise of Ambient Computing: When the Best Screen Is No Screen",
    dek: "Earbuds that translate, glasses that caption, homes that anticipate. The next platform shift is designed to be barely noticed.",
    author: "Go Overseas Newsroom",
    date: "July 7, 2026",
    read: 5,
    tags: ["Tech", "Tools & Apps", "Future Ready"],
    body: [
      "Every previous computing era announced itself with a screen: the desktop, the laptop, the phone. The one arriving now is different. Its ambition is to disappear.",
      "Ambient computing — the mesh of earbuds, glasses, sensors and assistants working in the background — has crossed from concept to habit. Live-translating earbuds are standard travel kit. Caption glasses are changing daily life for the hard of hearing. Homes increasingly adjust light, heat and sound without being asked, learning routines instead of demanding commands.",
      "The design philosophy is calm technology: fewer notifications, more anticipation. Instead of pulling attention toward a screen, the system resolves small tasks before they become interruptions. The best interaction, its designers argue, is the one you never notice happened.",
      "The trade-offs are real and worth naming. Always-available assistance means always-on sensing, and the privacy architecture — what is processed on the device, what leaves it, who can audit the difference — is becoming the deciding factor in which products earn trust. On-device processing is winning that argument, and not only for privacy reasons: it is faster and works offline.",
      "Smarter tools, simpler lives is an easy promise to make and a hard one to keep. The companies keeping it are the ones treating your attention as a resource to protect, not to harvest."
    ]
  },
  {
    id: "built-to-grow",
    cat: "go-business",
    featured: false,
    title: "Built to Grow: The Cross-Border Playbook Behind 2026's Breakout Startups",
    dek: "Distributed teams, day-one global markets and revenue before hype — inside the operating model quietly outperforming the old startup script.",
    author: "Go Overseas Newsroom",
    date: "July 6, 2026",
    read: 6,
    tags: ["Business", "Startups", "Market Watch"],
    body: [
      "The startup story used to have one setting: a garage in one famous valley. The breakout companies of 2026 read differently. Founded in Warsaw and Manila, engineering in three time zones, first customers on four continents — global from the first invoice.",
      "The playbook has three moves. First, distributed by design: teams hired for talent, not zip code, with the operating discipline — written decisions, async reviews, deliberate overlap hours — to make it work. Second, revenue before hype: the fundraising climate rewards companies that charge money early and grow from cash flow, and founders have adjusted. Third, day-one internationalization: pricing, payments and language support built for many markets from the start, because the addressable market was never one country.",
      "Investors have followed the returns. Cross-border funds now scout second and third cities — Guadalajara, Kraków, Da Nang, Kigali — where technical talent is deep and burn rates are rational. The unicorn is no longer the only trophy; the durable, profitable, hundred-million company built in five years commands new respect.",
      "The pattern extends past software. Modern logistics and fulfillment networks let a physical-product brand in one country serve customers in thirty, at a scale that once required a multinational's infrastructure.",
      "Ideas becoming opportunities is the category promise, and the barrier between the two has never been thinner. The next great company is being built right now, somewhere the old map never thought to look."
    ]
  },
  {
    id: "streaming-without-borders",
    cat: "go-culture",
    featured: false,
    title: "Streaming Without Borders: How Global Audiences Rewrote Prime Time",
    dek: "A Korean thriller, a Nigerian family saga, a Spanish heist drama — the world's most-watched shows no longer share a language, only a standard.",
    author: "Go Overseas Newsroom",
    date: "July 5, 2026",
    read: 5,
    tags: ["Culture", "Streaming", "Analysis"],
    body: [
      "Somewhere in the last few years, the phrase 'foreign-language hit' quietly lost its meaning. The most-watched shows on earth now routinely come from Seoul, Lagos, Madrid and Mumbai — and audiences stopped noticing the subtitles.",
      "The numbers behind the shift are structural, not seasonal. Streaming platforms discovered that great local stories travel better than diluted global ones, and redirected production budgets accordingly. Regional studios that once fought for domestic slots now green-light with the world in mind — without sanding off the specificity that makes the stories worth telling.",
      "Dubbing and subtitling, long an afterthought, became a craft discipline with its own awards conversation. Viewers increasingly toggle between original audio and dubs, and the best localization teams are credited like key creatives — because they are.",
      "The cultural consequences run deeper than entertainment. Audiences who spend their evenings inside other countries' living rooms develop an ambient familiarity with them. Food, fashion, music and travel follow the shows; tourism boards now track release calendars the way they once tracked exchange rates.",
      "What the world is watching turns out to be — for the first time — the world. Prime time belongs to everyone now."
    ]
  },
  {
    id: "virtual-venues",
    cat: "go-play",
    featured: false,
    title: "Where Digital Worlds Move: Virtual Venues Are the New Stadiums",
    dek: "Concerts inside games draw crowds no arena could hold, and the line between playing, watching and attending has all but dissolved.",
    author: "Go Overseas Newsroom",
    date: "July 4, 2026",
    read: 5,
    tags: ["Gaming", "Digital Worlds", "Events"],
    body: [
      "The biggest venue in the world has no address. When a headline artist performs inside a major game world, attendance is counted in tens of millions — more than a stadium tour's entire run, gathered in a single evening across every time zone at once.",
      "Game worlds have become the internet's public squares for a generation that grew up in them. They are where friends meet after school across borders, where films premiere, where fashion houses drop digital collections, and where fandoms build monuments to the things they love.",
      "The craft has matured past novelty. Virtual events are now designed by teams blending game design, concert production and film direction — with moments only possible when physics is optional. The audience is not watching the show; it is inside the show, and increasingly shaping it in real time.",
      "The economics follow the attention. Digital merchandise, ticketed experiences and creator-built venues have turned play spaces into platforms, with independent world-builders earning real livings designing places millions visit.",
      "Where digital worlds move, culture moves with them. The stadium is not being replaced — but it has learned it is no longer the ceiling on how many people can share a moment."
    ]
  },
  {
    id: "third-cities",
    cat: "go-discover",
    featured: false,
    title: "Third Cities: The Overlooked Places Drawing a New Generation of Travelers",
    dek: "Skip the capital, skip the resort. The most rewarding journeys of 2026 run through the cities guidebooks used to summarize in a paragraph.",
    author: "Go Overseas Newsroom",
    date: "July 3, 2026",
    read: 5,
    tags: ["Travel", "Community", "Discovery"],
    body: [
      "Every country has them: the third cities. Not the capital, not the resort town — the university city, the port city, the regional hub the guidebooks summarized in a paragraph. In 2026 they are having their moment, and it is well earned.",
      "The travelers finding them are staying longer and spending differently. Remote work turned the two-week vacation into the two-month stay, and two months rewards depth over checklists: a favorite market stall, a standing football game, neighbors who learn your name. That texture is exactly what the most-visited districts of the most-visited cities can no longer offer at peak season.",
      "The infrastructure has caught up quietly. Regional rail and budget air routes link second and third cities directly. Co-working spaces and long-stay housing have followed. Local tourism boards, watching over-touristed capitals strain, are courting slower visitors deliberately — fewer, longer, deeper.",
      "Done well, this is a better bargain for both sides. Spending spreads beyond a single overcrowded center; visitors get the version of a country its residents actually live in. Done carelessly, it exports the same pressures to smaller places — which is why the best guides in this category now talk about arriving as a guest, not a consumer.",
      "People, places and possibilities: the promise of travel was never the landmark photo. It was the possibility of being somewhere genuinely, generously different. The third cities still keep that promise."
    ]
  },
  {
    id: "small-models-big-shift",
    cat: "go-ai",
    featured: false,
    title: "Small Models, Big Shift: Why the Future of AI Fits in Your Pocket",
    dek: "The frontier gets the headlines, but compact on-device models are winning the daily workload — faster, cheaper, private by default.",
    author: "Go Overseas Newsroom",
    date: "July 2, 2026",
    read: 4,
    tags: ["AI", "Tools & Apps", "Analysis"],
    body: [
      "The AI race everyone watches is the one at the frontier: ever-larger models setting ever-higher benchmarks. The race that touches daily life is quieter — the sprint to make models small enough to live on the device in your hand.",
      "Compact models now handle translation, transcription, photo editing, summarization and drafting entirely on phones and laptops. No round trip to a data center means responses in milliseconds, features that work in airplane mode, and personal data that never leaves the device — a privacy answer that requires no policy, only physics.",
      "The economics push the same direction. Serving a billion users from the cloud is staggeringly expensive; serving them from their own hardware costs the provider almost nothing per query. Chipmakers have obliged, dedicating growing silicon to neural processing in every price tier — including the budget phones that most of the world actually buys.",
      "That last point is the global story. On-device AI is how these tools reach places where connectivity is expensive or intermittent — which is to say, most of the world. A student's phone that translates and tutors offline is a different kind of infrastructure than any data center.",
      "The frontier still matters; it sets what is possible. But the pocket sets what is universal — and universal is the bigger shift."
    ]
  },
  {
    id: "new-music-alert",
    cat: "go-sound",
    featured: false,
    title: "New Music Alert: The Producer Collectives Redefining the Global Hit",
    dek: "Cross-border crews writing in three languages over one rhythm section are behind more of your favorite songs than any label will admit.",
    author: "Go Overseas Newsroom",
    date: "July 1, 2026",
    read: 4,
    tags: ["Music", "New Releases", "Rising Artists"],
    body: [
      "Look closely at the credits of this year's global hits and a pattern emerges: the same clusters of names, scattered across different continents, appearing together again and again. The producer collective — loose, borderless, chronically online — has become pop's most important unit of creation.",
      "The workflow would bewilder an old-school studio. A drum pattern starts in Johannesburg, a topline arrives from Seoul by morning, a bridge is rewritten in Bogotá over lunch, and the mix bounces between London and Lagos before the weekend. The song is finished before its writers have ever shared a room.",
      "The results sound like their process: rhythms from one tradition under melodies from another, hooks that switch languages mid-line because the writers did too. Purists call it dilution. The charts call it the sound of right now.",
      "For emerging artists, the collectives function as distributed academies. A vocalist plugged into the right crew gets production, feedback and reach that once required a label advance — and keeps ownership while getting it.",
      "The sound taking over was not invented anywhere in particular. That is precisely the point."
    ]
  },
  {
    id: "climate-tech-moment",
    cat: "go-now",
    featured: false,
    title: "From Pledge to Procurement: Climate Tech Becomes a Line Item",
    dek: "Storage, grids and heat-proof cities are now budget entries, not summit promises. Follow the purchase orders, not the press releases.",
    author: "Go Overseas Newsroom",
    date: "June 30, 2026",
    read: 5,
    tags: ["Climate", "Global News", "Market Watch"],
    body: [
      "The most reliable way to track the climate transition in 2026 is no longer the summit communiqué. It is the procurement notice.",
      "Grid-scale battery storage is being tendered on every continent. Cross-border transmission lines — the unglamorous backbone that lets solar noon in one country power dinner time in another — are moving from feasibility study to construction. Cities from Athens to Ahmedabad are budgeting for heat resilience the way they long budgeted for snow removal or flood control: as a recurring cost of operating in reality.",
      "The signal in all this is contractual, not rhetorical. Purchase orders create factories, apprenticeships and shipping schedules; press releases do not. The clean-energy workforce is now measured in the tens of millions globally, and the fastest growth is in trades — electricians, grid technicians, retrofit crews — not in conference keynotes.",
      "None of this settles the hard questions. Financing for lower-income countries remains the sticking point of every negotiation, and adaptation still gets a fraction of what mitigation attracts. The gap between the money pledged and the money delivered is the story to watch this decade.",
      "But the direction is no longer in doubt, because it is no longer voluntary. What matters now is speed — and speed, unlike ambition, shows up in the receipts."
    ]
  },
  {
    id: "slow-feeds",
    cat: "go-trend",
    featured: false,
    title: "Slow Feeds: The Anti-Algorithm Apps Quietly Gaining Ground",
    dek: "Chronological timelines, daily posting limits, no infinite scroll. A wave of deliberately calmer apps is betting attention is worth more than engagement.",
    author: "Go Overseas Newsroom",
    date: "June 28, 2026",
    read: 4,
    tags: ["Trends", "Social Pulse", "Wellbeing"],
    body: [
      "The pitch sounds almost rebellious in 2026: an app that shows you less. Chronological feeds, hard daily limits, no autoplay, no infinite scroll — and a growing waiting list of people who want in.",
      "The slow-feed movement began as a niche protest against engagement-optimized platforms and has matured into a real product category. The apps differ in details but share a philosophy: your attention is the client, not the product. Sessions are designed to end. Notifications arrive in a single daily digest. Metrics are private by default.",
      "What surprised skeptics is retention. Users of these apps open them less often but stay subscribed longer, and the churn curves — the numbers that decide which products live — look healthier than many attention-maximizing rivals. Calm, it turns out, is a feature people will pay for.",
      "The giants have noticed, shipping their own quiet modes and screen-time tools. Whether that is genuine change or defensive theater is the debate — but the direction of travel is clear. The next status symbol of the internet may simply be an empty notification tray."
    ]
  },
  {
    id: "creator-unions",
    cat: "go-creator",
    featured: false,
    title: "The Creator Union Era: Collective Bargaining Goes Digital",
    dek: "Rate floors, contract templates, algorithm transparency demands — creators are organizing like the professional workforce they've become.",
    author: "Go Overseas Newsroom",
    date: "June 27, 2026",
    read: 4,
    tags: ["Creators", "Economy", "Community"],
    body: [
      "For years the creator economy had a structural oddity: a workforce of millions with no floor under it. Rates were secret, contracts were take-it-or-leave-it, and a platform policy change could erase a livelihood overnight. That era is ending — not by regulation, but by organization.",
      "Creator collectives across several countries now publish standard rate cards, share contract red-flag lists, and negotiate with brands as blocs. The largest have won concessions that individual creators never could: payment terms measured in days instead of months, kill-fee protections, and disclosure requirements when campaign briefs change.",
      "The harder fight is with platforms. Organized creators are demanding earlier notice of algorithm changes, transparent demonetization appeals, and portability of audiences — the right to take your subscriber list with you. Progress is uneven, but the asks are no longer dismissed as naive.",
      "The people behind the movement have realized something simple: the platforms need full-time creators as much as creators need platforms. Professional media has always been a negotiation. The creator economy just learned to show up to it together."
    ]
  },
  {
    id: "repair-culture",
    cat: "go-tech",
    featured: false,
    title: "Repair Culture Goes Mainstream: The Right-to-Fix Generation",
    dek: "Repair scores on price tags, parts counters in electronics shops, and a generation that treats fixing things as a flex, not a chore.",
    author: "Go Overseas Newsroom",
    date: "June 26, 2026",
    read: 4,
    tags: ["Tech", "Sustainability", "Tools & Apps"],
    body: [
      "The most telling tech trend of the year isn't a new device — it's what's happening to old ones. Repairability scores now sit next to prices in electronics shops across a growing list of countries, spare-parts counters have returned to main streets, and teardown videos rack up views that product launches would envy.",
      "Right-to-repair laws pushed the door open, requiring manufacturers to sell parts and publish manuals. But culture walked through it. A generation raised on climate anxiety and resale apps treats a repaired phone as a badge of competence, and repair cafés — volunteer-run fix-it meetups — have spread from a Dutch experiment to thousands of cities worldwide.",
      "Manufacturers are adapting in two ways: some grudgingly, shipping self-repair kits with the enthusiasm of a hostage note; others strategically, designing modular devices where upgrades snap in and marketing longevity as a premium feature. The second group is winning customers the first group considers lost.",
      "Smarter tools, simpler lives sometimes means an older tool, kept alive. The most sustainable device remains the one you already own — and for the first time in decades, the industry is being rebuilt around that fact."
    ]
  },
  {
    id: "four-day-week",
    cat: "go-business",
    featured: false,
    title: "The Four-Day Week After the Hype: What Five Years of Data Say",
    dek: "The trials ended, the spreadsheets are in. Shorter weeks survived contact with reality — with caveats the headlines skip.",
    author: "Go Overseas Newsroom",
    date: "June 25, 2026",
    read: 5,
    tags: ["Business", "Work", "Analysis"],
    body: [
      "Five years after the first large four-day-week trials made headlines, enough companies have kept — or abandoned — the model to move the conversation from ideology to evidence. The short version: it works far more often than skeptics predicted, and less universally than advocates promised.",
      "Across published trials and company reports, the pattern repeats. Knowledge-work teams typically maintain output while burnout, sick days and attrition fall — the recruiting advantage alone pays for the model in tight labor markets. The failures cluster where the work is coverage-based: support desks, clinics, logistics — where a day off the schedule is a day someone else must staff.",
      "The quiet insight from companies that made it stick: the fifth day was never the point. The redesign was — fewer meetings, sharper priorities, deeper focus blocks. Firms that cut hours without cutting waste simply compressed stress into four days and walked it back.",
      "The model is now spreading less as a banner policy and more as a negotiated norm — team by team, contract by contract, country by country. Ideas becoming opportunities rarely arrive as revolutions. They arrive as line items in an employee handbook."
    ]
  },
  {
    id: "polycentric-fashion",
    cat: "go-culture",
    featured: false,
    title: "Fashion Goes Polycentric: Lagos, Seoul and São Paulo Set the Pace",
    dek: "The old four-city calendar no longer decides what the world wears. Style's center of gravity has multiplied.",
    author: "Go Overseas Newsroom",
    date: "June 24, 2026",
    read: 4,
    tags: ["Culture", "Fashion", "Global Style"],
    body: [
      "For a century, fashion had four capitals and a calendar to match. That geography is dissolving. The shows drawing the most online attention — and increasingly the most buyers — now happen in Lagos, Seoul, São Paulo, Copenhagen and Mumbai as often as in the legacy four.",
      "The shift is structural. Social platforms broke the monopoly on visibility: a collection can now find its global audience without a Paris runway's permission. Diaspora communities amplify home-market designers across continents. And the growth markets for luxury and streetwear alike are precisely the regions the old calendar treated as customers, never creators.",
      "The creative consequences are visible on any street with good style: Nigerian tailoring vocabularies, Korean streetwear proportions and Brazilian color sensibilities cross-pollinating at the speed of a group chat. Trend forecasting agencies have quietly rebuilt their scouting maps around it.",
      "What the world is watching, it increasingly wears. Fashion's future looks less like a capital and more like a network — and the network has no head office."
    ]
  },
  {
    id: "esports-new-geography",
    cat: "go-play",
    featured: false,
    title: "Esports' New Geography: How Southeast Asia Became Competitive Play's Center",
    dek: "Mobile-first titles, packed arenas and a talent pipeline running through internet cafés — the region isn't emerging anymore. It's leading.",
    author: "Go Overseas Newsroom",
    date: "June 23, 2026",
    read: 4,
    tags: ["Gaming", "Esports", "Events"],
    body: [
      "Ask where competitive gaming's momentum lives and the honest answer has shifted: Jakarta, Manila, Ho Chi Minh City, Bangkok. Southeast Asia has moved from promising market to gravitational center — and it happened on phones.",
      "The region skipped the console-and-PC era's economics and built its competitive culture around mobile titles, where a world-class setup costs a fraction of a gaming rig. The result is the deepest talent pool in esports: hundreds of millions of players, a café-tournament pipeline that functions like grassroots football academies, and arena finals that sell out in minutes.",
      "The money followed the crowds. Regional leagues now command broadcast deals and sponsorships that rival legacy sports properties, and Western organizations open Southeast Asian academies the way football clubs scout South America.",
      "Where digital worlds move, economies move with them. The next decade of competitive play is being drafted in places the old industry maps barely labeled — which, by now, should sound familiar."
    ]
  },
  {
    id: "sleeper-train-renaissance",
    cat: "go-discover",
    featured: false,
    title: "The Sleeper Train Renaissance: A Continent Reconnects by Rail",
    dek: "New night routes are selling out across Europe and Asia as travelers trade airport hours for a bed, a window and a slower map.",
    author: "Go Overseas Newsroom",
    date: "June 22, 2026",
    read: 4,
    tags: ["Travel", "Rail", "Slow Travel"],
    body: [
      "A decade ago the night train was a nostalgia act, quietly cancelled route by route. Now new sleeper services are launching across Europe and Asia faster than operators can source carriages, and the berths sell out weeks ahead.",
      "The revival runs on three engines. Climate-conscious travelers want the flight-free option and will pay for it. Remote workers discovered that a night train is a hotel that commutes for you — board after dinner, wake up in another country, lose no working day. And rail operators finally rebuilt the product: private cabins, decent showers, booking apps that don't feel like archaeology.",
      "The map is redrawing accordingly. Routes that made no sense as day trips — Berlin to the Adriatic, night links across Scandinavia, sleeper corridors threading Southeast Asia — work beautifully at bedtime speed, and secondary cities along the lines are seeing visitors the budget-airline map never delivered.",
      "People, places and possibilities, at 90 kilometers an hour: the sleeper's real luxury was never the cabin. It is arriving somewhere new without the sky in between."
    ]
  },
  {
    id: "passport-power-shuffle",
    cat: "go-now",
    featured: false,
    title: "The Passport Power Shuffle: Mobility in a Multipolar World",
    dek: "Visa-free maps are being redrawn by trade blocs, talent wars and digital-nomad programs — and the rankings tell a bigger story than travel.",
    author: "Go Overseas Newsroom",
    date: "June 21, 2026",
    read: 5,
    tags: ["Global News", "Mobility", "Analysis"],
    body: [
      "Passport-power rankings read like a barometer of the world order, and the needle is moving. The historic gap between the strongest and weakest travel documents, after widening for decades, has begun to narrow — redrawn by regional blocs, talent shortages and a global competition for mobile spenders.",
      "The drivers are pragmatic, not sentimental. Regional agreements in Asia, Africa and the Gulf have opened visa-free corridors that would have been unthinkable a generation ago, because tourism receipts and labor mobility are easier to bank than geopolitical grudges. Aging economies short of workers are trading access for skills. And more than sixty countries now run digital-nomad or long-stay programs, courting remote earners like the export industry they effectively are.",
      "The counter-current is real: security politics still slams corridors shut on short notice, and the mobility divide remains stark — measured not only in destinations but in visa fees, appointment backlogs and the quiet indignity of proving intent to return.",
      "What matters now is that mobility has become explicit policy — a lever governments pull, not a fact of birth to accept. Where you can go is being renegotiated, in real time, on trade-bloc letterhead."
    ]
  }
];

/* Front-page trending rail — story ids, in rank order */
const GON_TRENDING = [
  "age-of-intelligence",
  "internet-never-sleeps",
  "sound-of-culture",
  "passport-power-shuffle",
  "creators-change-everything"
];

/* Magazine cover strip — mirrors the brand's cover system */
const GON_COVERS = [
  { story: "world-in-motion", issue: "Issue 01 · May 2026", coverTitle: "A World in Motion" },
  { story: "internet-never-sleeps", issue: "Issue 02 · May 2026", coverTitle: "The Internet Never Sleeps" },
  { story: "sound-of-culture", issue: "Issue 03 · May 2026", coverTitle: "The Sound of Culture" },
  { story: "age-of-intelligence", issue: "Issue 04 · May 2026", coverTitle: "The Age of Intelligence" },
  { story: "creators-change-everything", issue: "Issue 05 · May 2026", coverTitle: "Creators Change Everything" }
];

const GON_ICONS = {
  globe: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.6 3.8 5.7 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.7-3.8-9s1.3-6.4 3.8-9z"/></svg>',
  arrow: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 19L19 5M9 5h10v10"/></svg>',
  wave: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M3 10v4M7 7v10M11 4v16M15 7v10M19 10v4"/></svg>',
  chip: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><rect x="6" y="6" width="12" height="12" rx="2"/><path d="M9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3"/></svg>',
  mic: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0014 0M12 18v3"/></svg>',
  bolt: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"><path d="M13 2L4.5 13.5H11L9.5 22 19 10h-6.5L13 2z"/></svg>',
  case: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><rect x="3" y="7" width="18" height="13" rx="2"/><path d="M9 7V5a2 2 0 012-2h2a2 2 0 012 2v2M3 13h18"/></svg>',
  burst: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M12 3v18M3 12h18M5.6 5.6l12.8 12.8M18.4 5.6L5.6 18.4"/></svg>',
  play: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M10 8.5l6 3.5-6 3.5v-7z"/></svg>',
  pin: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M12 21s-7-6.1-7-11a7 7 0 0114 0c0 4.9-7 11-7 11z"/><circle cx="12" cy="10" r="2.6"/></svg>'
};
