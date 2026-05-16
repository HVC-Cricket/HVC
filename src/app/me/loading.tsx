import { Card, CardContent, CardHeader } from "@/components/ui/card";

export default function MeLoading() {
  return (
    <main className="flex-1 p-4 sm:p-6">
      <div className="mx-auto w-full max-w-2xl space-y-5">
        <Card>
          <CardContent className="flex items-center gap-4 py-5">
            <div className="size-14 animate-pulse rounded-full bg-muted" />
            <div className="flex-1 space-y-2">
              <div className="h-5 w-40 animate-pulse rounded bg-muted" />
              <div className="h-3 w-56 max-w-full animate-pulse rounded bg-muted" />
              <div className="h-3 w-24 animate-pulse rounded bg-muted" />
            </div>
          </CardContent>
        </Card>
        {Array.from({ length: 2 }).map((_, i) => (
          <Card key={i}>
            <CardHeader>
              <div className="h-4 w-40 animate-pulse rounded bg-muted" />
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="h-10 w-full animate-pulse rounded bg-muted" />
            </CardContent>
          </Card>
        ))}
      </div>
    </main>
  );
}
