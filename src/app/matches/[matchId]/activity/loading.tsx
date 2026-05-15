import { Card, CardContent } from "@/components/ui/card";

export default function ActivityLoading() {
  return (
    <main className="flex-1 p-4 sm:p-6">
      <div className="mx-auto max-w-4xl space-y-6">
        <div className="space-y-2">
          <div className="h-4 w-32 animate-pulse rounded bg-muted" />
          <div className="h-7 w-72 animate-pulse rounded bg-muted" />
          <div className="h-3 w-96 max-w-full animate-pulse rounded bg-muted" />
        </div>
        <Card>
          <CardContent className="space-y-2 py-6">
            {Array.from({ length: 8 }).map((_, i) => (
              <div
                key={i}
                className="h-4 animate-pulse rounded bg-muted"
                style={{ width: `${100 - (i % 4) * 8}%` }}
              />
            ))}
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
