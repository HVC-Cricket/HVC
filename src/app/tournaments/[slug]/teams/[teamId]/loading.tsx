import { Card, CardContent, CardHeader } from "@/components/ui/card";

export default function TeamDetailLoading() {
  return (
    <main className="flex-1 p-4 sm:p-6">
      <div className="mx-auto max-w-3xl space-y-5">
        <div className="h-4 w-32 animate-pulse rounded bg-muted" />
        <div className="flex items-start gap-4">
          <div className="size-14 animate-pulse rounded-md bg-muted" />
          <div className="space-y-2">
            <div className="h-7 w-44 animate-pulse rounded bg-muted" />
            <div className="h-3 w-16 animate-pulse rounded bg-muted" />
          </div>
        </div>
        <Card>
          <CardHeader>
            <div className="h-4 w-32 animate-pulse rounded bg-muted" />
          </CardHeader>
          <CardContent className="space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <div
                key={i}
                className="h-10 w-full animate-pulse rounded bg-muted"
              />
            ))}
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
