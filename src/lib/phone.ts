/**
 * Phone-number input helpers. Phone fields across this app accept the
 * usual punctuation people type (digits, leading +, spaces, dashes,
 * parens) and reject letters. No locale parsing — we don't enforce a
 * country format, just keep the input visibly numeric.
 */

/** Characters allowed inside a phone string. */
export const PHONE_ALLOWED_RE = /^[0-9+\-\s()]*$/;

/** Strip anything outside the allowed set. Use inside `onChange` so
 *  typing a letter just yields no character at all. */
export function stripPhoneInput(value: string): string {
  return value.replace(/[^0-9+\-\s()]/g, "");
}
