import Link from "next/link";

import { signOut } from "@/app/(auth)/actions";
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
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-3">
        <div className="flex min-w-0 items-center gap-3 sm:gap-6">
          <Link
            href="/"
            className="whitespace-nowrap font-semibold"
            title="HVC Tournament Scoring"
          >
            {/* Long-form brand on tablet+, abbreviated on phones so the
                nav links and user controls fit on one row at 375px. */}
            <span className="sm:hidden">HVC Scoring</span>
            <span className="hidden sm:inline">HVC Tournament Scoring</span>
          </Link>
          <nav className="flex items-center gap-3 text-sm text-muted-foreground sm:gap-4">
            <Link href="/tournaments" className="hover:text-foreground">
              Tournaments
            </Link>
            <Link href="/players" className="hover:text-foreground">
              Players
            </Link>
          </nav>
        </div>
        <nav className="flex items-center gap-2 text-sm sm:gap-3">
          {user ? (
            <>
              <Link
                href="/me"
                className="text-muted-foreground hover:text-foreground"
                title={displayName}
                aria-label={displayName}
              >
                {/* Avatar circle on phones (saves ~100px), full name on
                    tablet+. Both link to /me. */}
                <span className="flex size-7 items-center justify-center rounded-full bg-foreground/10 text-xs font-medium text-foreground sm:hidden">
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
    </header>
  );
}
