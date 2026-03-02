import React, { createContext, useContext, useState, useEffect } from "react";

const SessionContext = createContext();
const USER_STORAGE_KEY = "user";
const TOKEN_STORAGE_KEY = "token";

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

export const SessionProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isGuest, setIsGuest] = useState(false);

  const clearPersistedRefreshToken = async () => {
    if (!window?.electronAPI?.clearRefreshToken) return;

    const candidateBaseUrls = [
      process.env.BACKEND_URL,
      process.env.REACT_APP_BACKEND_URL,
      "http://167.71.231.64:3000",
      "http://localhost:3000",
      "http://127.0.0.1:3000",
      "https://future-electron-backend.onrender.com",
    ].filter(Boolean);

    const uniqueBaseUrls = Array.from(new Set(candidateBaseUrls));
    await Promise.allSettled(
      uniqueBaseUrls.map((baseUrl) =>
        window.electronAPI.clearRefreshToken({
          baseUrl,
          name: "refreshToken",
        }),
      ),
    );
  };

  // Initialize session from sessionStorage on mount.
  // Also clear legacy auth keys left in localStorage from older app versions.
  useEffect(() => {
    const sessionStorageRef = getSessionStorage();
    const localStorageRef = getLocalStorage();

    const savedUser = sessionStorageRef?.getItem(USER_STORAGE_KEY);
    const savedToken = sessionStorageRef?.getItem(TOKEN_STORAGE_KEY);

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

    if (savedToken && savedToken !== "undefined" && savedToken !== "null") {
      setToken(savedToken);
    }

    safeRemove(localStorageRef, USER_STORAGE_KEY);
    safeRemove(localStorageRef, TOKEN_STORAGE_KEY);

    setIsLoading(false);
  }, []);

  const login = (userData, accessToken) => {
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
    safeSet(sessionStorageRef, USER_STORAGE_KEY, JSON.stringify(normalizedUser));
    safeRemove(localStorageRef, USER_STORAGE_KEY);

    if (accessToken) {
      setToken(accessToken);
      safeSet(sessionStorageRef, TOKEN_STORAGE_KEY, accessToken);
      safeRemove(localStorageRef, TOKEN_STORAGE_KEY);
    } else {
      setToken(null);
      safeRemove(sessionStorageRef, TOKEN_STORAGE_KEY);
      safeRemove(localStorageRef, TOKEN_STORAGE_KEY);
    }
  };

  const logout = () => {
    const sessionStorageRef = getSessionStorage();
    const localStorageRef = getLocalStorage();

    setUser(null);
    setToken(null);
    setIsGuest(false);
    safeRemove(sessionStorageRef, USER_STORAGE_KEY);
    safeRemove(sessionStorageRef, TOKEN_STORAGE_KEY);
    safeRemove(localStorageRef, USER_STORAGE_KEY);
    safeRemove(localStorageRef, TOKEN_STORAGE_KEY);
    void clearPersistedRefreshToken();
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
        token,
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
