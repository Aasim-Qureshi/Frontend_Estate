
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MessageCircle, Send, Plus, ShieldCheck, Clock4, UserCheck, Paperclip } from 'lucide-react';
import { io } from 'socket.io-client';
import { useSession } from '../context/SessionContext';
import { useTranslation } from 'react-i18next';

const SOCKET_URL = 'http://localhost:3000';
const API_BASE_URL = 'http://localhost:3000';
const SUPPORT_PHONES = ['022222', '033333'];

const STATUS_LABELS = {
    waiting: 'في انتظار الرد',
    in_support: 'مشكلتك تتراجع في الدعم الفني',
    open: 'مفتوح الآن',
    closed: 'مغلقة',
    reopened: 'اعيدت فتحها'
};

const STATUS_STYLES = {
    waiting: 'border-amber-200 bg-amber-50 text-amber-800',
    in_support: 'border-sky-200 bg-sky-50 text-sky-800',
    open: 'border-emerald-200 bg-emerald-50 text-emerald-800',
    closed: 'border-slate-200 bg-slate-100 text-slate-700',
    reopened: 'border-rose-200 bg-rose-50 text-rose-700'
};

const STATUS_OPTIONS = [
    { value: 'waiting', label: STATUS_LABELS.waiting },
    { value: 'in_support', label: STATUS_LABELS.in_support },
    { value: 'open', label: STATUS_LABELS.open },
    { value: 'closed', label: STATUS_LABELS.closed },
    { value: 'reopened', label: STATUS_LABELS.reopened }
];

const formatTime = (value) => {
    if (!value) return '-';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '-' : date.toLocaleString();
};

const sortTickets = (items = []) =>
    [...items].sort((a, b) => {
        const aTime = new Date(a.lastMessageAt || a.updatedAt || a.createdAt || 0).getTime();
        const bTime = new Date(b.lastMessageAt || b.updatedAt || b.createdAt || 0).getTime();
        return bTime - aTime;
    });

const resolveId = (value) => {
    if (!value) return '';
    if (typeof value === 'string') return value;
    if (value._id) return value._id.toString();
    return value.toString();
};

const buildPreview = (payload = {}) => {
    if (payload.body) return payload.body;
    const attachments = Array.isArray(payload.attachments) ? payload.attachments : [];
    if (attachments.length === 1) return 'Attachment';
    if (attachments.length > 1) return `${attachments.length} attachments`;
    return 'No messages yet.';
};

