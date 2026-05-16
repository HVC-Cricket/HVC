import { Card, CardContent, CardHeader } from "@/components/ui/card";

export default function XILoading() {
  return (
    <main className="flex-1 p-4 sm:p-6">
      <div className="mx-auto max-w-3xl space-y-4">
        <div className="h-4 w-32 animate-pulse rounded bg-muted" />
        <Card>
          <CardHeader className="space-y-2">
            <div className="h-6 w-40 animate-pulse rounded bg-muted" />
            <div className="h-3 w-56 max-w-full animate-pulse rounded bg-muted" />
          </CardHeader>
          <CardContent className="space-y-2">
            {Array.from({ length: 7 }).map((_, i) => (
              <div
                key={i}
                className="flex items-center gap-3 rounded-md border border-foreground/10 p-2.5"
              >
                <div className="size-9 animate-pulse rounded-full bg-muted" />
                <div className="flex-1 space-y-1.5">
                  <div className="h-3 w-32 animate-pulse rounded bg-muted" />
                  <div className="h-3 w-20 animate-pulse rounded bg-muted" />
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
