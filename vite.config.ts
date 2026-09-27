import { reactRouter } from "@react-router/dev/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tailwindcss(), reactRouter(), tsconfigPaths()],
  // Find and bundle every dependency when the dev server starts, not when the
  // first page asks for it. Otherwise Vite re-bundles mid-load on a fresh
  // server, the page gets two copies of React, and the first thing anyone sees
  // is "Cannot read properties of null (reading 'useEffect')".
  optimizeDeps: {
    entries: ["./app/**/*.{ts,tsx}", "!./app/**/*.test.{ts,tsx}"],
  },
  server: {
    // The app runs behind Extend's edge proxy on an arbitrary hostname, so bind
    // on all interfaces and accept any Host header. Do not add X-Frame-Options or
    // CSP frame-ancestors here: the edge proxy owns framing headers.
    host: "0.0.0.0",
    port: 3000,
    strictPort: true,
    allowedHosts: true,
    // Files Extend rewrites (the managed docs, logs, the jobs manifest) aren't
    // part of the app: don't reload the page when they change.
    watch: {
      ignored: ["**/CLAUDE.md", "**/docs/**", "**/.extend-logs/**", "**/extend.json"],
    },
    // Transform the entry and routes up front, so the first page is quick.
    warmup: {
      clientFiles: ["./app/root.tsx", "./app/routes/**/*.tsx"],
    },
  },
});
