"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";

const emailField = z.string().email("Enter a valid email address");
const passwordField = z
  .string()
  .min(8, "Password must be at least 8 characters");

const signUpSchema = z.object({
  email: emailField,
  password: passwordField,
  displayName: z.string().min(2, "Display name must be at least 2 characters"),
});

const signInSchema = z.object({
  email: emailField,
  password: z.string().min(1, "Password is required"),
});

const verifySignupSchema = z.object({
  email: emailField,
  token: z
    .string()
    .trim()
    .regex(/^\d{6}$/u, "Enter the 6-digit code from your email"),
});

const resendSchema = z.object({ email: emailField });

export type ActionResult =
  | { ok: true }
  | { ok: false; error: string };

export type SignUpResult =
  | { ok: true; needsConfirmation: true; email: string }
  | { ok: false; error: string };

export async function signUp(
  input: z.infer<typeof signUpSchema>,
): Promise<SignUpResult> {
  const parsed = signUpSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      data: { display_name: parsed.data.displayName },
    },
  });

  if (error) {
    return { ok: false, error: error.message };
  }

  // Confirmation OFF (autoconfirm): a session is returned and the user is
  // already signed in. Redirect straight to /me. (Should not happen in
  // production where Confirm email is ON.)
  if (data.session) {
    revalidatePath("/", "layout");
    redirect("/me");
  }

  // Confirmation ON: no session yet. The user must enter the OTP from the
  // email. The signup form swaps to the OTP-entry step.
  return { ok: true, needsConfirmation: true, email: parsed.data.email };
}

/**
 * Verify the 6-digit OTP that Supabase emailed after signUp.
 * On success the SSR cookie manager writes the new session cookies into
 * the response, so the next navigation is signed-in.
 */
export async function verifySignup(
  input: z.infer<typeof verifySignupSchema>,
): Promise<ActionResult> {
  const parsed = verifySignupSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({
    email: parsed.data.email,
    token: parsed.data.token,
    type: "email",
  });

  if (error) {
    return { ok: false, error: error.message };
  }

  revalidatePath("/", "layout");
  redirect("/me");
}

export async function resendSignupOtp(
  input: z.infer<typeof resendSchema>,
): Promise<ActionResult> {
  const parsed = resendSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.resend({
    type: "signup",
    email: parsed.data.email,
  });

  if (error) {
    return { ok: false, error: error.message };
  }
  return { ok: true };
}

export async function signIn(input: z.infer<typeof signInSchema>): Promise<ActionResult> {
  const parsed = signInSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);

  if (error) {
    return { ok: false, error: error.message };
  }

  revalidatePath("/", "layout");
  redirect("/me");
}

export async function signOut(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  revalidatePath("/", "layout");
  redirect("/");
}
