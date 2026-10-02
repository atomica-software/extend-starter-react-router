# Extend starter: React Router v7

The default starter template for Contactzilla Extend apps. It's an internal tool
for a Contactzilla team, shown in an iframe inside Contactzilla and served
behind the stack's `edge` proxy.

React Router v7 (framework mode, SSR), TypeScript (strict), Tailwind CSS v4,
Drizzle ORM on Postgres, and Vitest.

## Layout

```
.extend/manifest.json      Template contract: commands, port, health path (managed)
CLAUDE.md, docs/           Installed by the stack on first boot (managed; not in this repo)
react-router.config.ts     SSR on, v8 future flags on
vite.config.ts             Dev server on 0.0.0.0:3000, any Host allowed (behind a proxy)
drizzle.config.ts          Drizzle Kit: schema app/db/schema.ts → app/db/migrations
app/
  root.tsx                 HTML shell; root loader exposes CZ_PUBLIC_URL for the bridge
  routes.ts                Explicit route config (index = `/`, the app's main screen)
  routes/_index.tsx        The app's main screen at `/`: a demo page until the app replaces it
  routes/_app.health.ts    GET /_app/health → {"status":"ok"}
  lib/viewer.server.ts     getViewer / requireViewer from X-CZ-* headers
  lib/cz.server.ts         cz(viewer): typed Contactzilla client, appAddressBooks(), contactMobileE164() (server-only)
  lib/contacts.ts          readContact(), customField(), samePhone(): reading contact fields
  lib/messaging.server.ts  sendSms(), replies and delivery reports (Twilio), with an outbox
  lib/extend-sdk.ts        postMessage bridge to the Contactzilla parent window
  db/schema.ts             Drizzle tables (none yet)
  db/client.server.ts      getDb(): lazily created Drizzle client
  db/migrations/           Generated SQL migrations (commit them)
  db/seeds/                Example data: *.sql applied once per database by db:migrate
scripts/migrate.mjs        Applies migrations, then example data not applied yet (scripts/seeds.mjs)
tests/                     Vitest unit tests
```

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Dev server with hot reload on `0.0.0.0:3000` (Preview) |
| `npm run build` | Production build into `build/` |
| `npm start` | Serves the build with `react-router-serve` on `$PORT` (default 3000), all interfaces (Live) |
| `npm run check` | Route typegen + `tsc` |
| `npm test` | Vitest |
| `npm run db:generate` | Generate a migration from `app/db/schema.ts` |
| `npm run db:migrate` | Apply migrations, then new `app/db/seeds/*.sql`, to `DATABASE_URL` |

## Conventions

- **Who is the user?** Call `getViewer(request)` or `requireViewer(request)` in a
  loader or action. The edge proxy sets `X-CZ-User-Id`, `-Name`, `-Email`,
  `X-CZ-Team` (team slug) and `X-CZ-Role` (`admin | member | restricted`) after
  authenticating the viewer, and signs them with the environment's
  `EXTEND_IDENTITY_KEY`; `getViewer` only trusts them when the signature checks
  out (anything else that can reach the app could send the headers). Don't build
  a login.
- **Calling Contactzilla.** Only from server code (loaders and actions), with
  `cz(viewer)` from `app/lib/cz.server.ts`: the typed
  [`@atomica-software/contactzilla`](https://www.npmjs.com/package/@atomica-software/contactzilla)
  client, set up to call `CZ_API_BASE`, a proxy that adds credentials, so never
  store an API key. Passing the viewer lets the proxy record who acted. The API
  reference is in `docs/contactzilla-api.md`; the live OpenAPI document is at
  `$CZ_API_BASE/openapi.json`.
- **Other services** (Google, Slack, Xero…). Extend Connect runs the OAuth
  sign-in and keeps tokens, encrypted, in the `oauth_tokens` table. Use
  `app/lib/connect.server.ts` on the server and `ConnectButton` in the page;
  `.extend/connect.json` says which providers are set up.
- **Not connected.** When the proxy says `cz_not_connected`, the client throws
  `CzNotConnectedError`. Show "Contactzilla isn't connected — ask an admin to
  reconnect from the Builder console". Other failures throw `CzApiError`
  (`status`, `code`, `message`). Calls outside the team get `403 outside_team`.
- **Talking to the parent window.** `useExtendSdk()` gives you `openContact`,
  `toast`, `resize` and `onTheme`. Messages are origin-checked against
  `CZ_PUBLIC_URL`, and they do nothing outside an iframe. Dark mode follows
  Contactzilla through `cz.theme`, which toggles `class="dark"` on `<html>`, so
  use Tailwind's `dark:` variants.
- **Data.** Put tables in `app/db/schema.ts`, run `npm run db:generate`, commit
  the migration, and apply it with `npm run db:migrate`. Use `getDb()` from
  `app/db/client.server.ts`.
- **Headers.** Don't set `X-Frame-Options` or CSP `frame-ancestors`. The edge
  proxy owns them.
- **Managed files.** `CLAUDE.md`, `docs/` and `.extend/` are overwritten when
  the stack upgrades. Don't edit them.

## Environment

| Variable | Used for |
|---|---|
| `PORT` | Listen port (3000) |
| `CZ_API_BASE` | Contactzilla proxy, e.g. `http://control:8080/cz` |
| `CZ_API_HOST` | The Contactzilla the stack belongs to, for links to its pages (`czHost()`) |
| `CZ_PUBLIC_URL` | Contactzilla origin for the postMessage bridge (`czPublicUrl()`; falls back to `CZ_API_HOST`, then `https://contactzilla.app`) |
| `DATABASE_URL` | The app's Postgres database |

To run it locally without the proxy, tell it to trust the identity headers you
send (never set this on a server anything else can reach):

```sh
EXTEND_TRUST_IDENTITY_HEADERS=1 CZ_API_BASE=http://localhost:8080/cz npm run dev
curl -H 'X-CZ-User-Id: 1' -H 'X-CZ-Team: acme' -H 'X-CZ-Role: admin' http://localhost:3000/
```
