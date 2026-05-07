import Link from "next/link";

import { signOut } from "@/app/(auth)/actions";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/server";

export async function SiteNav() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <header className="border-b border-foreground/10">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
        <div className="flex items-center gap-6">
          <Link href="/" className="font-semibold">
            HVC Scoring
          </Link>
          <nav className="hidden items-center gap-4 text-sm text-muted-foreground sm:flex">
            <Link href="/tournaments" className="hover:text-foreground">
              Tournaments
            </Link>
            <Link href="/players" className="hover:text-foreground">
              Players
            </Link>
          </nav>
        </div>
        <nav className="flex items-center gap-3 text-sm">
          {user ? (
            <>
              <Link
                href="/me"
                className="text-muted-foreground hover:text-foreground"
              >
                {user.user_metadata?.display_name ?? user.email}
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
