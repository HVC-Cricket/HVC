import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export default function Home() {
  return (
    <main className="flex-1 flex items-center justify-center p-6">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>HVC Scoring</CardTitle>
          <CardDescription>
            Box-cricket tournament — live scoring & spectator view
          </CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground space-y-2">
          <p>
            App scaffold only. Auth, tournaments, matches, and scoring screens
            are not built yet.
          </p>
          <p>
            Set up Supabase per <code>HANDOFF.md</code> and add credentials to{" "}
            <code>.env.local</code>.
          </p>
        </CardContent>
      </Card>
    </main>
  );
}
