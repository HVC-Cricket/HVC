"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";

import { resendSignupOtp, signUp, verifySignup } from "../actions";

const detailsSchema = z.object({
  displayName: z.string().min(2, "Display name must be at least 2 characters"),
  email: z.string().email("Enter a valid email"),
  password: z.string().min(8, "Password must be at least 8 characters"),
});

const otpSchema = z.object({
  token: z
    .string()
    .trim()
    .regex(/^\d{6}$/u, "Enter the 6-digit code from your email"),
});

type DetailsValues = z.infer<typeof detailsSchema>;
type OtpValues = z.infer<typeof otpSchema>;

export function SignupForm() {
  const [pendingEmail, setPendingEmail] = useState<string | null>(null);

  const detailsForm = useForm<DetailsValues>({
    resolver: zodResolver(detailsSchema),
    defaultValues: { displayName: "", email: "", password: "" },
  });

  const onDetailsSubmit = async (values: DetailsValues) => {
    const result = await signUp(values);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    if (result.needsConfirmation) {
      setPendingEmail(result.email);
      toast.success("Code sent — check your email.");
    }
  };

  if (pendingEmail) {
    return (
      <OtpStep
        email={pendingEmail}
        onBack={() => setPendingEmail(null)}
      />
    );
  }

  return (
    <Form {...detailsForm}>
      <form
        onSubmit={detailsForm.handleSubmit(onDetailsSubmit)}
        className="space-y-4"
      >
        <FormField
          control={detailsForm.control}
          name="displayName"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Display name</FormLabel>
              <FormControl>
                <Input autoComplete="name" placeholder="Pavan G" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={detailsForm.control}
          name="email"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Email</FormLabel>
              <FormControl>
                <Input
                  type="email"
                  autoComplete="email"
                  placeholder="you@example.com"
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={detailsForm.control}
          name="password"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Password</FormLabel>
              <FormControl>
                <Input
                  type="password"
                  autoComplete="new-password"
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <Button
          type="submit"
          className="w-full"
          disabled={detailsForm.formState.isSubmitting}
        >
          {detailsForm.formState.isSubmitting ? "Sending code…" : "Create account"}
        </Button>
      </form>
    </Form>
  );
}

function OtpStep({
  email,
  onBack,
}: {
  email: string;
  onBack: () => void;
}) {
  const [resending, startResend] = useTransition();

  const otpForm = useForm<OtpValues>({
    resolver: zodResolver(otpSchema),
    defaultValues: { token: "" },
  });

  const onOtpSubmit = async (values: OtpValues) => {
    const result = await verifySignup({ email, token: values.token });
    if (result && !result.ok) {
      toast.error(result.error);
    }
    // success: Server Action redirects to /me
  };

  const onResend = () => {
    startResend(async () => {
      const result = await resendSignupOtp({ email });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("New code sent — check your email.");
    });
  };

  return (
    <div className="space-y-4">
      <div className="space-y-1 text-sm">
        <p className="font-medium">Enter the code we sent</p>
        <p className="text-muted-foreground">
          Sent a 6-digit code to <span className="font-mono">{email}</span>.
          Check spam if it doesn&apos;t arrive within a minute.
        </p>
      </div>
      <Form {...otpForm}>
        <form
          onSubmit={otpForm.handleSubmit(onOtpSubmit)}
          className="space-y-4"
        >
          <FormField
            control={otpForm.control}
            name="token"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Confirmation code</FormLabel>
                <FormControl>
                  <Input
                    type="text"
                    inputMode="numeric"
                    pattern="\d{6}"
                    maxLength={6}
                    autoComplete="one-time-code"
                    placeholder="123456"
                    className="font-mono tracking-widest text-base"
                    {...field}
                  />
                </FormControl>
                <FormDescription>
                  Six digits, from the email subject line or body.
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
          <Button
            type="submit"
            className="w-full"
            disabled={otpForm.formState.isSubmitting}
          >
            {otpForm.formState.isSubmitting ? "Verifying…" : "Verify and sign in"}
          </Button>
        </form>
      </Form>
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <button
          type="button"
          className="underline underline-offset-4"
          onClick={onBack}
        >
          ← Use a different email
        </button>
        <button
          type="button"
          className="underline underline-offset-4 disabled:opacity-50"
          disabled={resending}
          onClick={onResend}
        >
          {resending ? "Resending…" : "Resend code"}
        </button>
      </div>
      <p className="text-xs text-muted-foreground">
        Already have an account?{" "}
        <Link href="/login" className="underline underline-offset-4">
          Sign in
        </Link>
      </p>
    </div>
  );
}
