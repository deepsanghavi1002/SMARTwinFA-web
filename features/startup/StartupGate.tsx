"use client";
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  Box,
  Button,
  Card,
  CardContent,
  CssBaseline,
  IconButton,
  InputAdornment,
  List,
  ListItemButton,
  ListItemText,
  Paper,
  Stack,
  TextField,
  ThemeProvider,
  Typography,
  createTheme,
} from "@mui/material";

// SMARTwinFA is installed per client, so the operator, accounting-year and
// company lists are read live from smart_system at runtime. Nothing on these
// screens may be carried in the application: a literal here would show one
// client's companies to another.
type Operator = { userNo: number; loginName: string; displayName: string; userType: string | null; department: string | null };
/** The signed-in web user (lib/auth/public-user.ts). */
type WebUser = { id: number; login: string; email: string | null; displayName: string; role: string; canManageUsers: boolean; choosesOperator: boolean };
type Me = { user: WebUser; operator: Operator | null; problem: string | null };
type AccountingYear = { key: number; id: string; label: string };
type Company = { key: number; id: string; name: string; code: string; address: string; group: string | null; dataName: string; available: boolean };

/** The company, accounting year and operator chosen on the startup screens. */
export type StartupSelection = Readonly<{
  companyId: string;
  companyName: string;
  /** The company's own database name (CO_DATANAME) that routes its data. */
  companySchema: string;
  /** CO_GROUP, which decides which menus this company may open. */
  companyGroup: string | null;
  yearKey: number;
  yearId: string;
  yearLabel: string;
  loginName: string;
  displayName: string;
}>;

const StartupSelectionContext = createContext<StartupSelection | null>(null);

export function useStartupSelection() {
  return useContext(StartupSelectionContext);
}

/** What a screen under the gate can ask of it. */
export type StartupActions = Readonly<{
  /** SETUP > COMPANY > SELECT: back to the company and accounting year selection, as after the login. */
  changeCompany: () => void;
  /** Log out: every window closes and the login screen shows again. */
  logout: () => void;
}>;

const StartupActionsContext = createContext<StartupActions | null>(null);

export function useStartupActions() {
  return useContext(StartupActionsContext);
}

export type ModernTheme = "light" | "dark";

export type ViewModeContextValue = {
  modernView: boolean;
  setModernView: React.Dispatch<React.SetStateAction<boolean>>;
  /** The Modern view's colour theme: the one chosen here, or the browser's own light / dark setting until then. */
  modernTheme: ModernTheme;
  setModernTheme: (next: ModernTheme) => void;
};

const ViewModeContext = createContext<ViewModeContextValue | null>(null);

/** Legacy or Modern, kept in this browser so a reload or the next sign-in opens the same view (held in memory where storage is blocked). */
const VIEW_KEY = "view-mode";
let modernNow: boolean | null = null;
const viewListeners = new Set<() => void>();
function readModernView(): boolean {
  if (modernNow === null) {
    try { modernNow = window.localStorage.getItem(VIEW_KEY) === "modern"; } catch { modernNow = false; }
  }
  return modernNow;
}
function writeModernView(next: React.SetStateAction<boolean>) {
  modernNow = typeof next === "function" ? next(readModernView()) : next;
  try { window.localStorage.setItem(VIEW_KEY, modernNow ? "modern" : "legacy"); } catch { /* the choice is only a convenience */ }
  for (const listener of viewListeners) listener();
}
function subscribeModernView(listener: () => void) {
  viewListeners.add(listener);
  // Another tab of this browser switching view switches this one too.
  const onStorage = (event: StorageEvent) => { if (event.key === VIEW_KEY) { modernNow = null; listener(); } };
  window.addEventListener("storage", onStorage);
  return () => { viewListeners.delete(listener); window.removeEventListener("storage", onStorage); };
}