const Tickets = ({ onViewChange }) => {
    const { user, token, isAuthenticated } = useSession();
    const { t } = useTranslation();
    const isAdmin = user?.phone === '000';
    const isSupport = SUPPORT_PHONES.includes(user?.phone);

    const [tickets, setTickets] = useState([]);
    const [selectedTicketId, setSelectedTicketId] = useState(null);
    const [messages, setMessages] = useState([]);
    const [loadingTickets, setLoadingTickets] = useState(false);
    const [loadingMessages, setLoadingMessages] = useState(false);
    const [createOpen, setCreateOpen] = useState(false);
    const [subject, setSubject] = useState('');
    const [initialMessage, setInitialMessage] = useState('');
    const [newAttachments, setNewAttachments] = useState([]);
    const [creating, setCreating] = useState(false);
    const [sending, setSending] = useState(false);
    const [messageInput, setMessageInput] = useState('');
    const [chatAttachments, setChatAttachments] = useState([]);
    const [socketStatus, setSocketStatus] = useState('disconnected');
    const [socketError, setSocketError] = useState('');
    const [socketToken, setSocketToken] = useState('');
    const [assignPhone, setAssignPhone] = useState(SUPPORT_PHONES[0]);
    const [statusUpdate, setStatusUpdate] = useState('');
    const [statusFilter, setStatusFilter] = useState('all');
    const [searchTerm, setSearchTerm] = useState('');
    const [highlightTicketId, setHighlightTicketId] = useState(null);

    const socketRef = useRef(null);
    const selectedTicketIdRef = useRef(null);
    const messagesEndRef = useRef(null);

    const headers = useMemo(() => (token ? { Authorization: `Bearer ${token}` } : {}), [token]);

    const selectedTicket = useMemo(
        () => tickets.find((ticket) => ticket._id === selectedTicketId) || null,
        [tickets, selectedTicketId]
    );

    const assignedPhone = selectedTicket?.assignedTo?.phone || '';
    const isAssignedToMe = selectedTicket && resolveId(selectedTicket.assignedTo) === resolveId(user?._id);
    const canTakeTicket = isSupport && selectedTicket && (!selectedTicket.assignedTo || assignedPhone === '000');
    const canUpdateStatus = isAdmin || (isSupport && isAssignedToMe);
    const canChat = isAdmin || !isSupport || isAssignedToMe;

    const statusLabel = STATUS_LABELS[selectedTicket?.status] || selectedTicket?.status || '-';

    const ticketStats = useMemo(() => {
        const counts = {
            waiting: 0,
            in_support: 0,
            open: 0,
            closed: 0,
            reopened: 0
        };
        tickets.forEach((ticket) => {
            const key = ticket.status;
            if (counts[key] !== undefined) counts[key] += 1;
        });
        return counts;
    }, [tickets]);

    const filteredTickets = useMemo(() => {
        const term = searchTerm.trim().toLowerCase();
        return tickets.filter((ticket) => {
            if (statusFilter !== 'all' && ticket.status !== statusFilter) return false;
            if (!term) return true;
            const haystack = [
                ticket.subject,
                ticket.lastMessagePreview,
                ticket.createdBy?.phone,
                ticket.createdBy?.displayName,
                ticket.assignedTo?.phone
            ]
                .filter(Boolean)
                .map((value) => String(value).toLowerCase());
            return haystack.some((value) => value.includes(term));
        });
    }, [tickets, statusFilter, searchTerm]);

    const descriptionText = useMemo(() => {
        if (messages.length === 0) return '';
        return messages[0]?.body || '';
    }, [messages]);

    const resolveSocketToken = useCallback(async () => {
        if (token) {
            setSocketToken(token);
            return;
        }
        if (!window?.electronAPI?.getToken) return;
        const res = await window.electronAPI.getToken();
        if (res?.token) {
            setSocketToken(res.token);
        }
    }, [token]);

    useEffect(() => {
        resolveSocketToken();
    }, [resolveSocketToken]);

    const upsertTicket = useCallback((updated) => {
        if (!updated?._id) return;
        setTickets((prev) => {
            const exists = prev.some((ticket) => ticket._id === updated._id);
            const next = exists
                ? prev.map((ticket) => (ticket._id === updated._id ? { ...ticket, ...updated } : ticket))
                : [updated, ...prev];
            return sortTickets(next);
        });
    }, []);
    const loadTickets = useCallback(async () => {
        if (!window?.electronAPI?.apiRequest) return;
        if (!isAuthenticated) return;
        setLoadingTickets(true);
        try {
            const response = await window.electronAPI.apiRequest('GET', '/api/tickets', {}, headers);
            const list = Array.isArray(response?.tickets) ? response.tickets : Array.isArray(response) ? response : [];
            const sorted = sortTickets(list);
            setTickets(sorted);
            if (sorted.length > 0) {
                setSelectedTicketId((prev) => prev || sorted[0]._id);
            }
        } catch (err) {
            console.error('Failed to load tickets', err);
        } finally {
            setLoadingTickets(false);
        }
    }, [headers, isAuthenticated]);

    const loadMessages = useCallback(
        async (ticketId) => {
            if (!window?.electronAPI?.apiRequest || !ticketId) return;
            setLoadingMessages(true);
            try {
                const response = await window.electronAPI.apiRequest(
                    'GET',
                    `/api/tickets/${ticketId}/messages`,
                    {},
                    headers
                );
                setMessages(Array.isArray(response?.messages) ? response.messages : []);
            } catch (err) {
                console.error('Failed to load messages', err);
                setMessages([]);
            } finally {
                setLoadingMessages(false);
            }
        },
        [headers]
    );

    useEffect(() => {
        if (!selectedTicketId) {
            setMessages([]);
            return;
        }
        loadMessages(selectedTicketId);
    }, [selectedTicketId, loadMessages]);

    useEffect(() => {
        selectedTicketIdRef.current = selectedTicketId;
    }, [selectedTicketId]);

    useEffect(() => {
        loadTickets();
    }, [loadTickets]);

    useEffect(() => {
        if (tickets.length === 0) return;
        const raw = localStorage.getItem('notification-target');
        if (!raw) return;
        try {
            const payload = JSON.parse(raw);
            if (payload?.type === 'ticket' && payload?.id) {
                const exists = tickets.some((ticket) => ticket._id === payload.id);
                if (exists) {
                    setSelectedTicketId(payload.id);
                    setHighlightTicketId(payload.id);
                    setTimeout(() => setHighlightTicketId(null), 6000);
                    localStorage.removeItem('notification-target');
                }
            }
        } catch (err) {
            console.warn('Failed to parse notification target', err);
            localStorage.removeItem('notification-target');
        }
    }, [tickets]);

    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages]);

    useEffect(() => {
        if (!socketToken || !user) return;
        const socket = io(SOCKET_URL, {
            auth: { token: socketToken }
        });

        socketRef.current = socket;

        const handleConnect = () => {
            setSocketStatus('connected');
            setSocketError('');
        };
        const handleDisconnect = () => setSocketStatus('disconnected');
        const handleConnectError = (err) => {
            setSocketStatus('error');
            setSocketError(err?.message || 'Unable to connect');
        };

        socket.on('connect', handleConnect);
        socket.on('disconnect', handleDisconnect);
        socket.on('connect_error', handleConnectError);

        socket.on('ticket:created', (payload) => {
            if (!payload?._id) return;
            upsertTicket(payload);
        });

        socket.on('ticket:updated', (payload) => {
            if (!payload?.ticketId) return;
            setTickets((prev) =>
                sortTickets(
                    prev.map((ticket) =>
                        ticket._id === payload.ticketId
                            ? {
                                ...ticket,
                                status: payload.status || ticket.status,
                                lastMessageAt: payload.lastMessageAt || ticket.lastMessageAt,
                                lastMessagePreview: payload.lastMessagePreview || ticket.lastMessagePreview,
                                assignedTo: payload.assignedTo !== undefined ? payload.assignedTo : ticket.assignedTo,
                                updatedAt: payload.updatedAt || ticket.updatedAt
                            }
                            : ticket
                    )
                )
            );
        });

        socket.on('ticket:message', (payload) => {
            if (!payload?.ticketId) return;
            const preview = buildPreview(payload);
            setTickets((prev) =>
                sortTickets(
                    prev.map((ticket) =>
                        ticket._id === payload.ticketId
                            ? {
                                ...ticket,
                                lastMessageAt: payload.createdAt,
                                lastMessagePreview: preview,
                                updatedAt: payload.createdAt
                            }
                            : ticket
                    )
                )
            );
            if (payload.ticketId === selectedTicketIdRef.current) {
                setMessages((prev) => (prev.some((msg) => msg._id === payload._id) ? prev : [...prev, payload]));
            }
        });

        return () => {
            socket.off('connect', handleConnect);
            socket.off('disconnect', handleDisconnect);
            socket.off('connect_error', handleConnectError);
            socket.off('ticket:created');
            socket.off('ticket:updated');
            socket.off('ticket:message');
            socket.disconnect();
            socketRef.current = null;
        };
    }, [socketToken, user, upsertTicket]);

    useEffect(() => {
        const socket = socketRef.current;
        if (!socket || !selectedTicketId || socketStatus !== 'connected') return;
        socket.emit('ticket:join', { ticketId: selectedTicketId });
        return () => {
            socket.emit('ticket:leave', { ticketId: selectedTicketId });
        };
    }, [selectedTicketId, socketStatus]);

    useEffect(() => {
        if (selectedTicket?.status) {
            setStatusUpdate(selectedTicket.status);
        }
    }, [selectedTicket]);
    const handleCreateTicket = async (event) => {
        event.preventDefault();
        if (!subject.trim()) {
            return;
        }
        if (!token) {
            alert('Login required to create a ticket.');
            return;
        }
        if (!initialMessage.trim() && newAttachments.length === 0) {
            alert('Please add a message or attach an image.');
            return;
        }
        setCreating(true);
        try {
            const formData = new FormData();
            formData.append('subject', subject.trim());
            if (initialMessage.trim()) {
                formData.append('message', initialMessage.trim());
            }
            newAttachments.forEach((file) => formData.append('attachments', file));

            const response = await fetch(`${API_BASE_URL}/api/tickets`, {
                method: 'POST',
                headers: { Authorization: `Bearer ${token}` },
                body: formData
            });

            if (!response.ok) {
                let message = 'Failed to create ticket';
                try {
                    const payload = await response.json();
                    message = payload?.message || message;
                } catch (parseError) {
                    const text = await response.text();
                    if (text) message = text;
                }
                throw new Error(message);
            }

            const payload = await response.json();
            const ticket = payload?.ticket || payload;
            if (ticket?._id) {
                upsertTicket(ticket);
                setSelectedTicketId(ticket._id);
                if (payload?.message) {
                    setMessages([payload.message]);
                }
            }
            setSubject('');
            setInitialMessage('');
            setNewAttachments([]);
            setCreateOpen(false);
        } catch (err) {
            const msg = err?.response?.data?.message || err.message || 'Failed to create ticket';
            alert(msg);
        } finally {
            setCreating(false);
        }
    };

    const handleSendMessage = async () => {
        if (!selectedTicketId) return;
        if (!canChat) {
            alert('Start support to reply to this ticket.');
            return;
        }
        const trimmed = messageInput.trim();
        if (!trimmed && chatAttachments.length === 0) return;

        if (chatAttachments.length > 0) {
            if (!token) {
                alert('Login required to send attachments.');
                return;
            }
            setSending(true);
            try {
                const formData = new FormData();
                if (trimmed) {
                    formData.append('body', trimmed);
                }
                chatAttachments.forEach((file) => formData.append('attachments', file));

                const response = await fetch(`${API_BASE_URL}/api/tickets/${selectedTicketId}/messages`, {
                    method: 'POST',
                    headers: { Authorization: `Bearer ${token}` },
                    body: formData
                });

                if (!response.ok) {
                    let message = 'Failed to send message';
                    try {
                        const payload = await response.json();
                        message = payload?.message || message;
                    } catch (parseError) {
                        const text = await response.text();
                        if (text) message = text;
                    }
                    throw new Error(message);
                }

                let payload = null;
                try {
                    payload = await response.json();
                } catch (parseError) {
                    payload = null;
                }
                const message = payload?.message;
                if (message?.ticketId) {
                    const preview = buildPreview(message);
                    setTickets((prev) =>
                        sortTickets(
                            prev.map((ticket) =>
                                ticket._id === message.ticketId
                                    ? {
                                        ...ticket,
                                        lastMessageAt: message.createdAt,
                                        lastMessagePreview: preview,
                                        updatedAt: message.createdAt
                                    }
                                    : ticket
                            )
                        )
                    );
                    if (message.ticketId === selectedTicketId) {
                        setMessages((prev) => (prev.some((msg) => msg._id === message._id) ? prev : [...prev, message]));
                    }
                }
                setMessageInput('');
                setChatAttachments([]);
            } catch (err) {
                alert(err.message || 'Failed to send message');
            } finally {
                setSending(false);
            }
            return;
        }

        const socket = socketRef.current;
        if (!socket || socketStatus !== 'connected') {
            alert('Socket is offline. Please wait for connection.');
            return;
        }
        setSending(true);
        socket.emit('ticket:message', { ticketId: selectedTicketId, body: trimmed }, (ack) => {
            setSending(false);
            if (!ack?.ok) {
                alert(ack?.error || 'Failed to send message');
                return;
            }
            setMessageInput('');
        });
    };

    const handleAssign = async () => {
        if (!selectedTicketId || !assignPhone) return;
        try {
            const response = await window.electronAPI.apiRequest(
                'PATCH',
                `/api/tickets/${selectedTicketId}/assign`,
                { supportPhone: assignPhone },
                headers
            );
            const updated = response?.ticket;
            if (updated?._id) {
                upsertTicket(updated);
            }
        } catch (err) {
            const msg = err?.response?.data?.message || err.message || 'Failed to assign ticket';
            alert(msg);
        }
    };

    const handleTake = async () => {
        if (!selectedTicketId) return;
        try {
            const response = await window.electronAPI.apiRequest('POST', `/api/tickets/${selectedTicketId}/take`, {}, headers);
            const updated = response?.ticket;
            if (updated?._id) {
                upsertTicket(updated);
            }
        } catch (err) {
            const msg = err?.response?.data?.message || err.message || 'Failed to take ticket';
            alert(msg);
        }
    };

    const handleStatusUpdate = async () => {
        if (!selectedTicketId || !statusUpdate) return;
        try {
            const response = await window.electronAPI.apiRequest(
                'PATCH',
                `/api/tickets/${selectedTicketId}/status`,
                { status: statusUpdate },
                headers
            );
            const updated = response?.ticket;
            if (updated?._id) {
                upsertTicket(updated);
            }
        } catch (err) {
            const msg = err?.response?.data?.message || err.message || 'Failed to update status';
            alert(msg);
        }
    };

    if (!isAuthenticated) {
        return (
            <div className="mx-auto max-w-md rounded-2xl border border-slate-200 bg-white/80 p-5 text-center shadow-[0_14px_30px_rgba(15,23,42,0.12)]">
                <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-[color:var(--accent)] text-white">
                    <ShieldCheck className="h-5 w-5" />
                </div>
                <h2 className="mt-3 font-display text-lg text-slate-900">Login required</h2>
                <p className="mt-2 text-[10px] text-slate-500">
                    Please sign in to open support tickets and chat with the super admin.
                </p>
                {onViewChange && (
                    <button
                        onClick={() => onViewChange('login')}
                        className="mt-4 inline-flex items-center gap-2 rounded-full bg-[color:var(--accent)] px-4 py-1.5 text-[10px] font-semibold text-white hover:brightness-95"
                    >
                        Go to login
                    </button>
                )}
            </div>
        );
    }
    return (
        <div
            className="relative page-animate"
            style={{
                '--ticket-ink': 'var(--ink-strong)',
                '--ticket-muted': 'var(--ink-muted)',
                '--ticket-surface': 'var(--surface)',
                '--ticket-border': 'rgba(15,23,42,0.08)',
                '--ticket-accent': 'var(--accent)'
            }}
        >
            <div className="pointer-events-none absolute inset-0 -z-10">
                <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(14,165,233,0.12),transparent_60%)]" />
                <div className="absolute bottom-0 right-0 h-[60%] w-[55%] bg-[radial-gradient(circle_at_bottom,rgba(16,185,129,0.12),transparent_65%)]" />
                <div className="absolute left-0 top-0 h-[55%] w-[50%] bg-[radial-gradient(circle_at_top_left,rgba(56,189,248,0.12),transparent_65%)]" />
            </div>

            <div className="space-y-4">
                <section className="rounded-2xl border border-[color:var(--ticket-border)] bg-[color:var(--ticket-surface)] px-4 py-3 shadow-[0_12px_24px_rgba(15,23,42,0.08)]">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                            <div className="text-[9px] font-semibold uppercase tracking-[0.3em] text-[color:var(--ticket-muted)]">
                                Support Desk
                            </div>
                            <h1 className="mt-1 font-display text-lg text-[color:var(--ticket-ink)]">Tickets</h1>
                            <p className="mt-1 text-[10px] text-[color:var(--ticket-muted)]">
                                تواصل مباشر مع المشرف والدعم الفني.
                            </p>
                        </div>
                        <div className="flex items-center gap-2">
                            <span
                                className={`inline-flex items-center gap-2 rounded-full border px-2.5 py-0.5 text-[9px] font-semibold ${
                                    socketStatus === 'connected'
                                        ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                                        : socketStatus === 'error'
                                            ? 'border-rose-200 bg-rose-50 text-rose-700'
                                            : 'border-slate-200 bg-slate-100 text-slate-500'
                                }`}
                            >
                                <span
                                    className={`h-2 w-2 rounded-full ${
                                        socketStatus === 'connected'
                                            ? 'bg-emerald-500'
                                            : socketStatus === 'error'
                                                ? 'bg-rose-500'
                                                : 'bg-slate-400'
                                    }`}
                                />
                                {socketStatus === 'connected'
                                    ? 'Live'
                                    : socketStatus === 'error'
                                        ? socketError || 'Offline'
                                        : 'Connecting'}
                            </span>
                            <button
                                onClick={loadTickets}
                                className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-2.5 py-0.5 text-[9px] font-semibold text-slate-600 hover:bg-slate-50"
                            >
                                <Clock4 className="h-3.5 w-3.5" />
                                Refresh
                            </button>
                        </div>
                    </div>

                    <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
                        <div className="rounded-xl border border-slate-200 bg-white px-2.5 py-2">
                            <div className="text-[9px] text-[color:var(--ticket-muted)]">الكل</div>
                            <div className="mt-1 font-display text-[13px] text-[color:var(--ticket-ink)]">{tickets.length}</div>
                        </div>
                        <div className="rounded-xl border border-amber-200/70 bg-amber-50/60 px-2.5 py-2">
                            <div className="text-[9px] text-amber-700">{STATUS_LABELS.waiting}</div>
                            <div className="mt-1 font-display text-[13px] text-amber-900">{ticketStats.waiting}</div>
                        </div>
                        <div className="rounded-xl border border-sky-200/70 bg-sky-50/60 px-2.5 py-2">
                            <div className="text-[9px] text-sky-700">{STATUS_LABELS.in_support}</div>
                            <div className="mt-1 font-display text-[13px] text-sky-900">{ticketStats.in_support}</div>
                        </div>
                        <div className="rounded-xl border border-emerald-200/70 bg-emerald-50/60 px-2.5 py-2">
                            <div className="text-[9px] text-emerald-700">{STATUS_LABELS.open}</div>
                            <div className="mt-1 font-display text-[13px] text-emerald-900">{ticketStats.open}</div>
                        </div>
                        <div className="rounded-xl border border-slate-200 bg-slate-100/70 px-2.5 py-2">
                            <div className="text-[9px] text-slate-600">{STATUS_LABELS.closed}</div>
                            <div className="mt-1 font-display text-[13px] text-slate-800">{ticketStats.closed}</div>
                        </div>
                    </div>
                </section>
                <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
                    <aside className="space-y-4">
                        <div className="rounded-2xl border border-[color:var(--ticket-border)] bg-white/95 p-3 shadow-[0_12px_24px_rgba(15,23,42,0.08)]">
                            <div className="flex items-center justify-between">
                                <div className="text-[10px] font-semibold text-[color:var(--ticket-ink)]">
                                    {t('tickets.create.title', { defaultValue: 'New ticket' })}
                                </div>
                                <button
                                    onClick={() => setCreateOpen((prev) => !prev)}
                                    className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-2.5 py-0.5 text-[9px] font-semibold text-slate-600 hover:bg-slate-50"
                                >
                                    <Plus className="h-3.5 w-3.5" />
                                    {createOpen ? 'Hide' : 'Create'}
                                </button>
                            </div>
                            {createOpen && (
                                <form onSubmit={handleCreateTicket} className="mt-3 space-y-2">
                                    <label className="block text-[9px] font-semibold text-[color:var(--ticket-muted)]">
                                        {t('tickets.create.description', { defaultValue: 'الوصف' })}
                                    </label>
                                    <textarea
                                        value={initialMessage}
                                        onChange={(e) => setInitialMessage(e.target.value)}
                                        rows={2}
                                        className="w-full rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-[10px] text-[color:var(--ticket-ink)] focus:outline-none focus:ring-2 focus:ring-sky-200"
                                        placeholder={t('tickets.create.descriptionPlaceholder', { defaultValue: 'اكتب تفاصيل المشكلة...' })}
                                    />
                                    <label className="block text-[9px] font-semibold text-[color:var(--ticket-muted)]">
                                        {t('tickets.create.subject', { defaultValue: 'الموضوع' })}
                                    </label>
                                    <input
                                        value={subject}
                                        onChange={(e) => setSubject(e.target.value)}
                                        className="w-full rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-[10px] text-[color:var(--ticket-ink)] focus:outline-none focus:ring-2 focus:ring-sky-200"
                                        placeholder={t('tickets.create.subjectPlaceholder', { defaultValue: 'عنوان مختصر للتذكرة' })}
                                    />
                                    <div className="flex flex-wrap items-center gap-2">
                                        <label className="inline-flex cursor-pointer items-center gap-2 rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[9px] font-semibold text-slate-600 hover:border-sky-300">
                                            <Paperclip className="h-3.5 w-3.5" />
                                            <input
                                                type="file"
                                                accept="image/*"
                                                multiple
                                                onChange={(event) => setNewAttachments(Array.from(event.target.files || []))}
                                                className="hidden"
                                            />
                                            {t('tickets.create.attachments', { defaultValue: 'صور' })}
                                        </label>
                                        {newAttachments.length > 0 && (
                                            <div className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[9px] font-semibold text-emerald-700">
                                                {newAttachments.length} جاهزة
                                            </div>
                                        )}
                                        {newAttachments.length > 0 && (
                                            <button
                                                type="button"
                                                onClick={() => setNewAttachments([])}
                                                className="text-[9px] font-semibold text-sky-700 hover:text-sky-500"
                                            >
                                                حذف
                                            </button>
                                        )}
                                    </div>
                                    <button
                                        type="submit"
                                        disabled={creating}
                                        className="w-full rounded-xl bg-[color:var(--ticket-accent)] px-4 py-1.5 text-[10px] font-semibold text-white hover:brightness-95 disabled:opacity-60"
                                    >
                                        {creating ? 'Creating...' : t('tickets.create.submit', { defaultValue: 'فتح تذكرة' })}
                                    </button>
                                </form>
                            )}
                        </div>

                        <div className="rounded-2xl border border-[color:var(--ticket-border)] bg-white/95 p-3 shadow-[0_12px_24px_rgba(15,23,42,0.08)]">
                            <div className="flex items-center justify-between">
                                <div className="text-[10px] font-semibold text-[color:var(--ticket-ink)]">
                                    {isAdmin || isSupport
                                        ? t('tickets.list.adminTitle', { defaultValue: 'All tickets' })
                                        : t('tickets.list.userTitle', { defaultValue: 'Your tickets' })}
                                </div>
                                <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[8px] font-semibold text-slate-500">
                                    {filteredTickets.length}
                                </span>
                            </div>
                            <div className="mt-2 flex items-center gap-2">
                                <input
                                    value={searchTerm}
                                    onChange={(event) => setSearchTerm(event.target.value)}
                                    className="w-full rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[9px] text-slate-700 focus:outline-none focus:ring-2 focus:ring-sky-200"
                                    placeholder="بحث..."
                                />
                                <select
                                    value={statusFilter}
                                    onChange={(event) => setStatusFilter(event.target.value)}
                                    className="rounded-full border border-slate-200 bg-white px-2 py-1 text-[9px] text-slate-600"
                                >
                                    <option value="all">كل الحالات</option>
                                    {STATUS_OPTIONS.map((option) => (
                                        <option key={option.value} value={option.value}>
                                            {option.label}
                                        </option>
                                    ))}
                                </select>
                            </div>
                            <div className="mt-2 max-h-[460px] space-y-2 overflow-y-auto pr-1">
                                {loadingTickets && (
                                    <div className="text-center text-[10px] text-[color:var(--ticket-muted)]">Loading...</div>
                                )}
                                {!loadingTickets && filteredTickets.length === 0 && (
                                    <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-3 py-4 text-center text-[10px] text-[color:var(--ticket-muted)]">
                                        {t('tickets.list.empty', { defaultValue: 'No tickets yet.' })}
                                    </div>
                                )}
                                {filteredTickets.map((ticket) => {
                                    const isActive = ticket._id === selectedTicketId;
                                    const isHighlighted = ticket._id === highlightTicketId;
                                    const statusClass = STATUS_STYLES[ticket.status] || STATUS_STYLES.waiting;
                                    const ownerLabel = ticket.createdBy?.phone || ticket.createdBy?.displayName;
                                    return (
                                        <button
                                            key={ticket._id}
                                            onClick={() => setSelectedTicketId(ticket._id)}
                                            className={`w-full rounded-xl border px-3 py-2 text-left transition ${
                                                isActive
                                                    ? 'border-sky-200 bg-sky-50/70'
                                                    : isHighlighted
                                                        ? 'border-amber-200 bg-amber-50/70'
                                                        : 'border-transparent bg-white hover:border-slate-200'
                                            }`}
                                        >
                                            <div className="flex items-start justify-between gap-3">
                                                <div>
                                                    <div className="text-[10px] font-semibold text-[color:var(--ticket-ink)]">
                                                        {ticket.subject}
                                                    </div>
                                                    {(isAdmin || isSupport) && ownerLabel && (
                                                        <div className="mt-1 text-[8px] text-[color:var(--ticket-muted)]">
                                                            {ownerLabel}
                                                        </div>
                                                    )}
                                                </div>
                                                <span className={`rounded-full border px-2 py-0.5 text-[8px] font-semibold ${statusClass}`}>
                                                    {STATUS_LABELS[ticket.status] || ticket.status}
                                                </span>
                                            </div>
                                            <div className="mt-1.5 text-[9px] text-[color:var(--ticket-muted)]">
                                                {ticket.lastMessagePreview || '...'}
                                            </div>
                                            <div className="mt-1.5 flex items-center justify-between text-[8px] text-slate-400">
                                                <span>{formatTime(ticket.lastMessageAt || ticket.updatedAt || ticket.createdAt)}</span>
                                                {ticket.assignedTo?.phone && (
                                                    <span className="inline-flex items-center gap-1">
                                                        <UserCheck className="h-3 w-3" />
                                                        {ticket.assignedTo.phone}
                                                    </span>
                                                )}
                                            </div>
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                    </aside>
                    <section className="flex min-h-[540px] flex-col overflow-hidden rounded-2xl border border-[color:var(--ticket-border)] bg-white/95 shadow-[0_14px_30px_rgba(15,23,42,0.08)]">
                        {!selectedTicket && (
                            <div className="flex flex-1 flex-col items-center justify-center px-4 py-6 text-center">
                                <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-[color:var(--ticket-accent)] text-white">
                                    <MessageCircle className="h-5 w-5" />
                                </div>
                                <h3 className="font-display text-[13px] text-[color:var(--ticket-ink)]">
                                    {t('tickets.empty.title', { defaultValue: 'Select a ticket' })}
                                </h3>
                                <p className="text-[10px] text-[color:var(--ticket-muted)]">
                                    {t('tickets.empty.subtitle', { defaultValue: 'Pick a ticket to view the conversation.' })}
                                </p>
                            </div>
                        )}

                        {selectedTicket && (
                            <>
                                <div className="border-b border-slate-200/70 bg-white px-4 py-3">
                                    <div className="flex flex-wrap items-start justify-between gap-3">
                                        <div className="max-w-xl">
                                            <div className="text-[9px] uppercase tracking-[0.3em] text-[color:var(--ticket-muted)]">
                                                {t('tickets.chat.kicker', { defaultValue: 'Ticket' })}
                                            </div>
                                            <div className="mt-1.5 font-display text-[15px] text-[color:var(--ticket-ink)]">
                                                {descriptionText || t('tickets.chat.descriptionPlaceholder', { defaultValue: 'بدون وصف حتى الآن' })}
                                            </div>
                                            <div className="mt-1 text-[10px] text-[color:var(--ticket-muted)]">
                                                {selectedTicket.subject}
                                            </div>
                                            <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[9px] text-[color:var(--ticket-muted)]">
                                                <span>
                                                    {selectedTicket.createdBy?.phone
                                                        ? `User: ${selectedTicket.createdBy.phone}`
                                                        : 'User'}
                                                </span>
                                                <span className="h-1 w-1 rounded-full bg-slate-300" />
                                                <span>
                                                    {selectedTicket.assignedTo?.phone
                                                        ? `Support: ${selectedTicket.assignedTo.phone}`
                                                        : 'Support: Super Admin'}
                                                </span>
                                            </div>
                                        </div>
                                        <div className="flex flex-col items-end gap-1.5">
                                            <span
                                                className={`rounded-full border px-2.5 py-0.5 text-[9px] font-semibold ${
                                                    STATUS_STYLES[selectedTicket.status] || STATUS_STYLES.waiting
                                                }`}
                                            >
                                                {statusLabel}
                                            </span>
                                            {isAdmin && (
                                                <div className="flex items-center gap-2">
                                                    <select
                                                        value={assignPhone}
                                                        onChange={(event) => setAssignPhone(event.target.value)}
                                                        className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[9px]"
                                                    >
                                                        {SUPPORT_PHONES.map((phone) => (
                                                            <option key={phone} value={phone}>
                                                                {phone}
                                                            </option>
                                                        ))}
                                                    </select>
                                                    <button
                                                        onClick={handleAssign}
                                                        className="rounded-full border border-slate-200 bg-[color:var(--ticket-accent)] px-2.5 py-0.5 text-[9px] font-semibold text-white hover:brightness-95"
                                                    >
                                                        Assign
                                                    </button>
                                                </div>
                                            )}
                                            {isSupport && canTakeTicket && (
                                                <button
                                                    onClick={handleTake}
                                                    className="rounded-full border border-sky-200 bg-sky-600 px-2.5 py-0.5 text-[9px] font-semibold text-white hover:bg-sky-500"
                                                >
                                                    Start support
                                                </button>
                                            )}
                                            {canUpdateStatus && (
                                                <div className="flex items-center gap-2">
                                                    <select
                                                        value={statusUpdate}
                                                        onChange={(event) => setStatusUpdate(event.target.value)}
                                                        className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[9px]"
                                                    >
                                                        {STATUS_OPTIONS.filter((option) =>
                                                            isAdmin ? true : option.value !== 'waiting'
                                                        ).map((option) => (
                                                            <option key={option.value} value={option.value}>
                                                                {option.label}
                                                            </option>
                                                        ))}
                                                    </select>
                                                    <button
                                                        onClick={handleStatusUpdate}
                                                        className="rounded-full border border-slate-200 bg-white px-2.5 py-0.5 text-[9px] font-semibold text-slate-700 hover:bg-slate-50"
                                                    >
                                                        Update
                                                    </button>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </div>
                                <div className="flex-1 space-y-3 overflow-y-auto bg-slate-50/70 px-4 py-4">
                                    {loadingMessages && (
                                        <div className="text-center text-[10px] text-[color:var(--ticket-muted)]">Loading messages...</div>
                                    )}
                                    {!loadingMessages && messages.length === 0 && (
                                        <div className="text-center text-[10px] text-[color:var(--ticket-muted)]">No messages yet.</div>
                                    )}
                                    {messages.map((msg) => {
                                        const isMine = resolveId(msg.senderId) === resolveId(user?._id);
                                        const attachments = Array.isArray(msg.attachments) ? msg.attachments : [];
                                        return (
                                            <div key={msg._id} className={`max-w-[72%] ${isMine ? 'ml-auto' : 'mr-auto'}`}>
                                                <div
                                                    className={`rounded-xl px-3 py-1.5 text-[10px] ${
                                                        isMine
                                                            ? 'bg-[color:var(--ticket-accent)] text-white'
                                                            : 'border border-slate-200 bg-white text-[color:var(--ticket-ink)]'
                                                    }`}
                                                >
                                                    <div className={`mb-1 text-[8px] ${isMine ? 'text-white/70' : 'text-slate-400'}`}>
                                                        {msg.senderRole === 'admin'
                                                            ? 'Super Admin'
                                                            : msg.senderRole === 'support'
                                                                ? 'Support'
                                                                : msg.senderPhone || 'User'}
                                                    </div>
                                                    {msg.body && <div className="whitespace-pre-wrap leading-relaxed">{msg.body}</div>}
                                                    {attachments.length > 0 && (
                                                        <div className="mt-2 grid grid-cols-2 gap-2">
                                                            {attachments.map((file) => {
                                                                const url = file.url?.startsWith('http')
                                                                    ? file.url
                                                                    : `${API_BASE_URL}${file.url}`;
                                                                return (
                                                                    <a key={url} href={url} target="_blank" rel="noreferrer">
                                                                        <img
                                                                            src={url}
                                                                            alt={file.name || 'attachment'}
                                                                            className="h-20 w-full rounded-lg object-cover"
                                                                        />
                                                                    </a>
                                                                );
                                                            })}
                                                        </div>
                                                    )}
                                                </div>
                                                <div className={`mt-1 text-[8px] text-slate-400 ${isMine ? 'text-right' : 'text-left'}`}>
                                                    {formatTime(msg.createdAt)}
                                                </div>
                                            </div>
                                        );
                                    })}
                                    <div ref={messagesEndRef} />
                                </div>

                                <div className="border-t border-slate-200/70 bg-white px-4 py-3">
                                    <div className="flex flex-col gap-2">
                                        <textarea
                                            value={messageInput}
                                            onChange={(e) => setMessageInput(e.target.value)}
                                            onKeyDown={(event) => {
                                                if (event.key === 'Enter' && !event.shiftKey) {
                                                    event.preventDefault();
                                                    handleSendMessage();
                                                }
                                            }}
                                            rows={2}
                                            disabled={!canChat}
                                            className="w-full rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-[10px] text-[color:var(--ticket-ink)] focus:outline-none focus:ring-2 focus:ring-sky-200 disabled:bg-slate-100/80"
                                            placeholder={
                                                canChat
                                                    ? t('tickets.chat.placeholder', { defaultValue: 'Write a reply...' })
                                                    : 'Start support to reply.'
                                            }
                                        />
                                        <div className="flex flex-wrap items-center justify-between gap-2">
                                            <div className="flex flex-wrap items-center gap-2">
                                                <label
                                                    className={`inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[9px] font-semibold text-slate-600 ${
                                                        canChat ? 'cursor-pointer hover:border-sky-300' : 'cursor-not-allowed opacity-60'
                                                    }`}
                                                >
                                                    <Paperclip className="h-3.5 w-3.5" />
                                                    <input
                                                        type="file"
                                                        accept="image/*"
                                                        multiple
                                                        onChange={(event) => setChatAttachments(Array.from(event.target.files || []))}
                                                        disabled={!canChat}
                                                        className="hidden"
                                                    />
                                                    {t('tickets.chat.attachments', { defaultValue: 'Attach images' })}
                                                </label>
                                                {chatAttachments.length > 0 && (
                                                    <div className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[9px] font-semibold text-emerald-700">
                                                        {chatAttachments.length} ready
                                                    </div>
                                                )}
                                                {chatAttachments.length > 0 && (
                                                    <button
                                                        type="button"
                                                        onClick={() => setChatAttachments([])}
                                                        className="text-[9px] font-semibold text-sky-700 hover:text-sky-500"
                                                    >
                                                        Clear
                                                    </button>
                                                )}
                                            </div>
                                            <button
                                                onClick={handleSendMessage}
                                                disabled={sending || !canChat}
                                                className="inline-flex items-center gap-2 rounded-full bg-[color:var(--ticket-accent)] px-4 py-1.5 text-[10px] font-semibold text-white hover:brightness-95 disabled:opacity-60"
                                            >
                                                <Send className="h-4 w-4" />
                                                {sending ? 'Sending...' : 'Send'}
                                            </button>
                                        </div>
                                    </div>
                                    <div className="mt-2 text-[8px] text-slate-400">
                                        {t('tickets.chat.hint', { defaultValue: 'Press Enter to send, Shift+Enter for a new line.' })}
                                    </div>
                                </div>
                            </>
                        )}
                    </section>
                </div>
            </div>
        </div>
    );
};

export default Tickets;
