// Throwaway credentials, named "fixture-*" so scanners do not flag them.

export const CORRECT = "correct-horse-fixture";

export const ADMIN_USER = "fixture-admin";
export const ADMIN_PASS = "fixture-admin-pass";

/** Must match the DASHBOARD_* baseline in tests/setup.ts. */
export const DEFAULT_ADMIN_USER = "admin";
export const DEFAULT_ADMIN_PASS = "change-me";

export const PLAINTEXT = "hash-me-fixture";

/** Dummy HMAC signing secrets (AUTH_SECRET); the two must differ. */
export const SIGNING = "fixture-signing-a";
export const SIGNING_ALT = "fixture-signing-b";
