# Apartment Bot

A Telegram bot that watches Israeli rental listing sites and messages you the moment a new
apartment matching your search appears. Same idea as dorin.app, running on your own machine.

- **Every city and town in Israel** - Tel Aviv to Kiryat Shmona to Eilat. Type any name in
  `/add` and it is searchable; big cities are read in full, not sampled.
- Reads Israel's rental boards at once - Yad2, Madlan, Realta, Homeless, OnMap, a long tail of
  smaller boards, public Telegram channels and (optionally) Facebook groups - and alerts on
  **new listings and price drops**, leading each message with the listing's photo.
- Everything is controlled from Telegram: `/add` walks you through city, rooms and budget, or
  just write what you want in a sentence. Every alert has the move-in date, a map button and
  WhatsApp when the ad gave a number.
- Remembers every listing it has ever seen, so you are never told about the same flat twice,
  and never flooded on day one.

## Setup

**1. Install dependencies** (Node 20+)

```bash
npm install
```

**2. Create your `.env`**

Copy `.env.example` to `.env` and fill in your bot token from [@BotFather](https://t.me/BotFather):

```
TELEGRAM_BOT_TOKEN=123456:ABC-DEF...
```

Leave `OWNER_CHAT_ID` empty for now. The first chat that messages the bot claims ownership and
the id is saved; everyone else is ignored without a reply. Send `/start` yourself straight
after first launch - the log line "registered bot owner" carries your `chatId` - and put it in
`.env` to lock it permanently. The owner can let friends in with `/invite`, which creates a
one-time link.

`GEMINI_API_KEY` is optional. Without it the structured sources (Yad2, Madlan, Realta,
Homeless, OnMap) work as normal and the model-read sources simply stay off. A free key from
[Google AI Studio](https://aistudio.google.com/apikey) is enough.

`SOURCES` picks which boards to read, e.g. `SOURCES=yad2,madlan`. Unset means all of them.

**3. Run it**

```bash
npm run dev
```

Message your bot `/start` in Telegram, then `/add` to create your first search.

## Commands

| Command | What it does |
| --- | --- |
| `/add` | Create a search: city → rooms → budget, then optionally streets and must-haves (חניה, מעלית, ללא תיווך, minimum m², keywords) |
| *free text* | `3 חדרים במודיעין עד 6500 בלי תיווך` - read by Gemini into a filled-in search you confirm with one tap |
| `/list` | Show saved searches |
| `/latest` | The market right now as a paged digest - exact matches, near misses, what was already sent - with a button for photo cards |
| `/remove` | Delete a search |
| `/pause` · `/resume` | Stop and restart all alerts |
| `/status` | Uptime, last cycle, per-source health |
| `/now` | Run a scan immediately |
| `/quiet 23:00-07:30` | Hold alerts overnight (`/quiet off` to disable) |
| `/invite` · `/users` | Owner only: hand out a one-time access link, see who has access |

Nothing is lost during quiet hours - listings are queued and sent when the window ends.

## Where the data comes from

No source needs an account except Facebook, and none needs a paid API. Every source sits
behind one `SourceAdapter` interface ([src/sources/](src/sources/)), so one that breaks or
blocks is isolated: you get a single "source failing" message, it backs off, and everything
else keeps running.

### Structured sources - read directly, no model

These sites already publish structured data, so each has a small hand-written parser. They are
free, exact and fast, and run every cycle.

| Source | Endpoint | How it is read | Posting date? |
| --- | --- | --- | --- |
| **Yad2** | `gw.yad2.co.il/realestate-feed/rent/feed` | The paged list the website itself calls, ordered by last update. Read from the top until a page holds nothing new (usually two pages), so a city of any size is covered in full. | ✅ recovered from photo URLs |
| **Madlan** | `www.madlan.co.il/api3` | Madlan's own GraphQL API, sorted newest-first nationwide; the city is matched after the fetch. Every 15 min. | ✅ `lastUpdated` |
| **Realta** | `realta.co.il/api/v1/search/` | Public JSON API; an aggregator of Yad2, Madlan, OnMap, Komo and Facebook Marketplace | ✅ `publishedAt` |
| **OnMap** | `phoenix.onmap.co.il/v1/properties/mixed_search` | Public JSON API; the city filter is a geographic polygon | ✅ |
| **Homeless** | `m.homeless.co.il/rent` | The mobile site, plain server-rendered HTML parsed with cheerio | - |

### Every city in Israel

Every locality Yad2 lists (1,178 at the last build) can be searched: type its name in
`/add`, or write it in a sentence. The list lives in
[cities.generated.ts](src/core/cities.generated.ts), built by `npm run build-cities` from the
official locality list on data.gov.il and Yad2's own address search, which supplies the city
and region codes its API needs. A wrong region code makes Yad2 return an empty city without
any error, so the codes are never typed by hand. Hand-kept details (other boards' city slugs,
everyday neighbourhood groupings) live in [cities.ts](src/core/cities.ts) and override the
generated entry. Regenerating is only needed when Yad2 adds a locality.

### Model-read sources - any page, no per-site parser

The long tail of Israeli boards has no API, and hand-writing a scraper for each would break on
every redesign. Instead the page is fetched, reduced to visible text plus candidate links and
images, and handed to Gemini, which returns structured listings validated with Zod. Adding a
board is a URL and a display name in [sites.ts](src/sources/generic/sites.ts); a redesign
degrades quality instead of silently returning nothing. These run hourly - about 120 model
calls a day, an eighth of the free quota.

Currently configured: **Komo**, **JAnglo**, **Anglo-Saxon**, **Homely MLS** and **Ktovet
Modi'in**.

### Free-text posts - Telegram channels and Facebook groups

Private, broker-free flats often appear here hours before any board, but as free-form Hebrew
posts. They are batched **ten posts per Gemini call**, and only posts that have never been
seen are sent, which keeps ten groups under ~100 calls a day instead of ~2,900.

- **Telegram** - public channels read through the `t.me/s/<channel>` web preview, which needs
  no account. Channels are listed per city in [channels.ts](src/sources/telegram/channels.ts);
  vet a candidate first with `npm run telegram-probe -- <channel>`. Every 20 min.
- **Facebook groups** - a real, logged-in Chrome profile driven by Playwright. Off by default;
  see [Enabling Facebook groups](#enabling-facebook-groups). Every 30 min.

Phone numbers are stripped locally before any post text reaches Google and re-attached
afterwards, so contact details never leave the machine.

### Things discovered the hard way

- **The websites are blocked; their APIs are not.** `www.yad2.co.il` answers a Radware
  challenge, and Madlan's pages and `/api2` are behind PerimeterX - yet the Yad2 gateway and
  Madlan's `/api3` both answer a plain request. Yad2 insists on `region` (omitting it is a 400)
  and on `Origin`/`Referer` headers, without which requests get captcha-banned.
- **Yad2's map endpoint caps a city at 200 ads, and not the newest.** Tel Aviv returned 188
  of its 4,769. The paged feed has them all, ordered by last update, with a bump counting as
  one: a new ad starts at the top and sinks as others are bumped, so the bot reads until a
  page shows nothing new. Yad2 ad numbers only grow, which is how a bumped ad from before a
  search began is told apart from a new one. Any query parameter beyond `region`, `city` and
  `page` gets a firewall block record instead of data, so none is ever sent.
- **Node's default TLS fingerprint is blocked by Cloudflare.** Requests go over HTTP/2 with
  Chrome's cipher ordering ([src/util/http.ts](src/util/http.ts)); without it every request
  comes back as a "Just a moment…" challenge, even with perfect browser headers.
- **Bot-challenge pages are served with HTTP 200.** The body is inspected before the status is
  trusted, and a detected block is never retried - retrying is what deepens a block. The source
  backs off exponentially instead and folds itself back in when the site lets it.
- **Homeless renders its desktop results into a JavaScript iframe**, so the adapter reads the
  mobile site, which is plain server-rendered HTML.
- **Sites only serve Israeli IPs properly** - Madlan returns nothing to datacenter IPs. Running
  on a home connection is a requirement, not a limitation.

Rejected sources, and why:

- **ad.co.il** orders its rental index by "popularity" with no working sort override, so its
  top results were ads created in **2023**. A board that cannot be asked for its newest
  listings is useless for alerting.
- **LuxuryEstate** was reachable and parsed cleanly, but every Modi'in listing it carried was
  an agency ad at the top of the market.
- **Immo Israel, data.gov.il, century21, lagur, sublet, homes.co.il** and a dozen others were
  probed and found dead, empty, or listing-free.

## How it works

```
Scheduler ──▶ PollCycle ──▶ SourceAdapter[] ──▶ filter ──▶ dedupe ──▶ Notifier ──▶ Telegram
(chained timer, (per search  (concurrent,       (price,    (seen_listings  (queued, quiet-hour
 ±20% jitter)    × city)      isolated)          rooms,     per chat)       aware)
                                                 areas, age)
```

A listing just outside your bounds - up to 10% off the price band, or half a room short or
over - is sent too, headed **🤏 כמעט מתאים** with the bound it missed. Bounds are guesses about
the market; a flagged near miss lets you correct the guess instead of never knowing.

Guards that apply to every source, each added after a live run got it wrong:

- **Posted in the last 30 days.** Where a source publishes a date it is applied directly. Most
  boards publish no date at all, so a source's whole back catalogue is seeded **silently on
  first sight** - only what appears afterwards can alert. That is what actually stopped the
  2023 listings, and it is why adding a source never floods you.
- **Residential only** - storage units, parking spaces, offices and shops are filtered out.
- **One alert per apartment.** The same flat appears on several boards, so listings are also
  fingerprinted across sources by price, rooms and size or address. The fingerprint refuses to
  merge when those fields are incomplete: a duplicate is better than a silently dropped flat.
- **No price, no alert.** "מחיר לא צוין" is almost always a broker withholding the figure.

State lives in SQLite (`better-sqlite3`, WAL mode) with append-only migrations. Per-source
cadence is stored against the clock, not counted in memory, so restarts never make a slow
source run early.

## Running it 24/7

See [ops/install-service.md](ops/install-service.md) to install it as a Windows service that
starts at boot and restarts itself if it crashes.

## Checking the sources still work

```bash
npm run probe              # every source, live, for Modi'in
npm run probe -- rishon    # another city
```

Fetches every source live and prints what came back, without touching the database or Telegram.
Run this first whenever alerts go quiet - it tells you immediately whether a site changed its
markup or started blocking you. Don't run it in a loop: repeated probing is exactly what trips
a site's rate limit.

## Tests

```bash
npm test
npm run typecheck
```

Parsers are tested against real captured responses in `test/fixtures/`, so a site changing its
markup shows up as a failing test rather than a silent empty result. Personal contact details
in the fixtures have been replaced with placeholders.

## Enabling Facebook groups

Groups are where private, broker-free flats appear first. Reading them needs your own logged-in
session, so it is off until you switch it on:

**1. Add your Gemini key** to `.env` (`GEMINI_API_KEY=…`). It turns free-text Hebrew posts
into structured listings.

**2. Log in once:**

```bash
npm run fb-login
```

A Chrome window opens against the bot's own profile in `.fb-profile/` (gitignored). Sign in by
hand - the bot never sees your password - then close the window. The script then checks the
saved session headlessly and prints **PASS** or **FAIL**, so you know before the bot does.

**3. Switch it on:** set `FACEBOOK_ENABLED=1` in `.env` and restart the bot. A profile directory
alone is not proof of a live session, so nothing runs until you say so.

**4. Check the group list** in [src/sources/facebook/fbGroups.ts](src/sources/facebook/fbGroups.ts).
The bot can only read groups your account is a member of.

Groups are read newest-first with human-paced scrolling. "Looking for a flat" posts are
recognised and dropped rather than sent as listings. If the session expires the bot sends you
one message with the command to run, backs the source off, and announces when it is back.

**Worth knowing:** automated reading is against Facebook's terms, and the risk lands on the
account you logged in with. The slow cadence and real-Chrome profile keep that risk low but
not zero.
