// Deterministic baseline env for every test file, then per-test temp-DB cleanup.
// Tests override individual vars with vi.stubEnv and restore them themselves.
import { afterEach, vi } from "vitest";
import { cleanupTmp } from "./helpers/app";
import { SIGNING } from "./helpers/fixtures";

// A fixed signing secret so minted session/invite tokens verify inside handlers.
process.env.AUTH_SECRET = SIGNING;

// Clear anything that would otherwise steer scheduling/booth/email logic, so the
// suite runs against the documented code defaults regardless of the shell env.
for (const key of [
  "SCHEDULER_BOOTHS",
  "OPEN_HOUR",
  "CLOSE_HOUR",
  "BOOKING_WINDOW_DAYS",
  "TIME_STEP_MINUTES",
  "MIN_BOOKING_MINUTES",
  "AUTO_APPROVE_MAX_HOURS",
  "INVITE_TTL_DAYS",
  "DASHBOARD_USERNAME",
  "DASHBOARD_PASSWORD",
  "LOGIN_MAX_ATTEMPTS",
  "LOGIN_BLOCK_SECONDS",
  "LOGIN_MAX_LOCKOUTS",
  "LOGIN_IP_MAX_ATTEMPTS",
  "LOGIN_IP_BLOCK_SECONDS",
  "RESEND_API_KEY",
  "EMAIL_FROM",
  "TURNSTILE_SECRET_KEY",
  "ALLOWED_ORIGINS",
  "DATA_FILE",
  // Keep the events skeleton dormant in tests: no broker → publish is a no-op,
  // so route handlers never try to open a Kafka connection.
  "KAFKA_BROKERS",
]) {
  delete process.env[key];
}

// Mocks persist across vi.resetModules(), so clear call history each test (the
// mockResolvedValue implementations set in vi.mock factories survive a clear).
afterEach(() => {
  vi.clearAllMocks();
  cleanupTmp();
});
