"use client";
import { type ReactNode, useState } from "react";
import { accountingYears, companies, mockUser } from "./mock-data";

export function StartupGate({ children }: { children: ReactNode }) {
  const [stage, setStage] = useState<"login" | "company" | "ready">("login");
  const [username, setUsername] = useState("SRP");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [year, setYear] = useState("2026");
  const [company, setCompany] = useState("dreamhouse");

  if (stage === "ready") return <>{children}</>;
  const login = () => {
    if (username.trim().toUpperCase() === mockUser.username && password === mockUser.password) { setError(""); setStage("company"); }
    else setError("Invalid user name or password");
  };

  return <main className="startup-desktop">
    {stage === "login" ? <section className="login-window" aria-label="User login screen">
      <div className="startup-title">Smart-WinFA <button aria-label="Close">×</button></div>
      <div className="login-panel"><h1>User Login Screen</h1><div className="login-content"><div className="login-brand"><div className="login-logo" role="img" aria-label="SMARTwinFA logo"/><div className="developer-credit"><span>Developed By</span><strong>PRANAV COMPUTERS</strong></div></div><form onSubmit={(event) => { event.preventDefault(); login(); }}>
        <label>Today&apos;s Date:<input value="18/08/2026" readOnly /></label>
        <label>User Name:<input autoFocus value={username} onChange={(event) => setUsername(event.target.value.toUpperCase())} /></label>
        <label>Password:<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} /></label>
        <p className="login-error" role="alert">{error}</p><p className="mock-hint">Mock login: SRP / smart123</p>
        <button className="login-button" type="submit"><span>➜</span> Login</button>
      </form></div></div>
    </section> : <section className="company-window" aria-label="Company selection menu">
      <div className="startup-title">Select Company <button aria-label="Close" onClick={() => setStage("login")}>×</button></div>
      <div className="company-panel"><h1>Company Selection Menu</h1>
        <label><strong>Select Accounting Year</strong><select size={3} value={year} onChange={(event) => setYear(event.target.value)}>{accountingYears.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
        <label><strong>Select Company</strong><select size={4} value={company} onChange={(event) => setCompany(event.target.value)}>{companies.map((item) => <option key={item.id} value={item.id}>{item.name}    {item.code}</option>)}</select></label>
        <div className="company-actions"><button onClick={() => setStage("ready")}>✓ Ok</button><button onClick={() => setStage("login")}>↩ Exit</button></div>
      </div>
    </section>}
  </main>;
}
