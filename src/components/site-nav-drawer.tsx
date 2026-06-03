"use client";

/* eslint-disable react-hooks/set-state-in-effect */

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, X } from "lucide-react";

import { Button } from "@/components/ui/button";

type SignOutAction = () => Promise<void>;

type Props = {
  user: {
    displayName: string;
    initial: string;
    isSuperAdmin: boolean;
  } | null;
  signOutAction: SignOutAction;
};

/**
 * Hamburger-triggered side drawer holding every top-level nav link.
 * The top bar (`SiteNav`) renders just the hamburger + brand; this
 * component owns the drawer chrome + open/close behaviour. Works
 * identically on mobile and desktop — no breakpoint-specific code.
 */
export function SiteNavDrawer({ user, signOutAction }: Props) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  // Auto-close when the route changes (e.g. user taps a link inside
  // the drawer and Next.js navigates).
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  // Lock body scroll + escape-to-close while the drawer is open.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const navLink = (href: string, label: string) => (
    <Link
      href={href}
      prefetch
      onClick={() => setOpen(false)}
      className={
        // Light theme: drawer body is white, so links use the
        // standard foreground/muted-foreground palette with a muted
        // hover/active wash. Dark theme keeps the original
        // muted-on-background palette.
        "rounded-md px-3 py-2 text-sm transition hover:bg-muted dark:hover:bg-muted " +
        (pathname?.startsWith(href)
          ? "bg-muted font-medium text-foreground dark:bg-muted dark:text-foreground"
          : "text-muted-foreground dark:text-muted-foreground")
      }
    >
      {label}
    </Link>
  );

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label="Open menu"
        onClick={() => setOpen(true)}
      >
        <Menu className="size-5" />
      </Button>
      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Site navigation"
          className="fixed inset-0 z-50 bg-black/50"
          onClick={() => setOpen(false)}
        >
          <aside
            // Light theme: white drawer body; only the top header
            // row keeps the medium-purple wash (see below). Dark
            // theme hardcodes the OLD cricket-blue dark background +
            // foreground so the drawer is explicitly excluded from
            // the dark purple palette per the design ask — visually
            // identical to the pre-purple dark UI.
            className="fixed inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col bg-background text-foreground shadow-xl dark:bg-[oklch(0.16_0.012_260)] dark:text-[oklch(0.98_0.005_260)]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-primary-foreground/15 bg-primary px-4 py-3 text-primary-foreground dark:border-foreground/10 dark:bg-transparent dark:text-[oklch(0.98_0.005_260)]">
              <Link
                href="/"
                onClick={() => setOpen(false)}
                className="text-base font-semibold"
              >
                HVC Heroes
              </Link>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="Close menu"
                onClick={() => setOpen(false)}
              >
                <X className="size-5" />
              </Button>
            </div>

            {user && (
              <div className="flex items-center gap-3 border-b border-border px-4 py-3 dark:border-foreground/10">
                <span className="flex size-9 items-center justify-center rounded-full bg-primary/15 text-sm font-medium text-primary dark:bg-primary/15 dark:text-primary">
                  {user.initial}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">
                    {user.displayName}
                  </div>
                  <Link
                    href="/me"
                    prefetch
                    onClick={() => setOpen(false)}
                    className="text-xs text-muted-foreground hover:text-foreground dark:text-muted-foreground dark:hover:text-foreground"
                  >
                    View profile
                  </Link>
                </div>
              </div>
            )}

            <nav className="flex flex-1 flex-col gap-1 overflow-y-auto px-2 py-3">
              {navLink("/tournaments", "Tournaments")}
              {navLink("/players", "Players")}
              {navLink("/stats", "Leaderboard")}
              {user && navLink("/me", "My profile")}
              {user?.isSuperAdmin && navLink("/admins", "Admin")}
            </nav>

            <div className="space-y-2 border-t border-border p-3 dark:border-foreground/10">
              {user ? (
                <form action={signOutAction}>
                  <Button
                    type="submit"
                    variant="outline"
                    size="sm"
                    className="w-full"
                  >
                    Sign out
                  </Button>
                </form>
              ) : (
                <Link
                  href="/login"
                  onClick={() => setOpen(false)}
                  className="block"
                >
                  <Button size="sm" className="w-full">
                    Sign in
                  </Button>
                </Link>
              )}
            </div>
          </aside>
        </div>
      )}
    </>
  );
}
