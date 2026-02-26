import React, { createContext, useContext, useState, useEffect } from 'react';

const SessionContext = createContext();

export const useSession = () => {
    const context = useContext(SessionContext);
    if (!context) {
        throw new Error('useSession must be used within SessionProvider');
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
            'http://localhost:3000',
            'http://127.0.0.1:3000',
            'https://future-electron-backend.onrender.com',
        ].filter(Boolean);

        const uniqueBaseUrls = Array.from(new Set(candidateBaseUrls));
        await Promise.allSettled(
            uniqueBaseUrls.map((baseUrl) =>
                window.electronAPI.clearRefreshToken({
                    baseUrl,
                    name: 'refreshToken',
                })
            )
        );
    };

    // Initialize session from localStorage on mount
    useEffect(() => {
        const savedUser = localStorage.getItem('user');
        const savedToken = localStorage.getItem('token');
        if (savedUser) {
            try {
                const parsed = JSON.parse(savedUser);
                if (typeof parsed === 'string') {
                    setUser({ id: parsed, guest: true });
                    setIsGuest(true);
                } else {
                    setUser(parsed);
                    setIsGuest(Boolean(parsed?.guest));
                }
            } catch (e) {
                console.error('Failed to parse saved user:', e);
                localStorage.removeItem('user');
            }
        }
        if (savedToken && savedToken !== 'undefined' && savedToken !== 'null') {
            setToken(savedToken);
        }
        setIsLoading(false);
    }, []);

    const login = (userData, accessToken) => {
        let normalizedUser = userData;
        let guestFlag = false;
        if (typeof userData === 'string') {
            normalizedUser = { id: userData, guest: true };
            guestFlag = true;
        } else if (userData?.guest) {
            guestFlag = true;
        }
        setUser(normalizedUser);
        setIsGuest(guestFlag);
        localStorage.setItem('user', JSON.stringify(normalizedUser));
        if (accessToken) {
            setToken(accessToken);
            localStorage.setItem('token', accessToken);
        } else {
            setToken(null);
            localStorage.removeItem('token');
        }
    };

    const logout = () => {
        setUser(null);
        setToken(null);
        setIsGuest(false);
        localStorage.removeItem('user');
        localStorage.removeItem('token');
        void clearPersistedRefreshToken();
    };

    const updateUser = (userData) => {
        setUser(userData);
        setIsGuest(Boolean(userData?.guest));
        localStorage.setItem('user', JSON.stringify(userData));
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
                isGuest
            }}
        >
            {children}
        </SessionContext.Provider>
    );
};

export default SessionContext;
