import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { io } from "socket.io-client";
import {
  Activity,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ArrowUpRight,
  Bell,
  Braces,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Clock3,
  Copy,
  Download,
  ExternalLink,
  Flag,
  Gamepad2,
  LayoutDashboard,
  ListFilter,
  LoaderCircle,
  MapPin,
  MoreHorizontal,
  Plus,
  Radio,
  Search,
  Settings2,
  ShieldCheck,
  Shuffle,
  Swords,
  Trash2,
  Trophy,
  Users,
  X,
  Zap,
  LogOut,
  LockKeyhole,
  Coins,
} from "lucide-react";
import type { Format, Match, Player, Tournament } from "@knockout/contracts";
import { formatLabel } from "@knockout/contracts";
import { api } from "./api";
import Bracket, { TeamMark, finished, playable } from "./components/Bracket";
import {
  AuthDialog,
  AccountPanel,
  CommunityPanel,
  PhaseMatchDialog,
  type User,
} from "./Phase2";

type View =
  | "tournaments"
  | "overview"
  | "players"
  | "schedule"
  | "activity"
  | "settings";
type CommunityView =
  | "dashboard"
  | "predictions"
  | "points"
  | "leaderboard"
  | "account"
  | "management";
type Modal = "create" | "player" | "enroll" | "help" | "login" | null;
type Session = {
  authenticated: boolean;
  mode: string;
  demo: boolean;
  user?: User | null;
};
const tabs = [
  "Bracket",
  "Participants",
  "Matches",
  "Overview",
  "Predictions",
  "Leaderboard",
  "Community",
  "Activity",
  "Settings",
] as const;
type Tab = (typeof tabs)[number];
const dateLabel = (date: string) =>
  new Date(date).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
const timeLabel = (date: string) =>
  new Date(date).toLocaleTimeString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
  });
const localDate = (date: string) => {
  const d = new Date(date);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
};
const navItems: {
  id: View | CommunityView;
  label: string;
  icon: typeof Trophy;
}[] = [
  { id: "overview", label: "Overview", icon: LayoutDashboard },
  { id: "tournaments", label: "Tournaments", icon: Trophy },
  { id: "players", label: "Participants", icon: Users },
  { id: "schedule", label: "Schedule", icon: CalendarDays },
  { id: "dashboard", label: "My dashboard", icon: LayoutDashboard },
  { id: "predictions", label: "Predictions", icon: Coins },
  { id: "points", label: "My points", icon: Activity },
  { id: "leaderboard", label: "Leaderboards", icon: Trophy },
  { id: "management", label: "Event management", icon: ShieldCheck },
  { id: "account", label: "My account", icon: Users },
];

function Badge({ status }: { status: string }) {
  return (
    <span className={`status-badge ${status}`}>
      <i />
      {status === "live"
        ? "In progress"
        : status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  );
}
function ModalShell({
  title,
  subtitle,
  children,
  close,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  close: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prior = document.activeElement as HTMLElement;
    const root = ref.current;
    root?.querySelector<HTMLElement>("input,button,select")?.focus();
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
      if (e.key === "Tab" && root) {
        const els = [
          ...root.querySelectorAll<HTMLElement>(
            "button,input,select,textarea,a[href]",
          ),
        ].filter((x) => !x.hasAttribute("disabled"));
        const first = els[0],
          last = els.at(-1);
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", handler);
    return () => {
      document.removeEventListener("keydown", handler);
      prior?.focus();
    };
  }, [close]);
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        ref={ref}
      >
        <button
          className="icon-button modal-close"
          onClick={close}
          aria-label="Close dialog"
        >
          <X size={18} />
        </button>
        <span className="eyebrow orange">KNOCKOUT / CONTROL ROOM</span>
        <h2>{title}</h2>
        {subtitle && <p className="muted">{subtitle}</p>}
        {children}
      </div>
    </div>
  );
}
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}
function Empty({
  icon,
  title,
  text,
  action,
}: {
  icon?: ReactNode;
  title: string;
  text: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      {icon ?? <Trophy size={34} />}
      <h3>{title}</h3>
      <p>{text}</p>
      {action}
    </div>
  );
}

