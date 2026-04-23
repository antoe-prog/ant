import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import { AuthProvider } from "./auth/AuthContext";
import { resolveGatewayBase } from "./gateway";
import "./index.css";

const gatewayBase = resolveGatewayBase();

const routerBase = (import.meta.env.BASE_URL || "/").replace(/\/$/, "") || "/";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter basename={routerBase}>
      <AuthProvider baseUrl={gatewayBase}>
        <App />
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
);
