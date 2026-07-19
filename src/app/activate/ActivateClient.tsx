"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { MAX_NAME, MIN_PASSWORD, MAX_PASSWORD } from "@/lib/types";

export default function ActivateClient({
  token,
  email,
}: {
  token: string;
  email: string;
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!name.trim()) {
      setError("Please enter your name.");
      return;
    }
    if (password.length < MIN_PASSWORD) {
      setError(`Password must be at least ${MIN_PASSWORD} characters.`);
      return;
    }
    if (password !== confirm) {
      setError("Passwords don't match.");
      return;
    }
    setLoading(true);
    const res = await fetch("/api/activate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, name, password }),
    });
    setLoading(false);
    if (res.ok) {
      // Activation signs the member in: send them to the booking screen.
      router.replace("/");
      router.refresh();
    } else {
      const data = await res.json().catch(() => ({}));
      setError(data.error || "Could not set up your account.");
    }
  }

  return (
    <div className="login-wrap">
      <form className="login-card" onSubmit={onSubmit}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="login-logo" src="/logo.svg" alt="Innospace Tirana" />
        <p>
          Set up your account for <strong>{email}</strong> to start booking
          meeting booths.
        </p>
        {error && <p className="error">{error}</p>}
        <input
          type="text"
          placeholder="Full name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoComplete="name"
          maxLength={MAX_NAME}
          autoFocus
        />
        <input
          type="password"
          placeholder={`Password (min ${MIN_PASSWORD})`}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="new-password"
          maxLength={MAX_PASSWORD}
        />
        <input
          type="password"
          placeholder="Confirm password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          autoComplete="new-password"
          maxLength={MAX_PASSWORD}
        />
        <button className="btn" type="submit" disabled={loading}>
          {loading ? "Setting up…" : "Create account"}
        </button>
      </form>
    </div>
  );
}
