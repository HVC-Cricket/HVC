"use client";

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
        "rounded-md px-3 py-2 text-sm transition hover:bg-muted " +
        (pathname?.startsWith(href)
          ? "bg-muted font-medium text-foreground"
          : "text-muted-foreground")
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
            className="fixed inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col bg-background shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-foreground/10 px-4 py-3">
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
              <div className="flex items-center gap-3 border-b border-foreground/10 px-4 py-3">
                <span className="flex size-9 items-center justify-center rounded-full bg-primary/15 text-sm font-medium text-primary">
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
                    className="text-xs text-muted-foreground hover:text-foreground"
                  >
                    View profile
                  </Link>
                </div>
              </div>
            )}

            <nav className="flex flex-1 flex-col gap-1 overflow-y-auto px-2 py-3">
              {navLink("/tournaments", "Tournaments")}
              {navLink("/players", "Players")}
              {user && navLink("/me", "My profile")}
            </nav>

            <div className="space-y-2 border-t border-foreground/10 p-3">
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
