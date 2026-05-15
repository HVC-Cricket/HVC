export default function HomeLoading() {
  return (
    <main className="flex-1 p-4 sm:p-6">
      <div className="mx-auto max-w-3xl space-y-8">
        {/* Hero */}
        <header className="relative overflow-hidden rounded-2xl border border-primary/15 bg-gradient-to-br from-primary/10 via-primary/5 to-transparent p-5 sm:p-7">
          <div className="h-8 w-72 animate-pulse rounded bg-muted sm:h-10" />
          <div className="mt-2 h-4 w-80 animate-pulse rounded bg-muted" />
        </header>

        {/* Live now section */}
        <section className="space-y-3">
          <div className="flex items-center gap-2">
            <span className="size-2.5 rounded-full bg-destructive/60" />
            <div className="h-3 w-20 animate-pulse rounded bg-muted" />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <LiveCardSkeleton />
            <LiveCardSkeleton />
          </div>
        </section>

        {/* Up next section */}
        <section className="space-y-3">
          <div className="h-3 w-24 animate-pulse rounded bg-muted" />
          <div className="space-y-2">
            <RowSkeleton />
            <RowSkeleton />
          </div>
        </section>
      </div>
    </main>
  );
}

function LiveCardSkeleton() {
  return (
    <div className="flex flex-col overflow-hidden rounded-xl border border-foreground/10 bg-background shadow-sm">
      <div className="flex items-center justify-between gap-2 border-b border-foreground/5 bg-destructive/5 px-3 py-1.5">
        <div className="h-3 w-12 animate-pulse rounded bg-muted" />
        <div className="h-3 w-24 animate-pulse rounded bg-muted" />
      </div>
      <div className="space-y-3 px-3 py-3">
        <TeamLineSkeleton />
        <TeamLineSkeleton />
      </div>
      <div className="h-10 animate-pulse bg-destructive/40" />
    </div>
  );
}

function TeamLineSkeleton() {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex min-w-0 items-center gap-2.5">
        <div className="size-8 shrink-0 animate-pulse rounded-full bg-muted" />
        <div className="space-y-1.5">
          <div className="h-3.5 w-28 animate-pulse rounded bg-muted" />
          <div className="h-2.5 w-10 animate-pulse rounded bg-muted" />
        </div>
      </div>
      <div className="space-y-1">
        <div className="h-5 w-14 animate-pulse rounded bg-muted" />
        <div className="ml-auto h-2.5 w-8 animate-pulse rounded bg-muted" />
      </div>
    </div>
  );
}

function RowSkeleton() {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-foreground/10 bg-background px-3 py-2.5">
      <div className="size-6 animate-pulse rounded-full bg-muted" />
      <div className="h-3 w-8 animate-pulse rounded bg-muted" />
      <div className="size-6 animate-pulse rounded-full bg-muted" />
      <div className="ml-auto space-y-1.5">
        <div className="h-3 w-20 animate-pulse rounded bg-muted" />
        <div className="ml-auto h-2.5 w-16 animate-pulse rounded bg-muted" />
      </div>
    </div>
  );
}
