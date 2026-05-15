import { type NextRequest, NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";

/**
 * OAuth callback. Supabase redirects users here after they authorize
 * with Google (or any other OAuth provider). The `code` query param
 * is exchanged for a Supabase session; the user is then sent to
 * `next` (defaults to /me).
 *
 * This route lives at /auth/callback. The Supabase redirect URL on
 * the provider's side is the Supabase-hosted callback
 * (https://<project>.supabase.co/auth/v1/callback) which then bounces
 * here with the code already set up.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/me";

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`);
    }
    // Code present but exchange failed — fall through to error redirect.
    return NextResponse.redirect(
      `${origin}/login?error=${encodeURIComponent(error.message)}`,
    );
  }

  // No code — most likely the user cancelled the OAuth flow.
  return NextResponse.redirect(`${origin}/login`);
}
