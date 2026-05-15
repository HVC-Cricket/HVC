import { Card, CardContent, CardHeader } from "@/components/ui/card";

export default function EditTournamentLoading() {
  return (
    <main className="flex-1 p-4 sm:p-6">
      <div className="mx-auto max-w-2xl space-y-4">
        <div className="h-4 w-24 animate-pulse rounded bg-muted" />
        <Card>
          <CardHeader className="space-y-2">
            <div className="h-6 w-44 animate-pulse rounded bg-muted" />
            <div className="h-3 w-72 max-w-full animate-pulse rounded bg-muted" />
          </CardHeader>
          <CardContent className="space-y-3">
            {Array.from({ length: 7 }).map((_, i) => (
              <div key={i} className="space-y-1.5">
                <div className="h-3 w-24 animate-pulse rounded bg-muted" />
                <div className="h-9 w-full animate-pulse rounded bg-muted" />
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
