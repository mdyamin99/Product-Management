import { createContext, useContext } from "react";

export interface User {
  id: string;
  name: string;
  email: string;
  createdAt: string;
  lastLoginAt: string | null;
}

/**
 * `loading` until the refresh cookie has been exchanged on first paint, so
 * the router never flashes the login screen at a signed-in user.
 */
export type AuthStatus = "loading" | "authenticated" | "anonymous";

export interface RegisterInput {
  name: string;
  email: string;
  password: string;
  confirmPassword: string;
}

export interface AuthContextValue {
  status: AuthStatus;
  user: User | null;
  login: (email: string, password: string) => Promise<void>;
  register: (input: RegisterInput) => Promise<void>;
  logout: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);

  if (context === null) {
    throw new Error("useAuth must be used inside an <AuthProvider>");
  }

  return context;
}
