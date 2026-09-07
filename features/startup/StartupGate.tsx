"use client";
import { createContext, type ReactNode, useContext, useEffect, useState } from "react";
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

const modernTheme = createTheme({
  palette: {
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

export function StartupGate({ children }: { children: ReactNode }) {
  const [stage, setStage] = useState<"login" | "company" | "ready">("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [dataError, setDataError] = useState("");
  const [operators, setOperators] = useState<Operator[]>([]);
  const [operator, setOperator] = useState<Operator | null>(null);
  const [accountingYears, setAccountingYears] = useState<AccountingYear[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [companiesLoading, setCompaniesLoading] = useState(false);
  const [year, setYear] = useState("");
  const [company, setCompany] = useState("");
  const [modernView, setModernView] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/operators", { signal: controller.signal, cache: "no-store" })
      .then(async (response) => {
        const body = await response.json() as { operators?: Operator[]; error?: string };
        if (!response.ok || !body.operators) throw new Error(body.error || "Operator list could not be loaded");
        return body.operators;
      })
      .then((rows) => { setOperators(rows); setUsername((current) => current || rows[0]?.loginName || ""); })
      .catch((reason: unknown) => {
        if (reason instanceof DOMException && reason.name === "AbortError") return;
        setDataError(reason instanceof Error ? reason.message : "Operator list could not be loaded");
      });
    return () => controller.abort();
  }, []);

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
    fetch(`/api/accounting-years?login=${encodeURIComponent(operator.loginName)}`, { signal: controller.signal, cache: "no-store" })
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
    fetch(`/api/companies?login=${encodeURIComponent(operator.loginName)}&year=${selectedYearKey}`, { signal: controller.signal, cache: "no-store" })
      .then(async (response) => {
        const body = await response.json() as { companies?: Company[]; error?: string };
        if (!response.ok || !body.companies) throw new Error(body.error || "Company list could not be loaded");
        return body.companies;
      })
      .then((rows) => {
        setCompanies(rows);
        setCompany((rows.find((item) => item.available) ?? rows[0])?.id ?? "");
        setDataError("");
        setCompaniesLoading(false);
      })
      .catch((reason: unknown) => {
        if (reason instanceof DOMException && reason.name === "AbortError") return;
        setCompaniesLoading(false);
        setDataError(reason instanceof Error ? reason.message : "Company list could not be loaded");
      });
    return () => controller.abort();
  }, [operator, selectedYearKey]);

  const selectedCompany = companies.find((item) => item.id === company);
  const canContinue = Boolean(selectedYear && selectedCompany?.available);

  const viewButton = (
    <button className={`view-switch ${modernView ? "modern-active" : "legacy-active"}`} type="button" onClick={() => setModernView((current) => !current)} aria-label={modernView ? "Switch to legacy view" : "Switch to modern view"}>
      <span>Legacy</span>
      <span>Modern</span>
    </button>
  );
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
    return <StartupSelectionContext.Provider value={selection}><div className={`view-mode ${modernView ? "modern-view" : "legacy-view"}`}>{viewButton}{children}</div></StartupSelectionContext.Provider>;
  }
  // The typed operator is matched against the real user_master list. The
  // legacy user_pw column is a fixed-width obfuscation whose algorithm is not
  // part of this conversion, so the password is required but not verified —
  // this must not be presented as authenticated access.
  const login = () => {
    if (!operators.length) { setError(dataError || "Operator list is still loading"); return; }
    const match = operators.find((item) => item.loginName.toUpperCase() === username.trim().toUpperCase());
    if (!match || !password.trim().length) { setError("Invalid user name or password"); return; }
    setAccountingYears([]);
    chooseYear("");
    setOperator(match);
    setError("");
    setStage("company");
  };

  if (modernView) {
    return (
      <ThemeProvider theme={modernTheme}>
        <CssBaseline />
        <div className="view-mode modern-view">
          {viewButton}
          <Box
            sx={{
              minHeight: "100vh",
              display: "grid",
              placeItems: "center",
              p: 2.5,
              background:
                "radial-gradient(circle at top, #f9fcff 0%, #e5f0fb 24%, #cfe2f4 52%, #a8c4e8 100%)",
            }}
          >
            {stage === "login" ? (
              <Card sx={{ width: "min(860px, 100%)", overflow: "hidden", borderRadius: 2, boxShadow: "0 18px 42px rgba(25, 50, 95, 0.14)" }}>
                <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", md: "280px minmax(0,1fr)" } }}>
                  <Box
                    sx={{
                      p: { xs: 3, md: 4 },
                      color: "#fff",
                      background: "linear-gradient(180deg,#173f7c 0%,#1565c0 72%,#1f8ca5 100%)",
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
                        <Typography variant="h4" sx={{ color: "#1a3a52", fontWeight: 700, fontSize: "2rem" }}>Welcome Back!</Typography>
                        <Typography variant="body2" sx={{ color: "#6b7c8c" }}>Please login to continue</Typography>
                      </Stack>
                      <TextField
                        label="Today's Date"
                        value={new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}
                        slotProps={{
                          htmlInput: { readOnly: true },
                          input: {
                            startAdornment: <InputAdornment position="start"><span style={{ color: "#1976d2", fontSize: 18, marginRight: 4 }}>📅</span></InputAdornment>
                          }
                        }}
                        fullWidth
                      />
                      <TextField
                        label="User Name"
                        value={username}
                        onChange={(event) => setUsername(event.target.value.toUpperCase())}
                        slotProps={{
                          input: {
                            startAdornment: <InputAdornment position="start"><span style={{ color: "#1976d2", fontSize: 18, marginRight: 4 }}>👤</span></InputAdornment>
                          }
                        }}
                        fullWidth
                      />
                      <TextField
                        label="Password"
                        type={showPassword ? "text" : "password"}
                        value={password}
                        onChange={(event) => setPassword(event.target.value)}
                        slotProps={{
                          input: {
                            startAdornment: <InputAdornment position="start"><span style={{ color: "#1976d2", fontSize: 18, marginRight: 4 }}>🔒</span></InputAdornment>,
                            endAdornment: (
                              <InputAdornment position="end">
                                <IconButton
                                  onClick={() => setShowPassword(!showPassword)}
                                  edge="end"
                                  sx={{ color: "#6b7c8c" }}
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
                        {error}
                      </Typography>
                      <Stack direction={{ xs: "column", sm: "row" }} spacing={1.25} sx={{ justifyContent: "center", alignItems: "center" }}>
                        <Button
                          type="submit"
                          variant="contained"
                          sx={{
                            flex: 1,
                            background: "linear-gradient(135deg, #1565c0 0%, #0f7c90 58%)",
                            textTransform: "none",
                            fontSize: "1rem",
                            fontWeight: 700,
                            py: 1.3,
                            '&:hover': {
                              background: "linear-gradient(135deg, #1565c0 0%, #0f7c90 58%)",
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
              <Card sx={{ width: "min(1000px, 100%)", overflow: "hidden", borderRadius: 3, boxShadow: "0 22px 48px rgba(25, 50, 95, 0.16)" }}>
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
                        <Typography variant="h4" sx={{ color: "#173b57", fontSize: { xs: "1.9rem", md: "2.15rem" } }}>Company Selection</Typography>
                        <Typography variant="body2" sx={{ color: "#6d8393" }}>Select accounting year and company to continue</Typography>
                      </Stack>

                      <Stack spacing={0.75}>
                        <Typography variant="subtitle2" sx={{ color: "#1976d2", fontWeight: 700 }}>Accounting Year</Typography>
                        <Paper variant="outlined" sx={{ borderColor: "#dbe6ef", boxShadow: "none", maxHeight: 108, overflow: "auto" }}>
                          <List dense disablePadding>
                            {!accountingYears.length && <ListItemText sx={{ px: 1.5, py: 1 }} primary="Loading accounting years…" />}
                            {accountingYears.map((item) => (
                              <ListItemButton key={item.id} selected={year === item.id} onClick={() => chooseYear(item.id)}>
                                <ListItemText
                                  primary={item.label}
                                  slotProps={{ primary: { sx: { fontWeight: year === item.id ? 700 : 500, color: year === item.id ? "#1565c0" : "#28394a" } } }}
                                />
                              </ListItemButton>
                            ))}
                          </List>
                        </Paper>
                      </Stack>

                      <Stack spacing={0.75}>
                        <Typography variant="subtitle2" sx={{ color: "#1976d2", fontWeight: 700 }}>Select Company</Typography>
                        <Paper variant="outlined" sx={{ borderColor: "#8fa2b4", boxShadow: "none", maxHeight: 240, overflow: "auto" }}>
                          <Box sx={{ display: "grid", gridTemplateColumns: "minmax(240px,1fr) 130px minmax(150px,.7fr)", position: "sticky", top: 0, background: "#eef2f6", fontWeight: 700, fontSize: 13, borderBottom: "1px solid #8fa2b4" }}>
                            <Box sx={{ px: 1, py: .75, borderRight: "1px solid #b9c6d2" }}>NAME</Box>
                            <Box sx={{ px: 1, py: .75, borderRight: "1px solid #b9c6d2" }}>CO_SHORT</Box>
                            <Box sx={{ px: 1, py: .75 }}>ADDRESS_1</Box>
                          </Box>
                          {companiesLoading && <Box sx={{ px: 1, py: 1.25, color: "#6d8393" }}>Loading companies…</Box>}
                          {!companiesLoading && !companies.length && <Box sx={{ px: 1, py: 1.25, color: "#6d8393" }}>No company is opened for this accounting year.</Box>}
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
                                borderBottom: "1px solid #dbe3ea",
                                cursor: item.available ? "pointer" : "not-allowed",
                                color: item.available ? (company === item.id ? "#0d47a1" : "#28394a") : "#93a1b0",
                                background: company === item.id ? "#dbe9fb" : item.available ? "#fff" : "#f5f7f9",
                                "&:hover": { background: item.available ? (company === item.id ? "#d3e3f8" : "#f2f7fd") : "#f5f7f9" },
                              }}
                            >
                              <Box sx={{ px: 1, py: .75, borderRight: "1px solid #e4eaf0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.name}</Box>
                              <Box sx={{ px: 1, py: .75, borderRight: "1px solid #e4eaf0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.code}</Box>
                              <Box sx={{ px: 1, py: .75, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.address}</Box>
                            </Box>
                          ))}
                        </Paper>
                      </Stack>

                      {dataError && <Typography variant="body2" color="error" role="alert">{dataError}</Typography>}

                      <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5} sx={{ justifyContent: "center", pt: .5 }}>
                        <Button variant="contained" disabled={!canContinue} onClick={() => setStage("ready")} sx={{ minWidth: 160, py: 1.1, fontWeight: 700 }}>✓ OK</Button>
                        <Button variant="outlined" onClick={() => setStage("login")} sx={{ minWidth: 160, py: 1.1, fontWeight: 700, color: "#dc2626", borderColor: "#d1d5db", "&:hover": { borderColor: "#dc2626", backgroundColor: "#fee2e2" } }}>✕ CLOSE</Button>
                      </Stack>
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

  return <div className={`view-mode ${modernView ? "modern-view" : "legacy-view"}`}>{viewButton}<main className="startup-desktop">
    {stage === "login" ? <section className="login-window" aria-label="User login screen">
      <div className="startup-title">Smart-WinFA <button aria-label="Close">×</button></div>
      <div className="login-panel"><h1>User Login Screen</h1><div className="login-content"><div className="login-brand"><div className="login-logo" role="img" aria-label="SMARTwinFA logo"/><div className="developer-credit"><span>Developed By</span><strong>PRANAV COMPUTERS</strong></div></div><form onSubmit={(event) => { event.preventDefault(); login(); }}>
        <label>Today&apos;s Date:<input value={new Date().toLocaleDateString("en-GB")} readOnly /></label>
        <label>User Name:<input value={username} onChange={(event) => setUsername(event.target.value.toUpperCase())} /></label>
        <label>Password:<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} /></label>
        <p className="login-error" role="alert">{error}</p>
        <button className="login-button" type="submit"><span>➜</span> Login</button>
      </form></div></div>
    </section> : <section className="company-window" aria-label="Company selection menu">
      <div className="startup-title">Select Company <button aria-label="Close" onClick={() => setStage("login")}>×</button></div>
      <div className="company-panel"><h1>Company Selection Menu</h1>
        <label><strong>Select Accounting Year</strong><select size={3} value={year} onChange={(event) => chooseYear(event.target.value)}>{accountingYears.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
        <label><strong>Select Company</strong><select size={4} value={company} onChange={(event) => setCompany(event.target.value)}>{companies.map((item) => <option key={item.id} value={item.id} disabled={!item.available}>{item.name} {item.code}</option>)}</select></label>
        {dataError && <p className="login-error" role="alert">{dataError}</p>}
        <div className="company-actions"><button disabled={!canContinue} onClick={() => setStage("ready")}>✓ Ok</button><button onClick={() => setStage("login")}>↩ Exit</button></div>
      </div>
    </section>}
  </main></div>;
}
