import Link from "next/link";

import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

import { GoogleSignInButton } from "../google-sign-in-button";
import { LoginForm } from "./login-form";

export default function LoginPage() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Sign in</CardTitle>
        <CardDescription>Welcome back to HVC Scoring.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <GoogleSignInButton />
        <OrDivider />
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

function OrDivider() {
  return (
    <div className="flex items-center gap-2 text-[10px] uppercase tracking-wide text-muted-foreground">
      <span className="h-px flex-1 bg-foreground/10" />
      <span>or with email</span>
      <span className="h-px flex-1 bg-foreground/10" />
    </div>
  );
}
