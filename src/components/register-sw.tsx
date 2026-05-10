"use client";

import { useEffect } from "react";

/**
 * Registers the service worker on first load. Production-only — in dev,
 * Next 16 + Turbopack's HMR doesn't play well with a SW intercepting
 * requests. Mount this once in the root layout.
 */
export function RegisterSW() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;

    const onLoad = () => {
      navigator.serviceWorker
        .register("/sw.js", { scope: "/" })
        .catch((err) => {
          // Log to console; we don't want to surface SW failures to users.
          console.error("[hvc-scoring] SW registration failed:", err);
        });
    };

    if (document.readyState === "complete") onLoad();
    else window.addEventListener("load", onLoad, { once: true });
  }, []);

  return null;
}
