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
import { OrDivider } from "../or-divider";
import { LoginForm } from "./login-form";

export default function LoginPage() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Sign in</CardTitle>
        <CardDescription>Welcome back to HVC Heroes.</CardDescription>
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

