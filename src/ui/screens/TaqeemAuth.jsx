import React, { useEffect, useState } from 'react';
import { useNavStatus } from '../context/NavStatusContext';
import usePersistentState from "../hooks/usePersistentState";
import { useSession } from '../context/SessionContext';
import { emitTaqeemConflict, syncTaqeemSnapshot } from '../../shared/helper/taqeemSync';

const TaqeemAuth = ({ onViewChange }) => {
    const [formData, setFormData, resetFormData] = usePersistentState('taqeem-auth:form', {
        email: '',
        password: '',
        otp: '',
        method: 'EMAIL' // Default method
    }, { storage: 'session' });
    const [showOtp, setShowOtp, resetShowOtp] = usePersistentState('taqeem-auth:showOtp', false, { storage: 'session' });
    const [isLoading, setIsLoading] = useState(false);
    const [message, setMessage, resetMessage] = usePersistentState('taqeem-auth:message', { text: '', type: '' }, { storage: 'session' });
    const [secondaryStatus, setSecondaryStatus] = useState({ text: '', type: '' });
    const [secondaryLoading, setSecondaryLoading] = useState(false);
    const [secondaryBatchId, setSecondaryBatchId] = useState('');
    const { taqeemStatus, setTaqeemStatus } = useNavStatus();
    const { token, login, logout, isGuest } = useSession();

    const redirectToPhoneLogin = async () => {
        if (isGuest) {
            logout();
        }
        await onViewChange?.("login");
    };

    useEffect(() => {
        if (taqeemStatus?.state !== 'success') {
            setTaqeemStatus('info', 'Taqeem login: Off');
        }
    }, [setTaqeemStatus, taqeemStatus?.state]);

    // useEffect(() => {
    //     if (!isAuthenticated && onViewChange) {
    //         onViewChange('registration');
    //     }
    // }, [isAuthenticated, onViewChange]);

    const goToCompanies = () => {
        if (onViewChange) {
            // Small delay so the success message is visible
            setTimeout(() => onViewChange('apps'), 400);
        }
    };

    const handleInputChange = (e) => {
        const { name, value, type, checked } = e.target;
        setFormData(prev => ({
            ...prev,
            [name]: type === 'checkbox' ? (checked ? 'SMS' : 'EMAIL') : value
        }));
        if (name === 'otp' && message?.text) {
            setMessage((prev) => ({ ...prev, text: '' }));
        }
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setIsLoading(true);
        setMessage({ text: "", type: "" });

        // --- helper: full Taqeem login flow (with OTP)
        const runTaqeemLoginFlow = async () => {
            if (!showOtp) {
                if (!window.electronAPI?.login) {
                    throw new Error("Electron API not available");
                }

                const result = await window.electronAPI.login({
                    email: formData.email,
                    password: formData.password,
                    method: formData.method,
                });

                console.log("Login result:", result);

                if (result.status === "OTP_REQUIRED") {
                    setShowOtp(true);
                    setMessage({
                        text:
                            result.message ||
                            `Two-factor authentication required. Please enter your ${formData.method === "SMS" ? "SMS" : "email"
                            } code.`,
                        type: "info",
                    });

                    setTaqeemStatus("info", "Awaiting OTP to finish Taqeem sign-in");
                    return { status: "OTP_REQUIRED" };
                }

                if (result.status === "SUCCESS") {
                    setMessage({
                        text: "Authentication complete - starting automation...",
                        type: "success",
                    });

                    setTaqeemStatus("success", "Taqeem login: On");
                    return { status: "SUCCESS" };
                }

                throw new Error(result.error || "Login failed");
            }

            // --- OTP submission phase
            if (!window.electronAPI?.submitOtp) {
                throw new Error("Electron API not available");
            }

            const result = await window.electronAPI.submitOtp(formData.otp);

            console.log("OTP result:", result);

            if (result.status === "SUCCESS") {
                setMessage({
                    text: "Authentication complete - automation running...",
                    type: "success",
                });

                    setTaqeemStatus("success", "Taqeem login: On");
                    return { status: "SUCCESS" };
                } else {
                    throw new Error(result.error || "OTP verification failed");
            }
        };

        try {
            setMessage({ text: "Authenticating with backend...", type: "info" });

            const headers = {};
            if (token) headers.Authorization = `Bearer ${token}`;

            const bootstrapResponse = await window.electronAPI.apiRequest(
                "POST",
                "/api/users/new-bootstrap",
                {
                    username: formData.email,
                    password: formData.password,
                },
                headers
            );

            console.log("Bootstrap response:", bootstrapResponse);

                        if (bootstrapResponse.status === "TAQEEM_ALREADY_USED") {
                emitTaqeemConflict(bootstrapResponse);
                setMessage({
                    text: bootstrapResponse.message || "This Taqeem user is already linked. Please login to Value Tech.",
                    type: "error",
                });
                setTaqeemStatus("error", "Taqeem user is already linked");
                await redirectToPhoneLogin();
                return;
            }

            const acceptedStatuses = ["BOOTSTRAP_GRANTED", "LOGIN_SUCCESS", "NORMAL_ACCOUNT"];
            if (acceptedStatuses.includes(bootstrapResponse.status)) {
                setMessage({
                    text: "Backend authentication successful. Proceeding to Taqeem login...",
                    type: "info",
                });

                const activeToken = bootstrapResponse.token || token || null;
                if (activeToken) {
                    const loginPayload = bootstrapResponse.user || {
                        id: bootstrapResponse.userId,
                        _id: bootstrapResponse.userId,
                        guest: bootstrapResponse.guest !== false,
                        taqeemUser: formData.email,
                    };
                    login(loginPayload, activeToken);
                }

                const loginResult = await runTaqeemLoginFlow();
                if (loginResult?.status === "SUCCESS") {
                    const syncResult = await syncTaqeemSnapshot({
                        token: activeToken,
                        taqeemUser: formData.email,
                    });

                    if (syncResult?.status === "TAQEEM_ALREADY_USED") {
                        emitTaqeemConflict(syncResult);
                        setMessage({
                            text: syncResult.message || "This Taqeem user is already linked. Please login to Value Tech.",
                            type: "error",
                        });
                        setTaqeemStatus("error", "Taqeem user is already linked");
                        await redirectToPhoneLogin();
                        return;
                    }

                    if (syncResult?.user && activeToken) {
                        login(syncResult.user, activeToken);
                    }

                    goToCompanies();
                }
                return;
            }

            // Any other backend response here is unexpected
            throw new Error(
                bootstrapResponse.message || "Backend authentication failed"
            );
        } catch (error) {
            console.error("Authentication error:", error);
            console.log("PROPS: ", Object.getOwnPropertyNames(error));

            const backendStatus = error.response?.data?.status;
            const httpStatus = error.status || error.response?.status;

            if (backendStatus === "TAQEEM_ALREADY_USED") {
                emitTaqeemConflict(error.response?.data || {});
                setMessage({
                    text: error.response?.data?.message || "This Taqeem user is already linked. Please login to Value Tech.",
                    type: "error",
                });
                setTaqeemStatus("error", "Taqeem user is already linked");
                await redirectToPhoneLogin();
            }

            // Invalid credentials
            else if (error.response?.data?.message === "Invalid credentials") {
                setMessage({
                    text: "Invalid username or password",
                    type: "error",
                });

                setTaqeemStatus("error", "Invalid credentials");
            }

            // LOGIN_REQUIRED (likely 403)
            else if (
                String(error?.message || "").includes("403")
            ) {
                setMessage({
                    text: "System login required first",
                    type: "info",
                });

                setTaqeemStatus(
                    "info",
                    "Backend requires login first"
                );

                await redirectToPhoneLogin();
            }

            // Generic fallback
            else {
                setMessage({
                    text: "Error: " + (error.message || "Authentication failed"),
                    type: "error",
                });

                setTaqeemStatus("error", error.message || "Authentication failed");
            }
        } finally {
            setIsLoading(false);
        }
    };


    const handleAutoLogin = async () => {
        if (isLoading) return;
        const autoCreds = {
            email: '1026592343',
            password: 'Aa@@654321',
            method: 'AUTO',
            autoOtp: true
        };
        setFormData((prev) => ({ ...prev, ...autoCreds, otp: '' }));
        setShowOtp(false);
        setMessage({ text: '', type: '' });
        setIsLoading(true);

        try {
            if (window.electronAPI && window.electronAPI.login) {
                const result = await window.electronAPI.login(autoCreds);

                if (result.status === 'OTP_REQUIRED') {
                    setShowOtp(true);
                    setMessage({
                        text: result.message || 'Two-factor authentication required. Please enter your email code.',
                        type: 'info'
                    });
                    setTaqeemStatus('info', 'Awaiting OTP to finish Taqeem sign-in');
                } else if (result.status === 'SUCCESS') {
                    setMessage({
                        text: result.message || 'Login successful! Starting automation...',
                        type: 'success'
                    });
                    setTaqeemStatus('success', 'Taqeem login: On');
                    goToCompanies();
                } else {
                    throw new Error(result.error || 'Login failed');
                }
            } else {
                throw new Error('Electron API not available');
            }
        } catch (error) {
            setMessage({
                text: 'Error: ' + error.message,
                type: 'error'
            });
            setTaqeemStatus('error', error.message || 'Taqeem login failed');
        } finally {
            setIsLoading(false);
        }
    };

    const handleReset = () => {
        resetFormData();
        resetShowOtp();
        resetMessage();
        setTaqeemStatus('info', 'Taqeem login: Off');
    };

    const handleOpenSecondaryLogin = async () => {
        if (!secondaryBatchId.trim()) {
            setSecondaryStatus({
                text: 'Please enter a batch ID before opening the secondary login.',
                type: 'error'
            });
            return;
        }
        setSecondaryLoading(true);
        setSecondaryStatus({ text: '', type: '' });

        try {
            if (!window.electronAPI?.openTaqeemLogin) {
                throw new Error('Cannot open external browser from this environment');
            }
            const result = await window.electronAPI.openTaqeemLogin({
                batchId: secondaryBatchId.trim(),
                preferChrome: false,
                waitForLogin: true
            });
            setSecondaryStatus({
                text: [
                    result?.message || 'Opened Taqeem login in a separate browser window.',
                    result?.batch ? `Processed reports: ${result.batch.succeeded}/${result.batch.total} succeeded, ${result.batch.failed} failed.` : 'Sign in with the alternate account there; batch will process automatically.'
                ].filter(Boolean).join(' '),
                type: result?.status === 'SUCCESS' ? 'success' : 'error'
            });
        } catch (error) {
            setSecondaryStatus({
                text: 'Unable to open a new login tab: ' + error.message,
                type: 'error'
            });
        } finally {
            setSecondaryLoading(false);
        }
    };

    const getMessageStyles = (type) => {
        const baseStyles = "p-4 rounded-lg border";
        switch (type) {
            case 'success':
                return `${baseStyles} bg-green-50 border-green-200 text-green-800`;
            case 'error':
                return `${baseStyles} bg-red-50 border-red-200 text-red-800`;
            case 'info':
                return `${baseStyles} bg-blue-50 border-blue-200 text-blue-800`;
            default:
                return `${baseStyles} bg-gray-50 border-gray-200 text-gray-800`;
        }
    };

    return (
        <div className="max-w-md w-full mx-auto py-8">
            <div className="bg-white rounded-xl shadow-lg p-6">
                {taqeemStatus?.state === 'success' && (
                    <div className="mb-4 rounded-lg border border-green-200 bg-gradient-to-r from-green-50 to-emerald-100 p-4 text-green-900 flex items-start gap-3">
                        <div className="mt-0.5">
                            <svg className="w-5 h-5 text-green-600" viewBox="0 0 20 20" fill="currentColor">
                                <path fillRule="evenodd" d="M16.707 5.293a1 1 0 00-1.414-1.414L8 11.172 4.707 7.879A1 1 0 003.293 9.293l4 4a1 1 0 001.414 0l8-8z" clipRule="evenodd" />
                            </svg>
                        </div>
                        <div className="flex-1">
                            <p className="font-semibold text-green-900">You are already logged in to Taqeem</p>
                            <p className="text-sm text-green-800">Move straight to selecting companies or keep this form for re-authentication.</p>
                        </div>
                        <button
                            onClick={() => onViewChange && onViewChange('get-companies')}
                            className="text-sm font-semibold text-green-900 bg-white border border-green-200 px-3 py-2 rounded-lg hover:bg-green-100"
                        >
                            Go to companies
                        </button>
                    </div>
                )}

                <div className="mb-6 rounded-lg border border-indigo-200 bg-indigo-50 p-4">
                    <div className="flex items-start justify-between gap-3">
                        <div className="flex-1 space-y-2">
                            <p className="font-semibold text-indigo-900">Login with another account</p>
                            <p className="text-sm text-indigo-800">
                                Opens Taqeem login in a separate browser window (isolated session) so you can sign in with a second user while keeping this session active. Provide the batch ID to auto-open each report and submit the confirmation step.
                            </p>
                            <div>
                                <label htmlFor="secondaryBatchId" className="block text-xs font-semibold text-indigo-900 uppercase tracking-wide mb-1">
                                    Batch ID
                                </label>
                                <input
                                    id="secondaryBatchId"
                                    name="secondaryBatchId"
                                    value={secondaryBatchId}
                                    onChange={(e) => setSecondaryBatchId(e.target.value)}
                                    placeholder="Enter batch ID to confirm reports"
                                    className="w-full px-3 py-2 rounded-md border border-indigo-200 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 bg-white"
                                    disabled={secondaryLoading}
                                />
                            </div>
                        </div>
                        <button
                            type="button"
                            onClick={handleOpenSecondaryLogin}
                            disabled={secondaryLoading}
                            className={`px-4 py-2 rounded-lg font-medium text-white transition-colors ${secondaryLoading ? 'bg-indigo-400 cursor-not-allowed' : 'bg-indigo-600 hover:bg-indigo-700'
                                }`}
                        >
                            {secondaryLoading ? 'Opening...' : 'Open new login'}
                        </button>
                    </div>
                    {secondaryStatus.text && (
                        <div className={`${getMessageStyles(secondaryStatus.type)} mt-3`}>
                            {secondaryStatus.text}
                        </div>
                    )}
                </div>
                <form onSubmit={handleSubmit} className="space-y-6">
                    {/* Email Field */}
                    <div>
                        <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-2">
                            Email Address
                        </label>
                        <input
                            type="text"
                            id="email"
                            name="email"
                            value={formData.email}
                            onChange={handleInputChange}
                            disabled={showOtp || isLoading}
                            placeholder="Enter your email"
                            className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:bg-gray-100 disabled:cursor-not-allowed"
                            required
                        />
                    </div>

                    {/* Password Field */}
                    <div>
                        <label htmlFor="password" className="block text-sm font-medium text-gray-700 mb-2">
                            Password
                        </label>
                        <input
                            type="password"
                            id="password"
                            name="password"
                            value={formData.password}
                            onChange={handleInputChange}
                            disabled={showOtp || isLoading}
                            placeholder="Enter your password"
                            className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:bg-gray-100 disabled:cursor-not-allowed"
                            required
                        />
                    </div>

                    {/* SMS Checkbox */}
                    <div className="flex items-center">
                        <input
                            type="checkbox"
                            id="method"
                            name="method"
                            checked={formData.method === 'SMS'}
                            onChange={handleInputChange}
                            disabled={showOtp || isLoading}
                            className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                        />
                        <label htmlFor="method" className="ml-2 block text-sm text-gray-700">
                            Use SMS for two-factor authentication
                        </label>
                    </div>

                    {/* Conditional OTP Field */}
                    {showOtp && (
                        <div>
                            <label htmlFor="otp" className="block text-sm font-medium text-gray-700 mb-2">
                                One-Time Password
                            </label>
                            <input
                                type="text"
                                id="otp"
                                name="otp"
                                value={formData.otp}
                                onChange={handleInputChange}
                                disabled={isLoading}
                                placeholder={`Enter ${formData.method === 'SMS' ? 'SMS' : '6-digit'} code`}
                                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:bg-gray-100 disabled:cursor-not-allowed"
                                maxLength={formData.method === 'SMS' ? undefined : "6"}
                                pattern={formData.method === 'SMS' ? undefined : "[0-9]{6}"}
                                required
                            />
                            <p className="mt-2 text-sm text-gray-500">
                                {formData.method === 'SMS'
                                    ? 'Check your phone for the SMS code'
                                    : 'Check your authenticator app for the code'
                                }
                            </p>
                        </div>
                    )}

                    {/* Action Buttons */}
                    <div className="flex space-x-4">
                        <button
                            type="submit"
                            disabled={isLoading}
                            className={`flex-1 py-3 px-4 rounded-lg font-medium transition-all duration-200 ${isLoading
                                ? 'bg-gray-400 cursor-not-allowed'
                                : 'bg-blue-600 hover:bg-blue-700 text-white'
                                }`}
                        >
                            {isLoading ? (
                                <span className="flex items-center justify-center">
                                    <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                    </svg>
                                    Processing...
                                </span>
                            ) : showOtp ? (
                                'Verify OTP'
                            ) : (
                                'Login & Start Automation'
                            )}
                        </button>

                        <button
                            type="button"
                            onClick={handleAutoLogin}
                            disabled={isLoading}
                            className="px-4 py-3 rounded-lg font-medium bg-amber-500 text-white hover:bg-amber-600 disabled:bg-amber-300 disabled:cursor-not-allowed transition-all duration-200"
                            title="Use preset credentials and start login automatically"
                        >
                            Auto login
                        </button>

                        <button
                            type="button"
                            onClick={handleReset}
                            disabled={isLoading}
                            className="px-6 py-3 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 disabled:bg-gray-100 disabled:cursor-not-allowed transition-all duration-200"
                        >
                            Reset
                        </button>
                    </div>

                    {/* Status Message */}
                    {message.text && (
                        <div className={getMessageStyles(message.type)}>
                            {message.text}
                        </div>
                    )}

                    {/* Progress Steps */}
                    <div className="flex items-center justify-center space-x-8 pt-4">
                        <div className={`flex items-center space-x-2 ${!showOtp ? 'text-blue-600' : 'text-green-600'}`}>
                            <div className={`w-8 h-8 rounded-full flex items-center justify-center border-2 ${!showOtp ? 'border-blue-600 bg-blue-600 text-white' : 'border-green-600 bg-green-600 text-white'
                                }`}>
                                1
                            </div>
                            <span className="text-sm font-medium">Credentials</span>
                        </div>
                        <div className="w-12 h-0.5 bg-gray-300"></div>
                        <div className={`flex items-center space-x-2 ${showOtp ? 'text-blue-600' : 'text-gray-400'}`}>
                            <div className={`w-8 h-8 rounded-full flex items-center justify-center border-2 ${showOtp ? 'border-blue-600 bg-blue-600 text-white' : 'border-gray-300'
                                }`}>
                                2
                            </div>
                            <span className="text-sm font-medium">Verification</span>
                        </div>
                    </div>
                </form>
            </div>
        </div>
    );
};

export default TaqeemAuth;

