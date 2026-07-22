import { verifyResetToken, passwordFingerprint } from "@/lib/auth";
import { findUserRecordById } from "@/lib/db";
import ResetClient from "./ResetClient";

export const dynamic = "force-dynamic";

export default async function ResetPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  const v = verifyResetToken(token);
  const user = v ? await findUserRecordById(v.userId) : null;
  // The fingerprint must still match: a used or stale link no longer does.
  const valid =
    !!v &&
    !!user &&
    user.activated &&
    !!user.passwordHash &&
    passwordFingerprint(user.passwordHash) === v.fp;

  if (!token || !valid) {
    return (
      <div className="login-wrap">
        <div className="login-card">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="login-logo" src="/logo.svg" alt="Innospace Tirana" />
          <p>This reset link is invalid or has expired.</p>
          <a className="btn" href="/forgot">
            Request a new link
          </a>
          <a className="login-alt" href="/login">
            Back to sign in
          </a>
        </div>
      </div>
    );
  }

  return <ResetClient token={token} email={user!.email} />;
}
