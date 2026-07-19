import { verifyInviteToken } from "@/lib/auth";
import { getUserById } from "@/lib/db";
import ActivateClient from "./ActivateClient";

export const dynamic = "force-dynamic";

export default async function ActivatePage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  const userId = verifyInviteToken(token);
  const user = userId ? await getUserById(userId) : null;

  if (!token || !user || user.activated) {
    const reason = user?.activated
      ? "This account is already set up."
      : "This invite link is invalid or has expired.";
    return (
      <div className="login-wrap">
        <div className="login-card">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="login-logo" src="/logo.svg" alt="Innospace Tirana" />
          <p>{reason}</p>
          <a className="btn" href="/login">
            Go to sign in
          </a>
        </div>
      </div>
    );
  }

  return <ActivateClient token={token} email={user.email} />;
}
