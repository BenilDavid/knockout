import {
  useCallback,
  useEffect,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  ArrowRight,
  Check,
  Coins,
  KeyRound,
  LoaderCircle,
  LogIn,
  Plus,
  ShieldCheck,
  Trophy,
  Users,
  X,
} from "lucide-react";
import type { Match, Tournament } from "@knockout/contracts";
import { api } from "./api";
import { TeamMark } from "./components/Bracket";

export interface User {
  id: string;
  email: string;
  name: string;
  role: string;
  verified: boolean;
  mfaEnabled: boolean;
  notifications: boolean;
}
type AnyRecord = Record<string, any>;
export function FormField({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}
function ErrorBox({ message }: { message: string }) {
  return message ? (
    <div className="form-error" role="alert">
      {message}
    </div>
  ) : null;
}
function Dialog({
  title,
  close,
  children,
}: {
  title: string;
  close: () => void;
  children: ReactNode;
}) {
  useEffect(() => {
    const before = document.activeElement as HTMLElement;
    const root = document.querySelector("[data-phase-dialog]") as HTMLElement;
    root?.querySelector<HTMLElement>("input,button")?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
      if (e.key === "Tab" && root) {
        const els = [
          ...root.querySelectorAll<HTMLElement>(
            "button,input,select,textarea,a[href]",
          ),
        ].filter((x) => !x.hasAttribute("disabled"));
        if (e.shiftKey && document.activeElement === els[0]) {
          e.preventDefault();
          els.at(-1)?.focus();
        } else if (!e.shiftKey && document.activeElement === els.at(-1)) {
          e.preventDefault();
          els[0]?.focus();
        }
      }
    };
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("keydown", key);
      before?.focus();
    };
  }, [close]);
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <section
        data-phase-dialog
        className="modal phase-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <button
          className="icon-button modal-close"
          aria-label="Close dialog"
          onClick={close}
        >
          <X size={18} />
        </button>
        <span className="eyebrow orange">KNOCKOUT / YOUR NEXT CHAPTER</span>
        <h2>{title}</h2>
        {children}
      </section>
    </div>
  );
}
export function AuthDialog({
  close,
  success,
}: {
  close: () => void;
  success: () => Promise<void>;
}) {
  const query = new URLSearchParams(location.search);
  const initial = query.get("auth");
  const [mode, setMode] = useState(
    initial === "verify" ? "verify" : initial === "reset" ? "reset" : "login",
  );
  const [admin, setAdmin] = useState(location.pathname === "/admin/login");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [link, setLink] = useState("");
  const switchMode = (m: string) => {
    setMode(m);
    setError("");
    setMessage("");
    setLink("");
  };
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    setError("");
    setMessage("");
    try {
      let path = mode,
        body: AnyRecord = {};
      if (mode === "login")
        body = {
          email: f.get("email"),
          password: f.get("password"),
          code: f.get("code") || undefined,
          admin,
        };
      if (mode === "register")
        body = {
          email: f.get("email"),
          password: f.get("password"),
          name: f.get("name"),
        };
      if (mode === "forgot" || mode === "resend")
        body = { email: f.get("email") };
      if (mode === "verify") body = { token: query.get("token") };
      if (mode === "reset")
        body = { token: query.get("token"), password: f.get("password") };
      const res = await api<AnyRecord>(`/auth/${path}`, "POST", body);
      if (mode === "login") {
        history.replaceState(null, "", "/");
        await success();
        close();
        return;
      }
      setMessage(res.message);
      setLink(res.developmentLink ?? "");
      if (mode === "verify" || mode === "reset") {
        const url = new URL(location.href);
        url.searchParams.delete("auth");
        url.searchParams.delete("token");
        history.replaceState(null, "", url);
        setMode("login");
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const title =
    mode === "register"
      ? "Join the competition."
      : mode === "forgot"
        ? "Get back in the game."
        : mode === "resend"
          ? "Verify your account."
          : mode === "verify"
            ? "One last step."
            : mode === "reset"
              ? "A fresh start."
              : admin
                ? "Organizer sign in."
                : "Welcome back.";
  return (
    <Dialog title={title} close={close}>
      <p className="muted auth-intro">
        {mode === "login"
          ? "Your matches, your predictions, your next big moment."
          : mode === "register"
            ? "Create your account, join an event, and make your picks."
            : "Keep your Knockout account secure."}
      </p>
      <ErrorBox message={error} />
      {message && <div className="result-notice">{message}</div>}
      {link && (
        <div className="local-mail">
          <strong>Local email preview</strong>
          <p>Email is not configured in this development workspace.</p>
          <a href={link} className="text-button orange">
            {mode === "forgot"
              ? "Open password reset"
              : "Open verification link"}{" "}
            <ArrowRight size={14} />
          </a>
        </div>
      )}
      <form onSubmit={submit} className="auth-form">
        {mode === "register" && (
          <FormField label="Display name">
            <input
              name="name"
              autoComplete="name"
              minLength={2}
              maxLength={80}
              required
            />
          </FormField>
        )}
        {["login", "register", "forgot", "resend"].includes(mode) && (
          <FormField label="Email address">
            <input
              name="email"
              type="email"
              autoComplete="email"
              maxLength={200}
              required
            />
          </FormField>
        )}
        {["login", "register", "reset"].includes(mode) && (
          <FormField label={mode === "reset" ? "New password" : "Password"}>
            <input
              name="password"
              type="password"
              autoComplete={
                mode === "login" ? "current-password" : "new-password"
              }
              minLength={mode === "login" ? 1 : 12}
              maxLength={128}
              required
            />
            {mode !== "login" && (
              <small className="muted">Use at least 12 characters.</small>
            )}
          </FormField>
        )}
        {mode === "login" && (
          <>
            <FormField label="Authenticator or recovery code (if enabled)">
              <input
                name="code"
                autoComplete="one-time-code"
                maxLength={100}
                placeholder="Optional unless two-factor is enabled"
              />
            </FormField>
            <label className="check-field">
              <input
                type="checkbox"
                checked={admin}
                onChange={(e) => setAdmin(e.target.checked)}
              />{" "}
              Administrator sign in
            </label>
          </>
        )}
        <button className="primary-button full-width" disabled={busy}>
          {busy ? (
            <LoaderCircle size={15} className="spin" />
          ) : (
            <LogIn size={15} />
          )}{" "}
          {mode === "login"
            ? "Sign in"
            : mode === "register"
              ? "Create account"
              : mode === "verify"
                ? "Verify email"
                : mode === "reset"
                  ? "Update password"
                  : "Send email"}
        </button>
      </form>
      <div className="auth-links">
        {mode === "login" ? (
          <>
            <button onClick={() => switchMode("register")}>
              Create an account
            </button>
            <button onClick={() => switchMode("forgot")}>
              Forgot password?
            </button>
            <button onClick={() => switchMode("resend")}>
              Resend verification
            </button>
          </>
        ) : (
          <button onClick={() => switchMode("login")}>Back to sign in</button>
        )}
      </div>
    </Dialog>
  );
}

export function AccountPanel({
  user,
  refresh,
  login,
}: {
  user: User | null | undefined;
  refresh: () => Promise<void>;
  login: () => void;
}) {
  const [data, setData] = useState<AnyRecord>({
      teams: [],
      memberships: [],
      wallets: [],
    }),
    [sessions, setSessions] = useState<AnyRecord[]>([]),
    [users, setUsers] = useState<AnyRecord[]>([]),
    [roster, setRoster] = useState<AnyRecord[]>([]);
  const awaiting = (u: AnyRecord) => !u.verified && !u.disabled;
  const pending = users.filter(awaiting).length;
  // Accounts awaiting verification first; otherwise keep the server order.
  const sortedUsers = [...users].sort(
    (a, b) => Number(awaiting(b)) - Number(awaiting(a)),
  );
  const [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [mfa, setMfa] = useState<AnyRecord | null>(null),
    [codes, setCodes] = useState<string[]>([]);
  const load = useCallback(async () => {
    if (!user) return;
    const [d, s] = await Promise.all([
      api<AnyRecord>("/me/workspace"),
      api<AnyRecord[]>("/me/sessions"),
    ]);
    setData(d);
    setSessions(s);
    if (user.role === "admin") {
      setUsers(await api<AnyRecord[]>("/admin/users"));
      setRoster(await api<AnyRecord[]>("/players"));
    }
  }, [user?.id, user?.role]);
  useEffect(() => {
    void load().catch((e) => setError(e.message));
  }, [load]);
  async function run(fn: () => Promise<any>, message: string) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await fn();
      await refresh();
      await load();
      setNotice(message);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (!user)
    return (
      <section className="empty-state">
        <Users size={34} />
        <h3>Your account. Your competition.</h3>
        <p>Sign in to manage your profile, teams, sessions, and security.</p>
        <button className="primary-button" onClick={login}>
          Sign in / Register
        </button>
      </section>
    );
  return (
    <div className="phase-section">
      <div className="section-heading">
        <div>
          <span className="eyebrow orange">YOUR WORKSPACE</span>
          <h1>Make yourself at home.</h1>
          <p className="muted">
            {user.email} ·{" "}
            {user.role === "admin" ? "Administrator" : "Participant"}
          </p>
        </div>
        <ShieldCheck size={27} className="orange" />
      </div>
      <ErrorBox message={error} />
      {notice && (
        <div className="result-notice" role="status">
          {notice}
        </div>
      )}
      <div className="phase-two-col">
        <section className="detail-card">
          <h2>Profile & preferences</h2>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              void run(
                () =>
                  api("/me", "PATCH", {
                    name: f.get("name"),
                    notifications: f.get("notifications") === "on",
                  }),
                "Profile updated.",
              );
            }}
          >
            <FormField label="Display name">
              <input
                name="name"
                defaultValue={user.name}
                minLength={2}
                maxLength={80}
                required
              />
            </FormField>
            <label className="check-field">
              <input
                type="checkbox"
                name="notifications"
                defaultChecked={user.notifications}
              />{" "}
              Show result notifications in my dashboard
            </label>
            <button className="primary-button" disabled={busy}>
              Save profile <Check size={14} />
            </button>
          </form>
        </section>
        <section className="detail-card">
          <h2>Change password</h2>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              void run(
                () =>
                  api("/me/password", "POST", {
                    currentPassword: f.get("current"),
                    password: f.get("password"),
                  }),
                "Password changed. Sign in again.",
              );
            }}
          >
            <FormField label="Current password">
              <input
                name="current"
                type="password"
                autoComplete="current-password"
                required
              />
            </FormField>
            <FormField label="New password">
              <input
                name="password"
                type="password"
                minLength={12}
                maxLength={128}
                autoComplete="new-password"
                required
              />
            </FormField>
            <button className="secondary-button" disabled={busy}>
              Update password <KeyRound size={14} />
            </button>
          </form>
        </section>
        <section className="detail-card">
          <h2>Two-factor authentication</h2>
          <p>
            {user.mfaEnabled
              ? "An authenticator protects your account."
              : "Add an authenticator app. Required for administrators on a hosted production event."}
          </p>
          {codes.length > 0 && (
            <div className="recovery-codes">
              <strong>Save these recovery codes now. Each works once.</strong>
              <pre>{codes.join("\n")}</pre>
              <button
                className="secondary-button"
                onClick={() => {
                  const a = document.createElement("a");
                  const url = URL.createObjectURL(
                    new Blob([codes.join("\n")], { type: "text/plain" }),
                  );
                  a.href = url;
                  a.download = "knockout-recovery-codes.txt";
                  a.click();
                  URL.revokeObjectURL(url);
                }}
              >
                Download recovery codes
              </button>
            </div>
          )}
          {!user.mfaEnabled && !mfa && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                void run(
                  async () =>
                    setMfa(
                      await api("/me/mfa/setup", "POST", {
                        password: f.get("password"),
                      }),
                    ),
                  "Enter this setup key in your authenticator.",
                );
              }}
            >
              <FormField label="Confirm password">
                <input
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  required
                />
              </FormField>
              <button className="secondary-button" disabled={busy}>
                Set up authenticator
              </button>
            </form>
          )}
          {mfa && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                void run(async () => {
                  const r = await api<{ recoveryCodes: string[] }>(
                    "/me/mfa/enable",
                    "POST",
                    { code: f.get("code") },
                  );
                  setCodes(r.recoveryCodes);
                  setMfa(null);
                }, "Two-factor authentication enabled.");
              }}
            >
              <p className="muted">
                In your authenticator, add a time-based account using this key:
              </p>
              <code className="setup-secret">{mfa.secret}</code>
              <FormField label="Six-digit authenticator code">
                <input
                  name="code"
                  pattern="[0-9]{6}"
                  autoComplete="one-time-code"
                  required
                />
              </FormField>
              <button className="primary-button" disabled={busy}>
                Enable two-factor
              </button>
            </form>
          )}
          {user.mfaEnabled && !mfa && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                void run(
                  async () => {
                    const response = await api<AnyRecord>(
                      `/me/mfa/${f.get("action") === "rotate" ? "setup" : "disable"}`,
                      "POST",
                      {
                        password: f.get("password"),
                        code: f.get("code"),
                      },
                    );
                    if (f.get("action") === "rotate") setMfa(response);
                  },
                  f.get("action") === "rotate"
                    ? "Add the new key to your authenticator, then confirm its code. Your old authenticator remains active until confirmation."
                    : "Two-factor authentication disabled.",
                );
              }}
            >
              <FormField label="Authenticator action">
                <select name="action">
                  <option value="rotate">
                    Replace authenticator / use recovery code
                  </option>
                  <option value="disable">
                    Disable (restricted for production admins)
                  </option>
                </select>
              </FormField>
              <FormField label="Password">
                <input
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  required
                />
              </FormField>
              <FormField label="Current authenticator or recovery code">
                <input name="code" required />
              </FormField>
              <button className="secondary-button" disabled={busy}>
                Continue
              </button>
            </form>
          )}
        </section>
        <section className="detail-card">
          <h2>Active sessions</h2>
          <p>Sign out a device you no longer use.</p>
          <div className="compact-list">
            {sessions.map((s) => (
              <div key={s.id}>
                <div>
                  <strong>
                    {s.current ? "This browser" : s.label.slice(0, 45)}
                  </strong>
                  <small>
                    Expires {new Date(s.expiresAt).toLocaleString()}
                  </small>
                </div>
                <button
                  className="secondary-button"
                  disabled={busy}
                  onClick={() =>
                    void run(
                      () => api(`/me/sessions/${s.id}`, "DELETE"),
                      "Session revoked.",
                    )
                  }
                >
                  Sign out
                </button>
              </div>
            ))}
          </div>
        </section>
      </div>
      <div className="section-heading">
        <h2>Your player & team profiles</h2>
        <span className="muted">
          Create a personal player profile or a team you captain.
        </span>
      </div>
      <section className="detail-card">
        <form
          className="inline-form"
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            const form = e.currentTarget;
            void run(async () => {
              await api("/teams", "POST", {
                name: f.get("name"),
                tag: f.get("tag"),
              });
              form.reset();
            }, "Profile created. You can now join tournaments.");
          }}
        >
          <FormField label="Player or team name">
            <input name="name" minLength={2} maxLength={80} required />
          </FormField>
          <FormField label="Short tag">
            <input name="tag" maxLength={8} required />
          </FormField>
          <button className="primary-button" disabled={busy}>
            <Plus size={14} /> Create profile
          </button>
        </form>
        <div className="compact-list">
          {data.teams.map((m: AnyRecord) => (
            <div key={m.id}>
              <TeamMark
                name={m.player?.name ?? "Team"}
                color={m.player?.color}
              />
              <div>
                <strong>{m.player?.name}</strong>
                <small>{m.accepted ? m.role : "Invitation waiting"}</small>
              </div>
              {!m.accepted && (
                <button
                  className="primary-button"
                  onClick={() =>
                    void run(
                      () => api(`/me/teams/${m.id}/accept`, "POST"),
                      "Team invitation accepted.",
                    )
                  }
                  disabled={busy}
                >
                  Accept
                </button>
              )}
              {m.accepted && m.role === "captain" && (
                <form
                  className="invite-form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const f = new FormData(e.currentTarget);
                    void run(
                      () =>
                        api(`/teams/${m.playerId}/invite`, "POST", {
                          email: f.get("email"),
                        }),
                      "Invitation added to their account.",
                    );
                  }}
                >
                  <input
                    name="email"
                    type="email"
                    aria-label={`Invite member to ${m.player?.name}`}
                    placeholder="Member’s verified email"
                    required
                  />
                  <button className="secondary-button" disabled={busy}>
                    Invite
                  </button>
                </form>
              )}
            </div>
          ))}
        </div>
      </section>
      {user.role === "admin" && (
        <section className="detail-card admin-users">
          <h2>Connect an existing player or team</h2>
          <p>
            Preserve existing tournament entries while assigning a registered
            captain. Current predictions are checked before ownership changes.
          </p>
          <form
            className="inline-form"
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              void run(
                () =>
                  api(`/admin/players/${f.get("playerId")}/owner`, "POST", {
                    userId: f.get("userId"),
                    reason: f.get("reason"),
                  }),
                "Player/team ownership assigned.",
              );
            }}
          >
            <FormField label="Existing profile">
              <select name="playerId" required>
                <option value="">Select player/team</option>
                {roster.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </FormField>
            <FormField label="Verified account">
              <select name="userId" required>
                <option value="">Select captain</option>
                {users
                  .filter((u) => u.verified && !u.disabled)
                  .map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name} · {u.email}
                    </option>
                  ))}
              </select>
            </FormField>
            <FormField label="Assignment reason">
              <input name="reason" minLength={5} maxLength={1000} required />
            </FormField>
            <button className="secondary-button" disabled={busy}>
              Assign captain
            </button>
          </form>
        </section>
      )}
      {user.role === "admin" && (
        <section className="detail-card admin-users">
          <h2>Account management</h2>
          <p>
            Promotions and access changes require a reason. Your own access is
            protected.
          </p>
          {pending > 0 && (
            <p className="result-notice">
              {pending} account(s) awaiting verification. If their email could
              not be confirmed, choose “Verify account” to approve them by hand.
            </p>
          )}
          <div className="compact-list">
            {sortedUsers.map((u) => (
              <div key={u.id}>
                <div>
                  <strong>{u.name}</strong>
                  <small>
                    {u.email} · {u.role} ·{" "}
                    {u.disabled
                      ? "Disabled"
                      : u.verified
                        ? "Verified"
                        : "Awaiting verification"}
                  </small>
                </div>
                {u.id !== user.id && (
                  <form
                    className="invite-form"
                    onSubmit={(e) => {
                      e.preventDefault();
                      const f = new FormData(e.currentTarget);
                      const action = String(f.get("action"));
                      void run(
                        () =>
                          api(`/admin/users/${u.id}`, "PATCH", {
                            ...(action === "verify"
                              ? { verified: true }
                              : action === "disable"
                                ? { disabled: true }
                                : action === "enable"
                                  ? { disabled: false }
                                  : { role: action }),
                            reason: f.get("reason"),
                          }),
                        action === "verify"
                          ? "Account verified."
                          : "Account access updated.",
                      );
                    }}
                  >
                    <select name="action" aria-label={`Access for ${u.name}`}>
                      {!u.verified && (
                        <option value="verify">Verify account</option>
                      )}
                      <option value={u.disabled ? "enable" : "disable"}>
                        {u.disabled ? "Enable" : "Disable"}
                      </option>
                      <option value="participant">Participant</option>
                      <option value="admin">Administrator</option>
                    </select>
                    <input
                      name="reason"
                      placeholder="Reason (required)"
                      aria-label={`Reason for ${u.name}`}
                      minLength={5}
                      maxLength={1000}
                      required
                    />
                    <button className="secondary-button" disabled={busy}>
                      Apply
                    </button>
                  </form>
                )}
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

export function CommunityPanel({
  t,
  user,
  mode,
  refresh,
  login,
  onMatch,
}: {
  t: Tournament | undefined;
  user: User | null | undefined;
  mode: string;
  refresh: () => Promise<void>;
  login: () => void;
  onMatch?: (match: Match) => void;
}) {
  const [data, setData] = useState<AnyRecord | null>(null),
    [workspace, setWorkspace] = useState<AnyRecord>({
      teams: [],
      ledger: [],
      memberships: [],
    }),
    [users, setUsers] = useState<AnyRecord[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [reason, setReason] = useState(""),
    [marketFilter, setMarketFilter] = useState("open");
  const load = useCallback(async () => {
    if (!t) return;
    const d = await api<AnyRecord>(`/tournaments/${t.id}/community`);
    setData(d);
    if (user) setWorkspace(await api("/me/workspace"));
    else setWorkspace({ teams: [], ledger: [], memberships: [] });
    if (user?.role === "admin") setUsers(await api("/admin/users"));
  }, [t?.id, user?.id, user?.role]);
  useEffect(() => {
    setData(null);
    void load().catch((e) => setError(e.message));
    const timer = setInterval(() => {
      if (!document.hidden) void load().catch(() => {});
    }, 30000);
    return () => clearInterval(timer);
  }, [load]);
  // Re-fetch after parent Socket.IO invalidation without overwriting stake forms.
  useEffect(() => {
    void load().catch((e) => setError(e.message));
  }, [t, load]);
  async function run(fn: () => Promise<unknown>, message: string) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await fn();
      await refresh();
      await load();
      setNotice(message);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (!t)
    return (
      <div className="empty-state">
        <Trophy size={34} />
        <h3>Choose your next competition.</h3>
        <p>Create or select a tournament to open its community.</p>
      </div>
    );
  if (!data)
    return (
      <div className="empty-state">
        <LoaderCircle className="spin" />
        <ErrorBox message={error} />
        <p>Opening the competition…</p>
      </div>
    );
  const admin = user?.role === "admin",
    isStaff = data.staff,
    w = data.wallet,
    member = data.membership;
  const base = `/tournaments/${t.id}`;
  const markets = data.markets as AnyRecord[];
  const title =
    mode === "predictions"
      ? "Back your instincts."
      : mode === "points"
        ? "Every point has a story."
        : mode === "leaderboard"
          ? "The prediction podium."
          : mode === "dashboard"
            ? "Your game plan."
            : "Behind the competition.";
  return (
    <section className="phase-section">
      <div className="section-heading">
        <div>
          <span className="eyebrow orange">
            {t.name.toUpperCase()} / COMMUNITY
          </span>
          <h1>{title}</h1>
          <p className="muted">
            100 free points per tournament. {data.stakeLimit}-point maximum per
            match. No purchases or cash redemption.
          </p>
        </div>
        <Coins size={28} className="orange" />
      </div>
      <ErrorBox message={error} />
      {notice && (
        <div className="result-notice" role="status">
          {notice}
        </div>
      )}
      <div className="phase-summary">
        <div>
          <span>AVAILABLE POINTS</span>
          <strong>{w?.available ?? "—"}</strong>
          <small>Ready for your next prediction</small>
        </div>
        <div>
          <span>RESERVED STAKES</span>
          <strong>{w?.reserved ?? 0}</strong>
          <small>Locked to your current picks</small>
        </div>
        <div>
          <span>TOTAL POINTS</span>
          <strong>{w ? w.available + w.reserved : "—"}</strong>
          <small>Available + reserved</small>
        </div>
        <div>
          <span>MEMBERSHIP</span>
          <strong className="membership-status">
            {isStaff ? "Event staff" : (member?.status ?? "Not joined")}
          </strong>
          <small>
            {member?.checkedIn
              ? "Checked in"
              : member?.kind === "competitor"
                ? "Competition entry"
                : data.predictionsEnabled
                  ? "Prediction pool open"
                  : "Predictions disabled"}
          </small>
        </div>
      </div>
      {!user ? (
        <div className="join-banner">
          <div>
            <h3>Your next great prediction starts here.</h3>
            <p>Register or sign in to join the competition.</p>
          </div>
          <button className="primary-button" onClick={login}>
            Sign in / Register
          </button>
        </div>
      ) : !isStaff && !member ? (
        <section className="detail-card">
          <h2>Join {t.name}</h2>
          <p>
            Choose competition entry or the prediction pool. An organizer
            approves requests and issues your 100 points once.
          </p>
          <form
            className="inline-form"
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              void run(
                () =>
                  api(`${base}/join`, "POST", {
                    kind: f.get("kind"),
                    playerId: f.get("playerId") || undefined,
                  }),
                "Request sent to the organizer.",
              );
            }}
          >
            <FormField label="Join as">
              <select name="kind">
                <option value="predictor">Prediction participant</option>
                <option value="competitor">
                  Competing player / team captain
                </option>
              </select>
            </FormField>
            <FormField label="Competition profile (for competitors)">
              <select name="playerId">
                <option value="">Select a profile you captain</option>
                {workspace.teams
                  .filter((x: AnyRecord) => x.role === "captain" && x.accepted)
                  .map((x: AnyRecord) => (
                    <option key={x.id} value={x.playerId}>
                      {x.player?.name}
                    </option>
                  ))}
              </select>
            </FormField>
            <button className="primary-button" disabled={busy}>
              Request to join <ArrowRight size={14} />
            </button>
          </form>
          <small className="muted">
            Create your player/team profile in Account settings before entering
            as a competitor.
          </small>
        </section>
      ) : member?.status === "pending" ? (
        <div className="join-banner">
          <ShieldCheck size={24} />
          <div>
            <h3>Your request is with the organizer.</h3>
            <p>
              Your 100 points are issued after approval. Returning or rejoining
              never creates another grant.
            </p>
          </div>
        </div>
      ) : member?.status === "rejected" ? (
        <div className="join-banner">
          <p>
            This membership request was rejected. Contact the organizer for
            review.
          </p>
        </div>
      ) : null}
      {member?.kind === "competitor" &&
        member.status === "approved" &&
        data.registration === "checkin" &&
        !member.checkedIn && (
          <div className="join-banner">
            <div>
              <h3>You’re on the lineup. Check in before the bracket starts.</h3>
            </div>
            <button
              className="primary-button"
              disabled={busy}
              onClick={() =>
                void run(
                  () => api(`${base}/checkin`, "POST"),
                  "You’re checked in.",
                )
              }
            >
              Check in <Check size={14} />
            </button>
          </div>
        )}
      {["dashboard", "management"].includes(mode) && isStaff && (
        <>
          <section className="detail-card">
            <h2>Event workflow</h2>
            <p>
              Registration and check-in close when the bracket is generated.
              Configure prediction rules before the first stake.
            </p>
            {admin ? (
              <form
                className="inline-form"
                key={`${t.id}-${data.registration}-${data.predictionsEnabled}`}
                onSubmit={(e) => {
                  e.preventDefault();
                  const f = new FormData(e.currentTarget);
                  void run(
                    () =>
                      api(`${base}/workflow`, "PATCH", {
                        ...(t.status === "draft"
                          ? { registration: f.get("registration") }
                          : {}),
                        predictionsEnabled: f.get("predictions") === "on",
                        stakeLimit: Number(f.get("limit")),
                      }),
                    "Event workflow updated.",
                  );
                }}
              >
                {t.status === "draft" && (
                  <FormField label="Registration">
                    <select
                      name="registration"
                      defaultValue={data.registration}
                    >
                      <option value="open">Open registration</option>
                      <option value="closed">Registration closed</option>
                      <option value="checkin">Check-in open</option>
                    </select>
                  </FormField>
                )}
                <FormField label="Stake limit">
                  <input
                    type="number"
                    name="limit"
                    min={1}
                    max={100}
                    defaultValue={data.stakeLimit}
                  />
                </FormField>
                <label className="check-field">
                  <input
                    name="predictions"
                    type="checkbox"
                    defaultChecked={data.predictionsEnabled}
                  />{" "}
                  Enable predictions
                </label>
                <button className="primary-button" disabled={busy}>
                  Save workflow
                </button>
              </form>
            ) : (
              <p className="muted">
                Registration: {data.registration} · Predictions:{" "}
                {data.predictionsEnabled ? "enabled" : "disabled"}
              </p>
            )}
          </section>
          <section className="detail-card">
            <h2>Registration requests & check-in</h2>
            <FormField label="Reason for review or staff action">
              <input
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Explain the decision (at least 5 characters)"
                maxLength={1000}
              />
            </FormField>
            <div className="compact-list">
              {data.members.map((m: AnyRecord) => (
                <div key={m.id}>
                  <div>
                    <strong>{m.name}</strong>
                    <small>
                      {m.player ?? m.kind} · {m.role} · {m.status}
                      {m.kind === "competitor"
                        ? m.checkedIn
                          ? " · Checked in"
                          : " · Not checked in"
                        : ""}
                    </small>
                  </div>
                  {m.kind === "competitor" &&
                    m.status === "approved" &&
                    !m.checkedIn &&
                    data.registration === "checkin" && (
                      <button
                        className="secondary-button"
                        disabled={busy || reason.trim().length < 5}
                        onClick={() =>
                          void run(
                            () =>
                              api(`${base}/members/${m.id}/checkin`, "POST", {
                                reason,
                              }),
                            "Entrant checked in by staff.",
                          )
                        }
                      >
                        Check in entrant
                      </button>
                    )}
                  {m.role !== "operator" && (
                    <>
                      <button
                        className="secondary-button"
                        disabled={
                          busy ||
                          reason.trim().length < 5 ||
                          m.status === "approved"
                        }
                        onClick={() =>
                          void run(
                            () =>
                              api(`${base}/members/${m.id}`, "PATCH", {
                                status: "approved",
                                reason,
                              }),
                            "Membership approved. Welcome points issued once.",
                          )
                        }
                      >
                        Approve
                      </button>
                      <button
                        className="secondary-button"
                        disabled={
                          busy ||
                          reason.trim().length < 5 ||
                          m.status === "rejected"
                        }
                        onClick={() =>
                          void run(
                            () =>
                              api(`${base}/members/${m.id}`, "PATCH", {
                                status: "rejected",
                                reason,
                              }),
                            "Membership rejected.",
                          )
                        }
                      >
                        Reject
                      </button>
                    </>
                  )}
                </div>
              ))}
              {!data.members.length && (
                <p className="muted">New requests will appear here.</p>
              )}
            </div>
          </section>
        </>
      )}
      {["dashboard", "management"].includes(mode) && admin && (
        <section className="detail-card">
          <h2>Tournament staff</h2>
          <p>
            Operators can start and schedule matches and review results.
            Administrators finalize point payouts.
          </p>
          <form
            className="inline-form"
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              void run(
                () =>
                  api(`${base}/staff`, "POST", {
                    userId: f.get("userId"),
                    role: f.get("role"),
                    reason,
                  }),
                "Staff assignment updated.",
              );
            }}
          >
            <FormField label="Verified account">
              <select name="userId" required>
                <option value="">Choose an account</option>
                {users
                  .filter(
                    (u) => u.verified && !u.disabled && u.role !== "admin",
                  )
                  .map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name} · {u.email}
                    </option>
                  ))}
              </select>
            </FormField>
            <FormField label="Permission">
              <select name="role">
                <option value="operator">Assign operator</option>
                <option value="participant">Remove operator access</option>
              </select>
            </FormField>
            <button
              className="secondary-button"
              disabled={busy || reason.trim().length < 5}
            >
              Apply assignment
            </button>
          </form>
          <small className="muted">
            Use the review reason above. Staff cannot predict matches they
            control.
          </small>
        </section>
      )}
      {["dashboard", "management"].includes(mode) && (
        <section className="detail-card">
          <h2>Result review</h2>
          <p>
            {isStaff
              ? "Confirm or reject competitor submissions. Approved results advance the bracket."
              : "Your team’s submissions and opponent responses appear here. Open a bracket match to submit a score."}
          </p>
          <div className="compact-list">
            {data.submissions.map((s: AnyRecord) => (
              <div key={s.id}>
                <div>
                  <strong>
                    Match {s.matchId + 1} · {s.homeScore} : {s.awayScore}
                  </strong>
                  <small>
                    {s.name} · {s.status} · {s.evidence || "No evidence note"}
                    {s.response && ` · ${s.response}`}
                  </small>
                </div>
                {isStaff &&
                  ["pending", "disputed", "confirmed"].includes(s.status) && (
                    <>
                      <button
                        className="primary-button"
                        disabled={busy || reason.trim().length < 5}
                        onClick={() =>
                          void run(
                            () =>
                              api(
                                `${base}/submissions/${s.id}/review`,
                                "POST",
                                { approve: true, reason },
                              ),
                            "Official result approved.",
                          )
                        }
                      >
                        Approve
                      </button>
                      <button
                        className="secondary-button"
                        disabled={busy || reason.trim().length < 5}
                        onClick={() =>
                          void run(
                            () =>
                              api(
                                `${base}/submissions/${s.id}/review`,
                                "POST",
                                { approve: false, reason },
                              ),
                            "Submission rejected.",
                          )
                        }
                      >
                        Reject
                      </button>
                    </>
                  )}
              </div>
            ))}
            {!data.submissions.length && (
              <p className="muted">No result submissions yet.</p>
            )}
          </div>
        </section>
      )}
      {mode === "dashboard" && data.ownMatches?.length > 0 && (
        <section className="detail-card">
          <h2>Your matches</h2>
          <div className="compact-list">
            {t.matches
              .filter((m) => data.ownMatches.includes(m.id))
              .map((m) => (
                <div key={m.id}>
                  <div>
                    <strong>
                      {m.home?.name ?? "TBD"} vs {m.away?.name ?? "TBD"}
                    </strong>
                    <small>
                      Match {m.id + 1} ·{" "}
                      {m.home?.result || m.away?.result
                        ? "Result recorded"
                        : m.status === 3
                          ? "In progress"
                          : "Upcoming"}
                      {m.scheduledAt
                        ? ` · ${new Date(m.scheduledAt).toLocaleString()}`
                        : ""}
                    </small>
                  </div>
                  {onMatch && (
                    <button
                      className="secondary-button"
                      onClick={() => onMatch(m)}
                    >
                      Open match
                    </button>
                  )}
                </div>
              ))}
          </div>
        </section>
      )}
      {mode === "dashboard" &&
        user?.notifications &&
        workspace.notifications?.length > 0 && (
          <section className="detail-card">
            <h2>Your notifications</h2>
            <div className="compact-list">
              {workspace.notifications
                .filter((x: AnyRecord) => x.tournamentId === t.id)
                .map((x: AnyRecord) => (
                  <div key={x.id}>
                    <div>
                      <strong>
                        Match {x.matchId + 1}: submission {x.status}
                      </strong>
                      <small>{x.response}</small>
                    </div>
                  </div>
                ))}
            </div>
          </section>
        )}
      {["predictions", "dashboard"].includes(mode) && (
        <>
          <div className="section-heading">
            <h2>
              {mode === "dashboard"
                ? "Upcoming prediction opportunities"
                : "Match predictions"}
            </h2>
            <span className="muted">Pools stay private until lock.</span>
          </div>
          <p className="rules-note">
            Back either team before the scheduled start or staff start action.
            Winning picks share the pool proportionally. Draws, forfeits, and
            one-sided pools refund stakes. You cannot predict your own matches
            or events you manage.
          </p>
          {mode === "predictions" && (
            <div className="match-filters space-top">
              {[
                ["open", "Open matches"],
                ["mine", "My picks"],
                ["pending", "Awaiting results"],
                ["all", "All matches"],
              ].map(([value, label]) => (
                <button
                  key={value}
                  className={marketFilter === value ? "active" : ""}
                  onClick={() => setMarketFilter(value)}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
          <div className="prediction-grid">
            {markets
              .filter((m) =>
                mode === "dashboard"
                  ? m.state === "open"
                  : marketFilter === "all"
                    ? true
                    : marketFilter === "mine"
                      ? Boolean(m.mine)
                      : m.state === marketFilter,
              )
              .map((m) => {
                const match = t.matches.find((x) => x.id === m.matchId);
                if (!match) return null;
                return (
                  <PredictionCard
                    key={m.id}
                    market={m}
                    match={match}
                    stakeLimit={data.stakeLimit}
                    busy={busy}
                    canStake={Boolean(
                      user &&
                        member?.status === "approved" &&
                        m.eligible &&
                        m.state === "open" &&
                        data.predictionsEnabled,
                    )}
                    signedIn={Boolean(user)}
                    stake={(side, stake) =>
                      void run(
                        () =>
                          api(`${base}/markets/${m.id}/prediction`, "PUT", {
                            side,
                            stake,
                          }),
                        "Prediction reserved. Good luck!",
                      )
                    }
                    cancel={() =>
                      void run(
                        () =>
                          api(`${base}/markets/${m.id}/prediction`, "DELETE"),
                        "Stake released.",
                      )
                    }
                  />
                );
              })}
          </div>
          {!markets.length && (
            <div className="empty-state">
              <Coins size={32} />
              <h3>The pool is warming up.</h3>
              <p>
                {data.predictionsEnabled
                  ? "Markets appear as opponents become known."
                  : "An administrator can enable predictions in Event management."}
              </p>
            </div>
          )}
        </>
      )}
      {["leaderboard", "dashboard"].includes(mode) && (
        <section className="detail-card">
          <h2>Prediction leaderboard</h2>
          <p>
            Ranked by available + reserved points. Equal totals share a rank.
            Tournament competition standings remain in the event Overview.
          </p>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>RANK</th>
                  <th>PARTICIPANT</th>
                  <th>POINTS</th>
                  <th>RESERVED</th>
                  <th>CORRECT PICKS</th>
                </tr>
              </thead>
              <tbody>
                {data.leaderboard.map((r: AnyRecord) => (
                  <tr
                    key={r.userId}
                    className={r.userId === user?.id ? "my-row" : ""}
                  >
                    <td>{r.rank === 1 ? "♛" : `#${r.rank}`}</td>
                    <td>
                      {r.name}
                      {r.userId === user?.id ? " · You" : ""}
                    </td>
                    <td className="points-number">{r.points}</td>
                    <td>{r.reserved ?? "—"}</td>
                    <td>{r.correct}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!data.leaderboard.length && (
            <p className="muted">
              The first approved members will start with 100 points.
            </p>
          )}
        </section>
      )}
      {mode === "points" && (
        <section className="detail-card">
          <h2>Your point history</h2>
          <p>
            Every grant, reservation, release, payout, and refund is recorded.
            Zero points never prevents you from playing tournament matches.
          </p>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>WHEN</th>
                  <th>ACTIVITY</th>
                  <th>AVAILABLE</th>
                  <th>RESERVED</th>
                </tr>
              </thead>
              <tbody>
                {workspace.ledger
                  .filter((l: AnyRecord) => l.walletId === w?.id)
                  .map((l: AnyRecord) => (
                    <tr key={l.id}>
                      <td>{new Date(l.createdAt).toLocaleString()}</td>
                      <td>
                        <strong className="capitalize">{l.kind}</strong>
                        <small className="block muted">{l.reason}</small>
                      </td>
                      <td
                        className={
                          l.availableDelta > 0 ? "positive-points" : ""
                        }
                      >
                        {l.availableDelta > 0 ? "+" : ""}
                        {l.availableDelta}
                      </td>
                      <td>
                        {l.reservedDelta > 0 ? "+" : ""}
                        {l.reservedDelta}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
          {!w && (
            <p className="muted">
              Your wallet is created once your membership is approved.
            </p>
          )}
        </section>
      )}
      {mode === "management" && admin && (
        <section className="detail-card">
          <h2>Finalize results & reconcile pools</h2>
          <p>
            Finalize only verified official results. Settled results are
            protected from ordinary edits. Reconciliation reverses payouts and
            refunds original stakes only when balances permit it.
          </p>
          <FormField label="Finalization / void / reconciliation reason">
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              minLength={5}
              maxLength={1000}
              placeholder="Required for every action"
            />
          </FormField>
          <div className="compact-list">
            {markets.map((m) => (
              <div key={m.id}>
                <div>
                  <strong>
                    Match {m.matchId + 1} · {m.state}
                  </strong>
                  <small>
                    {t.matches.find((x) => x.id === m.matchId)?.home?.name} vs{" "}
                    {t.matches.find((x) => x.id === m.matchId)?.away?.name}
                  </small>
                </div>
                {m.state === "pending" && (
                  <button
                    className="primary-button"
                    disabled={busy || reason.trim().length < 5}
                    onClick={() =>
                      void run(
                        () =>
                          api(`${base}/markets/${m.id}/finalize`, "POST", {
                            reason,
                          }),
                        "Result finalized. Pool settled or refunded.",
                      )
                    }
                  >
                    Finalize & settle
                  </button>
                )}
                {m.state === "locked" && (
                  <button
                    className="secondary-button"
                    disabled={busy || reason.trim().length < 5}
                    onClick={() =>
                      void run(
                        () =>
                          api(`${base}/markets/${m.id}/reopen`, "POST", {
                            reason,
                          }),
                        "Unplayed prediction market reopened with an audit record.",
                      )
                    }
                  >
                    Reopen unplayed
                  </button>
                )}
                {!["settled", "voided"].includes(m.state) && (
                  <button
                    className="secondary-button"
                    disabled={busy || reason.trim().length < 5}
                    onClick={() =>
                      void run(
                        () =>
                          api(`${base}/markets/${m.id}/void`, "POST", {
                            reason,
                          }),
                        "Market voided. Stakes refunded.",
                      )
                    }
                  >
                    Void & refund
                  </button>
                )}
                {m.state === "settled" && (
                  <button
                    className="secondary-button"
                    disabled={busy || reason.trim().length < 5}
                    onClick={() =>
                      void run(
                        () =>
                          api(`${base}/markets/${m.id}/reconcile`, "POST", {
                            reason,
                          }),
                        "Payouts reconciled and stakes refunded. Result correction is now available.",
                      )
                    }
                  >
                    Reconcile
                  </button>
                )}
              </div>
            ))}
          </div>
          <h3 className="space-top">Reasoned point adjustment</h3>
          <p>
            Adjustments change the point supply and are permanently recorded.
            They are not automatic top-ups.
          </p>
          <form
            className="inline-form"
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              void run(
                () =>
                  api(`${base}/wallets/${f.get("walletId")}/adjust`, "POST", {
                    amount: Number(f.get("amount")),
                    reason,
                    requestId: crypto.randomUUID(),
                  }),
                "Wallet adjustment recorded.",
              );
            }}
          >
            <FormField label="Wallet">
              <select name="walletId" required>
                <option value="">Select participant</option>
                {data.wallets?.map((w: AnyRecord) => (
                  <option key={w.id} value={w.id}>
                    {w.name} · {w.available} available
                  </option>
                ))}
              </select>
            </FormField>
            <FormField label="Point change">
              <input
                type="number"
                name="amount"
                min={-10000}
                max={10000}
                required
              />
            </FormField>
            <button
              className="secondary-button"
              disabled={busy || reason.trim().length < 5}
            >
              Record adjustment
            </button>
          </form>
        </section>
      )}
    </section>
  );
}

function PredictionCard({
  market: m,
  match,
  stakeLimit,
  busy,
  canStake,
  signedIn,
  stake,
  cancel,
}: {
  market: AnyRecord;
  match: Match;
  stakeLimit: number;
  busy: boolean;
  canStake: boolean;
  signedIn: boolean;
  stake: (side: string, n: number) => void;
  cancel: () => void;
}) {
  const [side, setSide] = useState(m.mine?.side ?? "home"),
    [amount, setAmount] = useState(m.mine?.stake || 10);
  return (
    <section className={`prediction-card ${m.mine ? "has-pick" : ""}`}>
      <div className="prediction-card-top">
        <span>
          M{String(match.id + 1).padStart(2, "0")} · ROUND {match.round}
        </span>
        <span className={`market-state ${m.state}`}>
          {m.state === "pending" ? "Awaiting finalization" : m.state}
        </span>
      </div>
      <div className="prediction-teams">
        {[match.home, match.away].map((team, i) => (
          <div key={i}>
            <TeamMark name={team?.name ?? "TBD"} color={team?.color} />
            <strong>{team?.name ?? "TBD"}</strong>
          </div>
        ))}
      </div>
      {match.scheduledAt && (
        <p className="muted">
          Locks {new Date(match.scheduledAt).toLocaleString()}
        </p>
      )}
      {m.homePool !== undefined && (
        <div className="pool-totals">
          <span>{m.homePool} pts</span>
          <span>LOCKED POOL</span>
          <span>{m.awayPool} pts</span>
        </div>
      )}
      {m.mine && (
        <div className="your-pick">
          Your pick:{" "}
          {m.mine.side === "home" ? match.home?.name : match.away?.name} ·{" "}
          {m.mine.stake} pts{" "}
          <span>
            {m.mine.status === "settled"
              ? `Returned ${m.mine.payout}`
              : m.mine.status}
          </span>
        </div>
      )}
      {canStake ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            stake(side, Number(amount));
          }}
        >
          <FormField label="Your winner">
            <select value={side} onChange={(e) => setSide(e.target.value)}>
              <option value="home">{match.home?.name}</option>
              <option value="away">{match.away?.name}</option>
            </select>
          </FormField>
          <div className="stake-row">
            <input
              type="number"
              aria-label={`Stake for match ${match.id + 1}`}
              min={1}
              max={stakeLimit}
              value={amount}
              onChange={(e) => setAmount(Number(e.target.value))}
              required
            />
            <button className="primary-button" disabled={busy}>
              {m.mine?.status === "reserved" ? "Update pick" : "Stake points"}{" "}
              <Coins size={13} />
            </button>
            {m.mine?.status === "reserved" && (
              <button
                type="button"
                className="secondary-button"
                disabled={busy}
                onClick={cancel}
              >
                Cancel
              </button>
            )}
          </div>
        </form>
      ) : (
        <p className="muted prediction-closed">
          {!signedIn
            ? "Sign in and receive membership approval to predict this match."
            : m.state !== "open"
              ? "Stakes are locked for this match."
              : !m.eligible
                ? "Staff and competitors in this match are ineligible."
                : "Join and receive approval to place a prediction."}
        </p>
      )}
    </section>
  );
}

export function PhaseMatchDialog({
  match: m,
  tournament: t,
  close,
  busy,
  error,
  authenticated,
  login,
  submit,
  saveMetadata,
  user,
  refresh,
}: {
  match: Match;
  tournament: Tournament;
  close: () => void;
  busy: boolean;
  error: string;
  authenticated: boolean;
  login: () => void;
  submit: (data: Record<string, unknown>, override: boolean) => void;
  saveMetadata: (data: unknown) => void;
  user?: User | null;
  refresh: () => Promise<void>;
}) {
  const [community, setCommunity] = useState<AnyRecord | null>(null),
    [localError, setError] = useState(""),
    [pending, setPending] = useState(false),
    [mode, setMode] = useState("result");
  const load = useCallback(
    async () => setCommunity(await api(`/tournaments/${t.id}/community`)),
    [t.id],
  );
  useEffect(() => {
    void load().catch((e) => setError(e.message));
  }, [load, t.revision]);
  const staff = community?.staff;
  const own = community?.ownMatches?.includes(m.id);
  const done = Boolean(m.home?.result || m.away?.result),
    ready = m.home?.id != null && m.away?.id != null,
    archived = t.status === "archived";
  async function run(path: string, body: unknown) {
    setPending(true);
    setError("");
    try {
      await api(path, "POST", body);
      await refresh();
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPending(false);
    }
  }
  return (
    <Dialog title={`Match ${String(m.id + 1).padStart(2, "0")}`} close={close}>
      <p className="muted auth-intro">
        {t.name} · Round {m.round} · Best of {t.bestOf}
      </p>
      <div className="match-dialog-teams">
        {[m.home, m.away].map((team, i) => (
          <div key={i}>
            <TeamMark name={team?.name ?? "BYE"} color={team?.color} />
            <strong>{team?.name ?? "BYE"}</strong>
            <small>
              {team?.score ?? "–"} {team?.result && `· ${team.result}`}
            </small>
          </div>
        ))}
      </div>
      <div className="dialog-tabs">
        <button
          className={mode === "result" ? "active" : ""}
          onClick={() => setMode("result")}
        >
          Result
        </button>
        <button
          className={mode === "schedule" ? "active" : ""}
          onClick={() => setMode("schedule")}
        >
          Schedule & details
        </button>
      </div>
      <ErrorBox message={error || localError} />
      {mode === "result" ? (
        <>
          {staff && ready && !done && !archived && m.status !== 3 && (
            <button
              className="secondary-button full-width"
              disabled={pending}
              onClick={() =>
                void run(`/tournaments/${t.id}/matches/${m.id}/start`, {})
              }
            >
              Start match & lock predictions
            </button>
          )}
          {(staff || own) && ready && !archived && (
            <form
              className="space-top"
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                const b = {
                  homeScore: Number(f.get("home")),
                  awayScore: Number(f.get("away")),
                };
                if (staff)
                  submit(
                    {
                      ...b,
                      ...(f.get("forfeit")
                        ? { forfeit: f.get("forfeit") }
                        : {}),
                      ...(done ? { reason: f.get("reason") } : {}),
                    },
                    done,
                  );
                else
                  void run(`/tournaments/${t.id}/matches/${m.id}/submissions`, {
                    ...b,
                    evidence: f.get("evidence"),
                  });
              }}
            >
              <div className="score-inputs">
                <FormField label={m.home?.name ?? "Home"}>
                  <input
                    name="home"
                    aria-label="Home score"
                    type="number"
                    min={0}
                    max={t.bestOf}
                    defaultValue={m.home?.score ?? 0}
                    required
                  />
                </FormField>
                <span>:</span>
                <FormField label={m.away?.name ?? "Away"}>
                  <input
                    name="away"
                    aria-label="Away score"
                    type="number"
                    min={0}
                    max={t.bestOf}
                    defaultValue={m.away?.score ?? 0}
                    required
                  />
                </FormField>
              </div>
              {staff ? (
                <>
                  {!done && (
                    <FormField label="Forfeit (optional)">
                      <select name="forfeit">
                        <option value="">No forfeit</option>
                        <option value="home">{m.home?.name} forfeits</option>
                        <option value="away">{m.away?.name} forfeits</option>
                      </select>
                    </FormField>
                  )}
                  {done && (
                    <FormField label="Reason for correction">
                      <textarea
                        name="reason"
                        minLength={5}
                        maxLength={1000}
                        required
                      />
                    </FormField>
                  )}
                  <button
                    className="primary-button full-width"
                    disabled={busy || pending}
                  >
                    {done
                      ? "Correct official result"
                      : "Confirm official result"}
                  </button>
                </>
              ) : !done ? (
                <>
                  <FormField label="Evidence note or link">
                    <textarea
                      name="evidence"
                      maxLength={2000}
                      placeholder="Score screenshot URL or a short explanation"
                    />
                  </FormField>
                  <button
                    className="primary-button full-width"
                    disabled={pending}
                  >
                    Submit score for review
                  </button>
                  <p className="help-note space-top">
                    An operator confirms official scores. Your submission does
                    not advance the bracket immediately.
                  </p>
                </>
              ) : (
                <p className="result-notice">
                  The official result is recorded.
                </p>
              )}
            </form>
          )}
          {!ready && (
            <p className="help-note">
              Both opponents must be decided before this match can start.
            </p>
          )}
          {!authenticated && (
            <button className="primary-button full-width" onClick={login}>
              Sign in to participate
            </button>
          )}
          {authenticated && !staff && !own && (
            <p className="help-note">
              Official results are managed by event staff. Visit Predictions to
              back an eligible match.
            </p>
          )}
          {community?.submissions
            .filter((s: AnyRecord) => s.matchId === m.id)
            .map((s: AnyRecord) => (
              <section className="submission-card" key={s.id}>
                <strong>
                  {s.homeScore} : {s.awayScore} · {s.status}
                </strong>
                <p className="muted">
                  {s.name} · {s.evidence || "No evidence note"}{" "}
                  {s.response && `· ${s.response}`}
                </p>
                {!staff &&
                  own &&
                  s.userId !== user?.id &&
                  ["pending", "disputed", "confirmed"].includes(s.status) && (
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        const f = new FormData(e.currentTarget);
                        void run(
                          `/tournaments/${t.id}/submissions/${s.id}/respond`,
                          { action: f.get("action"), reason: f.get("reason") },
                        );
                      }}
                    >
                      <FormField label="Response">
                        <select name="action">
                          <option value="confirm">Confirm score</option>
                          <option value="dispute">Dispute score</option>
                        </select>
                      </FormField>
                      <FormField label="Explanation">
                        <input
                          name="reason"
                          minLength={5}
                          maxLength={1000}
                          required
                        />
                      </FormField>
                      <button className="secondary-button" disabled={pending}>
                        Send response
                      </button>
                    </form>
                  )}
                {staff &&
                  ["pending", "disputed", "confirmed"].includes(s.status) && (
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        const f = new FormData(e.currentTarget);
                        void run(
                          `/tournaments/${t.id}/submissions/${s.id}/review`,
                          {
                            approve: f.get("action") === "approve",
                            reason: f.get("reason"),
                          },
                        );
                      }}
                    >
                      <FormField label="Decision">
                        <select name="action">
                          <option value="approve">
                            Approve official score
                          </option>
                          <option value="reject">Reject submission</option>
                        </select>
                      </FormField>
                      <FormField label="Review reason">
                        <input
                          name="reason"
                          minLength={5}
                          maxLength={1000}
                          required
                        />
                      </FormField>
                      <button className="primary-button" disabled={pending}>
                        Review submission
                      </button>
                    </form>
                  )}
              </section>
            ))}
        </>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            const date = String(f.get("date"));
            saveMetadata({
              ...(date ? { scheduledAt: new Date(date).toISOString() } : {}),
              durationMinutes: Number(f.get("duration")),
              venue: f.get("venue"),
              streamUrl: f.get("stream"),
            });
          }}
        >
          <FormField label="Match time (your local time)">
            <input
              type="datetime-local"
              name="date"
              defaultValue={
                m.scheduledAt
                  ? new Date(
                      Date.parse(m.scheduledAt) -
                        new Date(m.scheduledAt).getTimezoneOffset() * 60000,
                    )
                      .toISOString()
                      .slice(0, 16)
                  : ""
              }
              disabled={!staff || archived}
            />
          </FormField>
          <FormField label="Expected duration (minutes)">
            <input
              type="number"
              name="duration"
              min={1}
              max={1440}
              defaultValue={m.durationMinutes ?? 30}
              required
              disabled={!staff || archived}
            />
          </FormField>
          <FormField label="Server, court, or venue">
            <input
              name="venue"
              defaultValue={m.venue ?? ""}
              maxLength={150}
              disabled={!staff || archived}
            />
          </FormField>
          <FormField label="Stream URL">
            <input
              name="stream"
              type="url"
              defaultValue={m.streamUrl ?? ""}
              disabled={!staff || archived}
            />
          </FormField>
          {m.streamUrl && (
            <a
              href={m.streamUrl}
              target="_blank"
              rel="noreferrer"
              className="text-button orange"
            >
              Watch stream
            </a>
          )}
          {staff && !archived && (
            <button className="primary-button full-width" disabled={busy}>
              Save match details
            </button>
          )}
        </form>
      )}
    </Dialog>
  );
}
