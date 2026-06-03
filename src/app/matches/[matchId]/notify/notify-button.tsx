"use client";

/* eslint-disable react-hooks/set-state-in-effect */

import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";

import { subscribePush, unsubscribePush } from "./actions";

const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;

function urlBase64ToUint8Array(b64: string) {
  const padding = "=".repeat((4 - (b64.length % 4)) % 4);
  const base64 = (b64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; ++i) out[i] = raw.charCodeAt(i);
  return out;
}

/**
 * iOS Safari only delivers web push to PWAs installed via Add to Home
 * Screen — regular Safari tabs can subscribe but never receive pushes.
 * Detect that combo so we can guide the user instead of letting them
 * subscribe into a dead end.
 */
function isIosWithoutPwa(): boolean {
  if (typeof window === "undefined" || typeof navigator === "undefined") {
    return false;
  }
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
  if (!isIOS) return false;
  const standalone =
    (navigator as Navigator & { standalone?: boolean }).standalone === true ||
    window.matchMedia("(display-mode: standalone)").matches;
  return !standalone;
}

export function NotifyButton({ matchId }: { matchId: string }) {
  const [supported, setSupported] = useState<boolean | null>(null);
  const [subscribed, setSubscribed] = useState(false);
  const [pending, setPending] = useState(false);
  const [permissionDenied, setPermissionDenied] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (
      !("serviceWorker" in navigator) ||
      !("PushManager" in window) ||
      !("Notification" in window) ||
      !VAPID_PUBLIC_KEY
    ) {
      setSupported(false);
      return;
    }

    // If the browser has already denied notification permission, surface
    // a disabled "Blocked" state instead of letting the user click into
    // a permission re-prompt that immediately returns "denied".
    if (Notification.permission === "denied") {
      setSupported(true);
      setPermissionDenied(true);
      return;
    }

    navigator.serviceWorker
      .getRegistration()
      .then((reg) => {
        // No registration means the SW isn't active — dev mode (where
        // register-sw.tsx skips registration to avoid Turbopack
        // conflicts) or a failed registration in prod. Either way,
        // `navigator.serviceWorker.ready` would hang forever on click,
        // so hide the button.
        if (!reg) {
          setSupported(false);
          return undefined;
        }
        setSupported(true);
        return reg.pushManager.getSubscription();
      })
      .then((sub) => {
        if (sub) setSubscribed(true);
      })
      .catch(() => {
        setSupported(false);
      });
  }, []);

  if (supported === false) return null;
  if (supported === null) return null; // initial render: avoid flash

  const onClick = async () => {
    setPending(true);
    try {
      const reg = await navigator.serviceWorker.ready;
      const existing = await reg.pushManager.getSubscription();

      // Unsubscribe path
      if (subscribed && existing) {
        const endpoint = existing.endpoint;
        await existing.unsubscribe();
        const result = await unsubscribePush({ matchId, endpoint });
        if (!result.ok) throw new Error(result.error);
        setSubscribed(false);
        toast.success("Notifications turned off for this match");
        return;
      }

      // iOS without PWA install: web push won't be delivered. Guide the
      // user before kicking off the permission flow.
      if (isIosWithoutPwa()) {
        toast.error(
          "On iPhone/iPad, tap Share → Add to Home Screen first, then open the app from your home screen and try again.",
        );
        return;
      }

      // Subscribe path
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        if (permission === "denied") setPermissionDenied(true);
        toast.error("Notifications blocked. Allow them in browser settings.");
        return;
      }

      const sub =
        existing ??
        (await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY!),
        }));

      const json = sub.toJSON();
      const p256dh = json.keys?.p256dh;
      const authKey = json.keys?.auth;
      if (!p256dh || !authKey) {
        throw new Error("Browser didn't return push keys");
      }

      const result = await subscribePush({
        matchId,
        endpoint: sub.endpoint,
        p256dh,
        auth: authKey,
      });
      if (!result.ok) throw new Error(result.error);
      setSubscribed(true);
      toast.success("You'll get alerts for this match");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Couldn't set up notifications";
      toast.error(msg);
    } finally {
      setPending(false);
    }
  };

  if (permissionDenied) {
    return (
      <Button
        variant="ghost"
        size="sm"
        disabled
        title="Notifications are blocked in your browser settings. Allow them there to re-enable."
      >
        🔕 Blocked
      </Button>
    );
  }

  return (
    <Button
      variant={subscribed ? "secondary" : "outline"}
      size="sm"
      onClick={onClick}
      disabled={pending}
    >
      {subscribed ? "🔔 Notifications on" : "🔔 Notify me"}
    </Button>
  );
}
