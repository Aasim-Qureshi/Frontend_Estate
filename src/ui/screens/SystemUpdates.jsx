import React, { useEffect, useMemo, useState } from 'react';
import { useSession } from '../context/SessionContext';
import { useSystemControl } from '../context/SystemControlContext';
import { AlertTriangle, Download, Send, ShieldCheck, Bell, Settings, DollarSign } from 'lucide-react';

const typeLabels = {
    feature: 'Feature Addition',
    bugfix: 'Bug Fix',
    security: 'Security',
    maintenance: 'Maintenance',
    other: 'Other'
};

const rolloutLabels = {
    mandatory: 'Mandatory',
    optional: 'Optional',
    monitoring: 'Monitoring'
};

const humanDate = (value) => (value ? new Date(value).toLocaleString() : 'Not scheduled');

const SystemUpdates = () => {
    const { user, token, isAuthenticated } = useSession();
    const {
        systemState,
        updateSystemState,
        fetchSystemState,
        latestUpdate,
        userUpdateState,
        fetchUpdateNotice,
        markDownloaded,
        applyUpdate
    } = useSystemControl();
    const isAdmin = user?.phone === '000';
    const guestAccessEnabled = systemState?.guestAccessEnabled !== false;
    const guestAccessLimit = Number(systemState?.guestAccessLimit);
    const guestAccessCap = Number.isFinite(guestAccessLimit) && guestAccessLimit > 0 ? guestAccessLimit : 1;

    const [form, setForm] = useState({
        version: '',
        updateType: 'feature',
        rolloutType: 'optional',
        status: 'active',
        windowStart: '',
        windowEnd: '',
        description: '',
        notes: '',
        broadcast: true
    });
    const [updates, setUpdates] = useState([]);
    const [downloadProgress, setDownloadProgress] = useState(0);
    const [downloading, setDownloading] = useState(false);
    const [applyMessage, setApplyMessage] = useState('');
    const [showCard, setShowCard] = useState(true);
    const [dismissed, setDismissed] = useState(false);
    const [loading, setLoading] = useState(false);
    const [listLoading, setListLoading] = useState(false);
    const [guestAccess, setGuestAccess] = useState({ enabled: true, limit: 1 });
    const [guestSaving, setGuestSaving] = useState(false);
    const [guestAccessDirty, setGuestAccessDirty] = useState(false);
    const [guestFreePoints, setGuestFreePoints] = useState(5);
    const [guestFreePointsSaving, setGuestFreePointsSaving] = useState(false);
    const [guestFreePointsDirty, setGuestFreePointsDirty] = useState(false);
    const [ramTabsPerGb, setRamTabsPerGb] = useState(5);
    const [ramTabsSaving, setRamTabsSaving] = useState(false);
    const [ramTabsDirty, setRamTabsDirty] = useState(false);

    const headers = useMemo(() => (token ? { Authorization: `Bearer ${token}` } : {}), [token]);

    const loadUpdates = async () => {
        if (!isAdmin) return;
        setListLoading(true);
        try {
            const data = await window.electronAPI.apiRequest('GET', '/api/updates', {}, headers);
            setUpdates(data || []);
        } catch (err) {
            console.error('Failed to load updates', err);
        } finally {
            setListLoading(false);
        }
    };

    useEffect(() => {
        loadUpdates();
    }, [isAdmin, headers]); // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => {
        setDismissed(false);
        setShowCard(true);
    }, [latestUpdate]);

    useEffect(() => {
        if (!systemState) return;
        const enabled = systemState.guestAccessEnabled !== false;
        const limitValue = Number(systemState.guestAccessLimit);
        const limit = Number.isFinite(limitValue) && limitValue > 0 ? limitValue : 1;
        if (!guestAccessDirty) {
            setGuestAccess({ enabled, limit });
        }
        const tabsValue = Number(systemState.ramTabsPerGb);
        if (!ramTabsDirty) {
            setRamTabsPerGb(Number.isFinite(tabsValue) && tabsValue > 0 ? tabsValue : 5);
        }
        const pointsDigit = Number(systemState?.guestFreePoints);
        if (!guestFreePointsDirty) {
            setGuestFreePoints(
                Number.isFinite(pointsDigit) && pointsDigit > 0 ? pointsDigit : guestAccessCap,
            );
        }
    }, [systemState, guestAccessDirty, ramTabsDirty, guestFreePointsDirty, guestAccessCap]);

    const handleSubmit = async (e) => {
        e.preventDefault();
        setLoading(true);
        try {
            await window.electronAPI.apiRequest('POST', '/api/updates', form, headers);
            setForm({
                version: '',
                updateType: 'feature',
                rolloutType: 'optional',
                status: 'active',
                windowStart: '',
                windowEnd: '',
                description: '',
                notes: '',
                broadcast: true
            });
            await loadUpdates();
            await fetchUpdateNotice();
            alert('Update created and broadcasted.');
        } catch (err) {
            const msg = err?.response?.data?.message || err.message || 'Failed to create update';
            alert(msg);
        } finally {
            setLoading(false);
        }
    };

    const handleGuestAccessSave = async () => {
        setGuestSaving(true);
        try {
            const limitValue = Number(guestAccess.limit);
            const normalizedLimit = Number.isFinite(limitValue) && limitValue > 0 ? limitValue : 1;
            await updateSystemState({
                guestAccessEnabled: guestAccess.enabled,
                guestAccessLimit: normalizedLimit
            });
            setGuestAccessDirty(false);
            await fetchSystemState();
            alert('Guest access settings updated.');
        } catch (err) {
            const msg = err?.response?.data?.message || err.message || 'Failed to update guest access settings';
            alert(msg);
        } finally {
            setGuestSaving(false);
        }
    };

    const handleGuestAccessReset = () => {
        if (!systemState) return;
        const enabled = systemState.guestAccessEnabled !== false;
        const limitValue = Number(systemState.guestAccessLimit);
        const limit = Number.isFinite(limitValue) && limitValue > 0 ? limitValue : 1;
        setGuestAccess({ enabled, limit });
        setGuestAccessDirty(false);
    };

    const handleGuestPointsSave = async () => {
        if (guestFreePointsSaving) return;
        setGuestFreePointsSaving(true);
        try {
            const normalized = Math.max(1, Number(guestFreePoints) || 1);
            await updateSystemState({
                guestFreePoints: normalized,
            });
            setGuestFreePointsDirty(false);
            await fetchSystemState();
            alert('Guest free points updated.');
        } catch (err) {
            const message =
                err?.response?.data?.message ||
                err.message ||
                'Failed to update guest free points';
            alert(message);
        } finally {
            setGuestFreePointsSaving(false);
        }
    };

    const handleGuestPointsReset = () => {
        if (!systemState) return;
        const pointsValue = Number(systemState.guestFreePoints);
        const normalized = Number.isFinite(pointsValue) && pointsValue > 0 ? pointsValue : guestAccessCap;
        setGuestFreePoints(normalized);
        setGuestFreePointsDirty(false);
    };

    const handleRamTabsSave = async () => {
        setRamTabsSaving(true);
        try {
            const normalized = Math.max(1, Number(ramTabsPerGb) || 1);
            await updateSystemState({
                ramTabsPerGb: normalized
            });
            setRamTabsDirty(false);
            await fetchSystemState();
            alert('RAM tab settings updated.');
        } catch (err) {
            const msg = err?.response?.data?.message || err.message || 'Failed to update RAM tab settings';
            alert(msg);
        } finally {
            setRamTabsSaving(false);
        }
    };

    const handleRamTabsReset = () => {
        const tabsValue = Number(systemState?.ramTabsPerGb);
        setRamTabsPerGb(Number.isFinite(tabsValue) && tabsValue > 0 ? tabsValue : 5);
        setRamTabsDirty(false);
    };

    const patchStatus = async (id, payload) => {
        try {
            await window.electronAPI.apiRequest('PATCH', `/api/updates/${id}/status`, payload, headers);
            await loadUpdates();
            await fetchUpdateNotice();
        } catch (err) {
            const msg = err?.response?.data?.message || err.message || 'Failed to update status';
            alert(msg);
        }
    };

    const isMandatory = latestUpdate?.rolloutType === 'mandatory';
    const guestPointsDisplay = Number.isFinite(guestFreePoints) ? guestFreePoints : guestAccessCap;

    const handleDownload = async () => {
        if (!latestUpdate) return;
        if (!isAuthenticated) {
            alert('Login to download updates.');
            return;
        }
        try {
            setApplyMessage('');
            setDownloading(true);
            setDownloadProgress(0);

            const stepper = setInterval(() => {
                setDownloadProgress((prev) => {
                    const next = Math.min(prev + 15, 95);
                    return next;
                });
            }, 120);

            await markDownloaded(latestUpdate._id);

            clearInterval(stepper);
            setDownloadProgress(100);
            setTimeout(() => {
                setDownloading(false);
            }, 300);
        } catch (err) {
            const msg = err?.response?.data?.message || err.message || 'Failed to download update';
            alert(msg);
            setDownloading(false);
            setDownloadProgress(0);
        }
    };

    const handleApply = async () => {
        if (!latestUpdate) return;
        if (!isAuthenticated) {
            alert('Login to apply updates.');
            return;
        }
        try {
            await applyUpdate(latestUpdate._id);
            setApplyMessage('Update applied successfully. You are up to date.');
            setShowCard(false);
        } catch (err) {
            const msg = err?.response?.data?.message || err.message || 'Failed to apply update';
            alert(msg);
        }
    };

    return (
        <div className="p-5">
            <div className="max-w-6xl mx-auto space-y-4">
                <div className="relative overflow-hidden rounded-2xl border border-blue-900/20 bg-gradient-to-br from-slate-950 via-blue-950 to-blue-800 p-4 text-white shadow-lg">
                    <div className="absolute -right-16 -top-12 h-40 w-40 rounded-full bg-blue-400/25 blur-3xl" />
                    <div className="absolute -left-16 -bottom-16 h-40 w-40 rounded-full bg-cyan-200/20 blur-3xl" />
                    <div className="relative z-10 grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-2">
                        <div className="rounded-xl border border-white/15 bg-white/10 px-3 py-2">
                            <div className="flex items-center justify-between text-[9px] uppercase tracking-[0.2em] text-blue-100/70">
                                <span>Guest access</span>
                                <span className="h-1.5 w-1.5 rounded-full bg-cyan-300 shadow-[0_0_8px_rgba(34,211,238,0.9)]" />
                        </div>
                        <p className="text-[13px] font-semibold">
                            {guestAccessEnabled ? `${guestAccessCap} tries` : 'Unlimited'}
                        </p>
                    </div>
                    <div className="rounded-xl border border-white/15 bg-white/10 px-3 py-2">
                        <div className="flex items-center justify-between text-[9px] uppercase tracking-[0.2em] text-blue-100/70">
                            <span>Latest release</span>
                            <span className="h-1.5 w-1.5 rounded-full bg-blue-200 shadow-[0_0_8px_rgba(191,219,254,0.8)]" />
                        </div>
                        <p className="text-[13px] font-semibold">
                            {latestUpdate?.version || 'No release'}
                        </p>
                    </div>
                    <div className="rounded-xl border border-white/15 bg-white/10 px-3 py-2">
                        <div className="flex items-center justify-between text-[9px] uppercase tracking-[0.2em] text-blue-100/70">
                            <span>Update queue</span>
                            <span className="h-1.5 w-1.5 rounded-full bg-white/70 shadow-[0_0_8px_rgba(255,255,255,0.6)]" />
                        </div>
                        <p className="text-[13px] font-semibold">
                            {isAdmin ? updates.length : 'Admin only'}
                        </p>
                    </div>
                    <div className="rounded-xl border border-white/15 bg-white/10 px-3 py-2">
                        <div className="flex items-center justify-between text-[9px] uppercase tracking-[0.2em] text-blue-100/70">
                            <span>Tabs per GB</span>
                            <span className="h-1.5 w-1.5 rounded-full bg-emerald-200 shadow-[0_0_8px_rgba(167,243,208,0.8)]" />
                        </div>
                        <p className="text-[13px] font-semibold">
                            {Math.max(1, Number(ramTabsPerGb) || 1)}
                        </p>
                    </div>
                    <div className="rounded-xl border border-white/15 bg-white/10 px-3 py-2">
                        <div className="flex items-center justify-between text-[9px] uppercase tracking-[0.2em] text-blue-100/70">
                            <span>Guest free points</span>
                            <span className="h-1.5 w-1.5 rounded-full bg-amber-200 shadow-[0_0_8px_rgba(251,191,36,0.8)]" />
                        </div>
                        <p className="text-[13px] font-semibold">
                            {guestPointsDisplay} pts
                        </p>
                    </div>
                </div>
            </div>

                {!isAdmin && latestUpdate && showCard && !dismissed && userUpdateState?.status !== 'applied' && (
                    <div className="rounded-2xl border border-blue-900/15 bg-white p-3 space-y-2 shadow-sm">
                        <div className="flex flex-wrap items-center gap-2">
                            <div className="h-8 w-8 rounded-xl bg-blue-900/10 text-blue-900 flex items-center justify-center">
                                <Bell className="w-4 h-4" />
                            </div>
                            <div>
                                <p className="text-[10px] text-slate-600 font-semibold">Update available</p>
                                <p className="text-[14px] font-bold text-blue-950">Version {latestUpdate.version}</p>
                            </div>
                            <span className="ml-auto text-[9px] uppercase bg-blue-50 border border-blue-900/15 px-2 py-0.5 rounded-full text-blue-900 font-semibold">
                                {typeLabels[latestUpdate.updateType] || latestUpdate.updateType}
                            </span>
                        </div>
                        {(latestUpdate.description || latestUpdate.notes) && (
                            <p className="text-[10px] text-slate-600">
                                {latestUpdate.description || latestUpdate.notes}
                            </p>
                        )}
                        <div className="text-[10px] text-slate-500">
                            Window: {humanDate(latestUpdate.windowStart)} to {humanDate(latestUpdate.windowEnd)}
                        </div>
                        <div className="flex flex-wrap gap-2">
                            <button
                                onClick={handleDownload}
                                className="inline-flex items-center gap-2 rounded-md bg-blue-900 px-3 py-1.5 text-[10px] font-semibold text-white shadow-sm hover:bg-blue-800 disabled:opacity-60"
                                disabled={downloading}
                            >
                                <Download className="w-4 h-4" />
                                {userUpdateState?.status === 'downloaded' ? 'Downloaded' : (downloading ? 'Downloading...' : 'Download')}
                            </button>
                            {!isMandatory && (
                                <button
                                    onClick={() => setDismissed(true)}
                                    className="inline-flex items-center gap-2 rounded-md border border-blue-900/20 bg-white px-3 py-1.5 text-[10px] font-semibold text-blue-900 hover:bg-blue-50"
                                >
                                    Later
                                </button>
                            )}
                            {userUpdateState?.status === 'downloaded' && (
                                <button
                                    onClick={handleApply}
                                    className="inline-flex items-center gap-2 rounded-md bg-emerald-600 px-3 py-1.5 text-[10px] font-semibold text-white shadow-sm hover:bg-emerald-500"
                                    disabled={userUpdateState?.status === 'applied'}
                                >
                                    <ShieldCheck className="w-4 h-4" />
                                    {userUpdateState?.status === 'applied' ? 'Applied' : 'Apply'}
                                </button>
                            )}
                        </div>
                        {downloading && (
                            <div className="w-full bg-blue-900/10 h-2 rounded-full overflow-hidden">
                                <div
                                    className="h-full bg-blue-900 transition-all duration-200"
                                    style={{ width: `${downloadProgress}%` }}
                                />
                            </div>
                        )}
                        {applyMessage && (
                            <div className="text-[10px] text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
                                {applyMessage}
                            </div>
                        )}
                    </div>
                )}

            {isAdmin ? (
                <div className="space-y-3">
                    <div className="rounded-2xl border border-blue-900/15 bg-white shadow-sm p-3 space-y-2">
                        <div className="flex items-center justify-between gap-3">
                            <div className="flex items-center gap-2">
                                <div className={`h-9 w-9 rounded-xl flex items-center justify-center ${guestAccess.enabled ? 'bg-blue-900/10 text-blue-900' : 'bg-slate-200 text-slate-600'}`}>
                                    <ShieldCheck className="w-4 h-4" />
                                </div>
                                <div>
                                    <p className="text-[10px] uppercase tracking-[0.2em] text-blue-900/50">Guest access</p>
                                    <p className="text-[13px] font-semibold text-blue-950">Login-free usage</p>
                                </div>
                            </div>
                            <div className="flex items-center gap-2 text-[10px] font-semibold text-blue-900">
                                <span className={`px-2 py-0.5 rounded-full border ${guestAccess.enabled ? 'bg-blue-50 border-blue-900/10' : 'bg-slate-100 border-slate-200 text-slate-600'}`}>
                                    {guestAccess.enabled ? 'Limited' : 'Unlimited'}
                                </span>
                                <span className="px-2 py-0.5 rounded-full bg-blue-50 border border-blue-900/10 text-blue-900">
                                    {guestAccess.enabled ? `${guestAccess.limit} tries` : 'No limit'}
                                </span>
                            </div>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                            <div className="rounded-xl border border-blue-900/10 bg-blue-50/60 px-3 py-2 flex items-center justify-between">
                                <div>
                                    <p className="text-[9px] uppercase tracking-[0.2em] text-blue-900/50">Limit access</p>
                                    <p className="text-[11px] font-semibold text-blue-950">{guestAccess.enabled ? 'On' : 'Off'}</p>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => {
                                        setGuestAccessDirty(true);
                                        setGuestAccess((prev) => ({ ...prev, enabled: !prev.enabled }));
                                    }}
                                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition ${guestAccess.enabled ? 'bg-blue-900' : 'bg-slate-300'}`}
                                >
                                    <span
                                        className={`inline-block h-5 w-5 transform rounded-full bg-white transition ${guestAccess.enabled ? 'translate-x-5' : 'translate-x-1'}`}
                                    />
                                </button>
                            </div>

                            <div className="rounded-xl border border-blue-900/10 bg-white px-3 py-2 space-y-1">
                                <label className="block text-[10px] font-semibold text-blue-950">Allowed tries</label>
                                <div className="flex items-center gap-1.5">
                                    <input
                                        type="number"
                                        min="1"
                                        value={guestAccess.limit}
                                        onChange={(e) => {
                                            setGuestAccessDirty(true);
                                            setGuestAccess((prev) => ({ ...prev, limit: e.target.value }));
                                        }}
                                        className="w-full px-2 py-1.5 rounded-lg border border-blue-900/20 bg-white/90 text-[10px] text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-900/20 disabled:bg-slate-50 disabled:text-slate-400"
                                        disabled={!guestAccess.enabled}
                                    />
                                </div>
                                <div className="flex items-center gap-1.5">
                                    {[1, 3, 5].map((value) => (
                                        <button
                                            key={value}
                                            type="button"
                                            onClick={() => {
                                                setGuestAccessDirty(true);
                                                setGuestAccess((prev) => ({ ...prev, limit: value }));
                                            }}
                                            className="flex-1 rounded-lg border border-blue-900/15 bg-white px-2 py-1 text-[10px] font-semibold text-blue-900 hover:bg-blue-50 disabled:opacity-50 disabled:cursor-not-allowed"
                                            disabled={!guestAccess.enabled}
                                        >
                                            {value}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            <div className="flex items-center justify-end gap-2">
                                <button
                                    type="button"
                                    onClick={handleGuestAccessSave}
                                    disabled={guestSaving}
                                    className="inline-flex items-center justify-center rounded-md bg-blue-900 px-3 py-1.5 text-[10px] font-semibold text-white shadow-sm hover:bg-blue-800 disabled:opacity-60"
                                >
                                    {guestSaving ? 'Saving...' : 'Save'}
                                </button>
                                <button
                                    type="button"
                                    onClick={handleGuestAccessReset}
                                    className="inline-flex items-center justify-center rounded-md border border-blue-900/20 bg-white px-3 py-1.5 text-[10px] font-semibold text-blue-900 hover:bg-blue-50"
                                >
                                    Reset
                                </button>
                            </div>
                    </div>
                </div>

                <div className="rounded-2xl border border-blue-900/15 bg-white shadow-sm p-3 space-y-2">
                    <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2">
                            <div className="h-9 w-9 rounded-xl bg-amber-900/10 text-amber-900 flex items-center justify-center">
                                <DollarSign className="w-4 h-4" />
                            </div>
                            <div>
                                <p className="text-[10px] uppercase tracking-[0.2em] text-amber-900/50">Guest points</p>
                                <p className="text-[13px] font-semibold text-amber-900">Free points for guest users</p>
                            </div>
                        </div>
                        <div className="text-[10px] px-2 py-0.5 rounded-full bg-amber-50 border border-amber-200 text-amber-900 font-semibold">
                            {guestFreePoints} points
                        </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                        <div className="rounded-xl border border-amber-900/15 bg-amber-50/60 px-3 py-2">
                            <label className="block text-[10px] font-semibold text-amber-950 mb-0.5">Points per guest session</label>
                            <input
                                type="number"
                                min="1"
                                value={guestFreePoints}
                                onChange={(e) => {
                                    setGuestFreePoints(e.target.value);
                                    setGuestFreePointsDirty(true);
                                }}
                                className="w-full px-2 py-1.5 rounded-lg border border-amber-900/20 bg-white/90 text-[10px] text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-900/20"
                            />
                        </div>
                        <div className="rounded-xl border border-amber-900/15 bg-white px-3 py-2">
                            <div className="text-[9px] uppercase tracking-[0.2em] text-amber-900/50">Presets</div>
                            <div className="mt-1 flex items-center gap-1.5">
                                {[3, 5, 10].map((value) => (
                                    <button
                                        key={value}
                                        type="button"
                                        onClick={() => {
                                            setGuestFreePoints(value);
                                            setGuestFreePointsDirty(true);
                                        }}
                                        className="flex-1 rounded-lg border border-amber-900/15 bg-white px-2 py-1 text-[10px] font-semibold text-amber-900 hover:bg-amber-50"
                                    >
                                        {value}
                                    </button>
                                ))}
                            </div>
                        </div>
                        <div className="flex items-center justify-end gap-2">
                            <button
                                type="button"
                                onClick={handleGuestPointsSave}
                                disabled={guestFreePointsSaving || !guestFreePointsDirty}
                                className="inline-flex items-center justify-center rounded-md bg-amber-900 px-3 py-1.5 text-[10px] font-semibold text-white shadow-sm hover:bg-amber-800 disabled:opacity-60"
                            >
                                {guestFreePointsSaving ? 'Saving...' : 'Save'}
                            </button>
                            <button
                                type="button"
                                onClick={handleGuestPointsReset}
                                className="inline-flex items-center justify-center rounded-md border border-amber-900/20 bg-white px-3 py-1.5 text-[10px] font-semibold text-amber-900 hover:bg-amber-50"
                            >
                                Reset
                            </button>
                        </div>
                    </div>
                    <p className="text-[10px] text-slate-500">
                        Controls the number of points guests receive when they bootstrap a new Taqeem session.
                    </p>
                </div>

                <div className="rounded-2xl border border-blue-900/15 bg-white shadow-sm p-3 space-y-2">
                    <div className="flex items-center justify-between gap-3">
                            <div className="flex items-center gap-2">
                                <div className="h-9 w-9 rounded-xl bg-blue-900/10 text-blue-900 flex items-center justify-center">
                                    <Settings className="w-4 h-4" />
                                </div>
                                <div>
                                    <p className="text-[10px] uppercase tracking-[0.2em] text-blue-900/50">RAM scaling</p>
                                    <p className="text-[13px] font-semibold text-blue-950">Tabs per 1 GB</p>
                                </div>
                            </div>
                            <div className="text-[10px] font-semibold text-blue-900 px-2 py-0.5 rounded-full bg-blue-50 border border-blue-900/10">
                                {Math.max(1, Number(ramTabsPerGb) || 1)} tabs / GB
                            </div>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                            <div className="rounded-xl border border-blue-900/10 bg-white px-3 py-2">
                                <label className="block text-[10px] font-semibold text-blue-950 mb-0.5">Tabs per GB</label>
                                <input
                                    type="number"
                                    min="1"
                                    step="1"
                                    value={ramTabsPerGb}
                                    onChange={(e) => {
                                        setRamTabsDirty(true);
                                        setRamTabsPerGb(e.target.value);
                                    }}
                                    className="w-full px-2 py-1.5 rounded-lg border border-blue-900/20 bg-white/90 text-[10px] text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-900/20"
                                />
                            </div>
                            <div className="rounded-xl border border-blue-900/10 bg-blue-50/60 px-3 py-2">
                                <div className="text-[9px] uppercase tracking-[0.2em] text-blue-900/50">Presets</div>
                                <div className="mt-1 flex items-center gap-1.5">
                                    {[3, 5, 8].map((value) => (
                                        <button
                                            key={value}
                                            type="button"
                                            onClick={() => {
                                                setRamTabsDirty(true);
                                                setRamTabsPerGb(value);
                                            }}
                                            className="flex-1 rounded-lg border border-blue-900/15 bg-white px-2 py-1 text-[10px] font-semibold text-blue-900 hover:bg-blue-50"
                                        >
                                            {value}
                                        </button>
                                    ))}
                                </div>
                            </div>
                            <div className="flex items-center justify-end gap-2">
                                <button
                                    type="button"
                                    onClick={handleRamTabsSave}
                                    disabled={ramTabsSaving}
                                    className="inline-flex items-center justify-center rounded-md bg-blue-900 px-3 py-1.5 text-[10px] font-semibold text-white shadow-sm hover:bg-blue-800 disabled:opacity-60"
                                >
                                    {ramTabsSaving ? 'Saving...' : 'Save'}
                                </button>
                                <button
                                    type="button"
                                    onClick={handleRamTabsReset}
                                    className="inline-flex items-center justify-center rounded-md border border-blue-900/20 bg-white px-3 py-1.5 text-[10px] font-semibold text-blue-900 hover:bg-blue-50"
                                >
                                    Reset
                                </button>
                            </div>
                        </div>
                    </div>

                    <form onSubmit={handleSubmit} className="rounded-2xl border border-blue-900/15 bg-white shadow-sm p-3 space-y-2">
                        <div className="flex items-center justify-between gap-3">
                            <div>
                                <p className="text-[10px] uppercase tracking-[0.2em] text-blue-900/50">Release builder</p>
                                <h2 className="text-[13px] font-semibold text-blue-950">Create update</h2>
                            </div>
                            <div className="text-[10px] text-slate-500">Draft</div>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                            <div>
                                <label className="block text-[10px] font-semibold text-blue-950 mb-0.5">Version</label>
                                <input
                                    type="text"
                                    value={form.version}
                                    onChange={(e) => setForm({ ...form, version: e.target.value })}
                                    className="w-full px-2 py-1.5 rounded-lg border border-blue-900/20 bg-white/90 text-[10px] text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-900/20"
                                    placeholder="e.g., v2.4.0"
                                    required
                                />
                            </div>
                            <div>
                                <label className="block text-[10px] font-semibold text-blue-950 mb-0.5">Type</label>
                                <select
                                    value={form.updateType}
                                    onChange={(e) => setForm({ ...form, updateType: e.target.value })}
                                    className="w-full px-2 py-1.5 rounded-lg border border-blue-900/20 bg-white/90 text-[10px] text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-900/20"
                                >
                                    {Object.keys(typeLabels).map((key) => (
                                        <option key={key} value={key}>{typeLabels[key]}</option>
                                    ))}
                                </select>
                            </div>
                            <div>
                                <label className="block text-[10px] font-semibold text-blue-950 mb-0.5">Rollout</label>
                                <select
                                    value={form.rolloutType}
                                    onChange={(e) => setForm({ ...form, rolloutType: e.target.value })}
                                    className="w-full px-2 py-1.5 rounded-lg border border-blue-900/20 bg-white/90 text-[10px] text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-900/20"
                                >
                                    {Object.keys(rolloutLabels).map((key) => (
                                        <option key={key} value={key}>{rolloutLabels[key]}</option>
                                    ))}
                                </select>
                            </div>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                            <div>
                                <label className="block text-[10px] font-semibold text-blue-950 mb-0.5">Status</label>
                                <select
                                    value={form.status}
                                    onChange={(e) => setForm({ ...form, status: e.target.value })}
                                    className="w-full px-2 py-1.5 rounded-lg border border-blue-900/20 bg-white/90 text-[10px] text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-900/20"
                                >
                                    <option value="active">Active</option>
                                    <option value="inactive">Inactive</option>
                                    <option value="scheduled">Scheduled</option>
                                </select>
                            </div>
                            <div>
                                <label className="block text-[10px] font-semibold text-blue-950 mb-0.5">Window start</label>
                                <input
                                    type="datetime-local"
                                    value={form.windowStart}
                                    onChange={(e) => setForm({ ...form, windowStart: e.target.value })}
                                    className="w-full px-2 py-1.5 rounded-lg border border-blue-900/20 bg-white/90 text-[10px] text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-900/20"
                                />
                            </div>
                            <div>
                                <label className="block text-[10px] font-semibold text-blue-950 mb-0.5">Window end</label>
                                <input
                                    type="datetime-local"
                                    value={form.windowEnd}
                                    onChange={(e) => setForm({ ...form, windowEnd: e.target.value })}
                                    className="w-full px-2 py-1.5 rounded-lg border border-blue-900/20 bg-white/90 text-[10px] text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-900/20"
                                />
                            </div>
                        </div>

                        <label className="inline-flex items-center gap-2 text-[10px] font-semibold text-blue-950">
                            <input
                                type="checkbox"
                                checked={form.broadcast}
                                onChange={(e) => setForm({ ...form, broadcast: e.target.checked })}
                            />
                            Broadcast to users
                        </label>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                            <div>
                                <label className="block text-[10px] font-semibold text-blue-950 mb-0.5">Description</label>
                                <textarea
                                    value={form.description}
                                    onChange={(e) => setForm({ ...form, description: e.target.value })}
                                    className="w-full px-2 py-1.5 rounded-lg border border-blue-900/20 bg-white/90 text-[10px] text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-900/20"
                                    rows={2}
                                    placeholder="What is included in this update?"
                                />
                            </div>
                            <div>
                                <label className="block text-[10px] font-semibold text-blue-950 mb-0.5">Notes</label>
                                <textarea
                                    value={form.notes}
                                    onChange={(e) => setForm({ ...form, notes: e.target.value })}
                                    className="w-full px-2 py-1.5 rounded-lg border border-blue-900/20 bg-white/90 text-[10px] text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-900/20"
                                    rows={2}
                                    placeholder="Optional rollout notes"
                                />
                            </div>
                        </div>

                        <button
                            type="submit"
                            disabled={loading}
                            className="w-full inline-flex items-center justify-center gap-2 rounded-md bg-blue-900 px-4 py-2 text-[10px] font-semibold text-white shadow-sm hover:bg-blue-800 disabled:opacity-60"
                        >
                            <Send className="w-4 h-4" />
                            {loading ? 'Publishing...' : 'Publish update'}
                        </button>
                    </form>

                    <div className="rounded-2xl border border-blue-900/15 bg-white shadow-sm overflow-hidden">
                        <div className="px-4 py-3 border-b border-blue-900/10 flex items-center justify-between">
                            <h2 className="text-[13px] font-semibold text-blue-950">Update history</h2>
                            {listLoading && <span className="text-[10px] text-slate-500">Loading...</span>}
                        </div>
                        <div className="overflow-x-auto">
                            <table className="min-w-full">
                                <thead>
                                    <tr className="bg-gradient-to-r from-blue-900 via-slate-900 to-blue-900">
                                        <th className="px-3 py-2 text-left text-[10px] font-semibold text-white/90">Version</th>
                                        <th className="px-3 py-2 text-left text-[10px] font-semibold text-white/90">Type</th>
                                        <th className="px-3 py-2 text-left text-[10px] font-semibold text-white/90">Rollout</th>
                                        <th className="px-3 py-2 text-left text-[10px] font-semibold text-white/90">Status</th>
                                        <th className="px-3 py-2 text-left text-[10px] font-semibold text-white/90">Window</th>
                                        <th className="px-3 py-2 text-left text-[10px] font-semibold text-white/90">Notes</th>
                                        <th className="px-3 py-2 text-left text-[10px] font-semibold text-white/90">Actions</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-blue-900/10">
                                    {updates.map((row) => (
                                        <tr key={row._id} className="hover:bg-blue-50/50 align-top">
                                            <td className="px-3 py-2 text-[10px] font-semibold text-blue-950">{row.version}</td>
                                            <td className="px-3 py-2 text-[10px] text-slate-700">
                                                {typeLabels[row.updateType] || row.updateType}
                                            </td>
                                            <td className="px-3 py-2">
                                                <span className="px-2 py-0.5 rounded-full text-[9px] font-semibold bg-blue-50 text-blue-900 border border-blue-900/15">
                                                    {rolloutLabels[row.rolloutType] || row.rolloutType}
                                                </span>
                                            </td>
                                            <td className="px-3 py-2">
                                                <span className={`px-2 py-0.5 rounded-full text-[9px] font-semibold border ${row.status === 'active'
                                                    ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                                                    : row.status === 'scheduled'
                                                        ? 'bg-amber-50 text-amber-700 border-amber-200'
                                                        : 'bg-slate-100 text-slate-700 border-slate-200'
                                                    }`}>
                                                    {row.status}
                                                </span>
                                                <div className="text-[9px] text-slate-500 mt-1">
                                                    {row.broadcast ? 'Broadcast on' : 'Broadcast off'}
                                                </div>
                                            </td>
                                            <td className="px-3 py-2 text-[10px] text-slate-700">
                                                {humanDate(row.windowStart)}<br />{humanDate(row.windowEnd)}
                                            </td>
                                            <td className="px-3 py-2 text-[10px] text-slate-600 whitespace-pre-wrap">
                                                {row.description || row.notes || '-'}
                                            </td>
                                            <td className="px-3 py-2 space-y-1.5">
                                                <button
                                                    onClick={() => patchStatus(row._id, { status: row.status === 'active' ? 'inactive' : 'active' })}
                                                    className="w-full px-2 py-1.5 rounded-md bg-blue-900 text-white text-[9px] font-semibold hover:bg-blue-800"
                                                >
                                                    {row.status === 'active' ? 'Set inactive' : 'Set active'}
                                                </button>
                                                <button
                                                    onClick={() => patchStatus(row._id, { broadcast: !row.broadcast })}
                                                    className="w-full px-2 py-1.5 rounded-md border border-blue-900/20 bg-white text-blue-900 text-[9px] font-semibold hover:bg-blue-50"
                                                >
                                                    {row.broadcast ? 'Stop broadcast' : 'Broadcast'}
                                                </button>
                                            </td>
                                        </tr>
                                    ))}
                                    {updates.length === 0 && (
                                        <tr>
                                            <td colSpan="7" className="px-4 py-6 text-center text-slate-500 text-[10px]">
                                                No updates yet.
                                            </td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
            ) : (
                <div className="rounded-2xl border border-blue-900/15 bg-white p-4 shadow-sm">
                    <div className="flex items-start gap-3">
                        <AlertTriangle className="w-5 h-5 text-amber-600 mt-0.5" />
                        <div>
                            <p className="text-[15px] font-semibold text-blue-950">Updates are managed by admin</p>
                            <p className="text-[11px] text-slate-600">
                                You will be notified here and on the welcome banner when new Electron System builds are ready.
                            </p>
                        </div>
                    </div>
                </div>
            )}
            </div>
        </div>
    );
};

export default SystemUpdates;
