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
import { SignupForm } from "./signup-form";

export default function SignupPage() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Create an account</CardTitle>
        <CardDescription>
          Sign up to score matches or follow tournaments.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <GoogleSignInButton />
        <OrDivider />
        <SignupForm />
      </CardContent>
      <CardFooter className="text-sm text-muted-foreground">
        Already have an account?&nbsp;
        <Link href="/login" className="underline underline-offset-4">
          Sign in
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
