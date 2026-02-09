import React, { useEffect, useState } from "react";
import { useNavStatus } from "../context/NavStatusContext";
import usePersistentState from "../hooks/usePersistentState";
import { useSession } from "../context/SessionContext";
import { useValueNav } from "../context/ValueNavContext";

const repairMojibake = (value) => {
    if (!value || typeof value !== "string") return value;
    if (!/[\u00c3\u00c2\u00d8\u00d9]/.test(value)) return value;
    try {
        const bytes = Uint8Array.from(value, (ch) => ch.charCodeAt(0));
        return new TextDecoder("utf-8").decode(bytes);
    } catch (err) {
        return value;
    }
};

const normalizeCompany = (company) => {
    if (!company) return company;
    const fixedName = repairMojibake(company.name);
    if (fixedName === company.name) return company;
    return { ...company, name: fixedName };
};

export default function GetCompanies({ onViewChange }) {
    const [companies, setCompanies, resetCompanies] = usePersistentState(
        "get-companies:list",
        [],
        {
            storage: 'session',
            revive: (value) => Array.isArray(value) ? value.map(normalizeCompany) : [],
        }
    );
    const [loading, setLoading] = useState(false);
    const [navigating, setNavigating] = useState(false);
    const [error, setError] = usePersistentState("get-companies:error", "", { storage: 'session' });
    const [successMessage, setSuccessMessage] = usePersistentState("get-companies:success", "", { storage: 'session' });
    const [selectedCompany, setSelectedCompany, resetSelectedCompany] = usePersistentState(
        "get-companies:selected",
        null,
        {
            storage: 'session',
            revive: (value) => normalizeCompany(value),
        }
    );
    const [returnView, , resetReturnView] = usePersistentState("taqeem:returnView", null, { storage: "session" });
    const [navigationComplete, setNavigationComplete, _resetNavigationComplete] = usePersistentState("get-companies:navigationComplete", false, { storage: 'session' });
    const { taqeemStatus, setCompanyStatus } = useNavStatus();
    const { isAuthenticated } = useSession();
    const { syncCompanies, loadSavedCompanies, setPreferredCompany } = useValueNav();

    useEffect(() => {
        if (navigationComplete && selectedCompany) {
            const officeText = selectedCompany.office_id || selectedCompany.officeId || "unknown";
            const displayName = repairMojibake(selectedCompany.name) || "company";
            setCompanyStatus('success', `Navigated to ${displayName} (Office ${officeText})`);
        } else if (selectedCompany) {
            const displayName = repairMojibake(selectedCompany.name);
            setCompanyStatus('info', `Selected ${displayName}`);
        } else {
            setCompanyStatus('info', 'No company selected');
        }
    }, [navigationComplete, selectedCompany, setCompanyStatus]);

    const handleGetCompanies = async () => {
        if (!isAuthenticated) {
            setError('Please register or login with your phone number before using Taqeem.');
            if (onViewChange) onViewChange('registration');
            return;
        }
        setLoading(true);
        setError("");
        setSuccessMessage("");
        setSelectedCompany(null);
        setNavigationComplete(false);
        setCompanyStatus('info', 'No company selected');
        try {
            const data = await window.electronAPI.getCompanies();

            if (data.status === "SUCCESS") {
                const fetched = data.data || [];
                const normalized = fetched.map(normalizeCompany);
                setCompanies(normalized);
                setSuccessMessage("Companies fetched successfully!");
                setCompanyStatus('info', 'Select a company to navigate');

                // Persist companies to backend for this user
                if (syncCompanies) {
                    try {
                        await syncCompanies(fetched.map((c) => ({ ...c, type: c.type || 'equipment' })), 'equipment');
                        await loadSavedCompanies('equipment');
                    } catch (syncErr) {
                        console.warn('Failed to sync companies', syncErr);
                    }
                }
            } else {
                setError(data.error || 'Failed to get companies');
                setCompanyStatus('error', data.error || 'Failed to load companies');
            }
        } catch (err) {
            setError(err.message);
            setCompanyStatus('error', err.message);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (!isAuthenticated) {
            if (onViewChange) onViewChange('registration');
            return;
        }
        if (companies && companies.length) {
            return;
        }
        handleGetCompanies();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [companies, isAuthenticated]);

    const handleNavigateToCompany = async () => {
        if (!selectedCompany) return;

        setNavigating(true);
        setError("");
        setSuccessMessage("");
        try {
            const payload = {
                name: repairMojibake(selectedCompany.name),
                url: selectedCompany.url,
                officeId: selectedCompany.officeId,
                sectorId: selectedCompany.sectorId
            };
            const data = await window.electronAPI.navigateToCompany(payload);

            if (data.status === "SUCCESS") {
                const chosen = normalizeCompany(data.selectedCompany || payload);
                setSelectedCompany({ ...selectedCompany, ...chosen });
                const officeText = chosen.office_id || chosen.officeId || "unknown";
                setSuccessMessage(`Navigation completed successfully! Office ID: ${officeText}`);
                setNavigationComplete(true);
                const displayName = repairMojibake(chosen.name) || "company";
                setCompanyStatus('success', `Navigated to ${displayName} (Office ${officeText})`);
                if (returnView && onViewChange) {
                    const nextView = returnView;
                    resetReturnView();
                    setTimeout(() => onViewChange(nextView), 400);
                }
                if (setPreferredCompany) {
                    await setPreferredCompany(chosen, {
                        applySelection: true,
                        skipNavigation: true,
                        quiet: true,
                    });
                }
            } else {
                setError(data.error || 'Failed to navigate to company');
                setCompanyStatus('error', data.error || 'Failed to navigate to company');
            }
        } catch (err) {
            setError(err.message);
            setCompanyStatus('error', err.message);
        } finally {
            setNavigating(false);
        }
    };

    const renderPrimaryButton = () => {
        if (navigationComplete) {
            return (
                <button
                    onClick={() => {
                        setNavigationComplete(false);
                        resetSelectedCompany();
                        resetCompanies();
                        setSuccessMessage('');
                        setError('');
                        setCompanyStatus('info', 'Select a company to navigate');
                    }}
                    className="bg-amber-600 text-white py-3 px-8 rounded-lg font-semibold hover:bg-amber-700 focus:ring-2 focus:ring-amber-500 focus:ring-offset-2 transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center"
                >
                    Select another company
                </button>
            );
        }

        return (
            <button
                onClick={handleGetCompanies}
                disabled={loading}
                className="bg-indigo-600 text-white py-3 px-8 rounded-lg font-semibold hover:bg-indigo-700 focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center"
            >
                {loading ? (
                    <>
                        <svg
                            className="animate-spin -ml-1 mr-3 h-5 w-5 text-white"
                            xmlns="http://www.w3.org/2000/svg"
                            fill="none"
                            viewBox="0 0 24 24"
                        >
                            <circle
                                className="opacity-25"
                                cx="12"
                                cy="12"
                                r="10"
                                stroke="currentColor"
                                strokeWidth="4"
                            ></circle>
                            <path
                                className="opacity-75"
                                fill="currentColor"
                                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                            ></path>
                        </svg>
                        Loading...
                    </>
                ) : (
                    "Refresh"
                )}
            </button>
        );
    };

    return (
        <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-6">
            <div className="max-w-4xl mx-auto">
                <div className="bg-white rounded-2xl shadow-xl p-8 space-y-6">
                    <div className="text-center">
                        <h1 className="text-3xl font-bold text-gray-900 mb-2">
                            Get Companies
                        </h1>
                        <p className="text-gray-600">
                            Fetch companies list from Taqeem system
                        </p>
                    </div>

                    {taqeemStatus?.state === 'success' && (
                        <div className="rounded-xl border border-green-200 bg-green-50 p-4 flex items-start gap-3 shadow-sm">
                            <div className="flex-shrink-0">
                                <svg className="w-5 h-5 text-green-600" fill="currentColor" viewBox="0 0 20 20">
                                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 00-1.414-1.414L8 11.172 4.707 7.879A1 1 0 003.293 9.293l4 4a1 1 0 001.414 0l8-8z" clipRule="evenodd" />
                                </svg>
                            </div>
                            <div className="flex-1">
                                <p className="text-sm text-green-800 font-semibold">Already logged into Taqeem</p>
                                <p className="text-sm text-green-700 mt-1">You can continue selecting companies or return to the Taqeem login form.</p>
                            </div>
                            <button
                                onClick={() => onViewChange && onViewChange('taqeem-login')}
                                className="text-sm font-semibold text-green-900 bg-white border border-green-200 px-3 py-2 rounded-lg hover:bg-green-100"
                            >
                                Go to Taqeem login
                            </button>
                        </div>
                    )}

                    <div className="flex justify-center">
                        {renderPrimaryButton()}
                    </div>

                    {error && (
                        <div className="mb-6 p-4 bg-red-50 text-red-700 border border-red-200 rounded-lg">
                            {error}
                        </div>
                    )}

                    {successMessage && (
                        <div className="mb-6 p-4 bg-gradient-to-r from-green-50 to-emerald-100 text-green-800 border border-green-200 rounded-lg shadow-sm">
                            <div className="flex items-start gap-3">
                                <svg className="w-5 h-5 mt-0.5 text-green-600" fill="currentColor" viewBox="0 0 20 20">
                                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 00-1.414-1.414L8 11.172 4.707 7.879A1 1 0 003.293 9.293l4 4a1 1 0 001.414 0l8-8z" clipRule="evenodd" />
                                </svg>
                                <div>
                                    <p className="font-semibold">Success</p>
                                    <p className="text-sm">{successMessage}</p>
                                </div>
                            </div>
                        </div>
                    )}

                    {companies.length > 0 && (
                        <div className="space-y-6">
                            <h2 className="text-xl font-semibold text-gray-900">
                                Companies Found:
                            </h2>

                            {/* Company Selection */}
                            <div className="bg-gray-50 p-6 rounded-lg border">
                                <h3 className="text-lg font-medium text-gray-900 mb-4">
                                    Select Company to Navigate:
                                </h3>
                                <div className="space-y-3">
                                    <select
                                        value={selectedCompany?.url || ""}
                                        onChange={(e) => {
                                            const next = companies.find((company) => company.url === e.target.value);
                                            setSelectedCompany(normalizeCompany(next) || null);
                                            if (next) {
                                                setCompanyStatus('info', `Selected ${repairMojibake(next.name)}`);
                                            } else {
                                                setCompanyStatus('info', 'No company selected');
                                            }
                                        }}
                                        className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                                    >
                                        <option value="">-- Select Company --</option>
                                        {companies.map((company, index) => (
                                            <option key={index} value={company.url}>
                                                {repairMojibake(company.name)} {company.officeId ? `(Office ${company.officeId})` : ''}
                                            </option>
                                        ))}
                                    </select>

                                    <button
                                        onClick={handleNavigateToCompany}
                                        disabled={!selectedCompany || navigating}
                                        className="w-full bg-green-600 text-white py-3 px-6 rounded-lg font-semibold hover:bg-green-700 focus:ring-2 focus:ring-green-500 focus:ring-offset-2 transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center"
                                    >
                                        {navigating ? (
                                            <>
                                                <svg
                                                    className="animate-spin -ml-1 mr-3 h-5 w-5 text-white"
                                                    xmlns="http://www.w3.org/2000/svg"
                                                    fill="none"
                                                    viewBox="0 0 24 24"
                                                >
                                                    <circle
                                                        className="opacity-25"
                                                        cx="12"
                                                        cy="12"
                                                        r="10"
                                                        stroke="currentColor"
                                                        strokeWidth="4"
                                                    ></circle>
                                                    <path
                                                        className="opacity-75"
                                                        fill="currentColor"
                                                        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                                                    ></path>
                                                </svg>
                                                Navigating...
                                            </>
                                        ) : (
                                            "Select Company"
                                        )}
                                    </button>
                                </div>
                            </div>

                            {/* Companies List */}
                            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                                {companies.map((company, index) => (
                                    <div
                                        key={index}
                                        className={`bg-gradient-to-r from-blue-50 to-indigo-50 p-6 rounded-xl border hover:shadow-lg transition-shadow duration-300 cursor-pointer ${selectedCompany?.url === company.url ? 'border-green-500 ring-2 ring-green-200' : 'border-blue-100'
                                            }`}
                                        onClick={() => {
                                            setSelectedCompany(company);
                                            setCompanyStatus('info', `Selected ${company.name}`);
                                        }}
                                    >
                                        <div className="flex items-center mb-3">
                                            <div className="bg-blue-500 p-2 rounded-lg mr-3">
                                                <svg className="w-5 h-5 text-white" fill="currentColor" viewBox="0 0 20 20">
                                                    <path fillRule="evenodd" d="M4 4a2 2 0 00-2 2v8a2 2 0 002 2h12a2 2 0 002-2V6a2 2 0 00-2-2H4zm3 2a1 1 0 000 2h.01a1 1 0 100-2H7zm3 0a1 1 0 000 2h3a1 1 0 100-2h-3z" clipRule="evenodd" />
                                                </svg>
                                            </div>
                                        <h3 className="font-semibold text-gray-900 text-lg">
                                            {repairMojibake(company.name)}
                                        </h3>
                                    </div>
                                        <p className="text-sm text-gray-600 mb-3 break-all">{company.url}</p>
                                        <p className="text-sm text-gray-700 mb-1">
                                            Office ID: {company.officeId || 'Unknown'}{company.sectorId ? ` • Sector: ${company.sectorId}` : ''}
                                        </p>
                                        <div className="flex items-center text-xs text-gray-500">
                                            <svg className="w-4 h-4 mr-1" fill="currentColor" viewBox="0 0 20 20">
                                                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                                            </svg>
                                            Available for navigation
                                        </div>
                                    </div>
                                ))}
                            </div>

                            {navigationComplete && selectedCompany && (
                                <div className="mt-6 rounded-xl border border-emerald-200 bg-white shadow-sm p-6">
                                    <div className="flex items-center gap-3 mb-4">
                                        <div className="h-10 w-10 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center font-bold">
                                            {selectedCompany.name?.charAt(0) || 'C'}
                                        </div>
                                        <div>
                                            <p className="text-lg font-semibold text-gray-900">Company selected</p>
                                            <p className="text-sm text-gray-600">Details from your navigation</p>
                                        </div>
                                    </div>
                                    <div className="grid gap-3 sm:grid-cols-2">
                                        <InfoRow label="Name" value={repairMojibake(selectedCompany.name)} />
                                        <InfoRow label="Office ID" value={selectedCompany.office_id || selectedCompany.officeId || 'Unknown'} />
                                        <InfoRow label="Sector ID" value={selectedCompany.sector_id || selectedCompany.sectorId || 'N/A'} />
                                        <InfoRow label="URL" value={selectedCompany.url} />
                                    </div>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

const InfoRow = ({ label, value }) => (
    <div className="flex flex-col rounded-lg border border-gray-100 bg-gray-50 px-4 py-3">
        <span className="text-xs uppercase tracking-wide text-gray-500">{label}</span>
        <span className="text-sm text-gray-900 break-all">{value || '—'}</span>
    </div>
);
