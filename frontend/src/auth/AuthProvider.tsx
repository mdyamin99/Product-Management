import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  apiFetch,
  ensureAccessToken,
  setAccessToken,
  subscribeToSession,
} from "../api/client";
import {
  AuthContext,
  type AuthContextValue,
  type AuthStatus,
  type RegisterInput,
  type User,
} from "./AuthContext";

interface SessionPayload {
  data: { user: User; accessToken: string; expiresIn: number };
}

interface MePayload {
  data: { user: User };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>("loading");
  const [user, setUser] = useState<User | null>(null);

  // Restore the session from the httpOnly refresh cookie on first load.
  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const token = await ensureAccessToken();

        if (token === null) throw new Error("No active session");

        const me = await apiFetch<MePayload>("/auth/me");

        if (cancelled) return;

        setUser(me.data.user);
        setStatus("authenticated");
      } catch {
        if (cancelled) return;

        setAccessToken(null);
        setUser(null);
        setStatus("anonymous");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  // A refresh that finally fails means the cookie is gone (or was revoked
  // elsewhere), so drop the user no matter which component noticed.
  useEffect(
    () =>
      subscribeToSession(() => {
        setUser(null);
        setStatus("anonymous");
      }),
    [],
  );

  const login = useCallback(async (email: string, password: string) => {
    const session = await apiFetch<SessionPayload>(
      "/auth/login",
      { method: "POST", body: JSON.stringify({ email, password }) },
      false,
    );

    setAccessToken(session.data.accessToken);
    setUser(session.data.user);
    setStatus("authenticated");
  }, []);

  const register = useCallback(async (input: RegisterInput) => {
    const session = await apiFetch<SessionPayload>(
      "/auth/register",
      { method: "POST", body: JSON.stringify(input) },
      false,
    );

    setAccessToken(session.data.accessToken);
    setUser(session.data.user);
    setStatus("authenticated");
  }, []);

  const logout = useCallback(async () => {
    try {
      await apiFetch("/auth/logout", { method: "POST" }, false);
    } finally {
      // Sign out locally even if the request failed — the user asked to leave.
      setAccessToken(null);
      setUser(null);
      setStatus("anonymous");
    }
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ status, user, login, register, logout }),
    [status, user, login, register, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