export default function App() {
  const [events, setEvents] = useState<Tournament[]>([]),
    [players, setPlayers] = useState<Player[]>([]),
    [selectedId, setSelectedId] = useState<number | null>(
      () =>
        Number(new URLSearchParams(location.search).get("tournament")) || null,
    );
  const [view, setView] = useState<View | CommunityView>("tournaments"),
    [tab, setTab] = useState<Tab>("Bracket"),
    [modal, setModal] = useState<Modal>(() =>
      new URLSearchParams(location.search).has("auth") ||
      location.pathname === "/admin/login"
        ? "login"
        : null,
    ),
    [match, setMatch] = useState<Match | null>(null);
  const [session, setSession] = useState<Session>({
      authenticated: false,
      mode: "local",
      demo: true,
    }),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [loadError, setLoadError] = useState("");
  const [search, setSearch] = useState(""),
    [filter, setFilter] = useState("all"),
    [toast, setToast] = useState(""),
    [error, setError] = useState(""),
    [sidebar, setSidebar] = useState(false),
    [connected, setConnected] = useState(false);
  const socketUp = useRef(false);
  const t = events.find((e) => e.id === selectedId);
  const [staffEvents, setStaffEvents] = useState<number[]>([]);
  const [picked, setPicked] = useState<string[]>([]);
  useEffect(() => {
    if (modal !== "enroll") setPicked([]);
  }, [modal]);
  const isAdmin = session.user?.role === "admin";
  const initials = (session.user?.name ?? "Guest")
    .split(/\s+/)
    .map((x) => x[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  const close = useCallback(() => {
    setModal(null);
    setMatch(null);
    setError("");
  }, []);
  const notify = (text: string) => setToast(text);
  const refresh = useCallback(async () => {
    try {
      const [e, p, s] = await Promise.all([
        api<Tournament[]>("/tournaments"),
        api<Player[]>("/players"),
        api<Session>("/session"),
      ]);
      setEvents(e);
      setPlayers(p);
      setSession(s);
      if (s.user) {
        const workspace = await api<{
          memberships: { tournamentId: number; role: string; status: string }[];
        }>("/me/workspace");
        setStaffEvents(
          workspace.memberships
            .filter((m) => m.role === "operator" && m.status === "approved")
            .map((m) => m.tournamentId),
        );
      } else setStaffEvents([]);
      setLoadError("");
    } catch (err) {
      setLoadError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void refresh();
    const socket = io({ autoConnect: true });
    const expired = () => {
      void refresh();
    };
    // Collapse bursts of change events into a single refresh.
    let timer: number | undefined;
    const refreshSoon = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => void refresh(), 300);
    };
    window.addEventListener("knockout:sessionexpired", expired);
    socket.on("connect", () => {
      socketUp.current = true;
      setConnected(true);
      void refresh();
    });
    socket.on("disconnect", () => {
      socketUp.current = false;
      setConnected(false);
    });
    socket.on("tournaments:changed", refreshSoon);
    return () => {
      window.clearTimeout(timer);
      socketUp.current = false;
      socket.disconnect();
      window.removeEventListener("knockout:sessionexpired", expired);
    };
  }, [refresh]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 4500);
    return () => clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    if (!loading && selectedId === null && events.length)
      setSelectedId(events[0].id);
  }, [loading]);
  useEffect(() => {
    const url = new URL(location.href);
    if (selectedId) url.searchParams.set("tournament", String(selectedId));
    else url.searchParams.delete("tournament");
    history.replaceState(null, "", url);
  }, [selectedId]);
  const doWork = async (
    work: () => Promise<unknown>,
    message: string,
    dismiss = false,
    apply?: (result: any) => void,
  ) => {
    setBusy(true);
    setError("");
    try {
      const result = await work();
      // Show the saved result straight away. The socket event (or this fallback
      // when it is offline) brings in everything else without blocking the UI.
      apply?.(result);
      if (!socketUp.current) void refresh();
      if (dismiss) close();
      notify(message);
    } catch (e) {
      setError((e as Error).message);
      if (!modal && !match) notify((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const manage = (action: () => void) => {
    if (!session.authenticated) {
      setModal("login");
      return;
    }
    if (!isAdmin) {
      notify(
        "This action requires an administrator. Use Community to join or manage your own entry.",
      );
      return;
    }
    setError("");
    action();
  };
  const openEvent = (id: number) => {
    setSelectedId(id);
    setView("tournaments");
    setTab("Bracket");
    setSearch("");
    setSidebar(false);
  };
  const navigate = (v: View | CommunityView) => {
    setView(v);
    setSearch("");
    setSidebar(false);
  };
  const list = events.filter(
    (e) =>
      (filter === "all" || e.status === filter) &&
      `${e.name} ${e.game}`.toLowerCase().includes(search.toLowerCase()),
  );
  const completed = t?.matches.filter(finished).length ?? 0,
    total = t?.matches.length ?? 0;
  const active =
    t?.matches.filter((m) => playable(m) && !finished(m) && m.status !== 3) ??
    [];
  const activity = events
    .flatMap((e) => e.audit.map((a) => ({ ...a, tournament: e.name })))
    .sort((a, b) => b.at.localeCompare(a.at));
  const exportData = () => {
    if (!t) return;
    const blob = new Blob([JSON.stringify(t, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${t.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.json`;
    a.click();
    URL.revokeObjectURL(url);
    notify("Tournament exported.");
  };
  const submitCreate = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    void doWork(
      async () => {
        const event = await api<Tournament>("/tournaments", "POST", {
          name: f.get("name"),
          game: f.get("game"),
          format: f.get("format"),
          capacity: Number(f.get("capacity")),
          bestOf: Number(f.get("bestOf")),
          date: new Date(String(f.get("date"))).toISOString(),
          venue: f.get("venue") || "Online",
          prize: f.get("prize") || "",
          description: "",
        });
        setSelectedId(event.id);
        setView("tournaments");
        setTab("Participants");
      },
      "Tournament created. Add your participants to get started.",
      true,
    );
  };
  const savePlayer = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    void doWork(
      () => api("/players", "POST", { name: f.get("name"), tag: f.get("tag") }),
      "Participant added to your roster.",
      true,
      (p: Player) => setPlayers((all) => [...all, p]),
    );
  };
  const headerTitles: Record<View | CommunityView, string> = {
    tournaments: "Tournaments",
    overview: "Overview",
    players: "Participants",
    schedule: "Schedule",
    activity: "Activity log",
    settings: "Workspace settings",
    dashboard: "My dashboard",
    predictions: "Predictions",
    points: "My points",
    leaderboard: "Leaderboards",
    account: "My account",
    management: "Event management",
  };

  return (
    <div className={`app-shell ${isAdmin ? "is-admin" : "is-participant"}`}>
      {sidebar && (
        <div className="sidebar-overlay" onClick={() => setSidebar(false)} />
      )}
      <aside className={`sidebar ${sidebar ? "is-open" : ""}`}>
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            navigate("overview");
          }}
        >
          <span className="brand-symbol">
            k<span>↗</span>
          </span>
          <span>
            knockout<span className="brand-dot">.</span>
          </span>
        </a>
        <button
          className="workspace-switch"
          onClick={() => navigate("settings")}
        >
          <span className="workspace-avatar">K</span>
          <span>
            <strong>My workspace</strong>
            <small>
              {isAdmin
                ? "Tournament organizer"
                : session.authenticated
                  ? "Participant workspace"
                  : "Public spectator"}
            </small>
          </span>
          <ChevronDown size={14} />
        </button>
        <div className="sidebar-navigation">
          <span className="nav-section-label">WORKSPACE</span>
          <nav>
            {navItems
              .filter(
                (n) =>
                  n.id !== "management" ||
                  isAdmin ||
                  staffEvents.includes(selectedId ?? -1),
              )
              .map(({ id, label, icon: Icon }) => (
                <button
                  key={id}
                  className={`nav-item ${view === id ? "active" : ""}`}
                  onClick={() => navigate(id)}
                >
                  <Icon size={18} />
                  <span>{label}</span>
                  {id === "tournaments" && (
                    <span className="nav-count">{events.length}</span>
                  )}
                </button>
              ))}
          </nav>
          <div className="nav-divider" />
          <div className="nav-section-row">
            <span className="nav-section-label">YOUR TOURNAMENTS</span>
            <button
              className="tiny-button"
              aria-label="New tournament"
              onClick={() => manage(() => setModal("create"))}
            >
              <Plus size={14} />
            </button>
          </div>
          <div className="event-shortcuts">
            {events
              .filter((e) => e.status !== "archived")
              .slice(0, 5)
              .map((e) => (
                <button
                  key={e.id}
                  className={
                    selectedId === e.id && view === "tournaments"
                      ? "selected"
                      : ""
                  }
                  onClick={() => openEvent(e.id)}
                >
                  <span className={`event-dot ${e.status}`} />
                  <span>{e.name}</span>
                  {selectedId === e.id && <ChevronRight size={13} />}
                </button>
              ))}
            {!events.length && (
              <small className="muted">Your next event starts here.</small>
            )}
          </div>
        </div>
        <div className="sidebar-bottom">
          <div className="organizer-note">
            <span className="note-icon">
              <Zap size={17} />
            </span>
            <strong>Built for the big moments.</strong>
            <p>
              Less organizing.
              <br />
              More game time.
            </p>
            <button onClick={() => setModal("help")}>
              Your organizer playbook <ArrowUpRight size={14} />
            </button>
          </div>
          <button
            className={`nav-item ${view === "activity" ? "active" : ""}`}
            onClick={() => navigate("activity")}
          >
            <Activity size={17} />
            <span>Activity log</span>
          </button>
          <button
            className={`nav-item ${view === "settings" ? "active" : ""}`}
            onClick={() => navigate("settings")}
          >
            <Settings2 size={17} />
            <span>Settings</span>
          </button>
          <div className="user-card">
            <span className="user-avatar">{initials}</span>
            <span>
              <strong>{session.user?.name ?? "Welcome to Knockout"}</strong>
              <small>
                {session.demo
                  ? "Local workspace"
                  : session.authenticated
                    ? isAdmin
                      ? "Administrator"
                      : "Participant"
                    : "Spectator"}
              </small>
            </span>
            <button
              className="tiny-button"
              aria-label={
                session.authenticated && !session.demo
                  ? "Sign out"
                  : "Account settings"
              }
              onClick={() =>
                session.authenticated && !session.demo
                  ? void doWork(
                      () => api("/auth/logout", "POST"),
                      "Signed out.",
                    )
                  : setModal(session.demo ? "help" : "login")
              }
            >
              {session.authenticated && !session.demo ? (
                <LogOut size={15} />
              ) : (
                <MoreHorizontal size={17} />
              )}
            </button>
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            <button
              className="mobile-menu icon-button"
              onClick={() => setSidebar(true)}
              aria-label="Open navigation"
            >
              <Braces size={20} />
            </button>
            <span>Workspace</span>
            <ChevronRight size={13} />
            <button
              onClick={() => {
                setSelectedId(null);
                setView("tournaments");
              }}
            >
              {headerTitles[view]}
            </button>
            {view === "tournaments" && t && (
              <>
                <ChevronRight size={13} />
                <strong>{t.name}</strong>
              </>
            )}
          </div>
          <div className="topbar-right">
            <span className={`connection ${connected ? "" : "offline"}`}>
              <i />
              {connected ? "Live sync on" : "Reconnecting"}
            </span>
            <span className="topbar-separator" />
            <button
              className="icon-button"
              aria-label="Help"
              onClick={() => setModal("help")}
            >
              <CircleHelp size={17} />
            </button>
            <button
              className="icon-button notification-button"
              aria-label="View notifications"
              onClick={() =>
                navigate(session.authenticated ? "dashboard" : "activity")
              }
            >
              <Bell size={17} />
              {activity.length > 0 &&
                (isAdmin || session.user?.notifications) && <i />}
            </button>
            {session.authenticated ? (
              <button
                className="user-avatar mini"
                aria-label="Open my account"
                onClick={() => navigate("account")}
              >
                {initials}
              </button>
            ) : (
              <button
                className="primary-button small-button"
                onClick={() => setModal("login")}
              >
                Sign in
              </button>
            )}
          </div>
        </header>
        <main>
          {loading ? (
            <div className="loading-state">
              <LoaderCircle className="spin" size={28} />
              <p>Opening the control room…</p>
            </div>
          ) : loadError ? (
            <Empty
              title="We couldn't reach your workspace."
              text={loadError}
              action={
                <button
                  className="primary-button"
                  onClick={() => {
                    setLoading(true);
                    void refresh();
                  }}
                >
                  Try again
                </button>
              }
            />
          ) : (
            <>
              {view === "tournaments" && t ? (
                <>
                  <div className="page-heading tournament-heading">
                    <div>
                      <button
                        className="back-link"
                        onClick={() => setSelectedId(null)}
                      >
                        <ArrowLeft size={13} /> All tournaments
                      </button>
                      <div className="heading-title">
                        <h1>{t.name}</h1>
                        <Badge status={t.status} />
                      </div>
                      <p className="tournament-meta">
                        <span className="game-tag">
                          <Gamepad2 size={13} />
                          {t.game}
                        </span>
                        <span>·</span>
                        <span>{formatLabel[t.format]}</span>
                        <span>·</span>
                        <span>
                          <CalendarDays size={13} />
                          {dateLabel(t.date)}
                        </span>
                        <span>·</span>
                        <span>
                          <MapPin size={13} />
                          {t.venue}
                        </span>
                      </p>
                    </div>
                    <div className="heading-actions">
                      <button
                        className="secondary-button"
                        onClick={async () => {
                          try {
                            await navigator.clipboard.writeText(location.href);
                            notify("Spectator link copied.");
                          } catch {
                            notify(
                              "Copy this page’s address to share the bracket.",
                            );
                          }
                        }}
                      >
                        <ExternalLink size={14} /> Share bracket
                      </button>
                      <button
                        className="primary-button"
                        onClick={() => {
                          if (!isAdmin) {
                            setTab("Community");
                            return;
                          }
                          manage(() => {
                            if (t.status === "draft") {
                              setTab("Participants");
                            } else if (
                              active.length ||
                              t.matches.some((m) => m.status === 3)
                            )
                              setMatch(
                                t.matches.find((m) => m.status === 3) ??
                                  active[0],
                              );
                            else setTab("Matches");
                          });
                        }}
                      >
                        <Plus size={16} />
                        {!isAdmin
                          ? "Join / Predict"
                          : t.status === "draft"
                            ? "Manage entries"
                            : "Report result"}
                      </button>
                    </div>
                  </div>
                  <div className="stat-grid">
                    <Stat
                      icon={<Users size={19} />}
                      label="PARTICIPANTS"
                      value={String(t.entries.length).padStart(2, "0")}
                      detail={`/ ${t.capacity} teams`}
                      foot={
                        t.entries.length === t.capacity
                          ? "All spots filled"
                          : t.status === "draft"
                            ? "Registration open"
                            : "Registration closed"
                      }
                      dot
                    />
                    <Stat
                      icon={<Swords size={19} />}
                      label="MATCHES PLAYED"
                      value={String(completed).padStart(2, "0")}
                      detail={`/ ${total} matches`}
                      foot={`${Math.round(total ? (completed / total) * 100 : 0)}% of the tournament complete`}
                      progress={total ? completed / total : 0}
                    />
                    <Stat
                      icon={<Radio size={19} />}
                      label="READY TO PLAY"
                      value={String(active.length).padStart(2, "0")}
                      detail="matches"
                      foot={
                        active.length
                          ? "The next round starts here"
                          : "Waiting for the next matchup"
                      }
                      orange
                    />
                    <Stat
                      icon={<Trophy size={19} />}
                      label="PRIZE POOL"
                      value={t.prize || "Glory"}
                      foot={
                        t.prize
                          ? "Everything to play for"
                          : "The championship title"
                      }
                      gold
                    />
                  </div>
                  <div className="tournament-panel">
                    <div className="tab-bar">
                      <div role="tablist" aria-label="Tournament views">
                        {tabs
                          .filter((label) => label !== "Settings" || isAdmin)
                          .map((label) => (
                            <button
                              role="tab"
                              aria-selected={tab === label}
                              key={label}
                              className={tab === label ? "active" : ""}
                              onClick={() => {
                                setTab(label);
                                setSearch("");
                              }}
                            >
                              {label}
                              {label === "Participants" && (
                                <span>{t.entries.length}</span>
                              )}
                            </button>
                          ))}
                      </div>
                      <button
                        className="icon-button"
                        aria-label="Export tournament"
                        onClick={exportData}
                      >
                        <Download size={16} />
                      </button>
                    </div>
                    {tab === "Bracket" && (
                      <>
                        <div className="panel-toolbar">
                          <div>
                            <h2>
                              Tournament bracket{" "}
                              <span className="outline-tag">BO{t.bestOf}</span>
                            </h2>
                            <p>
                              The road to the championship. Every match counts.
                            </p>
                          </div>
                          <div className="toolbar-actions">
                            {t.status === "draft" && isAdmin ? (
                              <button
                                className="primary-button small-button"
                                disabled={busy || t.entries.length < 2}
                                onClick={() =>
                                  manage(
                                    () =>
                                      void doWork(
                                        () =>
                                          api(
                                            `/tournaments/${t.id}/stages`,
                                            "POST",
                                          ),
                                        "Bracket generated. Let the games begin.",
                                      ),
                                  )
                                }
                              >
                                <Zap size={14} /> Generate bracket
                              </button>
                            ) : (
                              <>
                                <span className="bracket-legend">
                                  <i className="completed-dot" />
                                  Completed <i className="upcoming-dot" />
                                  Upcoming
                                </span>
                                <button
                                  className="secondary-button small-button"
                                  onClick={() => setTab("Matches")}
                                >
                                  <ListFilter size={13} /> Match list
                                </button>
                              </>
                            )}
                          </div>
                        </div>
                        <div className="bracket-scroll">
                          <Bracket tournament={t} onSelect={setMatch} />
                        </div>
                        <div className="bracket-footer">
                          <span>
                            <span className="shortcut-key">↖</span> Select a
                            match to view details or report a result
                          </span>
                          <span>
                            <ShieldCheck size={13} />
                            BeUI bracket · brackets-manager
                          </span>
                        </div>
                      </>
                    )}
                    {tab === "Participants" && (
                      <>
                        <div className="panel-toolbar">
                          <div>
                            <h2>
                              The competition{" "}
                              <span className="outline-tag">
                                {t.entries.length} / {t.capacity}
                              </span>
                            </h2>
                            <p>
                              {t.status === "draft"
                                ? "Add teams and arrange their seeds before generating your bracket."
                                : "Your registered teams, ordered by their tournament seed."}
                            </p>
                          </div>
                          {t.status === "draft" && isAdmin && (
                            <div className="toolbar-actions">
                              <button
                                className="secondary-button"
                                disabled={busy || t.entries.length < 2}
                                onClick={() =>
                                  manage(() => {
                                    const ids = t.entries.map((e) => e.id);
                                    for (let i = ids.length - 1; i > 0; i--) {
                                      const j = Math.floor(
                                        Math.random() * (i + 1),
                                      );
                                      [ids[i], ids[j]] = [ids[j], ids[i]];
                                    }
                                    void doWork(
                                      () =>
                                        api(
                                          `/tournaments/${t.id}/seeding`,
                                          "PATCH",
                                          { entryIds: ids },
                                        ),
                                      "Seeds shuffled.",
                                    );
                                  })
                                }
                              >
                                <Shuffle size={14} /> Shuffle
                              </button>
                              <button
                                className="primary-button"
                                onClick={() => manage(() => setModal("enroll"))}
                              >
                                <Plus size={14} /> Add participant
                              </button>
                              <button
                                className="secondary-button"
                                disabled={busy || t.entries.length < 2}
                                onClick={() =>
                                  manage(
                                    () =>
                                      void doWork(
                                        () =>
                                          api(
                                            `/tournaments/${t.id}/stages`,
                                            "POST",
                                          ),
                                        "Bracket generated. Let the games begin.",
                                      ),
                                  )
                                }
                              >
                                <Zap size={14} /> Generate bracket
                              </button>
                            </div>
                          )}
                        </div>
                        {t.entries.length ? (
                          <div className="table-wrap">
                            <table>
                              <thead>
                                <tr>
                                  <th>SEED</th>
                                  <th>PARTICIPANT</th>
                                  <th>TAG</th>
                                  <th>STATUS</th>
                                  {t.status === "draft" && isAdmin && (
                                    <th>SEEDING</th>
                                  )}
                                </tr>
                              </thead>
                              <tbody>
                                {t.entries.map((e, i) => (
                                  <tr key={e.id}>
                                    <td>
                                      <span className="seed-cell">
                                        {String(e.seed).padStart(2, "0")}
                                      </span>
                                    </td>
                                    <td>
                                      <div className="team-cell">
                                        <TeamMark
                                          name={e.name}
                                          color={e.color}
                                        />
                                        <strong>{e.name}</strong>
                                      </div>
                                    </td>
                                    <td className="muted">{e.tag}</td>
                                    <td>
                                      <span className="registered">
                                        <Check size={12} /> Registered
                                      </span>
                                    </td>
                                    {t.status === "draft" && isAdmin && (
                                      <td>
                                        <div className="table-actions">
                                          {[-1, 1].map((d) => (
                                            <button
                                              key={d}
                                              className="icon-button"
                                              aria-label={`${d === -1 ? "Move up" : "Move down"} ${e.name}`}
                                              disabled={
                                                busy ||
                                                i + d < 0 ||
                                                i + d >= t.entries.length
                                              }
                                              onClick={() =>
                                                manage(() => {
                                                  const ids = t.entries.map(
                                                    (x) => x.id,
                                                  );
                                                  [ids[i], ids[i + d]] = [
                                                    ids[i + d],
                                                    ids[i],
                                                  ];
                                                  void doWork(
                                                    () =>
                                                      api(
                                                        `/tournaments/${t.id}/seeding`,
                                                        "PATCH",
                                                        { entryIds: ids },
                                                      ),
                                                    "Seeding updated.",
                                                  );
                                                })
                                              }
                                            >
                                              {d === -1 ? (
                                                <ArrowUp size={14} />
                                              ) : (
                                                <ArrowDown size={14} />
                                              )}
                                            </button>
                                          ))}
                                          <button
                                            className="icon-button danger"
                                            aria-label={`Remove ${e.name}`}
                                            disabled={busy}
                                            onClick={() =>
                                              manage(
                                                () =>
                                                  void doWork(
                                                    () =>
                                                      api(
                                                        `/tournaments/${t.id}/entries/${e.id}`,
                                                        "DELETE",
                                                      ),
                                                    "Participant removed.",
                                                  ),
                                              )
                                            }
                                          >
                                            <Trash2 size={14} />
                                          </button>
                                        </div>
                                      </td>
                                    )}
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        ) : (
                          <Empty
                            icon={<Users size={34} />}
                            title="Build your starting lineup."
                            text="Add participants from your workspace roster to get the competition started."
                            action={
                              <button
                                className="primary-button"
                                onClick={() => manage(() => setModal("enroll"))}
                              >
                                <Plus size={14} /> Add participants
                              </button>
                            }
                          />
                        )}
                      </>
                    )}
                    {tab === "Matches" && (
                      <>
                        <div className="panel-toolbar">
                          <div>
                            <h2>Every matchup</h2>
                            <p>
                              Open a match to report scores, record a forfeit,
                              or set its schedule.
                            </p>
                          </div>
                        </div>
                        <Matches matches={t.matches} onSelect={setMatch} />
                      </>
                    )}
                    {tab === "Overview" && (
                      <div className="overview-content">
                        <div className="detail-card">
                          <span className="eyebrow">ABOUT THE EVENT</span>
                          <h2>{t.name}</h2>
                          <p>
                            {t.description ||
                              "The next great competition starts here."}
                          </p>
                          <dl>
                            <dt>Game</dt>
                            <dd>{t.game}</dd>
                            <dt>Format</dt>
                            <dd>{formatLabel[t.format]}</dd>
                            <dt>Series</dt>
                            <dd>Best of {t.bestOf}</dd>
                            <dt>Starts</dt>
                            <dd>
                              {dateLabel(t.date)} · {timeLabel(t.date)}
                            </dd>
                            <dt>Location</dt>
                            <dd>{t.venue}</dd>
                            <dt>Prize pool</dt>
                            <dd>{t.prize || "Championship title"}</dd>
                          </dl>
                        </div>
                        <div className="detail-card">
                          <span className="eyebrow">STANDINGS</span>
                          <h2>
                            {t.format === "round_robin"
                              ? "The leaderboard"
                              : "The contenders"}
                          </h2>
                          <Standings tournament={t} />
                        </div>
                      </div>
                    )}
                    {tab === "Activity" && <ActivityList items={t.audit} />}
                    {["Predictions", "Leaderboard", "Community"].includes(
                      tab,
                    ) && (
                      <CommunityPanel
                        onMatch={setMatch}
                        t={t}
                        user={session.user}
                        mode={
                          tab === "Predictions"
                            ? "predictions"
                            : tab === "Leaderboard"
                              ? "leaderboard"
                              : isAdmin
                                ? "management"
                                : "dashboard"
                        }
                        refresh={refresh}
                        login={() => setModal("login")}
                      />
                    )}
                    {tab === "Settings" && (
                      <SettingsForm
                        key={`${t.id}-${t.status}`}
                        tournament={t}
                        busy={busy}
                        save={(data) =>
                          manage(
                            () =>
                              void doWork(
                                () =>
                                  api(`/tournaments/${t.id}`, "PATCH", data),
                                "Tournament settings saved.",
                              ),
                          )
                        }
                        archive={() =>
                          manage(
                            () =>
                              void doWork(
                                () =>
                                  api(`/tournaments/${t.id}`, "PATCH", {
                                    status: "archived",
                                  }),
                                "Tournament archived.",
                              ),
                          )
                        }
                      />
                    )}
                  </div>
                  <div className="page-footer">
                    <span>
                      <span className="footer-dot" /> Your tournament. Under
                      control.
                    </span>
                    <span>
                      Made for the love of the game{" "}
                      <span className="orange">↗</span>
                    </span>
                  </div>
                </>
              ) : view === "tournaments" ? (
                <>
                  <PageHeading
                    eyebrow="LET THE GAMES BEGIN"
                    title="Your tournaments"
                    subtitle="Great competition starts with a little organization."
                    action={
                      <button
                        className="primary-button"
                        onClick={() => manage(() => setModal("create"))}
                      >
                        <Plus size={16} /> New tournament
                      </button>
                    }
                  />
                  <div className="list-toolbar">
                    <SearchBox
                      value={search}
                      set={setSearch}
                      placeholder="Search tournaments…"
                    />
                    <select
                      aria-label="Tournament status"
                      value={filter}
                      onChange={(e) => setFilter(e.target.value)}
                    >
                      <option value="all">All statuses</option>
                      <option value="draft">Draft</option>
                      <option value="live">In progress</option>
                      <option value="completed">Completed</option>
                      <option value="archived">Archived</option>
                    </select>
                  </div>
                  <div className="event-grid">
                    {list.map((e) => (
                      <EventCard
                        key={e.id}
                        event={e}
                        open={() => openEvent(e.id)}
                      />
                    ))}
                  </div>
                  {!list.length && (
                    <Empty
                      title="Room for your next big event."
                      text="Create a tournament, invite the competition, and let Knockout take care of the bracket."
                      action={
                        <button
                          className="primary-button"
                          onClick={() => manage(() => setModal("create"))}
                        >
                          <Plus size={14} /> Create tournament
                        </button>
                      }
                    />
                  )}
                </>
              ) : null}
              {view === "overview" && (
                <>
                  <PageHeading
                    eyebrow="THE CONTROL ROOM"
                    title="Good games start here."
                    subtitle="Your competitions, your teams, your next big moment."
                    action={
                      <button
                        className="primary-button"
                        onClick={() => manage(() => setModal("create"))}
                      >
                        <Plus size={16} /> New tournament
                      </button>
                    }
                  />
                  <div className="dashboard-banner">
                    <div>
                      <span className="eyebrow">BUILT FOR THE COMPETITION</span>
                      <h2>
                        Bring the players.
                        <br />
                        We’ll bring the brackets<span>.</span>
                      </h2>
                      <p>
                        From the first matchup to the final celebration.
                        <br />
                        Everything you need to run a great tournament.
                      </p>
                      <button
                        className="primary-button"
                        onClick={() => manage(() => setModal("create"))}
                      >
                        Create your next tournament <ArrowUpRight size={16} />
                      </button>
                    </div>
                    <div className="banner-art">
                      <div className="art-orbit orbit-one" />
                      <div className="art-orbit orbit-two" />
                      <Trophy size={118} strokeWidth={0.9} />
                      <span className="art-spark">✦</span>
                      <span className="art-number">01</span>
                    </div>
                  </div>
                  <div className="stat-grid workspace-stats">
                    <Stat
                      icon={<Trophy size={19} />}
                      label="TOURNAMENTS"
                      value={String(events.length).padStart(2, "0")}
                      foot="Every competition in one place"
                    />
                    <Stat
                      icon={<Radio size={19} />}
                      label="IN PROGRESS"
                      value={String(
                        events.filter((e) => e.status === "live").length,
                      ).padStart(2, "0")}
                      foot="The competition is on"
                      orange
                    />
                    <Stat
                      icon={<Users size={19} />}
                      label="PARTICIPANTS"
                      value={String(players.length).padStart(2, "0")}
                      foot="Your workspace roster"
                    />
                    <Stat
                      icon={<Swords size={19} />}
                      label="RESULTS RECORDED"
                      value={String(
                        events.reduce(
                          (n, e) => n + e.matches.filter(finished).length,
                          0,
                        ),
                      ).padStart(2, "0")}
                      foot="Every result, safely recorded"
                    />
                  </div>
                  <div className="section-heading">
                    <h2>Your tournaments</h2>
                    <button
                      className="text-button"
                      onClick={() => {
                        setSelectedId(null);
                        navigate("tournaments");
                      }}
                    >
                      View all <ArrowRight size={14} />
                    </button>
                  </div>
                  <div className="event-grid">
                    {events.slice(0, 3).map((e) => (
                      <EventCard
                        key={e.id}
                        event={e}
                        open={() => openEvent(e.id)}
                      />
                    ))}
                  </div>
                </>
              )}
              {view === "players" && (
                <>
                  <PageHeading
                    eyebrow="THE COMPETITION"
                    title="Your participants"
                    subtitle="One roster. Endless possibilities for great matchups."
                    action={
                      <button
                        className="primary-button"
                        onClick={() => manage(() => setModal("player"))}
                      >
                        <Plus size={15} /> Add participant
                      </button>
                    }
                  />
                  <div className="list-toolbar">
                    <SearchBox
                      value={search}
                      set={setSearch}
                      placeholder="Search teams or tags…"
                    />
                    <span className="muted">
                      {players.length} participants in your workspace
                    </span>
                  </div>
                  <div className="player-grid">
                    {players
                      .filter((p) =>
                        `${p.name} ${p.tag}`
                          .toLowerCase()
                          .includes(search.toLowerCase()),
                      )
                      .map((p) => (
                        <div className="player-card" key={p.id}>
                          <TeamMark name={p.name} color={p.color} />
                          <div>
                            <strong>{p.name}</strong>
                            <small>
                              {p.tag} <span>·</span>{" "}
                              {
                                events.filter((e) =>
                                  e.entries.some((x) => x.id === p.id),
                                ).length
                              }{" "}
                              tournaments
                            </small>
                          </div>
                          <span className="registered">
                            <Check size={12} />
                          </span>
                        </div>
                      ))}
                  </div>
                </>
              )}
              {view === "schedule" && (
                <>
                  <PageHeading
                    eyebrow="ON THE HORIZON"
                    title="The game plan"
                    subtitle="Your tournament dates and scheduled matches, all in one place."
                  />
                  <div className="schedule-list">
                    {[...events]
                      .sort((a, b) => a.date.localeCompare(b.date))
                      .map((e) => (
                        <div className="schedule-event" key={e.id}>
                          <div className="calendar-tile">
                            <small>
                              {new Date(e.date).toLocaleDateString("en-IN", {
                                month: "short",
                              })}
                            </small>
                            <strong>{new Date(e.date).getDate()}</strong>
                          </div>
                          <div>
                            <button
                              className="text-button"
                              onClick={() => openEvent(e.id)}
                            >
                              <h3>{e.name}</h3>
                              <ArrowUpRight size={15} />
                            </button>
                            <p>
                              <Clock3 size={13} />
                              {timeLabel(e.date)} <span>·</span> {e.venue}
                            </p>
                            {e.matches
                              .filter((m) => m.scheduledAt)
                              .map((m) => (
                                <button
                                  key={m.id}
                                  className="scheduled-match"
                                  onClick={() => {
                                    openEvent(e.id);
                                    setMatch(m);
                                  }}
                                >
                                  {dateLabel(m.scheduledAt!)} ·{" "}
                                  {timeLabel(m.scheduledAt!)} —{" "}
                                  {m.home?.name ?? "BYE"} vs{" "}
                                  {m.away?.name ?? "BYE"}
                                </button>
                              ))}
                          </div>
                          <Badge status={e.status} />
                        </div>
                      ))}
                  </div>
                  {!events.length && (
                    <Empty
                      title="A clear calendar. A world of possibilities."
                      text="Create a tournament to start planning your next event."
                    />
                  )}
                </>
              )}
              {view === "activity" && (
                <>
                  <PageHeading
                    eyebrow="NOTHING MISSED"
                    title="Behind every result"
                    subtitle="A record of the moments that shape your tournaments."
                  />
                  <div className="tournament-panel">
                    <ActivityList items={activity} />
                  </div>
                </>
              )}
              {view === "settings" && (
                <>
                  <PageHeading
                    eyebrow="MAKE IT YOURS"
                    title="Workspace settings"
                    subtitle="A little clarity about your tournament control room."
                  />
                  <div className="workspace-settings">
                    <div className="detail-card">
                      <ShieldCheck className="orange" size={25} />
                      <h2>Your workspace</h2>
                      <dl>
                        <dt>Storage</dt>
                        <dd>
                          {session.mode === "postgresql"
                            ? "PostgreSQL"
                            : "Persistent local file"}
                        </dd>
                        <dt>Access</dt>
                        <dd>
                          {session.demo
                            ? "Local demo — admin access enabled"
                            : session.authenticated
                              ? "Administrator"
                              : "Public spectator"}
                        </dd>
                        <dt>Live updates</dt>
                        <dd>{connected ? "Connected" : "Reconnecting"}</dd>
                        <dt>Tournament engine</dt>
                        <dd>brackets-manager 1.11.1</dd>
                      </dl>
                      <p className="muted">
                        {session.demo
                          ? "This local workspace saves your changes between restarts. For a hosted event, use the included PostgreSQL deployment and configure your admin key."
                          : "Share a tournament link for public viewing. An admin key is required to change results."}
                      </p>
                      {!session.demo && !session.authenticated && (
                        <button
                          className="primary-button"
                          onClick={() => setModal("login")}
                        >
                          Sign in as administrator
                        </button>
                      )}
                    </div>
                    <div className="detail-card">
                      <Trophy size={25} className="orange" />
                      <h2>Play your way.</h2>
                      <p className="muted">
                        Single elimination, double elimination, and round robin.
                        Teams, seeds, results, and a record of every change.
                      </p>
                      <button
                        className="secondary-button"
                        onClick={() => setModal("help")}
                      >
                        Open the organizer playbook <ArrowUpRight size={14} />
                      </button>
                    </div>
                  </div>
                </>
              )}
            </>
          )}
          {!loading &&
            !loadError &&
            [
              "dashboard",
              "predictions",
              "points",
              "leaderboard",
              "management",
              "account",
            ].includes(view) && (
              <>
                {view !== "account" && (
                  <div className="phase-event-picker">
                    <label>
                      Selected tournament
                      <select
                        aria-label="Selected tournament"
                        value={selectedId ?? ""}
                        onChange={(e) => setSelectedId(Number(e.target.value))}
                      >
                        {!events.length && (
                          <option value="">No tournaments yet</option>
                        )}
                        {events.map((e) => (
                          <option key={e.id} value={e.id}>
                            {e.name}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                )}
                {view === "account" ? (
                  <AccountPanel
                    user={session.user}
                    refresh={refresh}
                    login={() => setModal("login")}
                  />
                ) : (
                  <CommunityPanel
                    onMatch={setMatch}
                    t={t}
                    user={session.user}
                    mode={view}
                    refresh={refresh}
                    login={() => setModal("login")}
                  />
                )}
              </>
            )}
        </main>
      </div>
      {toast && (
        <div className="toast" role="status">
          <Check size={16} />
          {toast}
          <button
            className="tiny-button"
            onClick={() => setToast("")}
            aria-label="Dismiss notification"
          >
            <X size={14} />
          </button>
        </div>
      )}
      {modal === "login" && (
        <AuthDialog
          close={close}
          success={async () => {
            await refresh();
            const s = await api<Session>("/session");
            setView(s.user?.role === "admin" ? "overview" : "dashboard");
          }}
        />
      )}
      {modal && modal !== "login" && (
        <ModalShell
          close={close}
          title={
            modal === "create"
              ? "Set the stage."
              : modal === "player"
                ? "Meet your next contender."
                : modal === "enroll"
                  ? "Build the lineup."
                  : "Your organizer playbook."
          }
          subtitle={
            modal === "create"
              ? "A few details. A whole new competition."
              : modal === "enroll"
                ? "Choose participants from your workspace roster."
                : undefined
          }
        >
          {error && (
            <div className="form-error" role="alert">
              {error}
            </div>
          )}
          {modal === "create" && (
            <form onSubmit={submitCreate}>
              <Field label="Tournament name">
                <input
                  name="name"
                  placeholder="e.g. Weekend Warriors Cup"
                  maxLength={100}
                  required
                />
              </Field>
              <div className="form-row">
                <Field label="Game">
                  <input
                    name="game"
                    placeholder="e.g. VALORANT"
                    maxLength={100}
                    required
                  />
                </Field>
                <Field label="Format">
                  <select name="format" defaultValue="single_elimination">
                    {Object.entries(formatLabel).map(([v, label]) => (
                      <option key={v} value={v}>
                        {label}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
              <div className="form-row">
                <Field label="Participant limit">
                  <select name="capacity" defaultValue="16">
                    {[4, 8, 16, 32, 64, 128].map((n) => (
                      <option key={n}>{n}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Match series">
                  <select name="bestOf" defaultValue="3">
                    {[1, 3, 5, 7].map((n) => (
                      <option key={n} value={n}>
                        Best of {n}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
              <Field label="Starts at (your local time)">
                <input
                  type="datetime-local"
                  name="date"
                  defaultValue={localDate(
                    new Date(Date.now() + 86400000).toISOString(),
                  )}
                  required
                />
              </Field>
              <div className="form-row">
                <Field label="Location">
                  <input name="venue" defaultValue="Online" maxLength={150} />
                </Field>
                <Field label="Prize pool (optional)">
                  <input
                    name="prize"
                    placeholder="e.g. ₹25,000"
                    maxLength={80}
                  />
                </Field>
              </div>
              <div className="modal-actions">
                <button
                  type="button"
                  className="secondary-button"
                  onClick={close}
                >
                  Cancel
                </button>
                <button className="primary-button" disabled={busy}>
                  {busy ? (
                    <LoaderCircle className="spin" size={15} />
                  ) : (
                    <Plus size={15} />
                  )}{" "}
                  Create tournament
                </button>
              </div>
            </form>
          )}
          {modal === "player" && (
            <form onSubmit={savePlayer}>
              <Field label="Team or player name">
                <input
                  name="name"
                  placeholder="e.g. Team Phoenix"
                  maxLength={100}
                  required
                />
              </Field>
              <Field label="Short tag">
                <input name="tag" placeholder="PHX" maxLength={8} required />
              </Field>
              <div className="modal-actions">
                <button
                  type="button"
                  className="secondary-button"
                  onClick={close}
                >
                  Cancel
                </button>
                <button className="primary-button" disabled={busy}>
                  Add participant <Plus size={15} />
                </button>
              </div>
            </form>
          )}
          {modal === "enroll" && t && (() => {
            const available = players.filter(
              (p) => !t.entries.some((e) => e.id === p.id),
            );
            const spotsLeft = Math.max(0, t.capacity - t.entries.length);
            const chosen = picked.filter((pid) =>
              available.some((p) => p.id === pid),
            );
            const full = chosen.length >= spotsLeft;
            const allOn =
              available.length > 0 &&
              chosen.length === Math.min(available.length, spotsLeft);
            return (
              <>
                {available.length > 0 && (
                  <div className="enroll-toolbar">
                    <label className="check-field">
                      <input
                        type="checkbox"
                        checked={allOn}
                        disabled={busy || spotsLeft === 0}
                        onChange={() =>
                          setPicked(
                            allOn
                              ? []
                              : available.slice(0, spotsLeft).map((p) => p.id),
                          )
                        }
                      />
                      <span>Select all</span>
                    </label>
                    <span className="muted">
                      {chosen.length} selected · {spotsLeft} spot
                      {spotsLeft === 1 ? "" : "s"} left
                    </span>
                  </div>
                )}
                <div className="enroll-list">
                  {available.map((p) => {
                    const on = chosen.includes(p.id);
                    return (
                      <label
                        key={p.id}
                        className={`enroll-row${on ? " on" : ""}`}
                      >
                        <input
                          type="checkbox"
                          checked={on}
                          disabled={busy || (!on && full)}
                          onChange={() =>
                            setPicked(
                              on
                                ? chosen.filter((pid) => pid !== p.id)
                                : [...chosen, p.id],
                            )
                          }
                        />
                        <TeamMark name={p.name} color={p.color} />
                        <strong>{p.name}</strong>
                      </label>
                    );
                  })}
                  {available.length === 0 && (
                    <p className="muted">
                      Everyone in your roster is already registered.
                    </p>
                  )}
                </div>
                <div className="modal-actions">
                  <button
                    className="text-button"
                    onClick={() => setModal("player")}
                  >
                    <Plus size={14} /> Create a new participant
                  </button>
                  <button className="secondary-button" onClick={close}>
                    Cancel
                  </button>
                  <button
                    className="primary-button"
                    disabled={busy || chosen.length === 0}
                    onClick={() =>
                      void doWork(
                        () =>
                          api(`/tournaments/${t.id}/entries/bulk`, "POST", {
                            playerIds: chosen,
                          }),
                        `${chosen.length} participant${chosen.length === 1 ? "" : "s"} added to the tournament.`,
                        true,
                        (updated: Tournament) =>
                          setEvents((all) =>
                            all.map((e) => (e.id === updated.id ? updated : e)),
                          ),
                      )
                    }
                  >
                    {busy ? (
                      <LoaderCircle className="spin" size={15} />
                    ) : (
                      <Plus size={15} />
                    )}
                    {chosen.length
                      ? `Add ${chosen.length} selected`
                      : "Add selected"}
                  </button>
                </div>
              </>
            );
          })()}
          {modal === "help" && (
            <div className="playbook">
              {[
                [
                  "01",
                  "Create your tournament",
                  "Choose a game, format, series length, and date. Your event starts as a draft.",
                ],
                [
                  "02",
                  "Build your lineup",
                  "Add teams to the workspace roster, enroll them in your tournament, then arrange or shuffle the seeds.",
                ],
                [
                  "03",
                  "Let the games begin",
                  "Generate your bracket. Select a ready match and report its result — winners advance automatically.",
                ],
                [
                  "04",
                  "Keep everyone in the loop",
                  "Share the bracket link. Connected viewers receive updates automatically. Use Activity to review changes.",
                ],
              ].map(([n, title, text]) => (
                <div key={n}>
                  <span>{n}</span>
                  <div>
                    <h3>{title}</h3>
                    <p>{text}</p>
                  </div>
                </div>
              ))}
              <p className="help-note">
                Corrections require a reason. If a later match has started, the
                tournament engine may lock earlier results to keep the bracket
                consistent.
              </p>
            </div>
          )}
        </ModalShell>
      )}
      {match && t && (
        <PhaseMatchDialog
          key={`${t.id}-${match.id}`}
          match={t.matches.find((m) => m.id === match.id) ?? match}
          tournament={t}
          close={close}
          busy={busy}
          error={error}
          authenticated={session.authenticated}
          user={session.user}
          refresh={refresh}
          login={() => {
            setMatch(null);
            setModal("login");
          }}
          submit={(data, override) =>
            void doWork(
              () =>
                api(
                  `/tournaments/${t.id}/matches/${match.id}/${override ? "override" : "result"}`,
                  "PATCH",
                  { ...data, revision: t.revision },
                ),
              override
                ? "Result corrected. Bracket updated."
                : "Result saved. Bracket updated.",
              true,
            )
          }
          saveMetadata={(data) =>
            void doWork(
              () =>
                api(
                  `/tournaments/${t.id}/matches/${match.id}/metadata`,
                  "PATCH",
                  data,
                ),
              "Match schedule saved.",
              true,
            )
          }
        />
      )}
    </div>
  );
}

function Stat({
  icon,
  label,
  value,
  detail,
  foot,
  dot,
  progress,
  orange,
  gold,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  detail?: string;
  foot: string;
  dot?: boolean;
  progress?: number;
  orange?: boolean;
  gold?: boolean;
}) {
  return (
    <div
      className={`stat-card ${orange ? "orange-stat" : ""} ${gold ? "gold-stat" : ""}`}
    >
      <div className="stat-top">
        <span>{label}</span>
        {icon}
      </div>
      <div className="stat-value">
        {value}
        <span>{detail}</span>
      </div>
      <div className="stat-foot">
        {dot && <i />}
        {foot}
      </div>
      {progress !== undefined && (
        <div className="progress-track">
          <span style={{ width: `${progress * 100}%` }} />
        </div>
      )}
    </div>
  );
}
function PageHeading({
  eyebrow,
  title,
  subtitle,
  action,
}: {
  eyebrow: string;
  title: string;
  subtitle: string;
  action?: ReactNode;
}) {
  return (
    <div className="page-heading">
      <div>
        <span className="eyebrow orange">{eyebrow}</span>
        <h1>{title}</h1>
        <p className="muted">{subtitle}</p>
      </div>
      {action}
    </div>
  );
}
function SearchBox({
  value,
  set,
  placeholder,
}: {
  value: string;
  set: (v: string) => void;
  placeholder: string;
}) {
  return (
    <label className="search-box">
      <Search size={16} />
      <input
        aria-label={placeholder}
        value={value}
        onChange={(e) => set(e.target.value)}
        placeholder={placeholder}
      />
      {value && (
        <button
          className="tiny-button"
          aria-label="Clear search"
          onClick={() => set("")}
        >
          <X size={13} />
        </button>
      )}
    </label>
  );
}
function EventCard({
  event: e,
  open,
}: {
  event: Tournament;
  open: () => void;
}) {
  return (
    <button className="event-card" onClick={open}>
      <div className="event-card-art">
        <Gamepad2 size={53} strokeWidth={1} />
        <span>{e.game}</span>
        <Badge status={e.status} />
        <div className="event-art-grid" />
      </div>
      <div className="event-card-body">
        <div className="event-card-game">
          {e.game} <ArrowUpRight size={16} />
        </div>
        <h3>{e.name}</h3>
        <p>
          {formatLabel[e.format]} <span>·</span> BO{e.bestOf}
        </p>
        <div className="event-card-footer">
          <span>
            <CalendarDays size={13} />
            {dateLabel(e.date)}
          </span>
          <span>
            <Users size={13} />
            {e.entries.length}/{e.capacity}
          </span>
        </div>
      </div>
    </button>
  );
}
function Matches({
  matches,
  onSelect,
}: {
  matches: Match[];
  onSelect: (m: Match) => void;
}) {
  const [filter, setFilter] = useState("all");
  const filtered = matches.filter(
    (m) =>
      filter === "all" ||
      (filter === "finished"
        ? finished(m)
        : filter === "ready"
          ? playable(m) && !finished(m)
          : !playable(m)),
  );
  return (
    <>
      <div className="match-filters">
        {[
          ["all", "All matches"],
          ["ready", "Ready to play"],
          ["finished", "Completed"],
          ["upcoming", "Upcoming"],
        ].map(([v, label]) => (
          <button
            key={v}
            className={filter === v ? "active" : ""}
            onClick={() => setFilter(v)}
          >
            {label}
          </button>
        ))}
      </div>
      {filtered.length ? (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>MATCH</th>
                <th>MATCHUP</th>
                <th>RESULT</th>
                <th>STATUS</th>
                <th>SCHEDULE</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {filtered.map((m) => (
                <tr
                  key={m.id}
                  onClick={() => onSelect(m)}
                  className="clickable-row"
                >
                  <td className="muted">
                    M{String(m.id + 1).padStart(2, "0")}
                    <small className="block">Round {m.round}</small>
                  </td>
                  <td>
                    <div className="table-matchup">
                      <span>
                        <TeamMark
                          name={m.home?.name ?? "BYE"}
                          color={m.home?.color}
                          small
                        />
                        {m.home?.name ?? "BYE"}
                      </span>
                      <small>vs</small>
                      <span>
                        <TeamMark
                          name={m.away?.name ?? "BYE"}
                          color={m.away?.color}
                          small
                        />
                        {m.away?.name ?? "BYE"}
                      </span>
                    </div>
                  </td>
                  <td className="score-cell">
                    {m.home?.score ?? "–"} <span>:</span> {m.away?.score ?? "–"}
                  </td>
                  <td>
                    <span
                      className={`match-status ${finished(m) ? "done" : playable(m) ? "ready" : ""}`}
                    >
                      {finished(m)
                        ? "Completed"
                        : playable(m)
                          ? "Ready to play"
                          : "Upcoming"}
                    </span>
                  </td>
                  <td className="muted">
                    {m.scheduledAt
                      ? `${dateLabel(m.scheduledAt)} · ${timeLabel(m.scheduledAt)}`
                      : "Unscheduled"}
                  </td>
                  <td>
                    <button
                      className="icon-button"
                      aria-label={`Open match ${m.id + 1}`}
                    >
                      <ArrowUpRight size={15} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <Empty
          icon={<Swords size={32} />}
          title="No matches here yet."
          text="Your matchups will appear when the bracket is ready."
        />
      )}
    </>
  );
}
function ActivityList({
  items,
}: {
  items: {
    id: string;
    action: string;
    detail: string;
    at: string;
    tournament?: string;
  }[];
}) {
  return (
    <div className="activity-list">
      {items.length ? (
        items.map((a) => (
          <div className="activity-item" key={a.id}>
            <span
              className={`activity-icon ${a.action.includes("RESULT") ? "orange" : ""}`}
            >
              {a.action.includes("RESULT") ? (
                <Swords size={16} />
              ) : a.action.includes("PARTICIPANT") ? (
                <Users size={16} />
              ) : (
                <Activity size={16} />
              )}
            </span>
            <div>
              <h4>{a.action.toLowerCase().replaceAll("_", " ")}</h4>
              <p>{a.detail}</p>
              {a.tournament && <small>{a.tournament}</small>}
            </div>
            <time title={new Date(a.at).toLocaleString()}>
              {dateLabel(a.at)}
              <small>{timeLabel(a.at)}</small>
            </time>
          </div>
        ))
      ) : (
        <Empty
          title="A fresh start."
          text="Tournament changes and match results will be recorded here."
        />
      )}
    </div>
  );
}
function Standings({ tournament: t }: { tournament: Tournament }) {
  const list = t.entries
    .map((e) => ({
      ...e,
      wins: t.matches.filter(
        (m) =>
          (m.home?.name === e.name && m.home.result === "win") ||
          (m.away?.name === e.name && m.away.result === "win"),
      ).length,
      losses: t.matches.filter(
        (m) =>
          (m.home?.name === e.name && m.home.result === "loss") ||
          (m.away?.name === e.name && m.away.result === "loss"),
      ).length,
      draws: t.matches.filter(
        (m) =>
          (m.home?.name === e.name && m.home.result === "draw") ||
          (m.away?.name === e.name && m.away.result === "draw"),
      ).length,
    }))
    .sort(
      (a, b) =>
        b.wins - a.wins ||
        a.losses - b.losses ||
        b.draws - a.draws ||
        a.seed - b.seed,
    );
  return (
    <div className="standings">
      {list.map((e, i) => (
        <div key={e.id}>
          <span className="muted">{String(i + 1).padStart(2, "0")}</span>
          <TeamMark name={e.name} color={e.color} small />
          <strong>{e.name}</strong>
          <span>
            {e.wins}W{" "}
            <span className="muted">
              {t.format === "round_robin" ? `/ ${e.draws}D ` : ""}/ {e.losses}L
            </span>
          </span>
        </div>
      ))}
    </div>
  );
}
function SettingsForm({
  tournament: t,
  save,
  archive,
  busy,
}: {
  tournament: Tournament;
  save: (d: unknown) => void;
  archive: () => void;
  busy: boolean;
}) {
  const [confirm, setConfirm] = useState(false);
  return (
    <div className="settings-content">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          save({
            name: f.get("name"),
            game: f.get("game"),
            date: new Date(String(f.get("date"))).toISOString(),
            venue: f.get("venue"),
            prize: f.get("prize"),
            description: f.get("description"),
          });
        }}
      >
        <h2>Tournament details</h2>
        <p className="muted">The details that make this competition yours.</p>
        <Field label="Tournament name">
          <input
            name="name"
            defaultValue={t.name}
            maxLength={100}
            required
            disabled={t.status === "archived"}
          />
        </Field>
        <div className="form-row">
          <Field label="Game">
            <input
              name="game"
              defaultValue={t.game}
              maxLength={100}
              required
              disabled={t.status === "archived"}
            />
          </Field>
          <Field label="Starts at (your local time)">
            <input
              type="datetime-local"
              name="date"
              defaultValue={localDate(t.date)}
              required
              disabled={t.status === "archived"}
            />
          </Field>
        </div>
        <div className="form-row">
          <Field label="Location">
            <input
              name="venue"
              defaultValue={t.venue}
              maxLength={150}
              disabled={t.status === "archived"}
            />
          </Field>
          <Field label="Prize pool">
            <input
              name="prize"
              defaultValue={t.prize}
              maxLength={80}
              disabled={t.status === "archived"}
            />
          </Field>
        </div>
        <Field label="About the event">
          <textarea
            name="description"
            defaultValue={t.description}
            maxLength={2000}
            rows={4}
            disabled={t.status === "archived"}
          />
        </Field>
        <button
          className="primary-button"
          disabled={busy || t.status === "archived"}
        >
          Save changes <Check size={14} />
        </button>
      </form>
      {t.status !== "archived" && (
        <div className="archive-box">
          <h3>Archive tournament</h3>
          <p className="muted">
            Keep every result and activity record, and close the tournament to
            further changes.
          </p>
          {confirm ? (
            <div className="toolbar-actions">
              <button
                className="danger-button"
                onClick={archive}
                disabled={busy}
              >
                Confirm archive
              </button>
              <button
                className="secondary-button"
                onClick={() => setConfirm(false)}
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              className="secondary-button"
              onClick={() => setConfirm(true)}
            >
              Archive tournament
            </button>
          )}
        </div>
      )}
    </div>
  );
}
