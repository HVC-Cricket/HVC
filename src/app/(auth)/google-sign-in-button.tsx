"use client";

import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";

/**
 * "Continue with Google" button used on the login + signup screens.
 *
 * Flow:
 *   1. We call supabase.auth.signInWithOAuth on the client.
 *   2. The browser is redirected to Google's account picker.
 *   3. Google sends the user back to Supabase
 *      (https://<project>.supabase.co/auth/v1/callback).
 *   4. Supabase verifies the code + sets cookies, then redirects
 *      to our `redirectTo` which is /auth/callback?code=... on our
 *      app origin.
 *   5. Our /auth/callback route exchanges the code for a session and
 *      sends the user to /me.
 *
 * If the user is brand new, the existing `handle_new_user` trigger
 * on auth.users automatically creates their `profiles` row using
 * Google's `name` metadata as the display name.
 */
export function GoogleSignInButton() {
  const [pending, setPending] = useState(false);

  const onClick = async () => {
    setPending(true);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
      },
    });
    if (error) {
      setPending(false);
      toast.error(error.message);
    }
    // On success the browser navigates away to Google, so we don't
    // bother clearing the pending state.
  };

  return (
    <Button
      type="button"
      variant="outline"
      className="w-full"
      onClick={onClick}
      disabled={pending}
    >
      <GoogleLogo className="mr-2 size-4" />
      {pending ? "Redirecting…" : "Continue with Google"}
    </Button>
  );
}

/**
 * Inline Google "G" mark so we don't need a separate dependency or
 * remote image. Colours kept as-is per Google's brand guidelines.
 */
function GoogleLogo({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 48 48"
      aria-hidden="true"
    >
      <path
        fill="#FFC107"
        d="M43.611 20.083H42V20H24v8h11.303c-1.649 4.657-6.08 8-11.303 8-6.627 0-12-5.373-12-12s5.373-12 12-12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 12.955 4 4 12.955 4 24s8.955 20 20 20 20-8.955 20-20c0-1.341-.138-2.65-.389-3.917z"
      />
      <path
        fill="#FF3D00"
        d="M6.306 14.691l6.571 4.819C14.655 15.108 18.961 12 24 12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 16.318 4 9.656 8.337 6.306 14.691z"
      />
      <path
        fill="#4CAF50"
        d="M24 44c5.166 0 9.86-1.977 13.409-5.192l-6.19-5.238A11.91 11.91 0 0 1 24 36c-5.202 0-9.619-3.317-11.283-7.946l-6.522 5.025C9.505 39.556 16.227 44 24 44z"
      />
      <path
        fill="#1976D2"
        d="M43.611 20.083H42V20H24v8h11.303a12.04 12.04 0 0 1-4.087 5.571l.003-.002 6.19 5.238C36.971 39.205 44 34 44 24c0-1.341-.138-2.65-.389-3.917z"
      />
    </svg>
  );
}
