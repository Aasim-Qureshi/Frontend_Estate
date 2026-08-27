import React, { useState } from "react";
import { useSession } from "../context/SessionContext";
import { useTranslation } from "react-i18next";
import { Phone, Lock, Loader2, CheckCircle2, AlertCircle, Eye, EyeOff } from "lucide-react";

/**
 * Login now authenticates against the Spark Vision backend (port 5000)
 * instead of the legacy Electron backend (port 3000).
 *
 * Spark Vision's `POST /auth/login` is cookie/session based (sv_identity,
 * sv_session, sv_csrf) rather than JWT-based — it returns { user, profile,
 * guestAccess } in the body and sets auth cookies via Set-Cookie. All the
 * guest/Taqeem-linking logic from the old system (guestUserId,
 * guestTaqeemUser, sessionStorage handoff) is intentionally dropped: Spark
 * Vision has no concept of a guest-to-registered-user merge.
 */
const LoginForm = ({ onViewChange }) => {
    const [formData, setFormData] = useState({
        phone: "",
        password: "",
    });
    const [isLoading, setIsLoading] = useState(false);
    const [message, setMessage] = useState({ text: "", type: "" });
    const [showPassword, setShowPassword] = useState(false);
    const { login } = useSession();
    const { t } = useTranslation();

    const handleInputChange = (e) => {
        const { name, value } = e.target;
        setFormData((prev) => ({
            ...prev,
            [name]: value,
        }));
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

            // Spark Vision's /api/auth/login accepts EITHER a phone number
            // (with explicit country code, e.g. "+9665XXXXXXXX") OR a
            // username (e.g. "admin_ms"). Only treat the input as a phone
            // if it's actually numeric — otherwise send it as `username` so
            // it isn't mangled by phone normalization.
            const rawIdentifier = formData.phone.trim();
            const looksLikePhone = /^[+0-9\s()-]+$/.test(rawIdentifier);

            let loginPayload;
            if (looksLikePhone) {
                let phone = rawIdentifier;
                if (!phone.startsWith("+") && !phone.startsWith("00")) {
                    phone = phone.startsWith("0")
                        ? `+966${phone.slice(1)}`
                        : `+966${phone}`;
                }
                loginPayload = { phone, password: formData.password, rememberMe: true };
            } else {
                loginPayload = {
                    username: rawIdentifier,
                    password: formData.password,
                    rememberMe: true,
                };
            }

            const result = await window.electronAPI.apiRequest(
                "POST",
                "/api/auth/login",
                loginPayload,
            );

            if (result && result.user) {
                login(result.user);
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
        const baseStyles = "flex items-start gap-2.5 p-3.5 rounded-lg border text-sm";
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

    const MessageIcon = message.type === "success" ? CheckCircle2 : AlertCircle;

    return (
        <div className="h-full flex items-center justify-center bg-gray-50 px-4 py-12">
            <div className="max-w-md w-full">
                <div className="bg-white rounded-2xl shadow-xl border border-gray-100 p-8">
                    {/* Header */}
                    <div className="text-center mb-8">
                        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-blue-50">
                            <Lock className="w-6 h-6 text-blue-600" />
                        </div>
                        <h2 className="text-2xl font-bold text-gray-800">
                            {t("login.titles.phone")}
                        </h2>
                    </div>

                    <form onSubmit={handlePhoneLogin} className="space-y-5">
                        {/* Phone / username field */}
                        <div>
                            <label
                                htmlFor="phone"
                                className="block text-sm font-medium text-gray-700 mb-1.5"
                            >
                                {t("login.fields.phone")}
                            </label>
                            <div className="relative">
                                <Phone className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
                                <input
                                    type="tel"
                                    id="phone"
                                    name="phone"
                                    value={formData.phone}
                                    onChange={handleInputChange}
                                    disabled={isLoading}
                                    placeholder={t("login.placeholders.phone")}
                                    className="w-full pl-10 pr-4 py-3 border border-gray-300 rounded-lg text-gray-800 placeholder-gray-400 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:bg-gray-100 disabled:cursor-not-allowed"
                                    dir="auto"
                                    required
                                />
                            </div>
                        </div>

                        {/* Password field */}
                        <div>
                            <label
                                htmlFor="password"
                                className="block text-sm font-medium text-gray-700 mb-1.5"
                            >
                                {t("login.fields.password")}
                            </label>
                            <div className="relative">
                                <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
                                <input
                                    type={showPassword ? "text" : "password"}
                                    id="password"
                                    name="password"
                                    value={formData.password}
                                    onChange={handleInputChange}
                                    disabled={isLoading}
                                    placeholder={t("login.placeholders.password")}
                                    className="w-full pl-10 pr-11 py-3 border border-gray-300 rounded-lg text-gray-800 placeholder-gray-400 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:bg-gray-100 disabled:cursor-not-allowed"
                                    required
                                />
                                <button
                                    type="button"
                                    onClick={() => setShowPassword((v) => !v)}
                                    tabIndex={-1}
                                    className="absolute right-3.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors"
                                    aria-label={showPassword ? "Hide password" : "Show password"}
                                >
                                    {showPassword ? (
                                        <EyeOff className="w-4 h-4" />
                                    ) : (
                                        <Eye className="w-4 h-4" />
                                    )}
                                </button>
                            </div>
                        </div>

                        {message.text && (
                            <div className={getMessageStyles(message.type)}>
                                <MessageIcon className="w-4 h-4 mt-0.5 shrink-0" />
                                <span>{message.text}</span>
                            </div>
                        )}

                        <button
                            type="submit"
                            disabled={isLoading}
                            className={`w-full flex items-center justify-center gap-2 py-3 px-4 rounded-lg font-medium transition-all duration-200 ${
                                isLoading
                                    ? "bg-gray-400 cursor-not-allowed"
                                    : "bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white shadow-sm hover:shadow-md"
                            }`}
                        >
                            {isLoading && <Loader2 className="w-4 h-4 animate-spin" />}
                            {isLoading
                                ? t("login.actions.loggingIn")
                                : t("login.actions.login")}
                        </button>
                    </form>
                </div>
            </div>
        </div>
    );
};

export default LoginForm;
