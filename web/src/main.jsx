import React from "react";
import { createRoot } from "react-dom/client";
import { PrivyProvider } from "@privy-io/react-auth";
import { defineChain } from "viem";
import App from "./App.jsx";
import "./styles.css";

const robinhood = defineChain({
  id: 4663,
  name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.mainnet.chain.robinhood.com"] } },
});

const root = createRoot(document.getElementById("root"));

// Privy App ID is served at runtime, so no rebuild is needed to set/rotate it.
fetch("/config.json")
  .then((r) => r.json())
  .then((cfg) => {
    if (!cfg.privyAppId) {
      root.render(
        <div className="card">
          <h1>$GOLD — Not configured</h1>
          <p className="sub">PRIVY_APP_ID is not set on the server yet.</p>
        </div>
      );
      return;
    }
    root.render(
      <PrivyProvider
        appId={cfg.privyAppId}
        config={{
          loginMethods: ["email", "google"],
          embeddedWallets: { ethereum: { createOnLogin: "users-without-wallets" } },
          defaultChain: robinhood,
          supportedChains: [robinhood],
          appearance: { theme: "dark", accentColor: "#f5b301" },
        }}
      >
        <App cfg={cfg} />
      </PrivyProvider>
    );
  })
  .catch((e) =>
    root.render(
      <div className="card">
        <h1>$GOLD</h1>
        <p className="sub">Failed to load config: {String(e)}</p>
      </div>
    )
  );
