import { NextResponse, type NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";

/**
 * Email-confirmation callback. Supabase email links land here after the
 * user clicks "Confirm signup". Handles both flows the SDK can produce:
 *
 *   - PKCE: `?code=...`           → exchangeCodeForSession (default for @supabase/ssr)
 *   - OTP:  `?token_hash=...&type=...` → verifyOtp (modern email-template format)
 *
 * On success: redirect to `next` (defaults to `/me`) with `?confirmed=1`.
 * On failure: redirect to `/login?error=...`.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const next = searchParams.get("next") ?? "/me";
  const supabase = await createClient();

  const code = searchParams.get("code");
  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}${next}?confirmed=1`);
    }
    return NextResponse.redirect(
      `${origin}/login?error=${encodeURIComponent(error.message)}`,
    );
  }

  const token_hash = searchParams.get("token_hash");
  const type = searchParams.get("type");
  if (token_hash && type) {
    const { error } = await supabase.auth.verifyOtp({
      type: type as
        | "signup"
        | "email"
        | "recovery"
        | "invite"
        | "email_change",
      token_hash,
    });
    if (!error) {
      return NextResponse.redirect(`${origin}${next}?confirmed=1`);
    }
    return NextResponse.redirect(
      `${origin}/login?error=${encodeURIComponent(error.message)}`,
    );
  }

  return NextResponse.redirect(
    `${origin}/login?error=${encodeURIComponent(
      "Invalid or expired confirmation link",
    )}`,
  );
}
