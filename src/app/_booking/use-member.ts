import { useEffect, useState } from "react";

/** The booker Google vouched for; the form shows them instead of asking. */
export interface Member {
  name: string;
  email: string;
}

/** Undefined until /api/me answers, since the page itself is cached for everyone. */
export function useMember(): Member | null | undefined {
  const [member, setMember] = useState<Member | null | undefined>(undefined);
  useEffect(() => {
    let cancelled = false;
    fetch("/api/me", { cache: "no-store" })
      .then((res) => res.json() as Promise<{ member?: Member | null }>)
      .then((json) => !cancelled && setMember(json.member ?? null))
      // Unreachable or unparsable: book as a guest, which needs no session.
      .catch(() => !cancelled && setMember(null));
    return () => {
      cancelled = true;
    };
  }, []);
  return member;
}
