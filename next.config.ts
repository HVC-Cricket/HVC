import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Allow the dev server's HMR / static-chunk endpoints to be reached
  // from LAN IPs (so the scoring app is testable from a phone on the
  // same Wi-Fi). Without this, Next.js 15+ blocks any request to
  // `_next/*` from a non-localhost host and JS hydration breaks —
  // the login form then "does nothing" on mobile because the React
  // handlers never wire up, the form falls back to a native POST,
  // and the page just reloads cleared.
  allowedDevOrigins: ["192.168.31.169"],
  // Allow Server Actions to be called from LAN IPs in dev too. The
  // default origin check otherwise silently rejects any POST whose
  // Origin doesn't match the deployment URL.
  experimental: {
    serverActions: {
      allowedOrigins: [
        "localhost:3000",
        "localhost:3001",
        "192.168.31.169:3000",
        "192.168.31.169:3001",
      ],
    },
  },
};

export default nextConfig;
