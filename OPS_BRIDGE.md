# Ops bridge

A read-only JSON surface the **Sales CRM** (`LPGP-CRM`) calls server-to-server to
answer one question:

> Does this company already exist as a deal here, and which events is it
> sponsoring?

Nothing in `bridge.js` mutates the tracker.

## Enabling it

Set one environment variable on this app:

```bash
openssl rand -hex 32     # generate a secret
```

| Variable | Value |
| --- | --- |
| `OPS_BRIDGE_KEY` | The secret. Set the **same value** on the sales CRM. |

Unset, every bridge route returns `503` and the CRM hides its ops features.

## Auth

Send the secret as `x-ops-key` (or `Authorization: Bearer …`). It's compared over
SHA-256 digests so the check is timing-safe for unequal-length inputs. These
routes deliberately do **not** use the admin session cookie — the caller is
another server, not a browser.

## Routes

| Route | Returns |
| --- | --- |
| `GET /api/bridge/ping` | Handshake + deal/event/allocation counts |
| `GET /api/bridge/match?name=Barings` | Scored company matches with their event allocations |
| `GET /api/bridge/companies[?slim=1]` | Every company with deals, grouped |
| `GET /api/bridge/events` | Portfolio events with allocated and paid revenue |
| `GET /api/bridge/events/:id/sponsors` | Who's sponsoring one event, and for how much |
| `GET /api/bridge/deals/:id` | One deal in full |

## How matching works

Company names are grouped in JS over a single query rather than via `pg_trgm`,
so it works on any Neon branch without an extension. Scoring is tiered so an
exact hit never loses to a fuzzy one:

| Tier | Score | Example |
| --- | --- | --- |
| Identical once normalised | `1.00` | `Kirkland and Ellis` ↔ `Kirkland & Ellis` |
| Same with legal suffixes stripped | `0.96` | `Barings` ↔ `Barings LLC` |
| Prefix, meaningful share of the name | `0.88` / `0.78` | `Barings` ↔ `Barings Real Estate` |
| Substring (5+ chars) | `0.72` | |
| Token overlap | `≤ 0.75` | |

Only legal-entity suffixes (`ltd`, `llc`, `gmbh`, …) are stripped. Words like
*Capital* and *Partners* are kept deliberately — stripping them would collapse
`Apollo Global Management` and `Apollo Capital` into one match.

`Barings` vs `BlackRock` scores `0`.

## Money

Totals are returned **per currency**, never cross-summed — the tracker holds
GBP, USD, EUR and CHF deals. Cancelled deals are excluded from totals and
counted separately.

## Tests

```bash
npm test
```

Runs the bridge against a stubbed database: the auth guard, the grouping, the
match tiers, per-currency totals and every payload shape — no Postgres needed.
