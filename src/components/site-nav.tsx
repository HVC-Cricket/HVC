import Link from "next/link";

import { signOut } from "@/app/(auth)/actions";
import { SiteNavDrawer } from "@/components/site-nav-drawer";
import { ThemeToggle } from "@/components/theme-toggle";
import { createClient } from "@/lib/supabase/server";

/**
 * Top bar: hamburger (opens `SiteNavDrawer`) on the left, brand link
 * next to it, theme toggle on the far right. Every nav link —
 * Tournaments, Players, /me, Sign out — lives in the drawer. Same
 * layout on mobile and desktop.
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
    <header className="border-b border-foreground/10">
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
        <div className="ml-auto">
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
