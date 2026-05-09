import Link from "next/link";

import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

import { LoginForm } from "./login-form";

export default async function LoginPage(props: {
  searchParams: Promise<{ error?: string; confirmed?: string }>;
}) {
  const sp = await props.searchParams;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Sign in</CardTitle>
        <CardDescription>Welcome back to HVC Scoring.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {sp.confirmed && (
          <p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900 dark:border-emerald-900/40 dark:bg-emerald-950/30 dark:text-emerald-200">
            Email confirmed — sign in to continue.
          </p>
        )}
        {sp.error && (
          <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {sp.error}
          </p>
        )}
        <LoginForm />
      </CardContent>
      <CardFooter className="text-sm text-muted-foreground">
        Don&apos;t have an account?&nbsp;
        <Link href="/signup" className="underline underline-offset-4">
          Sign up
        </Link>
      </CardFooter>
    </Card>
  );
}
