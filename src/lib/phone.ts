/**
 * Phone-number input helpers. Phone fields across this app accept the
 * usual punctuation people type (digits, leading +, spaces, dashes,
 * parens) and reject letters. Validation is Indian-format only —
 * 10-digit mobile starting 6-9, with an optional `91` / `+91` / `0`
 * prefix and any amount of spaces / dashes / parens for readability.
 */

/** Characters allowed inside a phone string while typing. */
export const PHONE_ALLOWED_RE = /^[0-9+\-\s()]*$/;

/**
 * Raw input length cap. Generous enough to hold any reasonable Indian
 * format including `+91 (98765) 43210` (~16 chars). Stops the input
 * from accepting unbounded typing, which is what was happening before
 * — users could enter 50+ digits and the form would happily submit it.
 */
export const PHONE_MAX_LENGTH = 17;

/**
 * Strict digits-only regex for the normalized form. Indian mobile
 * numbers are 10 digits starting 6/7/8/9; optional `91` or leading
 * `0` prefix is tolerated. Landlines + other formats are not allowed
 * — this app is mobile-first and box-cricket players are tracked by
 * mobile.
 */
export const INDIAN_PHONE_DIGITS_RE = /^(91|0)?[6-9]\d{9}$/;

/** Strip anything outside the allowed set and clamp to PHONE_MAX_LENGTH.
 *  Use inside `onChange` so typing letters or pasting an essay yields
 *  visible-numeric output. */
export function stripPhoneInput(value: string): string {
  return value.replace(/[^0-9+\-\s()]/g, "").slice(0, PHONE_MAX_LENGTH);
}

/** Pull digits-only form (drops `+`, spaces, dashes, parens) so the
 *  Indian-format regex can match cleanly. */
export function digitsOnly(value: string): string {
  return value.replace(/\D/g, "");
}

/** True when `value` is empty or a syntactically valid Indian mobile.
 *  Empty passes because the phone field is optional everywhere. */
export function isValidIndianPhone(value: string): boolean {
  if (!value) return true;
  return INDIAN_PHONE_DIGITS_RE.test(digitsOnly(value));
}
