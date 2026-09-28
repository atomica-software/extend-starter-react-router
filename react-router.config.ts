import type { Config } from "@react-router/dev/config";

export default {
  // Server-side rendering on: loaders/actions run on the server, which is where
  // all Contactzilla calls must happen (see app/lib/cz.server.ts).
  ssr: true,
  // Form posts/actions from the browser carry the public edge host in their Origin header
  // (app.… / preview.…), which differs from the internal URL the app server sees. Without
  // this, React Router's CSRF check rejects every action with 400 "Bad Request".
  // Each environment accepts its own host only: a page in the Preview must never be
  // able to post to Live as the admin viewing it.
  allowedActionOrigins: (process.env.EXTEND_ENV === "live"
    ? [process.env.EXTEND_APP_HOST]
    : process.env.EXTEND_ENV === "preview"
      ? [process.env.EXTEND_PREVIEW_HOST]
      : [process.env.EXTEND_APP_HOST, process.env.EXTEND_PREVIEW_HOST]
  ).filter((h): h is string => Boolean(h)),
  // Opt in to React Router v8 behaviour now so upgrading later is a no-op.
  future: {
    v8_middleware: true,
    v8_splitRouteModules: true,
    v8_viteEnvironmentApi: true,
    v8_passThroughRequests: true,
    v8_trailingSlashAwareDataRequests: true,
  },
} satisfies Config;
