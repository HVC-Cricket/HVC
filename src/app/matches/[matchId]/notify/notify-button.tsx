"use client";

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

export function NotifyButton({ matchId }: { matchId: string }) {
  const [supported, setSupported] = useState<boolean | null>(null);
  const [subscribed, setSubscribed] = useState(false);
  const [pending, setPending] = useState(false);

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
    setSupported(true);

    navigator.serviceWorker
      .getRegistration()
      .then((reg) => reg?.pushManager.getSubscription())
      .then((sub) => setSubscribed(!!sub))
      .catch(() => {
        /* if the SW isn't registered yet, treat as not subscribed */
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

      // Subscribe path
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
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
