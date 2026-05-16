import Link from "next/link";

import { signOut } from "@/app/(auth)/actions";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/server";

export async function SiteNav() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const displayName = user?.user_metadata?.display_name ?? user?.email ?? "?";
  const initial = displayName.slice(0, 1).toUpperCase();

  return (
    <header className="border-b border-foreground/10">
      <div className="mx-auto max-w-5xl px-4 py-2.5 sm:py-3">
        {/* Row 1: brand on left, user controls on right.
            On phones the nav links wrap to a second row below. */}
        <div className="flex items-center justify-between gap-3">
          <Link
            href="/"
            prefetch
            className="whitespace-nowrap text-base font-semibold sm:text-lg"
            title="HVC Tournament Scoring"
          >
            <span className="sm:hidden">HVC Scoring</span>
            <span className="hidden sm:inline">HVC Tournament Scoring</span>
          </Link>
          <nav className="hidden flex-1 items-center gap-4 px-6 text-sm text-muted-foreground sm:flex">
            <Link
              href="/tournaments"
              prefetch
              className="hover:text-foreground"
            >
              Tournaments
            </Link>
            <Link href="/players" prefetch className="hover:text-foreground">
              Players
            </Link>
          </nav>
          <nav className="flex items-center gap-1 text-sm sm:gap-2">
            <ThemeToggle />
            {user ? (
              <>
                <Link
                  href="/me"
                  prefetch
                  className="text-muted-foreground hover:text-foreground"
                  title={displayName}
                  aria-label={displayName}
                >
                  <span className="flex size-7 items-center justify-center rounded-full bg-primary/15 text-xs font-medium text-primary sm:hidden">
                    {initial}
                  </span>
                  <span className="hidden sm:inline">{displayName}</span>
                </Link>
                <form action={signOut}>
                  <Button type="submit" variant="ghost" size="sm">
                    Sign out
                  </Button>
                </form>
              </>
            ) : (
              <Link href="/login">
                <Button size="sm">Sign in</Button>
              </Link>
            )}
          </nav>
        </div>
        {/* Row 2: nav links on phones only. Always rendered so signed-
            out spectators on mobile still have a way to reach the
            tournament + player browse pages. */}
        <nav className="mt-2 flex items-center gap-5 text-sm text-muted-foreground sm:hidden">
          <Link href="/tournaments" prefetch className="hover:text-foreground">
            Tournaments
          </Link>
          <Link href="/players" prefetch className="hover:text-foreground">
            Players
          </Link>
        </nav>
      </div>
    </header>
  );
}
