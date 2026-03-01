"use client";

import { createContext, useContext, useState, useEffect, type ReactNode } from "react";

export type WalletMode = "public" | "private";

type WalletModeContextValue = {
  mode: WalletMode;
  setMode: (mode: WalletMode) => void;
};

const WalletModeContext = createContext<WalletModeContextValue>({
  mode: "public",
  setMode: () => {},
});

export function WalletModeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<WalletMode>("public");

  // Hydrate from localStorage on mount
  useEffect(() => {
    const stored = localStorage.getItem("wallet_mode") as WalletMode | null;
    if (stored === "public" || stored === "private") setModeState(stored);
  }, []);

  function setMode(next: WalletMode) {
    setModeState(next);
    localStorage.setItem("wallet_mode", next);
  }

  return (
    <WalletModeContext.Provider value={{ mode, setMode }}>
      {children}
    </WalletModeContext.Provider>
  );
}

export function useWalletMode() {
  return useContext(WalletModeContext);
}