/** Light or Dark for the Modern view, kept in this browser (the browser's own setting decides until one is chosen). */
const THEME_KEY = "modern-theme";
let themeNow: ModernTheme | null = null;
const themeListeners = new Set<() => void>();
function readModernTheme(): ModernTheme {
  if (themeNow === null) {
    let stored: string | null = null;
    try { stored = window.localStorage.getItem(THEME_KEY); } catch { stored = null; }
    let system: ModernTheme = "light";
    try { system = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"; } catch { system = "light"; }
    themeNow = stored === "dark" || stored === "light" ? stored : system;
  }
  return themeNow;
}
function writeModernTheme(next: ModernTheme) {
  themeNow = next;
  try { window.localStorage.setItem(THEME_KEY, next); } catch { /* the choice is only a convenience */ }
  for (const listener of themeListeners) listener();
}
function subscribeModernTheme(listener: () => void) {
  themeListeners.add(listener);
  const onStorage = (event: StorageEvent) => { if (event.key === THEME_KEY) { themeNow = null; listener(); } };
  window.addEventListener("storage", onStorage);
  return () => { themeListeners.delete(listener); window.removeEventListener("storage", onStorage); };
}

export function useViewMode() {
  return useContext(ViewModeContext);
}

export function ViewSwitchButton({ className = "" }: { className?: string }) {
  const mode = useViewMode();
  if (!mode) return null;
  return (
    <button
      className={`view-switch ${mode.modernView ? "modern-active" : "legacy-active"} ${className}`.trim()}
      type="button"
      onClick={() => mode.setModernView((current) => !current)}
      aria-label={mode.modernView ? "Switch to legacy view" : "Switch to modern view"}
    >
      <span>Legacy</span>
      <span>Modern</span>
    </button>
  );
}

const muiTheme = (mode: ModernTheme) => createTheme({
  palette: mode === "dark"
    ? {
      mode: "dark",
      primary: { main: "#F5B544", contrastText: "#0E131B" },
      secondary: { main: "#5AA9FF" },
      background: { default: "#090C12", paper: "#111722" },
      text: { primary: "#E9EEF5", secondary: "#8A96A8" },
    }
    : {
      mode: "light",
      primary: { main: "#1976d2" },
      secondary: { main: "#26a69a" },
      background: { default: "#eef4fb", paper: "#ffffff" },
    },
  shape: { borderRadius: 6 },
  typography: {
    fontFamily: "Roboto, Aptos, Segoe UI, Arial, sans-serif",
    h4: { fontWeight: 700, letterSpacing: "-0.02em", fontSize: "2.15rem" },
    h6: { fontWeight: 700, fontSize: "1.1rem" },
    button: { textTransform: "none", fontWeight: 600 },
  },
});
const muiLight = muiTheme("light");
const muiDark = muiTheme("dark");

export function StartupGate({ children }: { children: ReactNode }) {
  const [stage, setStage] = useState<"login" | "operator" | "company" | "ready">("login");
  /** The session cookie is being checked: the login form waits (it is what shows when there is no session). */
  const [checking, setChecking] = useState(true);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [signingIn, setSigningIn] = useState(false);
  const [error, setError] = useState("");
  const [dataError, setDataError] = useState("");
  const [user, setUser] = useState<WebUser | null>(null);
  /** The operators a platform admin may work as (the operator screen only). */
  const [operators, setOperators] = useState<Operator[]>([]);
  const [operator, setOperator] = useState<Operator | null>(null);
  /** The operator highlighted on the operator screen. */
  const [pick, setPick] = useState("");
  const [accountingYears, setAccountingYears] = useState<AccountingYear[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [companiesLoading, setCompaniesLoading] = useState(false);
  const [year, setYear] = useState("");
  const [company, setCompany] = useState("");
  // The server's page is Legacy; the browser switches to the remembered view once it has started.
  const modernView = useSyncExternalStore(subscribeModernView, readModernView, () => false);
  const modernTheme = useSyncExternalStore(subscribeModernTheme, readModernTheme, (): ModernTheme => "light");
  const dark = modernView && modernTheme === "dark";
  // The page itself carries the view and theme, so overlays outside the screens (message boxes, pop-ups) follow them too.
  useEffect(() => {
    const root = document.documentElement;
    if (modernView) root.dataset.mtheme = modernTheme; else delete root.dataset.mtheme;
  }, [modernView, modernTheme]);
  /** The company screen was opened from the menu (not after the login): Exit goes back to the company that was open. */
  const [fromMenu, setFromMenu] = useState(false);
  const openBefore = useRef<{ year: string; company: string } | null>(null);
  /** The company to highlight when the year list refills after Exit put the year back. */
  const restoreCompany = useRef<string | null>(null);
  /**
   * Set at sign-in: when the newest year holds exactly one company, it opens without the company
   * screen (a client's installation normally carries just its own company, one database per year).
   * SETUP > COMPANY > SELECT still opens the screen to change the year.
   */
  const autoOpen = useRef(false);

  /**
   * After the server accepted the sign-in (or the page opened with a live session): straight to
   * the company screen as the linked operator, or to the operator screen for a platform admin.
   */
  const enter = useCallback(async (me: Me) => {
    setUser(me.user);
    setPassword("");
    setError("");
    setAccountingYears([]);
    setYear("");
    setCompanies([]);
    setCompany("");
    if (me.operator) { autoOpen.current = true; setOperator(me.operator); setStage("company"); return; }
    if (me.user.choosesOperator) {
      const response = await fetch("/api/operators", { cache: "no-store" });
      const body = await response.json() as { operators?: Operator[]; error?: string };
      setOperators(body.operators ?? []);
      setDataError(response.ok ? "" : body.error || "Operator list could not be loaded");
      setStage("operator");
      return;
    }
    // Signed in, but nothing to open the books as: an admin can still manage users.
    setError(me.problem || "No operator is linked to this user");
    setStage("login");
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/auth/me", { signal: controller.signal, cache: "no-store" })
      .then(async (response) => {
        if (response.status === 401) return;
        const body = await response.json() as Me & { error?: string };
        if (!response.ok) throw new Error(body.error || "The session could not be read");
        await enter(body);
      })
      .catch((reason: unknown) => {
        if (reason instanceof DOMException && reason.name === "AbortError") return;
        setError(reason instanceof Error ? reason.message : "The session could not be read");
      })
      .finally(() => { if (!controller.signal.aborted) setChecking(false); });
    return () => controller.abort();
  }, [enter]);

  // Highlighting a year empties the grid before it refills, the way the
  // desktop's Lbox_CoSelect_AcYear double-click handler does.
  const chooseYear = (id: string) => {
    setYear(id);
    setCompanies([]);
    setCompany("");
    setCompaniesLoading(id.length > 0);
  };

  // Setup_CompanySelect reads the year list for the operator who just signed
  // in: USER_YEAR and WEBSITE decide which years and companies they may open.
  useEffect(() => {
    if (!operator) return;
    const controller = new AbortController();
    // The server answers for the session's own operator; the browser does not name one.
    fetch("/api/accounting-years", { signal: controller.signal, cache: "no-store" })
      .then(async (response) => {
        const body = await response.json() as { years?: AccountingYear[]; error?: string };
        if (!response.ok || !body.years) throw new Error(body.error || "Accounting years could not be loaded");
        return body.years;
      })
      .then((rows) => { setAccountingYears(rows); chooseYear(rows[0]?.id ?? ""); setDataError(""); })
      .catch((reason: unknown) => {
        if (reason instanceof DOMException && reason.name === "AbortError") return;
        setDataError(reason instanceof Error ? reason.message : "Accounting years could not be loaded");
      });
    return () => controller.abort();
  }, [operator]);

  const selectedYear = accountingYears.find((item) => item.id === year);
  const selectedYearKey = selectedYear?.key;

  // The desktop grid refills whenever the highlighted year changes.
  useEffect(() => {
    if (!operator || selectedYearKey === undefined) return;
    const controller = new AbortController();
    fetch(`/api/companies?year=${selectedYearKey}`, { signal: controller.signal, cache: "no-store" })
      .then(async (response) => {
        const body = await response.json() as { companies?: Company[]; error?: string };
        if (!response.ok || !body.companies) throw new Error(body.error || "Company list could not be loaded");
        return body.companies;
      })
      .then((rows) => {
        setCompanies(rows);
        const wanted = restoreCompany.current;
        restoreCompany.current = null;
        const back = wanted ? rows.find((item) => item.id === wanted && item.available) : undefined;
        setCompany(back ? back.id : (rows.find((item) => item.available) ?? rows[0])?.id ?? "");
        setDataError("");
        setCompaniesLoading(false);
        // Only the first list after sign-in (the newest year) may skip the screen.
        if (autoOpen.current) {
          autoOpen.current = false;
          if (rows.length === 1 && rows[0].available) setStage("ready");
        }
      })
      .catch((reason: unknown) => {
        if (reason instanceof DOMException && reason.name === "AbortError") return;
        setCompaniesLoading(false);
        setDataError(reason instanceof Error ? reason.message : "Company list could not be loaded");
      });
    return () => controller.abort();
  }, [operator, selectedYearKey]);

  const selectedCompany = companies.find((item) => item.id === company);
  const changeCompany = useCallback(() => {
    openBefore.current = { year, company };
    setFromMenu(true);
    setStage("company");
  }, [year, company]);
  /** Back to the login: the session ends on the server, the operator, company and year are forgotten, and the windows (children) go with the ready screen. */
  const logout = useCallback(() => {
    void fetch("/api/auth/logout", { method: "POST", cache: "no-store" }).catch(() => undefined);
    openBefore.current = null;
    autoOpen.current = false;
    setFromMenu(false);
    setPassword("");
    setError("");
    setUser(null);
    setOperator(null);
    setOperators([]);
    setAccountingYears([]);
    setCompanies([]);
    setYear("");
    setCompany("");
    setStage("login");
  }, []);
  const actions = useMemo<StartupActions>(() => ({ changeCompany, logout }), [changeCompany, logout]);
  /** OK on the company screen. */
  const confirmCompany = () => { openBefore.current = null; setFromMenu(false); setStage("ready"); };
  /** Exit / close on the company screen: from the menu, back to the company that was open; after the login, signs out. */
  const leaveCompany = () => {
    if (fromMenu && openBefore.current) {
      const before = openBefore.current;
      if (before.year !== year) { restoreCompany.current = before.company; chooseYear(before.year); } else setCompany(before.company);
      openBefore.current = null;
      setFromMenu(false);
      setStage("ready");
      return;
    }
    logout();
  };
  /** A platform admin picks the operator this session works as. */
  const chooseOperator = async (loginName: string) => {
    setDataError("");
    const response = await fetch("/api/auth/operator", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ operator: loginName }),
      cache: "no-store",
    }).catch(() => null);
    const body = response ? await response.json().catch(() => ({})) as { operator?: Operator; error?: string } : {};
    if (!response?.ok || !body.operator) { setDataError(body.error || "The operator could not be chosen"); return; }
    setAccountingYears([]);
    chooseYear("");
    autoOpen.current = true;
    setOperator(body.operator);
    setStage("company");
  };
  const manageUsers = user?.canManageUsers
    ? <a className="manage-users-link" href="/admin/users">Manage users</a>
    : null;
  const canContinue = Boolean(selectedYear && selectedCompany?.available);

  const viewModeValue = useMemo(() => ({ modernView, setModernView: writeModernView, modernTheme, setModernTheme: writeModernTheme }), [modernView, modernTheme]);

  if (stage === "ready" && operator && selectedYear && selectedCompany) {
    const selection: StartupSelection = {
      companyId: selectedCompany.id,
      companyName: selectedCompany.name,
      companySchema: selectedCompany.dataName,
      companyGroup: selectedCompany.group,
      yearKey: selectedYear.key,
      yearId: selectedYear.id,
      yearLabel: selectedYear.label,
      loginName: operator.loginName,
      displayName: operator.displayName,
    };
    return (
      <ViewModeContext.Provider value={viewModeValue}>
        <StartupSelectionContext.Provider value={selection}>
          <StartupActionsContext.Provider value={actions}>
            <div className={`view-mode ${modernView ? "modern-view" : "legacy-view"}`} data-mtheme={modernView ? modernTheme : undefined}>
              {children}
            </div>
          </StartupActionsContext.Provider>
        </StartupSelectionContext.Provider>
      </ViewModeContext.Provider>
    );
  }
  // The server checks the web password (app/api/auth/login) and sets an HttpOnly session cookie.
  // The legacy user_pw column is never used: users set a web password from an invitation link.
  const login = async () => {
    if (signingIn || checking) return;
    if (!username.trim() || !password) { setError("Enter your user name and password"); return; }
    setSigningIn(true);
    setError("");
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ login: username.trim(), password }),
        cache: "no-store",
      });
      const body = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) { setError(body.error || "Invalid user name or password"); return; }
      const me = await fetch("/api/auth/me", { cache: "no-store" });
      const meBody = await me.json() as Me & { error?: string };
      if (!me.ok) { setError(meBody.error || "The session could not be read"); return; }
      await enter(meBody);
    } catch {
      setError("Sign-in is not available right now");
    } finally {
      setSigningIn(false);
    }
  };
  /** A platform admin may go back to the operator screen from the company screen. */
  const canChangeOperator = Boolean(user?.choosesOperator);
  const changeOperator = () => { if (user) void enter({ user, operator: null, problem: null }); };

  // The operator screen is the same in both views: only SMARTwinFA's own staff see it.
  if (stage === "operator") {
    return (
      <main className="startup-desktop">
        <section className="company-window operator-window" aria-label="Choose the operator">
          <div className="startup-title">Work as operator <button aria-label="Sign out" onClick={logout}>×</button></div>
          <div className="company-panel">
            <h1>Choose the operator</h1>
            <p className="operator-note">Signed in as {user?.displayName}. The chosen operator&apos;s company, year and menu rights apply until you sign out.</p>
            <label><strong>Operator</strong>
              <select size={8} value={pick} onChange={(event) => setPick(event.target.value)} onDoubleClick={() => { if (pick) void chooseOperator(pick); }}>
                {operators.map((item) => <option key={item.loginName} value={item.loginName}>{item.loginName}{item.displayName !== item.loginName ? ` (${item.displayName})` : ""}{item.userType ? ` · ${item.userType}` : ""}</option>)}
              </select>
            </label>
            {dataError && <p className="login-error" role="alert">{dataError}</p>}
            <div className="company-actions">
              <button disabled={!pick} onClick={() => void chooseOperator(pick)}>✓ Ok</button>
              <button onClick={logout}>↩ Sign out</button>
            </div>
            {manageUsers}
          </div>
        </section>
      </main>
    );
  }

  if (modernView) {
    // The sign-in and company screens are drawn with MUI props, so their colours come from this table for the chosen theme.
    const T = dark
      ? { page: "radial-gradient(circle at top, #1b2740 0%, #0e131b 55%, #090c12 100%)", shadow: "0 18px 42px rgba(0, 0, 0, 0.5)", title: "#E9EEF5", sub: "#8A96A8", accent: "#F5B544", line: "#222C3C", line2: "#34425A", head: "#161E2B", text: "#E9EEF5", sel: "#F5B544", selText: "#F5B544", disabled: "#566275", selBg: "#1B2433", selHover: "#222C3C", hover: "#161E2B", rowOff: "#0E131B", row: "#111722", button: "linear-gradient(135deg, #F5B544 0%, #D98E1F 100%)", buttonText: "#0E131B", side: "linear-gradient(180deg,#0e131b 0%,#172033 72%,#1f2d45 100%)" }
      : { page: "radial-gradient(circle at top, #f9fcff 0%, #e5f0fb 24%, #cfe2f4 52%, #a8c4e8 100%)", shadow: "0 18px 42px rgba(25, 50, 95, 0.14)", title: "#1a3a52", sub: "#6b7c8c", accent: "#1976d2", line: "#dbe6ef", line2: "#b9c6d2", head: "#eef2f6", text: "#28394a", sel: "#1565c0", selText: "#0d47a1", disabled: "#93a1b0", selBg: "#dbe9fb", selHover: "#d3e3f8", hover: "#f2f7fd", rowOff: "#f5f7f9", row: "#fff", button: "linear-gradient(135deg, #1565c0 0%, #0f7c90 58%)", buttonText: "#fff", side: "linear-gradient(180deg,#173f7c 0%,#1565c0 72%,#1f8ca5 100%)" };
    return (
      <ThemeProvider theme={dark ? muiDark : muiLight}>
        <CssBaseline />
        <div className="view-mode modern-view" data-mtheme={modernTheme}>
          <Box
            sx={{
              minHeight: "100vh",
              display: "grid",
              placeItems: "center",
              p: 2.5,
              background:
                T.page,
            }}
          >
            {stage === "login" ? (
              <Card sx={{ width: "min(860px, 100%)", overflow: "hidden", borderRadius: 2, boxShadow: T.shadow }}>
                <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", md: "280px minmax(0,1fr)" } }}>
                  <Box
                    sx={{
                      p: { xs: 3, md: 4 },
                      color: "#fff",
                      background: T.side,
                      display: "grid",
                      alignContent: "space-between",
                      gap: 2,
                    }}
                  >
                    <Stack spacing={2}>
                      <Typography variant="overline" sx={{ opacity: 0.88, letterSpacing: ".12em" }}>SMARTwinFA</Typography>
                      <Typography variant="h5" sx={{ fontWeight: 700 }}>User Login</Typography>
                    </Stack>
                    <Stack spacing={1} sx={{ alignItems: "flex-start" }}>
                      <Box className="login-logo" role="img" aria-label="SMARTwinFA logo" />
                      <Typography variant="caption" sx={{ color: "#dcecff", letterSpacing: ".14em" }}>DEVELOPED BY</Typography>
                      <Typography variant="body2" sx={{ color: "#fff", fontWeight: 700, letterSpacing: ".03em" }}>PRANAV COMPUTERS</Typography>
                    </Stack>
                  </Box>
                  <CardContent sx={{ p: { xs: 3, md: 3.5 } }}>
                    <Stack component="form" spacing={3} onSubmit={(event) => { event.preventDefault(); login(); }}>
                      <Stack spacing={0.5}>
                        <Typography variant="h4" sx={{ color: T.title, fontWeight: 700, fontSize: "2rem" }}>Welcome Back!</Typography>
                        <Typography variant="body2" sx={{ color: T.sub }}>Please login to continue</Typography>
                      </Stack>
                      <TextField
                        label="Today's Date"
                        value={new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}
                        slotProps={{
                          htmlInput: { readOnly: true },
                          input: {
                            startAdornment: <InputAdornment position="start"><span style={{ color: T.accent, fontSize: 18, marginRight: 4 }}>📅</span></InputAdornment>
                          }
                        }}
                        fullWidth
                      />
                      <TextField
                        label="User Name or Email"
                        value={username}
                        autoComplete="username"
                        onChange={(event) => setUsername(event.target.value)}
                        slotProps={{
                          input: {
                            startAdornment: <InputAdornment position="start"><span style={{ color: T.accent, fontSize: 18, marginRight: 4 }}>👤</span></InputAdornment>
                          }
                        }}
                        fullWidth
                      />
                      <TextField
                        label="Password"
                        type={showPassword ? "text" : "password"}
                        autoComplete="current-password"
                        value={password}
                        onChange={(event) => setPassword(event.target.value)}
                        slotProps={{
                          input: {
                            startAdornment: <InputAdornment position="start"><span style={{ color: T.accent, fontSize: 18, marginRight: 4 }}>🔒</span></InputAdornment>,
                            endAdornment: (
                              <InputAdornment position="end">
                                <IconButton
                                  onClick={() => setShowPassword(!showPassword)}
                                  edge="end"
                                  sx={{ color: T.sub }}
                                >
                                  {showPassword ? "🙈" : "👁️"}
                                </IconButton>
                              </InputAdornment>
                            )
                          }
                        }}
                        fullWidth
                      />
                      <Typography variant="body2" color="error" role="alert" sx={{ minHeight: 24 }}>
                        {checking ? "Checking your session…" : error} {manageUsers}
                      </Typography>
                      <Stack direction={{ xs: "column", sm: "row" }} spacing={1.25} sx={{ justifyContent: "center", alignItems: "center" }}>
                        <Button
                          type="submit"
                          variant="contained"
                          disabled={signingIn || checking}
                          sx={{
                            flex: 1,
                            background: T.button, color: T.buttonText,
                            textTransform: "none",
                            fontSize: "1rem",
                            fontWeight: 700,
                            py: 1.3,
                            '&:hover': {
                              background: T.button, color: T.buttonText,
                              filter: "brightness(1.1)"
                            }
                          }}
                        >
                          🧑‍💼 LOGIN
                        </Button>
                        <Typography variant="body2" sx={{ color: "#9ca3af" }}>or</Typography>
                        <Button
                          variant="outlined"
                          sx={{
                            flex: 1,
                            borderColor: "#d1d5db",
                            color: "#dc2626",
                            textTransform: "none",
                            fontSize: "1rem",
                            fontWeight: 700,
                            py: 1.3,
                            '&:hover': {
                              borderColor: "#dc2626",
                              backgroundColor: "#fee2e2"
                            }
                          }}
                          onClick={() => typeof window !== 'undefined' && window.close?.()}
                        >
                          ✕ CLOSE
                        </Button>
                      </Stack>
                    </Stack>
                  </CardContent>
                </Box>
              </Card>
            ) : (
              <Card sx={{ width: "min(1000px, 100%)", overflow: "hidden", borderRadius: 3, boxShadow: T.shadow }}>
                <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", md: "300px minmax(0,1fr)" } }}>
                  <Box
                    sx={{
                      p: { xs: 3, md: 4 },
                      color: "#fff",
                      background: "linear-gradient(180deg,#2f6ae0 0%,#2359d6 60%,#1c4bbd 100%)",
                      display: "grid",
                      alignContent: "center",
                      justifyItems: "center",
                      gap: 1.5,
                      textAlign: "center",
                    }}
                  >
                    <Box className="login-logo" role="img" aria-label="SMARTwinFA logo" />
                    <Typography variant="h5" sx={{ fontWeight: 700 }}>SMART WINFA</Typography>
                    <Typography variant="body2" sx={{ color: "#d7e5ff" }}>Select Your Company</Typography>
                  </Box>
                  <CardContent sx={{ p: { xs: 3, md: 3.5 } }}>
                    <Stack spacing={2}>
                      <Stack spacing={0.5}>
                        <Typography variant="h4" sx={{ color: T.title, fontSize: { xs: "1.9rem", md: "2.15rem" } }}>Company Selection</Typography>
                        <Typography variant="body2" sx={{ color: T.sub }}>Select accounting year and company to continue</Typography>
                      </Stack>

                      <Stack spacing={0.75}>
                        <Typography variant="subtitle2" sx={{ color: T.accent, fontWeight: 700 }}>Accounting Year</Typography>
                        <Paper variant="outlined" sx={{ borderColor: T.line, boxShadow: "none", maxHeight: 108, overflow: "auto" }}>
                          <List dense disablePadding>
                            {!accountingYears.length && <ListItemText sx={{ px: 1.5, py: 1 }} primary="Loading accounting years…" />}
                            {accountingYears.map((item) => (
                              <ListItemButton key={item.id} selected={year === item.id} onClick={() => chooseYear(item.id)}>
                                <ListItemText
                                  primary={item.label}
                                  slotProps={{ primary: { sx: { fontWeight: year === item.id ? 700 : 500, color: year === item.id ? T.sel : T.text } } }}
                                />
                              </ListItemButton>
                            ))}
                          </List>
                        </Paper>
                      </Stack>

                      <Stack spacing={0.75}>
                        <Typography variant="subtitle2" sx={{ color: T.accent, fontWeight: 700 }}>Select Company</Typography>
                        <Paper variant="outlined" sx={{ borderColor: T.line2, boxShadow: "none", maxHeight: 240, overflow: "auto" }}>
                          <Box sx={{ display: "grid", gridTemplateColumns: "minmax(240px,1fr) 130px minmax(150px,.7fr)", position: "sticky", top: 0, background: T.head, fontWeight: 700, fontSize: 13, borderBottom: "1px solid #8fa2b4" }}>
                            <Box sx={{ px: 1, py: .75, borderRight: `1px solid ${T.line2}` }}>NAME</Box>
                            <Box sx={{ px: 1, py: .75, borderRight: `1px solid ${T.line2}` }}>CO_SHORT</Box>
                            <Box sx={{ px: 1, py: .75 }}>ADDRESS_1</Box>
                          </Box>
                          {companiesLoading && <Box sx={{ px: 1, py: 1.25, color: T.sub }}>Loading companies…</Box>}
                          {!companiesLoading && !companies.length && <Box sx={{ px: 1, py: 1.25, color: T.sub }}>No company is opened for this accounting year.</Box>}
                          {companies.map((item) => (
                            <Box
                              key={item.id}
                              component="button"
                              type="button"
                              disabled={!item.available}
                              title={item.available ? item.name : `${item.dataName} is not present in this installation`}
                              onClick={() => setCompany(item.id)}
                              sx={{
                                display: "grid",
                                width: "100%",
                                gridTemplateColumns: "minmax(240px,1fr) 130px minmax(150px,.7fr)",
                                textAlign: "left",
                                font: "inherit",
                                fontSize: 14,
                                border: 0,
                                borderBottom: `1px solid ${T.line}`,
                                cursor: item.available ? "pointer" : "not-allowed",
                                color: item.available ? (company === item.id ? T.selText : T.text) : T.disabled,
                                background: company === item.id ? T.selBg : item.available ? T.row : T.rowOff,
                                "&:hover": { background: item.available ? (company === item.id ? T.selHover : T.hover) : T.rowOff },
                              }}
                            >
                              <Box sx={{ px: 1, py: .75, borderRight: `1px solid ${T.line}`, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.name}</Box>
                              <Box sx={{ px: 1, py: .75, borderRight: `1px solid ${T.line}`, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.code}</Box>
                              <Box sx={{ px: 1, py: .75, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.address}</Box>
                            </Box>
                          ))}
                        </Paper>
                      </Stack>

                      {dataError && <Typography variant="body2" color="error" role="alert">{dataError}</Typography>}

                      <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5} sx={{ justifyContent: "center", pt: .5 }}>
                        <Button variant="contained" disabled={!canContinue} onClick={confirmCompany} sx={{ minWidth: 160, py: 1.1, fontWeight: 700 }}>✓ OK</Button>
                        <Button variant="outlined" onClick={leaveCompany} sx={{ minWidth: 160, py: 1.1, fontWeight: 700, color: "#dc2626", borderColor: "#d1d5db", "&:hover": { borderColor: "#dc2626", backgroundColor: "#fee2e2" } }}>✕ CLOSE</Button>
                      </Stack>
                      {(manageUsers || canChangeOperator) && (
                        <Stack direction="row" spacing={2} sx={{ justifyContent: "center", fontSize: 14 }}>
                          {canChangeOperator && !fromMenu && <Button size="small" onClick={changeOperator}>Change operator ({operator?.loginName})</Button>}
                          {manageUsers}
                        </Stack>
                      )}
                    </Stack>
                  </CardContent>
                </Box>
              </Card>
            )}
          </Box>
        </div>
      </ThemeProvider>
    );
  }

  return (
    <ViewModeContext.Provider value={viewModeValue}>
      <div className={`view-mode ${modernView ? "modern-view" : "legacy-view"}`} data-mtheme={modernView ? modernTheme : undefined}>
        <main className="startup-desktop">
          {stage === "login" ? <section className="login-window" aria-label="User login screen">
            <div className="startup-title">Smart-WinFA <button aria-label="Close">×</button></div>
            <div className="login-panel"><h1>User Login Screen</h1><div className="login-content"><div className="login-brand"><div className="login-logo" role="img" aria-label="SMARTwinFA logo"/><div className="developer-credit"><span>Developed By</span><strong>PRANAV COMPUTERS</strong></div></div><form onSubmit={(event) => { event.preventDefault(); login(); }}>
              <label>Today&apos;s Date:<input value={new Date().toLocaleDateString("en-GB")} readOnly /></label>
              <label>User Name:<input value={username} autoComplete="username" placeholder="user name or email" onChange={(event) => setUsername(event.target.value)} /></label>
              <label>Password:<input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} /></label>
              <p className="login-error" role="alert">{checking ? "Checking your session…" : error} {manageUsers}</p>
              <button className="login-button" type="submit" disabled={signingIn || checking}><span>➜</span> Login</button>
            </form></div></div>
          </section> : <section className="company-window" aria-label="Company selection menu">
            <div className="startup-title">Select Company <button aria-label="Close" onClick={leaveCompany}>×</button></div>
            <div className="company-panel"><h1>Company Selection Menu</h1>
              <label><strong>Select Accounting Year</strong><select size={3} value={year} onChange={(event) => chooseYear(event.target.value)}>{accountingYears.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
              <label><strong>Select Company</strong><select size={4} value={company} onChange={(event) => setCompany(event.target.value)}>{companies.map((item) => <option key={item.id} value={item.id} disabled={!item.available}>{item.name} {item.code}</option>)}</select></label>
              {dataError && <p className="login-error" role="alert">{dataError}</p>}
              <div className="company-actions"><button disabled={!canContinue} onClick={confirmCompany}>✓ Ok</button><button onClick={leaveCompany}>↩ Exit</button></div>
              {(manageUsers || canChangeOperator) && <p className="company-admin-links">{canChangeOperator && !fromMenu && <button type="button" onClick={changeOperator}>Change operator ({operator?.loginName})</button>} {manageUsers}</p>}
            </div>
          </section>}
        </main>
      </div>
    </ViewModeContext.Provider>
  );
}
