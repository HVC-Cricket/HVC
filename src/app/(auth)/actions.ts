"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
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

export type ActionResult =
  | { ok: true }
  | { ok: false; error: string };

export type SignUpResult =
  | { ok: true; needsConfirmation: true; email: string }
  | { ok: false; error: string };

async function getOrigin(): Promise<string> {
  const h = await headers();
  const host = h.get("host");
  if (!host) return "http://localhost:3000";
  const protocol = h.get("x-forwarded-proto") ?? "http";
  return `${protocol}://${host}`;
}

export async function signUp(
  input: z.infer<typeof signUpSchema>,
): Promise<SignUpResult> {
  const parsed = signUpSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const supabase = await createClient();
  const origin = await getOrigin();
  const { data, error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      data: { display_name: parsed.data.displayName },
      emailRedirectTo: `${origin}/auth/confirm`,
    },
  });

  if (error) {
    return { ok: false, error: error.message };
  }

  // Confirmation OFF (autoconfirm): a session is returned and the user is
  // already signed in. Redirect straight to /me.
  if (data.session) {
    revalidatePath("/", "layout");
    redirect("/me");
  }

  // Confirmation ON: no session yet. The user must click the email link.
  return { ok: true, needsConfirmation: true, email: parsed.data.email };
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
