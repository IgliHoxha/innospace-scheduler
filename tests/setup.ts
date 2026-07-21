// Deterministic baseline env for every test file, then per-test temp-DB cleanup.
// Tests override individual vars with vi.stubEnv and restore them themselves.
import { afterEach, vi } from "vitest";
import { cleanupTmp } from "./helpers/app";
import { SIGNING } from "./helpers/fixtures";

// Every required env var now has NO code default, so the suite must provide a
// deterministic baseline. These values mirror the previous code defaults, so
// value-dependent tests keep asserting the same numbers. Individual tests still
// override with vi.stubEnv and restore themselves.
const REQUIRED_BASELINE: Record<string, string> = {
  AUTH_SECRET: SIGNING,
  SCHEDULER_BOOTHS: "booth-1:Booth 1:2,booth-2:Booth 2:4,booth-3:Booth 3:6",
  OPEN_HOUR: "9",
  CLOSE_HOUR: "18",
  RESERVATION_WINDOW_DAYS: "14",
  TIME_STEP_MINUTES: "5",
  MIN_RESERVATION_MINUTES: "15",
  AUTO_APPROVE_MAX_HOURS: "2",
  INVITE_TTL_DAYS: "2",
  DASHBOARD_USERNAME: "admin",
  DASHBOARD_PASSWORD: "change-me",
  LOGIN_MAX_ATTEMPTS: "5",
  LOGIN_BLOCK_SECONDS: "60",
  LOGIN_MAX_LOCKOUTS: "10",
  LOGIN_IP_MAX_ATTEMPTS: "20",
  LOGIN_IP_BLOCK_SECONDS: "60",
  EMAIL_FROM: "onboarding@resend.dev",
  APP_BASE_URL: "https://scheduler.example.test",
  EMAIL_SIGNOFF_NAME: "Test Signer",
  BUSINESS_NAME: "Test Org",
  BUSINESS_PHONE: "+000 000",
  BUSINESS_EMAIL: "hello@test.test",
  BUSINESS_WEBSITE_URL: "https://test.test",
};
for (const [key, value] of Object.entries(REQUIRED_BASELINE)) {
  process.env[key] = value;
}

// Optional feature-flags stay OFF for a deterministic suite (email skipped, no
// captcha, CORS wildcard). DATA_FILE is set per-test by loadDb() to a temp file.
for (const key of [
  "RESEND_API_KEY",
  "TURNSTILE_SECRET_KEY",
  "ALLOWED_ORIGINS",
  "DATA_FILE",
]) {
  delete process.env[key];
}

// Mocks persist across vi.resetModules(), so clear call history each test (the
// mockResolvedValue implementations set in vi.mock factories survive a clear).
afterEach(() => {
  vi.clearAllMocks();
  cleanupTmp();
});
