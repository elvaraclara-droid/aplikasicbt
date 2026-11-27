"use client";

import { useEffect } from "react";

/**
 * Registers the CBT static-asset service worker cleanly without caching dynamic exam APIs.
 */
export function PwaRegistrar() {
  useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) {
      return;
    }

    navigator.serviceWorker
      .register("/sw.js", { scope: "/" })
      .catch(() => {
        // Ignore registration issues in restricted WebViews or private browsing modes
      });
  }, []);

  return null;
}
