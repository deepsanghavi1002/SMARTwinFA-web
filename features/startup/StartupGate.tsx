"use client";
import { type ReactNode, useState } from "react";
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
import { accountingYears, companies, mockUser } from "./mock-data";

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
  const [year, setYear] = useState("2026");
  const [company, setCompany] = useState("dreamhouse");
  const [modernView, setModernView] = useState(false);

  const viewButton = (
    <button className={`view-switch ${modernView ? "modern-active" : "legacy-active"}`} type="button" onClick={() => setModernView((current) => !current)} aria-label={modernView ? "Switch to legacy view" : "Switch to modern view"}>
      <span>Legacy</span>
      <span>Modern</span>
    </button>
  );
  if (stage === "ready") return <div className={`view-mode ${modernView ? "modern-view" : "legacy-view"}`}>{viewButton}{children}</div>;
  const login = () => {
    if (username.trim().toUpperCase() === mockUser.username && password.trim().length > 0) { setError(""); setStage("company"); }
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
                    <Stack component="form" spacing={2} onSubmit={(event) => { event.preventDefault(); login(); }}>
                      <Typography variant="h6" sx={{ color: "#173b57" }}>Sign in</Typography>
                      <TextField label="Today's Date" value="19/08/2026" slotProps={{ htmlInput: { readOnly: true } }} fullWidth />
                      <TextField label="User Name" value={username} onChange={(event) => setUsername(event.target.value.toUpperCase())} fullWidth />
                      <TextField label="Password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} fullWidth />
                      <Typography variant="body2" color="error" role="alert" sx={{ minHeight: 24 }}>
                        {error}
                      </Typography>
                      <Stack direction={{ xs: "column", sm: "row" }} spacing={1.25} sx={{ justifyContent: "flex-end" }}>
                        <Button type="submit" variant="contained">Login</Button>
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
                      <Button variant="contained" onClick={() => setStage("ready")}>Continue</Button>
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

  return <div className={`view-mode ${modernView ? "modern-view" : "legacy-view"}`}>{viewButton}<main className="startup-desktop">
    {stage === "login" ? <section className="login-window" aria-label="User login screen">
      <div className="startup-title">Smart-WinFA <button aria-label="Close">×</button></div>
      <div className="login-panel"><h1>User Login Screen</h1><div className="login-content"><div className="login-brand"><div className="login-logo" role="img" aria-label="SMARTwinFA logo"/><div className="developer-credit"><span>Developed By</span><strong>PRANAV COMPUTERS</strong></div></div><form onSubmit={(event) => { event.preventDefault(); login(); }}>
        <label>Today&apos;s Date:<input value="18/08/2026" readOnly /></label>
        <label>User Name:<input value={username} onChange={(event) => setUsername(event.target.value.toUpperCase())} /></label>
        <label>Password:<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} /></label>
        <p className="login-error" role="alert">{error}</p>
        <button className="login-button" type="submit"><span>➜</span> Login</button>
      </form></div></div>
    </section> : <section className="company-window" aria-label="Company selection menu">
      <div className="startup-title">Select Company <button aria-label="Close" onClick={() => setStage("login")}>×</button></div>
      <div className="company-panel"><h1>Company Selection Menu</h1>
        <label><strong>Select Accounting Year</strong><select size={3} value={year} onChange={(event) => setYear(event.target.value)}>{accountingYears.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
        <label><strong>Select Company</strong><select size={4} value={company} onChange={(event) => setCompany(event.target.value)}>{companies.map((item) => <option key={item.id} value={item.id}>{item.name} {item.code}</option>)}</select></label>
        <div className="company-actions"><button onClick={() => setStage("ready")}>✓ Ok</button><button onClick={() => setStage("login")}>↩ Exit</button></div>
      </div>
    </section>}
  </main></div>;
}
