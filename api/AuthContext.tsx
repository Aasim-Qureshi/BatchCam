import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
} from "react";
import { tokenStore, authApi, loginAndSave, signupAndSave, User } from "./api";

interface AuthState {
  user: User | null;
  isLoading: boolean;
  isAuthenticated: boolean;
}

interface AuthContextValue extends AuthState {
  login: (email: string, password: string) => Promise<void>;
  signup: (
    email: string,
    password: string,
    companyName: string,
  ) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AuthState>({
    user: null,
    isLoading: true,
    isAuthenticated: false,
  });

  // On mount — check if a token exists and fetch the current user
  useEffect(() => {
    (async () => {
      try {
        const token = await tokenStore.getToken();
        if (token) {
          const user = await authApi.me();
          setState({ user, isLoading: false, isAuthenticated: true });
        } else {
          setState((s) => ({ ...s, isLoading: false }));
        }
      } catch {
        // Token is stale / expired — clear it
        await tokenStore.clear();
        setState({ user: null, isLoading: false, isAuthenticated: false });
      }
    })();
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const res = await loginAndSave(email, password);
    setState({ user: res.user, isLoading: false, isAuthenticated: true });
  }, []);

  const signup = useCallback(
    async (email: string, password: string, companyName: string) => {
      const res = await signupAndSave(email, password, companyName);
      setState({ user: res.user, isLoading: false, isAuthenticated: true });
    },
    [],
  );

  const logout = useCallback(async () => {
    await authApi.logout();
    setState({ user: null, isLoading: false, isAuthenticated: false });
  }, []);

  return (
    <AuthContext.Provider value={{ ...state, login, signup, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
