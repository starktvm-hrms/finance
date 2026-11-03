import { useEffect, useRef, useState, type FormEvent } from "react";
import { getAdapter } from "../lib/adapter";
import { useStore } from "../lib/store";

const FEATURES = [
  { title: "Jobs to invoices", text: "Open a job, send the estimate, get approval and raise the invoice." },
  { title: "Media & vendor spend", text: "Publications, channels, radio, outdoor and digital in one place." },
  { title: "Know your margins", text: "Revenue, costs and profit by month, client and job." },
];

/** Home page when signed out: agency branding on one side, the sign-in form on the other. */
export default function Login() {
  const { signIn } = useStore();
  const [brand, setBrand] = useState<{ agencyName: string; logo: string }>({ agencyName: "", logo: "" });
  const [username, setUsername] = useState(() => {
    try {
      return localStorage.getItem("agency-finance:last-user") ?? "";
    } catch {
      return "";
    }
  });
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [remember, setRemember] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const passwordRef = useRef<HTMLInputElement>(null);
  const userRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    getAdapter().auth?.branding().then(setBrand).catch(() => undefined);
    (username ? passwordRef : userRef).current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    document.title = `Sign in · ${brand.agencyName || "Agency Finance"}`;
    return () => {
      document.title = "Agency Finance";
    };
  }, [brand.agencyName]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await signIn(username.trim(), password, remember);
      try {
        localStorage.setItem("agency-finance:last-user", username.trim());
      } catch {
        /* convenience only */
      }
    } catch (err) {
      setError((err as Error).message || "Could not sign in.");
      setPassword("");
      passwordRef.current?.focus();
    } finally {
      setBusy(false);
    }
  };

  const name = brand.agencyName || "Agency Finance";

  return (
    <div className="login">
      <section className="login-brand" aria-label={name}>
        <div className="login-brand-top">
          {brand.logo ? (
            <span className="login-logo"><img src={brand.logo} alt="" /></span>
          ) : (
            <span className="login-mark" aria-hidden>₹</span>
          )}
          <span className="login-name">{name}</span>
        </div>
        <div className="login-pitch">
          <h2>Your agency's finances, in one place.</h2>
          <ul>
            {FEATURES.map((f) => (
              <li key={f.title}>
                <strong>{f.title}</strong>
                <span>{f.text}</span>
              </li>
            ))}
          </ul>
        </div>
        <p className="login-foot">Finance workspace · {name}</p>
      </section>

      <main className="login-main">
        <form className="login-card" onSubmit={submit} noValidate={false}>
          <div className="login-card-head">
            <h1>Sign in</h1>
            <p className="muted">Welcome back. Sign in to continue to {name}.</p>
          </div>

          {error && (
            <div className="login-error" role="alert">
              {error}
            </div>
          )}

          <label className="field">
            <span>Username</span>
            <input
              ref={userRef}
              name="username"
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              required
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
          </label>

          <label className="field">
            <span>Password</span>
            <span className="password-wrap">
              <input
                ref={passwordRef}
                name="password"
                type={show ? "text" : "password"}
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <button type="button" className="btn ghost show-btn" onClick={() => setShow((v) => !v)} aria-pressed={show} aria-label={show ? "Hide password" : "Show password"}>
                {show ? "Hide" : "Show"}
              </button>
            </span>
          </label>

          <label className="check">
            <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
            Keep me signed in for 30 days
          </label>

          <button className="btn primary login-submit" disabled={busy || !username.trim() || !password}>
            {busy ? "Signing in…" : "Sign in"}
          </button>

          <p className="muted small login-help">Forgot your password? Ask your administrator to reset it.</p>
        </form>
      </main>
    </div>
  );
}
