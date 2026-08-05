// Throwaway credentials, named "fixture-*" so scanners do not flag them.

/** A valid member password used across the auth/activation tests. */
export const CORRECT = "correct-horse-fixture";

/** Stubbed admin env credentials (DASHBOARD_USERNAME / DASHBOARD_PASSWORD). */
export const ADMIN_USER = "fixture-admin";
export const ADMIN_PASS = "fixture-admin-pass";

/** The built-in admin fallback: real defaults, kept out of an inline pair. */
export const DEFAULT_ADMIN_USER = "admin";
export const DEFAULT_ADMIN_PASS = "change-me";

/** Arbitrary text hashed in the scrypt round-trip test. */
export const PLAINTEXT = "hash-me-fixture";

/** Dummy HMAC signing secrets (AUTH_SECRET); the two must differ. */
export const SIGNING = "fixture-signing-a";
export const SIGNING_ALT = "fixture-signing-b";
