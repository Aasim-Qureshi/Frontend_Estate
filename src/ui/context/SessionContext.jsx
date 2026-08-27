import React, { createContext, useContext, useState, useEffect } from "react";

const SessionContext = createContext();
const USER_STORAGE_KEY = "user";

const getSessionStorage = () => {
  if (typeof window === "undefined") return null;
  return window.sessionStorage || null;
};

const getLocalStorage = () => {
  if (typeof window === "undefined") return null;
  return window.localStorage || null;
};

const safeRemove = (storage, key) => {
  if (!storage) return;
  try {
    storage.removeItem(key);
  } catch (error) {
    console.warn(`Failed to remove ${key} from storage`, error);
  }
};

const safeSet = (storage, key, value) => {
  if (!storage) return;
  try {
    storage.setItem(key, value);
  } catch (error) {
    console.warn(`Failed to persist ${key} in storage`, error);
  }
};

export const useSession = () => {
  const context = useContext(SessionContext);
  if (!context) {
    throw new Error("useSession must be used within SessionProvider");
  }
  return context;
};

/**
 * Auth is now Spark Vision's cookie session (sv_identity / sv_session /
 * sv_csrf), managed entirely by the main-process API handler
 * (packageHandlers.js) — it reads those cookies back onto every request and
 * writes/clears them from Set-Cookie responses. This context no longer
 * stores or tracks a bearer token at all; it only mirrors the `user` object
 * for the renderer to read synchronously.
 */
export const SessionProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isGuest, setIsGuest] = useState(false);

  // Initialize session from sessionStorage on mount.
  // Also clear legacy auth keys left in storage from older app versions
  // (the old system stored a JWT under "token"; Spark Vision has none).
  useEffect(() => {
    const sessionStorageRef = getSessionStorage();
    const localStorageRef = getLocalStorage();

    const savedUser = sessionStorageRef?.getItem(USER_STORAGE_KEY);

    if (savedUser) {
      try {
        const parsed = JSON.parse(savedUser);
        if (typeof parsed === "string") {
          setUser({ id: parsed, guest: true });
          setIsGuest(true);
        } else {
          setUser(parsed);
          setIsGuest(Boolean(parsed?.guest));
        }
      } catch (e) {
        console.error("Failed to parse saved user:", e);
        safeRemove(sessionStorageRef, USER_STORAGE_KEY);
      }
    }

    safeRemove(sessionStorageRef, "token");
    safeRemove(localStorageRef, USER_STORAGE_KEY);
    safeRemove(localStorageRef, "token");

    setIsLoading(false);
  }, []);

  const login = (userData) => {
    const sessionStorageRef = getSessionStorage();
    const localStorageRef = getLocalStorage();

    let normalizedUser = userData;
    let guestFlag = false;

    if (typeof userData === "string") {
      normalizedUser = { id: userData, guest: true };
      guestFlag = true;
    } else if (userData?.guest) {
      guestFlag = true;
    }

    setUser(normalizedUser);
    setIsGuest(guestFlag);
    safeSet(
      sessionStorageRef,
      USER_STORAGE_KEY,
      JSON.stringify(normalizedUser),
    );
    safeRemove(localStorageRef, USER_STORAGE_KEY);
  };

  const logout = () => {
    const sessionStorageRef = getSessionStorage();
    const localStorageRef = getLocalStorage();

    setUser(null);
    setIsGuest(false);
    safeRemove(sessionStorageRef, USER_STORAGE_KEY);
    safeRemove(localStorageRef, USER_STORAGE_KEY);

    // Let Spark Vision clear its own sv_session cookie (it responds with a
    // Set-Cookie that expires it; packageHandlers.js's cookie-removal logic
    // then removes it from Electron's cookie store). Fire-and-forget: the
    // renderer's user state is already cleared above regardless of outcome.
    if (window?.electronAPI?.apiRequest) {
      void window.electronAPI
        .apiRequest("POST", "/api/auth/logout")
        .catch((err) => {
          console.warn("[Session] Spark Vision logout call failed:", err);
        });
    }
  };

  const updateUser = (userData) => {
    const sessionStorageRef = getSessionStorage();
    const localStorageRef = getLocalStorage();

    setUser(userData);
    setIsGuest(Boolean(userData?.guest));
    safeSet(sessionStorageRef, USER_STORAGE_KEY, JSON.stringify(userData));
    safeRemove(localStorageRef, USER_STORAGE_KEY);
  };

  return (
    <SessionContext.Provider
      value={{
        user,
        isLoading,
        login,
        logout,
        updateUser,
        isAuthenticated: !!user,
        isGuest,
      }}
    >
      {children}
    </SessionContext.Provider>
  );
};

export default SessionContext;
