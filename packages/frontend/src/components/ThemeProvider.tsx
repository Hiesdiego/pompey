/**
 * ThemeProvider — dark/light mode via the `dark` class on <html>.
 * Persists to localStorage ("tickr-theme"), defaults to dark.
 * An inline script in layout.tsx sets the initial class before paint
 * to avoid a flash of the wrong theme.
 */

"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

export type Theme = "dark" | "light";

const STORAGE_KEY = "tickr-theme";

const ThemeContext = createContext<{ theme: Theme; toggle: () => void }>({
  theme: "dark",
  toggle: () => {},
});

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>("dark");

  // Sync from localStorage on mount (the pre-paint script already applied it).
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      setTheme(saved === "light" ? "light" : "dark");
    } catch {
      /* private mode — stay dark */
    }
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      /* ignore */
    }
  }, [theme]);

  const toggle = useCallback(
    () => setTheme((t) => (t === "dark" ? "light" : "dark")),
    []
  );

  return (
    <ThemeContext.Provider value={{ theme, toggle }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
