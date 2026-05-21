import Link from "next/link";

import { signOut } from "@/app/(auth)/actions";
import { SiteNavDrawer } from "@/components/site-nav-drawer";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/server";

/**
 * Top bar: hamburger (opens `SiteNavDrawer`) on the left, brand link
 * next to it, theme toggle on the far right. Guests also get a
 * "Sign in" button next to the toggle so the auth entry point isn't
 * hidden two clicks deep inside the drawer. Every other nav link —
 * Tournaments, Players, /me, Sign out — still lives in the drawer.
 * Same layout on mobile and desktop.
 */
export async function SiteNav() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const displayName = user?.user_metadata?.display_name ?? user?.email ?? "?";
  const initial = displayName.slice(0, 1).toUpperCase();

  // Super-admin flag drives the optional "Admin" link in the drawer.
  // One extra single-row query per nav render — cheap, and avoids
  // prop-drilling the profile through every layout.
  let isSuperAdmin = false;
  if (user) {
    const { data } = await supabase
      .from("profiles")
      .select("is_super_admin")
      .eq("id", user.id)
      .maybeSingle();
    isSuperAdmin = data?.is_super_admin === true;
  }

  return (
    // Light theme picks up the medium-purple wash from `--primary`;
    // dark theme hardcodes the OLD blue-tinted dark background so
    // the bar is explicitly excluded from the dark purple palette
    // (per the design ask) and stays visually identical to before.
    // Underscores in the arbitrary value stand in for spaces inside
    // the `oklch(...)` literal — Tailwind's parser requires that.
    <header className="border-b border-foreground/10 bg-primary text-primary-foreground dark:bg-[oklch(0.16_0.012_260)] dark:text-[oklch(0.98_0.005_260)]">
      <div className="mx-auto flex max-w-5xl items-center gap-2 px-3 py-2.5 sm:px-4 sm:py-3">
        <SiteNavDrawer
          user={user ? { displayName, initial, isSuperAdmin } : null}
          signOutAction={signOut}
        />
        <Link
          href="/"
          prefetch
          className="whitespace-nowrap text-base font-semibold sm:text-lg"
          title="HVC Heroes"
        >
          HVC Heroes
        </Link>
        <div className="ml-auto flex items-center gap-1">
          {!user && (
            <Link href="/login" prefetch>
              {/* Outline button overridden so it reads against the
                  purple bar in light mode and the cricket-blue dark
                  bar in dark mode. Matches the drawer's Sign-out
                  button styling for consistency. */}
              <Button
                size="sm"
                variant="outline"
                className="border-primary-foreground/30 bg-transparent text-primary-foreground hover:bg-primary-foreground/10 hover:text-primary-foreground dark:border-[oklch(1_0_0/15%)] dark:bg-transparent dark:text-[oklch(0.98_0.005_260)] dark:hover:bg-[oklch(1_0_0/8%)] dark:hover:text-[oklch(0.98_0.005_260)]"
              >
                Sign in
              </Button>
            </Link>
          )}
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
