"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { MAX_EMAIL, MAX_PASSWORD } from "@/lib/types";

export default function LoginPage() {
  const router = useRouter();
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    const res = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ login, password }),
    });
    setLoading(false);
    if (res.ok) {
      // Already at the top, and the dashboard opens with a sticky topbar there is no scrolling to.
      router.replace("/dashboard", { scroll: false });
      router.refresh();
    } else {
      const data = await res.json().catch(() => ({}));
      setError(data.error || "Login failed.");
    }
  }

  return (
    <div className="login-wrap">
      <form className="login-card" onSubmit={onSubmit}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="login-logo" src="/logo.svg" alt="Innospace Tirana" />
        <p>Admin sign in. Booking a booth needs no account.</p>
        {error && <p className="error">{error}</p>}
        <input
          id="login"
          name="login"
          type="text"
          placeholder="Username"
          value={login}
          onChange={(e) => setLogin(e.target.value)}
          autoComplete="username"
          maxLength={MAX_EMAIL}
          required
          autoFocus
        />
        <input
          id="password"
          name="password"
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          maxLength={MAX_PASSWORD}
          required
        />
        <button className="btn" type="submit" disabled={loading}>
          {loading ? "Signing in…" : "Sign in"}
        </button>
        <a className="login-alt" href="/">
          Back to booking
        </a>
      </form>
    </div>
  );
}
