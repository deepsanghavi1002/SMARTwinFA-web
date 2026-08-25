"use client";
import { type ReactNode, useEffect, useState } from "react";
import {
  Box,
  Button,
  Card,
  CardContent,
  CssBaseline,
  FormControl,
  InputLabel,
  List,
  ListItemButton,
  ListItemText,
  MenuItem,
  Paper,
  Select,
  Stack,
  TextField,
  ThemeProvider,
  Typography,
  createTheme,
} from "@mui/material";

type StartupContext = {
  source: "legacy-postgresql";
  authenticationMode: "migration-test";
  companies: Array<{ id: string; name: string; code: string; address: string }>;
  years: Array<{ id: string; label: string }>;
};

const migrationAccessUser = "SRP";

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
  const [username, setUsername] = useState("SRP");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [context, setContext] = useState<StartupContext | null>(null);
  const [contextError, setContextError] = useState("");
  const [year, setYear] = useState("");
  const [company, setCompany] = useState("");
  const [modernView, setModernView] = useState(false);
  const accountingYears = context?.years ?? [];
  const companies = context?.companies ?? [];

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/legacy/startup", { signal: controller.signal, cache: "no-store" })
      .then(async (response) => {
        const body = await response.json() as StartupContext | { error?: string };
        if (!response.ok || !("companies" in body)) throw new Error("error" in body && body.error ? body.error : "Startup data could not be loaded");
        return body;
      })
      .then((body) => {
        setContext(body);
        setYear(body.years[0]?.id ?? "");
        setCompany(body.companies[0]?.id ?? "");
      })
      .catch((reason: unknown) => {
        if (reason instanceof DOMException && reason.name === "AbortError") return;
        setContextError(reason instanceof Error ? reason.message : "Startup data could not be loaded");
      });
    return () => controller.abort();
  }, []);

  const viewButton = (
    <button className={`view-switch ${modernView ? "modern-active" : "legacy-active"}`} type="button" onClick={() => setModernView((current) => !current)} aria-label={modernView ? "Switch to legacy view" : "Switch to modern view"} aria-pressed={modernView}>
      <span className="view-switch-state">{modernView ? "Modern view" : "Legacy view"}</span>
      <span className="view-switch-action">{modernView ? "Switch to legacy" : "Switch to modern"} <b aria-hidden="true">⇄</b></span>
    </button>
  );
  if (stage === "ready") return <div className={`view-mode ${modernView ? "modern-view" : "legacy-view"}`}>{viewButton}{children}</div>;
  const login = () => {
    if (username.trim().toUpperCase() === migrationAccessUser && password.trim().length > 0) { setError(""); setStage("company"); }
    else setError("Invalid user name or password");
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
              <Card sx={{ width: "min(920px, 100%)", overflow: "hidden", borderRadius: 3, boxShadow: "0 22px 48px rgba(25, 50, 95, 0.16)" }}>
                <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", md: "310px minmax(0,1fr)" } }}>
                  <Box
                    sx={{
                      p: { xs: 3, md: 4 },
                      color: "#fff",
                      background: "linear-gradient(180deg,#173f7c 0%,#1565c0 72%,#1f8ca5 100%)",
                      display: "flex",
                      flexDirection: "column",
                      justifyContent: "space-between",
                      minHeight: { md: 448 },
                      gap: 4,
                    }}
                  >
                    <Stack spacing={2}>
                      <Typography variant="overline" sx={{ opacity: 0.88, letterSpacing: ".12em" }}>SMARTwinFA</Typography>
                      <Typography variant="h5" sx={{ fontWeight: 700 }}>User Login</Typography>
                    </Stack>
                    <Stack spacing={1.25} sx={{ width: "100%", alignItems: "center", textAlign: "center" }}>
                      <Box component="img" className="login-logo" src="/smartwinfa-logo.svg" alt="SMARTwinFA logo" />
                      <Typography variant="caption" sx={{ color: "#dcecff", letterSpacing: ".14em" }}>DEVELOPED BY</Typography>
                      <Typography variant="body2" sx={{ color: "#fff", fontWeight: 700, letterSpacing: ".03em" }}>PRANAV COMPUTERS</Typography>
                    </Stack>
                  </Box>
                  <CardContent sx={{ display: "grid", alignContent: "center", p: { xs: 3, md: 4.5 } }}>
                    <Stack component="form" spacing={1.75} onSubmit={(event) => { event.preventDefault(); login(); }}>
                      <Typography variant="h6" sx={{ color: "#173b57" }}>Sign in</Typography>
                      <TextField label="Today's Date" value={new Date().toLocaleDateString("en-GB")} slotProps={{ htmlInput: { readOnly: true } }} fullWidth />
                      <TextField label="User Name" value={username} onChange={(event) => setUsername(event.target.value.toUpperCase())} fullWidth />
                      <TextField label="Password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} fullWidth />
                      <Typography variant="body2" color="error" role="alert" sx={{ minHeight: 24 }}>
                        {error}
                      </Typography>
                      <Typography variant="caption" sx={{ color: contextError ? "error.main" : "text.secondary" }}>{contextError || "Migration test access; company and year come from PostgreSQL."}</Typography>
                      <Stack direction={{ xs: "column", sm: "row" }} spacing={1.25} sx={{ justifyContent: "flex-end", pt: 0.5 }}>
                        <Button type="submit" variant="contained" sx={{ minWidth: 128, minHeight: 42 }}>Login</Button>
                      </Stack>
                    </Stack>
                  </CardContent>
                </Box>
              </Card>
            ) : (
              <Card sx={{ width: "min(1040px, 100%)", borderRadius: 2, boxShadow: "0 18px 42px rgba(25, 50, 95, 0.14)" }}>
                <CardContent sx={{ p: { xs: 3, md: 3.5 } }}>
                  <Stack spacing={2.5}>
                    <Stack spacing={0.75}>
                      <Typography variant="h4" sx={{ color: "#173b57", fontSize: { xs: "2rem", md: "2.35rem" } }}>Select company</Typography>
                      <Typography variant="body1" sx={{ color: "#6d8393" }}>
                        Choose accounting year and company.
                      </Typography>
                    </Stack>
                    <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", lg: "280px minmax(0,1fr)" }, gap: 2 }}>
                      <Paper variant="outlined" sx={{ p: 2, borderRadius: 2, borderColor: "#dbe6ef", boxShadow: "none" }}>
                        <Stack spacing={1.25}>
                          <FormControl fullWidth>
                            <InputLabel id="year-label">Accounting Year</InputLabel>
                            <Select labelId="year-label" label="Accounting Year" value={year} onChange={(event) => setYear(event.target.value)}>
                              {accountingYears.map((item) => <MenuItem key={item.id} value={item.id}>{item.label}</MenuItem>)}
                            </Select>
                          </FormControl>
                        </Stack>
                      </Paper>
                      <Paper variant="outlined" sx={{ p: 1.25, borderRadius: 2, borderColor: "#dbe6ef", boxShadow: "none" }}>
                        <Typography variant="subtitle1" sx={{ px: 1.25, py: 0.75, fontWeight: 700, color: "#173b57" }}>
                          Company list
                        </Typography>
                        <List sx={{ maxHeight: 320, overflow: "auto" }}>
                          {companies.map((item) => (
                            <ListItemButton
                              key={item.id}
                              selected={company === item.id}
                              onClick={() => setCompany(item.id)}
                              sx={{
                                borderRadius: 1.5,
                                mb: 0.5,
                                px: 1.25,
                                py: 0.75,
                                "&.Mui-selected": {
                                  backgroundColor: "#e8f0fb",
                                },
                                "&.Mui-selected:hover": {
                                  backgroundColor: "#dfeaf8",
                                },
                              }}
                            >
                              <ListItemText
                                primary={item.name}
                                secondary={item.code}
                                slotProps={{
                                  primary: { sx: { fontWeight: company === item.id ? 700 : 500, fontSize: "1rem" } },
                                  secondary: { sx: { fontSize: ".9rem" } },
                                }}
                              />
                            </ListItemButton>
                          ))}
                        </List>
                      </Paper>
                    </Box>
                    <Stack direction={{ xs: "column", sm: "row" }} spacing={1.25} sx={{ justifyContent: "flex-end" }}>
                      <Button variant="outlined" onClick={() => setStage("login")}>Exit</Button>
                      <Button variant="contained" disabled={!context || !year || !company} onClick={() => setStage("ready")}>Continue</Button>
                    </Stack>
                  </Stack>
                </CardContent>
              </Card>
            )}
          </Box>
        </div>
      </ThemeProvider>
    );
  }

  return <div className="view-mode legacy-view">{viewButton}<main className="startup-desktop legacy-startup">
    {stage === "login" ? <section className="legacy-auth-window" aria-label="User login screen">
      <aside className="legacy-auth-brand"><div className="legacy-auth-logo" role="img" aria-label="SMARTwinFA logo"/><strong>SMART WINFA</strong><span>Modern Technology ✓</span><small>Simple Accounting. Smart Business.</small></aside>
      <form className="legacy-auth-form" onSubmit={(event) => { event.preventDefault(); login(); }}>
        <span className="legacy-screen-caption">User Login Screen</span><h1>Welcome Back!</h1><p>Please login to continue</p>
        <label><strong>▦ Today&apos;s Date</strong><input value={new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })} readOnly /></label>
        <label><strong>♙ User Name</strong><input value={username} onChange={(event) => setUsername(event.target.value.toUpperCase())} /></label>
        <label><strong>▢ Password</strong><input type="password" value={password} onChange={(event) => setPassword(event.target.value)} /></label>
        <p className="login-error" role="alert">{error}</p>
        <small className="startup-source-status">{contextError || "Migration test access; company and year come from PostgreSQL."}</small>
        <div className="legacy-auth-actions"><button className="legacy-login-button" type="submit">👤 ▶ LOGIN</button><button type="button">🚪 ✕ CLOSE</button></div>
        <small>Developed By</small><b>PRANAV COMPUTERS</b>
      </form>
    </section> : <section className="legacy-company-window" aria-label="Company selection menu">
      <aside className="legacy-auth-brand"><div className="legacy-auth-logo" role="img" aria-label="SMARTwinFA logo"/><strong>SMART WINFA</strong><span>Select Your Company</span></aside>
      <div className="legacy-company-panel"><h1>Company Selection</h1><p>Select accounting year and company to continue</p>
        <label className="legacy-year-select"><strong>▦ Accounting Year</strong><select size={2} value={year} onChange={(event) => setYear(event.target.value)}>{accountingYears.slice().reverse().map((item) => <option key={item.id} value={item.id}>▣ {item.label}</option>)}</select></label>
        <div className="legacy-company-grid"><strong>▦ Select Company</strong><div className="legacy-company-grid-head"><span>NAME</span><span>CO_SHORT</span><span>ADDRESS_1</span></div>{companies.map((item) => <button className={company === item.id ? "selected" : ""} key={item.id} type="button" onClick={() => setCompany(item.id)}><span>{item.name}</span><span>{item.code}</span><span>{item.address}</span></button>)}</div>
        {contextError && <p className="login-error" role="alert">{contextError}</p>}
        <div className="legacy-company-actions"><button disabled={!context || !year || !company} onClick={() => setStage("ready")}>✓ OK</button><button onClick={() => setStage("login")}>✕ CLOSE</button></div>
      </div>
    </section>}
  </main></div>;
}
