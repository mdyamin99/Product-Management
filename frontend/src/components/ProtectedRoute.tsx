import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { LoadingScreen } from "./LoadingScreen";

/**
 * Renders its children only for signed-in users. While the session is being
 * restored we show a spinner rather than bouncing to /login, which would
 * flash the sign-in form at every user who reloads the page.
 */
export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  const location = useLocation();

  if (status === "loading") {
    return <LoadingScreen label="Restoring your session…" />;
  }

  if (status === "anonymous") {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  return <>{children}</>;
}
