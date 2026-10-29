import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { ToastProvider } from "./hooks/useToasts";
import { ModeProvider } from "./lib/mode";
import { ReferralProvider } from "./lib/referral";
import { I18nProvider } from "./lib/i18n";
import "./index.css";

const el = document.getElementById("root");
if (!el) throw new Error("#root not found");

createRoot(el).render(
  <React.StrictMode>
    <I18nProvider>
      <ToastProvider>
        <ModeProvider>
          <ReferralProvider>
            <App />
          </ReferralProvider>
        </ModeProvider>
      </ToastProvider>
    </I18nProvider>
  </React.StrictMode>,
);
