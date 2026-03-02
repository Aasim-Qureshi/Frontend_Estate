import React, { useState } from "react";
import { useSession } from "../context/SessionContext";
import { useTranslation } from "react-i18next";

const LoginForm = ({ onViewChange }) => {
    const [formData, setFormData] = useState({
        phone: "",
        password: "",
    });
    const [isLoading, setIsLoading] = useState(false);
    const [message, setMessage] = useState({ text: "", type: "" });
    const { login, user, isGuest } = useSession();
    const { t } = useTranslation();

    const handleInputChange = (e) => {
        const { name, value } = e.target;
        setFormData((prev) => ({
            ...prev,
            [name]: value,
        }));
    };

    const setRefreshCookieIfPresent = async (result) => {
        try {
            if (result?.refreshToken && window.electronAPI?.setRefreshToken) {
                await window.electronAPI.setRefreshToken(result.refreshToken, {
                    name: "refreshToken",
                    maxAgeDays: 7,
                    sameSite: "lax",
                });
            }
        } catch (err) {
            console.warn("Failed to set refresh token in cookie store:", err);
        }
    };

    const handlePhoneLogin = async (e) => {
        e.preventDefault();
        setIsLoading(true);
        setMessage({ text: "", type: "" });

        try {
            if (!formData.phone || !formData.password) {
                throw new Error(t("login.errors.enterPhonePassword"));
            }

            if (!window.electronAPI) {
                throw new Error(t("login.errors.electronApiUnavailable"));
            }

            let guestUserId = isGuest
                ? user?._id || user?.id || user?.userId || null
                : null;
            let guestTaqeemUser = isGuest
                ? user?.taqeemUser || user?.taqeem?.username || null
                : null;

            if (!guestUserId) {
                try {
                    const rawGuestUserId = window?.sessionStorage?.getItem(
                        "taqeem:guestUserIdForLink",
                    );
                    if (rawGuestUserId) {
                        const parsed = JSON.parse(rawGuestUserId);
                        if (typeof parsed === "string" && parsed.trim()) {
                            guestUserId = parsed.trim();
                        }
                    }
                } catch (err) {
                    guestUserId = null;
                }
            }

            if (!guestTaqeemUser) {
                try {
                    const rawGuestTaqeem = window?.sessionStorage?.getItem(
                        "taqeem:guestUserForLink",
                    );
                    if (rawGuestTaqeem) {
                        const parsed = JSON.parse(rawGuestTaqeem);
                        if (typeof parsed === "string" && parsed.trim()) {
                            guestTaqeemUser = parsed.trim();
                        }
                    }
                } catch (err) {
                    guestTaqeemUser = null;
                }
            }

            const loginPayload = {
                phone: formData.phone,
                password: formData.password,
            };
            if (guestUserId) {
                loginPayload.guestUserId = String(guestUserId);
            }
            if (guestTaqeemUser) {
                loginPayload.guestTaqeemUser = String(guestTaqeemUser).trim();
            }

            const result = await window.electronAPI.apiRequest(
                "POST",
                "/api/users/login",
                loginPayload,
            );

            await setRefreshCookieIfPresent(result);

            if (result && result.user) {
                login(result.user, result.token);
                setMessage({
                    text: t("login.messages.success"),
                    type: "success",
                });
                setTimeout(() => {
                    if (!onViewChange) return;

                    let nextView = "apps";
                    try {
                        const rawReturnView = window?.sessionStorage?.getItem(
                            "taqeem:returnView",
                        );
                        if (rawReturnView) {
                            const parsed = JSON.parse(rawReturnView);
                            if (typeof parsed === "string" && parsed.trim()) {
                                nextView = parsed.trim();
                            }
                            window.sessionStorage.removeItem("taqeem:returnView");
                        }
                    } catch (err) {
                        nextView = "apps";
                    }

                    if (nextView === "login" || nextView === "registration") {
                        nextView = "apps";
                    }

                    onViewChange(nextView);
                }, 500);

                try {
                    window?.sessionStorage?.removeItem("taqeem:guestUserIdForLink");
                    window?.sessionStorage?.removeItem("taqeem:guestUserForLink");
                } catch (err) {
                    // ignore storage failures
                }
            } else {
                throw new Error(
                    result?.error || result?.message || t("login.errors.loginFailed"),
                );
            }
        } catch (error) {
            const errorMsg =
                error.response?.data?.message ||
                error.message ||
                t("login.errors.unknown");
            setMessage({
                text: t("login.messages.error", { error: errorMsg }),
                type: "error",
            });
            console.error("Phone login error:", error);
        } finally {
            setIsLoading(false);
        }
    };

    const getMessageStyles = (type) => {
        const baseStyles = "p-4 rounded-lg border";
        switch (type) {
            case "success":
                return `${baseStyles} bg-green-50 border-green-200 text-green-800`;
            case "error":
                return `${baseStyles} bg-red-50 border-red-200 text-red-800`;
            case "info":
                return `${baseStyles} bg-blue-50 border-blue-200 text-blue-800`;
            default:
                return `${baseStyles} bg-gray-50 border-gray-200 text-gray-800`;
        }
    };

    return (
        <div className="max-w-md w-full mx-auto py-8">
            <div className="bg-white rounded-xl shadow-lg p-6">
                <h2 className="text-2xl font-bold text-gray-800 mb-6 text-center">
                    {t("login.titles.phone")}
                </h2>

                <form onSubmit={handlePhoneLogin} className="space-y-4">
                    <div>
                        <label
                            htmlFor="phone"
                            className="block text-sm font-medium text-gray-700 mb-2"
                        >
                            {t("login.fields.phone")}
                        </label>
                        <input
                            type="tel"
                            id="phone"
                            name="phone"
                            value={formData.phone}
                            onChange={handleInputChange}
                            disabled={isLoading}
                            placeholder={t("login.placeholders.phone")}
                            className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:bg-gray-100 disabled:cursor-not-allowed"
                            dir="auto"
                            required
                        />
                    </div>

                    <div>
                        <label
                            htmlFor="password"
                            className="block text-sm font-medium text-gray-700 mb-2"
                        >
                            {t("login.fields.password")}
                        </label>
                        <input
                            type="password"
                            id="password"
                            name="password"
                            value={formData.password}
                            onChange={handleInputChange}
                            disabled={isLoading}
                            placeholder={t("login.placeholders.password")}
                            className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:bg-gray-100 disabled:cursor-not-allowed"
                            required
                        />
                    </div>

                    {message.text && (
                        <div className={getMessageStyles(message.type)}>
                            {message.text}
                        </div>
                    )}

                    <div className="flex">
                        <button
                            type="submit"
                            disabled={isLoading}
                            className={`flex-1 py-3 px-4 rounded-lg font-medium transition-all duration-200 ${
                                isLoading
                                    ? "bg-gray-400 cursor-not-allowed"
                                    : "bg-blue-600 hover:bg-blue-700 text-white"
                            }`}
                        >
                            {isLoading
                                ? t("login.actions.loggingIn")
                                : t("login.actions.login")}
                        </button>
                    </div>

                    <div className="text-center text-sm text-gray-600">
                        {t("login.registerPrompt")}{" "}
                        <button
                            type="button"
                            onClick={() => onViewChange && onViewChange("registration")}
                            className="text-blue-600 hover:underline"
                        >
                            {t("layout.auth.register")}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

export default LoginForm;
