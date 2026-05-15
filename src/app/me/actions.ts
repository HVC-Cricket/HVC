"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";

const schema = z.object({
  display_name: z.string().min(2, "Name must be at least 2 characters"),
  avatar_url: z
    .string()
    .url("Avatar URL must be a valid URL")
    .optional()
    .or(z.literal("")),
});

export async function updateProfile(input: {
  display_name: string;
  avatar_url: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid input",
    };
  }

  const { error } = await supabase
    .from("profiles")
    .update({
      display_name: parsed.data.display_name,
      avatar_url: parsed.data.avatar_url || null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", user.id);

  if (error) return { ok: false, error: error.message };

  revalidatePath("/me");
  return { ok: true };
}
