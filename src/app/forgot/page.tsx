"use client";

import { useState } from "react";
import { MAX_EMAIL } from "@/lib/types";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    setMessage("");
    const res = await fetch("/api/forgot-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    setLoading(false);
    const data = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      message?: string;
      error?: string;
    };
    if (res.ok && data.ok) {
      // Generic by design: never reveals whether the address is a member.
      setMessage(
        data.message ||
          "If that email belongs to a member, we've sent a password reset link.",
      );
    } else {
      setError(data.error || "Could not send a reset link. Please try again.");
    }
  }

  return (
    <div className="login-wrap">
      <form className="login-card" onSubmit={onSubmit}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="login-logo" src="/logo.svg" alt="Innospace Tirana" />
        <p>
          Enter your email and we&apos;ll send you a link to reset your
          password.
        </p>
        {error && <p className="error">{error}</p>}
        {message && <p className="success">{message}</p>}
        <input
          id="email"
          name="email"
          type="email"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="username"
          maxLength={MAX_EMAIL}
          autoFocus
          disabled={!!message}
        />
        <button className="btn" type="submit" disabled={loading || !!message}>
          {loading ? "Sending…" : "Send reset link"}
        </button>
        <a className="login-alt" href="/login">
          Back to sign in
        </a>
      </form>
    </div>
  );
}
