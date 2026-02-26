import React, { useState, useEffect, useRef, useCallback } from "react";
import { MessageCircle, Package, Send, X } from "lucide-react";
import { useSession } from "../context/SessionContext";

const BANK_ACCOUNT_NUMBER = "0123456789";
const API_BASE_URL = "http://167.71.231.64:3000";
const REQUESTS_PAGE_SIZE = 10;
const DEDUCTION_HISTORY_LIMIT = 20;

const formatDateTime = (value) => {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString();
};

const formatTime = (value) => {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "-" : date.toLocaleString();
};

const formatMoney = (value) => {
  if (value === null || value === undefined || value === "") return "-";
  const amount = Number(value);
  if (!Number.isFinite(amount)) return "-";
  return `$${amount.toFixed(2)}`;
};

const Packages = () => {
  const { user, token } = useSession();
  const isAdmin = user?.phone === "000";
  const [packages, setPackages] = useState([]);
  const [formData, setFormData] = useState({ name: "", points: "", price: "" });
  const [editingPackage, setEditingPackage] = useState(null);
  const [totalPoints, setTotalPoints] = useState(0);
  const [subscriptions, setSubscriptions] = useState([]);
  const [requests, setRequests] = useState([]);
  const [deductionHistory, setDeductionHistory] = useState([]);
  const [historyPagination, setHistoryPagination] = useState({
    page: 1,
    limit: 20,
    total: 0,
    totalPages: 1,
  });
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyModalOpen, setHistoryModalOpen] = useState(false);
  const [historyHighlightId, setHistoryHighlightId] = useState(null);
  const [isBankModalOpen, setIsBankModalOpen] = useState(false);
  const [selectedPackage, setSelectedPackage] = useState(null);
  const [isAdminRequestsOpen, setIsAdminRequestsOpen] = useState(false);
  const [isSubscriptionsOpen, setIsSubscriptionsOpen] = useState(false);
  const [isRequestsOpen, setIsRequestsOpen] = useState(false);
  const [uploadingRequestId, setUploadingRequestId] = useState(null);
  const [processingRequestId, setProcessingRequestId] = useState(null);
  const [accountNumberInput, setAccountNumberInput] = useState("");
  const [editingRequestId, setEditingRequestId] = useState(null);
  const [editingAccountNumber, setEditingAccountNumber] = useState("");
  const [updatingRequestId, setUpdatingRequestId] = useState(null);
  const [deletingRequestId, setDeletingRequestId] = useState(null);
  const [requestsPage, setRequestsPage] = useState(1);
  const [adminRequestsPage, setAdminRequestsPage] = useState(1);
  const [activeChatRequestId, setActiveChatRequestId] = useState(null);
  const [highlightRequestId, setHighlightRequestId] = useState(null);
  const [chatMessagesByRequest, setChatMessagesByRequest] = useState({});
  const [chatLoadingByRequest, setChatLoadingByRequest] = useState({});
  const [chatInputByRequest, setChatInputByRequest] = useState({});
  const [chatAttachmentsByRequest, setChatAttachmentsByRequest] = useState({});
  const [chatSendingByRequest, setChatSendingByRequest] = useState({});
  const accountNumberRef = useRef(null);
  const chatInputRefs = useRef({});

  const fetchPackages = async () => {
    try {
      const response = await window.electronAPI.apiRequest(
        "GET",
        "/api/packages",
      );
      setPackages(response || []);
    } catch (error) {
      console.error("Error fetching packages:", error);
      setPackages([]);
    }
  };

  const fetchSubscriptions = useCallback(async () => {
    if (!token) return;
    try {
      const headers = { Authorization: `Bearer ${token}` };
      const response = await window.electronAPI.apiRequest(
        "GET",
        "/api/packages/subscriptions",
        {},
        headers,
      );
      setTotalPoints(response.totalPoints);
      setSubscriptions(response.subscriptions);
    } catch (error) {
      console.error("Error fetching subscriptions:", error);
      setTotalPoints(0);
      setSubscriptions([]);
    }
  }, [token]);

  const notifyRequestUpdates = async (items) => {
    if (!token || !Array.isArray(items)) return;
    const pendingNotifications = items.filter(
      (request) =>
        ["confirmed", "rejected"].includes(request.status) &&
        !request.userNotified,
    );
    if (pendingNotifications.length === 0) return;

    const messages = pendingNotifications.map((request) => {
      const name = request.packageName || request.packageId?.name || "Package";
      const statusLabel =
        request.status === "confirmed" ? "confirmed" : "rejected";
      return `Your request for ${name} was ${statusLabel}.`;
    });

    alert(messages.join("\n"));

    const headers = { Authorization: `Bearer ${token}` };
    await Promise.all(
      pendingNotifications.map((request) =>
        window.electronAPI.apiRequest(
          "POST",
          `/api/packages/requests/${request._id}/ack`,
          {},
          headers,
        ),
      ),
    );

    setRequests((prev) =>
      prev.map((request) =>
        pendingNotifications.some((item) => item._id === request._id)
          ? { ...request, userNotified: true }
          : request,
      ),
    );

    if (
      pendingNotifications.some((request) => request.status === "confirmed")
    ) {
      fetchSubscriptions();
    }
  };

  const fetchRequests = useCallback(async () => {
    if (!token) return;
    try {
      const headers = { Authorization: `Bearer ${token}` };
      const response = await window.electronAPI.apiRequest(
        "GET",
        "/api/packages/requests",
        {},
        headers,
      );
      const items = response || [];
      setRequests(items);
      if (!isAdmin) {
        await notifyRequestUpdates(items);
      }
    } catch (error) {
      console.error("Error fetching requests:", error);
      setRequests([]);
    }
  }, [token, isAdmin]);

  const fetchDeductionHistory = useCallback(
    async (page = 1) => {
      if (!token) {
        setDeductionHistory([]);
        setHistoryPagination({
          page: 1,
          limit: DEDUCTION_HISTORY_LIMIT,
          total: 0,
          totalPages: 1,
        });
        return;
      }
      setHistoryLoading(true);
      try {
        const headers = { Authorization: `Bearer ${token}` };
        const response = await window.electronAPI.apiRequest(
          "GET",
          `/api/packages/deductions?page=${page}&limit=${DEDUCTION_HISTORY_LIMIT}`,
          {},
          headers,
        );
        if (response?.success) {
          setDeductionHistory(
            Array.isArray(response.data) ? response.data : [],
          );
          setHistoryPagination({
            page: response.pagination?.page || page,
            limit: response.pagination?.limit || DEDUCTION_HISTORY_LIMIT,
            total: response.pagination?.total || 0,
            totalPages: response.pagination?.totalPages || 1,
          });
        }
      } catch (error) {
        console.error("Failed to load deduction history:", error);
        setDeductionHistory([]);
      } finally {
        setHistoryLoading(false);
      }
    },
    [token],
  );

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    fetchPackages();
  }, []);

  useEffect(() => {
    if (!token) {
      setTotalPoints(0);
      setSubscriptions([]);
      setRequests([]);
      setActiveChatRequestId(null);
      setChatMessagesByRequest({});
      setChatLoadingByRequest({});
      setChatInputByRequest({});
      setChatAttachmentsByRequest({});
      setChatSendingByRequest({});
      setAccountNumberInput("");
      setEditingRequestId(null);
      setEditingAccountNumber("");
      setUpdatingRequestId(null);
      setDeletingRequestId(null);
      setIsSubscriptionsOpen(false);
      setIsRequestsOpen(false);
      setRequestsPage(1);
      setAdminRequestsPage(1);
      return;
    }
    fetchSubscriptions();
    fetchRequests();
    fetchDeductionHistory();
  }, [token, fetchSubscriptions, fetchRequests, fetchDeductionHistory]);

  useEffect(() => {
    const handler = () => {
      fetchSubscriptions();
      fetchDeductionHistory();
    };
    window.addEventListener("points-updated", handler);
    return () => {
      window.removeEventListener("points-updated", handler);
    };
  }, [fetchSubscriptions, fetchDeductionHistory]);

  useEffect(() => {
    if (!activeChatRequestId) return;
    const input = chatInputRefs.current[activeChatRequestId];
    if (input) {
      input.focus();
    }
  }, [activeChatRequestId]);

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData({ ...formData, [name]: value });
  };

  const handleAddPackage = async (e) => {
    e.preventDefault();
    try {
      const headers = token ? { Authorization: `Bearer ${token}` } : {};
      await window.electronAPI.apiRequest(
        "POST",
        "/api/packages",
        formData,
        headers,
      );
      alert("Package added successfully!");
      setFormData({ name: "", points: "", price: "" });
      fetchPackages();
    } catch (error) {
      console.error("Error adding package:", error);
      const errorMsg =
        error.response?.data?.message ||
        error.message ||
        "Failed to add package";
      alert(`Failed to add package: ${errorMsg}`);
    }
  };

  const handleSubscribe = (pkg) => {
    setSelectedPackage(pkg);
    setIsBankModalOpen(true);
    setAccountNumberInput("");
    if (accountNumberRef.current) {
      accountNumberRef.current.value = "";
    }
  };

  const scrollToRequests = () => {
    setIsRequestsOpen(true);
  };

  const handleCreateRequest = async () => {
    if (!selectedPackage) return;
    if (!token) {
      alert("Login required to request a package.");
      return;
    }
    const trimmedAccountNumber = String(
      accountNumberRef.current?.value ?? accountNumberInput,
    ).trim();
    if (!trimmedAccountNumber) {
      alert("Please add your account number before continuing.");
      return;
    }
    try {
      const headers = { Authorization: `Bearer ${token}` };
      await window.electronAPI.apiRequest(
        "POST",
        "/api/packages/requests",
        { packageId: selectedPackage._id, accountNumber: trimmedAccountNumber },
        headers,
      );
      alert(
        "Request created. Upload your transfer image to send it to the super admin.",
      );
      setIsBankModalOpen(false);
      setSelectedPackage(null);
      setAccountNumberInput("");
      if (accountNumberRef.current) {
        accountNumberRef.current.value = "";
      }
      await fetchRequests();
      scrollToRequests();
    } catch (error) {
      console.error("Error creating request:", error);
      const errorMsg =
        error.response?.data?.message || error.message || "Request failed";
      alert(`Request failed: ${errorMsg}`);
    }
  };
  const handleEdit = (pkg) => {
    setEditingPackage(pkg);
    setFormData({ name: pkg.name, points: pkg.points, price: pkg.price });
  };

  const handleDelete = async (packageId) => {
    if (window.confirm("Are you sure you want to delete this package?")) {
      try {
        const headers = token ? { Authorization: `Bearer ${token}` } : {};
        await window.electronAPI.apiRequest(
          "DELETE",
          `/api/packages/${packageId}`,
          {},
          headers,
        );
        alert("Package deleted successfully!");
        fetchPackages();
      } catch (error) {
        console.error("Error deleting package:", error);
        const errorMsg =
          error.response?.data?.message ||
          error.message ||
          "Failed to delete package";
        alert(`Failed to delete package: ${errorMsg}`);
      }
    }
  };

  const handleUpdatePackage = async (e) => {
    e.preventDefault();
    try {
      const headers = token ? { Authorization: `Bearer ${token}` } : {};
      await window.electronAPI.apiRequest(
        "PUT",
        `/api/packages/${editingPackage._id}`,
        formData,
        headers,
      );
      alert("Package updated successfully!");
      setFormData({ name: "", points: "", price: "" });
      setEditingPackage(null);
      fetchPackages();
    } catch (error) {
      console.error("Error updating package:", error);
      const errorMsg =
        error.response?.data?.message ||
        error.message ||
        "Failed to update package";
      alert(`Failed to update package: ${errorMsg}`);
    }
  };

  const handleCancelEdit = () => {
    setEditingPackage(null);
    setFormData({ name: "", points: "", price: "" });
  };

  const handleUploadTransfer = async (requestId, file) => {
    if (!file) return;
    if (!token) {
      alert("Login required to upload transfer image.");
      return;
    }

    setUploadingRequestId(requestId);
    try {
      const formData = new FormData();
      formData.append("transferImage", file);

      const response = await fetch(
        `${API_BASE_URL}/api/packages/requests/${requestId}/upload`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
          },
          body: formData,
        },
      );

      if (!response.ok) {
        let message = "Failed to upload transfer image";
        try {
          const payload = await response.json();
          message = payload?.message || message;
        } catch (parseError) {
          const text = await response.text();
          if (text) message = text;
        }
        throw new Error(message);
      }

      const updatedRequest = await response.json();
      setRequests((prev) =>
        prev.map((request) =>
          request._id === requestId ? updatedRequest : request,
        ),
      );
      alert("Transfer image uploaded.");
    } catch (error) {
      console.error("Upload failed:", error);
      const errorMsg = error.message || "Upload failed";
      alert(`Upload failed: ${errorMsg}`);
    } finally {
      setUploadingRequestId(null);
    }
  };

  const handleUpdateRequestStatus = async (requestId, status) => {
    if (!token) {
      alert("Login required to update requests.");
      return;
    }
    setProcessingRequestId(requestId);
    try {
      const headers = { Authorization: `Bearer ${token}` };
      await window.electronAPI.apiRequest(
        "PATCH",
        `/api/packages/requests/${requestId}/status`,
        { status },
        headers,
      );
      alert(status === "confirmed" ? "Request approved." : "Request rejected.");
      await fetchRequests();
    } catch (error) {
      console.error("Error updating request status:", error);
      const errorMsg =
        error.response?.data?.message || error.message || "Update failed";
      alert(`Update failed: ${errorMsg}`);
    } finally {
      setProcessingRequestId(null);
    }
  };

  const handleStartEditRequest = (request) => {
    setEditingRequestId(request._id);
    setEditingAccountNumber(String(request.accountNumber || "").trim());
  };

  const handleCancelEditRequest = () => {
    setEditingRequestId(null);
    setEditingAccountNumber("");
  };

  const handleSaveRequestEdit = async (requestId) => {
    const trimmedAccount = editingAccountNumber.trim();
    if (!trimmedAccount) {
      alert("Account number is required.");
      return;
    }
    if (!token) {
      alert("Login required to update requests.");
      return;
    }

    setUpdatingRequestId(requestId);
    try {
      const headers = { Authorization: `Bearer ${token}` };
      const updated = await window.electronAPI.apiRequest(
        "PATCH",
        `/api/packages/requests/${requestId}`,
        { accountNumber: trimmedAccount },
        headers,
      );
      if (updated?._id) {
        setRequests((prev) =>
          prev.map((request) =>
            request._id === requestId ? updated : request,
          ),
        );
      }
      handleCancelEditRequest();
    } catch (error) {
      console.error("Error updating request:", error);
      const errorMsg =
        error.response?.data?.message || error.message || "Update failed";
      alert(`Update failed: ${errorMsg}`);
    } finally {
      setUpdatingRequestId(null);
    }
  };

  const handleDeleteRequest = async (requestId) => {
    if (!token) {
      alert("Login required to delete requests.");
      return;
    }
    if (!window.confirm("Are you sure you want to delete this request?")) {
      return;
    }
    setDeletingRequestId(requestId);
    try {
      const headers = { Authorization: `Bearer ${token}` };
      await window.electronAPI.apiRequest(
        "DELETE",
        `/api/packages/requests/${requestId}`,
        {},
        headers,
      );
      setRequests((prev) =>
        prev.filter((request) => request._id !== requestId),
      );
      if (activeChatRequestId === requestId) {
        setActiveChatRequestId(null);
      }
      if (editingRequestId === requestId) {
        handleCancelEditRequest();
      }
    } catch (error) {
      console.error("Error deleting request:", error);
      const errorMsg =
        error.response?.data?.message || error.message || "Delete failed";
      alert(`Delete failed: ${errorMsg}`);
    } finally {
      setDeletingRequestId(null);
    }
  };

  const loadRequestMessages = async (requestId) => {
    if (!token) return;
    setChatLoadingByRequest((prev) => ({ ...prev, [requestId]: true }));
    try {
      const headers = { Authorization: `Bearer ${token}` };
      const response = await window.electronAPI.apiRequest(
        "GET",
        `/api/packages/requests/${requestId}/messages`,
        {},
        headers,
      );
      const messages = Array.isArray(response?.messages)
        ? response.messages
        : [];
      setChatMessagesByRequest((prev) => ({ ...prev, [requestId]: messages }));
    } catch (error) {
      console.error("Error loading request messages:", error);
      setChatMessagesByRequest((prev) => ({ ...prev, [requestId]: [] }));
    } finally {
      setChatLoadingByRequest((prev) => ({ ...prev, [requestId]: false }));
    }
  };

  const toggleRequestChat = (requestId) => {
    if (activeChatRequestId === requestId) {
      setActiveChatRequestId(null);
      return;
    }
    setActiveChatRequestId(requestId);
    loadRequestMessages(requestId);
  };

  const handleSendRequestMessage = async (requestId) => {
    const input = chatInputRefs.current[requestId];
    const body = String(
      chatInputByRequest[requestId] ?? input?.value ?? "",
    ).trim();
    const attachments = chatAttachmentsByRequest[requestId] || [];
    if (!body && attachments.length === 0) return;
    if (!token) {
      alert("Login required to send messages.");
      return;
    }

    setChatSendingByRequest((prev) => ({ ...prev, [requestId]: true }));
    try {
      const formData = new FormData();
      if (body) {
        formData.append("body", body);
      }
      attachments.forEach((file) => formData.append("attachments", file));

      const response = await fetch(
        `${API_BASE_URL}/api/packages/requests/${requestId}/messages`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
          },
          body: formData,
        },
      );

      if (!response.ok) {
        let message = "Failed to send message";
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
      const newMessage = payload?.message || payload;
      if (newMessage?._id) {
        setChatMessagesByRequest((prev) => ({
          ...prev,
          [requestId]: [...(prev[requestId] || []), newMessage],
        }));
      }
      setChatInputByRequest((prev) => ({ ...prev, [requestId]: "" }));
      setChatAttachmentsByRequest((prev) => ({ ...prev, [requestId]: [] }));
    } catch (error) {
      console.error("Failed to send message:", error);
      alert(error.message || "Failed to send message");
    } finally {
      setChatSendingByRequest((prev) => ({ ...prev, [requestId]: false }));
    }
  };

  const resolvePackageName = (request) =>
    request.packageName || request.packageId?.name || "Package";
  const resolvePackagePoints = (request) =>
    request.packagePoints || request.packageId?.points || 0;
  const resolvePackagePrice = (request) => {
    const directPrice = Number(request?.packagePrice);
    if (Number.isFinite(directPrice) && directPrice > 0) return directPrice;
    const fallbackPrice = Number(request?.packageId?.price);
    if (Number.isFinite(fallbackPrice) && fallbackPrice > 0)
      return fallbackPrice;
    return null;
  };
  const resolveAccountNumber = (request) =>
    String(request?.accountNumber || "").trim() || "-";
  const resolveUserId = (requestUser) => {
    if (!requestUser) return null;
    if (typeof requestUser === "string") return requestUser;
    return requestUser._id;
  };

  const myRequests =
    isAdmin && user?._id
      ? requests.filter((request) => resolveUserId(request.userId) === user._id)
      : requests;
  const pendingRequestsCount = requests.filter(
    (request) => request.status === "pending",
  ).length;

  useEffect(() => {
    if (!token) return;
    const raw = localStorage.getItem("notification-target");
    if (!raw) return;
    let payload;
    try {
      payload = JSON.parse(raw);
    } catch (err) {
      console.warn("Failed to parse notification target", err);
      localStorage.removeItem("notification-target");
      return;
    }

    if (payload?.type === "deduction-history") {
      setHistoryModalOpen(true);
      fetchDeductionHistory(payload?.page || 1);
      if (payload?.deductionId) {
        setHistoryHighlightId(payload.deductionId);
        setTimeout(() => setHistoryHighlightId(null), 6000);
      }
      localStorage.removeItem("notification-target");
      return;
    }

    if (payload?.type !== "package-request" || !payload?.id) return;
    const list = isAdmin ? requests : myRequests;
    if (!Array.isArray(list) || list.length === 0) return;
    const targetIndex = list.findIndex((request) => request._id === payload.id);
    if (targetIndex === -1) return;

    const targetPage = Math.floor(targetIndex / REQUESTS_PAGE_SIZE) + 1;
    if (isAdmin) {
      setIsAdminRequestsOpen(true);
      setAdminRequestsPage(targetPage);
    } else {
      setIsRequestsOpen(true);
      setRequestsPage(targetPage);
    }
    setActiveChatRequestId(payload.id);
    loadRequestMessages(payload.id);
    setHighlightRequestId(payload.id);
    setTimeout(() => setHighlightRequestId(null), 6000);
    localStorage.removeItem("notification-target");
  }, [token, requests, myRequests, isAdmin, fetchDeductionHistory]);

  useEffect(() => {
    setRequestsPage(1);
  }, [myRequests.length]);

  useEffect(() => {
    setAdminRequestsPage(1);
  }, [requests.length]);

  const getPageCount = (items) =>
    Math.max(1, Math.ceil(items.length / REQUESTS_PAGE_SIZE));

  const statusStyles = {
    new: "border-blue-200 bg-blue-50 text-blue-700",
    pending: "border-amber-200 bg-amber-50 text-amber-700",
    confirmed: "border-emerald-200 bg-emerald-50 text-emerald-700",
    rejected: "border-rose-200 bg-rose-50 text-rose-700",
  };

  const renderRequestChatRow = (request, colSpan) => {
    if (activeChatRequestId !== request._id) return null;
    const messages = chatMessagesByRequest[request._id] || [];
    const loading = chatLoadingByRequest[request._id];
    const sending = chatSendingByRequest[request._id];
    const attachments = chatAttachmentsByRequest[request._id] || [];

    return (
      <tr className="bg-blue-50/40">
        <td colSpan={colSpan} className="px-3 py-3">
          <div className="rounded-xl border border-blue-900/15 bg-white/95 shadow-sm overflow-hidden pointer-events-auto">
            <div className="flex items-center justify-between px-3 py-1.5 bg-slate-900 text-white">
              <div className="flex items-center gap-2 text-[10px] font-semibold">
                <MessageCircle className="h-4 w-4" />
                Request chat
              </div>
              <button
                onClick={() => loadRequestMessages(request._id)}
                className="rounded-full border border-white/20 bg-white/10 px-2.5 py-0.5 text-[9px] font-semibold hover:bg-white/20"
              >
                Refresh
              </button>
            </div>
            <div className="px-3 py-2 space-y-2 max-h-40 overflow-y-auto">
              {loading && (
                <div className="text-center text-[10px] text-slate-500">
                  Loading messages...
                </div>
              )}
              {!loading && messages.length === 0 && (
                <div className="text-center text-[10px] text-slate-500">
                  No messages yet.
                </div>
              )}
              {messages.map((msg) => {
                const isMine =
                  msg.senderId?.toString() === user?._id?.toString();
                const bubbleStyle = isMine
                  ? "ml-auto bg-gradient-to-r from-blue-900 to-blue-700 text-white"
                  : "mr-auto bg-white text-slate-800 border border-blue-900/10";
                const files = Array.isArray(msg.attachments)
                  ? msg.attachments
                  : [];
                return (
                  <div
                    key={msg._id}
                    className={`max-w-[75%] ${isMine ? "ml-auto" : "mr-auto"}`}
                  >
                    <div
                      className={`rounded-xl px-2.5 py-1.5 text-[10px] shadow-sm ${bubbleStyle}`}
                    >
                      <div className="text-[8px] opacity-70 mb-0.5">
                        {msg.senderRole === "admin"
                          ? "Super Admin"
                          : msg.senderPhone || "User"}
                      </div>
                      {msg.body && (
                        <div className="whitespace-pre-wrap leading-relaxed">
                          {msg.body}
                        </div>
                      )}
                      {files.length > 0 && (
                        <div className="mt-2 grid grid-cols-2 gap-2">
                          {files.map((file) => {
                            const url = file.url?.startsWith("http")
                              ? file.url
                              : `${API_BASE_URL}${file.url}`;
                            return (
                              <a
                                key={url}
                                href={url}
                                target="_blank"
                                rel="noreferrer"
                              >
                                <img
                                  src={url}
                                  alt={file.name || "attachment"}
                                  className="h-16 w-full rounded-md object-cover border border-blue-900/10"
                                />
                              </a>
                            );
                          })}
                        </div>
                      )}
                    </div>
                    <div
                      className={`mt-1 text-[9px] text-slate-400 ${isMine ? "text-right" : "text-left"}`}
                    >
                      {formatTime(msg.createdAt)}
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="border-t border-blue-900/10 px-3 py-2 space-y-2 bg-white/90">
              <div className="flex items-end gap-2">
                <textarea
                  ref={(el) => {
                    if (el) {
                      chatInputRefs.current[request._id] = el;
                    }
                  }}
                  value={chatInputByRequest[request._id] || ""}
                  onChange={(event) =>
                    setChatInputByRequest((prev) => ({
                      ...prev,
                      [request._id]: event.target.value,
                    }))
                  }
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      handleSendRequestMessage(request._id);
                    }
                  }}
                  rows={2}
                  className="flex-1 rounded-lg border border-blue-900/20 bg-white px-2.5 py-1.5 text-[10px] text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-900/20 pointer-events-auto"
                  placeholder="Write a short, professional reply..."
                />
                <button
                  onClick={() => handleSendRequestMessage(request._id)}
                  disabled={sending}
                  className="inline-flex items-center gap-2 rounded-lg bg-blue-900 px-3 py-1.5 text-[10px] font-semibold text-white shadow-sm hover:bg-blue-800 disabled:opacity-60"
                >
                  <Send className="h-4 w-4" />
                  {sending ? "Sending..." : "Send"}
                </button>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  onChange={(event) =>
                    setChatAttachmentsByRequest((prev) => ({
                      ...prev,
                      [request._id]: Array.from(event.target.files || []),
                    }))
                  }
                  className="block text-[9px] text-slate-600"
                />
                {attachments.length > 0 && (
                  <div className="rounded-lg border border-blue-900/10 bg-blue-50 px-2 py-1 text-[10px] text-blue-900">
                    {attachments.length} image
                    {attachments.length > 1 ? "s" : ""} ready
                  </div>
                )}
              </div>
              <div className="text-[8px] text-slate-500">
                Share a transfer proof for quick approval.
              </div>
            </div>
          </div>
        </td>
      </tr>
    );
  };

  return (
    <div className="p-4 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-blue-900/15 bg-gradient-to-r from-white via-blue-50 to-white px-3 py-2 shadow-sm">
        <div className="flex items-center gap-2">
          <div className="h-8 w-8 rounded-xl bg-blue-900 text-white flex items-center justify-center shadow-sm">
            <Package className="w-4 h-4" />
          </div>
          <div>
            <div className="text-[11px] uppercase tracking-[0.2em] text-blue-900/60 font-semibold">
              Billing
            </div>
            <h2 className="text-lg font-bold text-blue-950">
              Packages & Balance
            </h2>
            <p className="text-[11px] text-slate-600">
              Track subscriptions, points, and available packages.
            </p>
          </div>
        </div>
      </div>

      {isAdmin && (
        <div className="rounded-2xl border border-blue-900/15 bg-white shadow-sm p-2.5 flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-[11px] uppercase tracking-[0.18em] text-blue-900/50">
              Requests
            </p>
            <h3 className="text-[15px] font-semibold text-blue-950">
              Pending approvals
            </h3>
            <p className="text-[11px] text-slate-600">
              Pending: {pendingRequestsCount}
            </p>
          </div>
          <button
            onClick={() => {
              setIsAdminRequestsOpen(true);
              fetchRequests();
            }}
            className="rounded-md bg-blue-900 px-3 py-1.5 text-[11px] font-semibold text-white shadow-sm hover:bg-blue-800"
          >
            Requests
          </button>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-blue-900/15 bg-white shadow-sm px-3 py-2">
        <button
          onClick={() => setIsSubscriptionsOpen(true)}
          className="rounded-md border border-slate-700 bg-slate-900/80 px-3 py-1.5 text-[11px] font-semibold text-white shadow-lg hover:bg-slate-900"
        >
          Subscriptions
        </button>
        <button
          onClick={() => setIsRequestsOpen(true)}
          className="rounded-md border border-slate-700 bg-slate-900/80 px-3 py-1.5 text-[11px] font-semibold text-white shadow-lg hover:bg-slate-900"
        >
          Requests
        </button>
        <button
          onClick={() => {
            fetchDeductionHistory(1);
            setHistoryHighlightId(null);
            setHistoryModalOpen(true);
          }}
          className="rounded-md border border-slate-700 bg-slate-900/80 px-3 py-1.5 text-[11px] font-semibold text-white shadow-lg hover:bg-slate-900"
        >
          History of Deduction
        </button>
      </div>

      {/* Balance full width */}
      <div className="rounded-2xl border border-blue-900/15 bg-white shadow-sm p-2 space-y-1">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[11px] uppercase tracking-[0.18em] text-blue-900/50">
              Balance
            </p>
            <h3 className="text-[15px] font-semibold text-blue-950">
              Current Balance
            </h3>
          </div>
          <span className="text-[10px] text-blue-900/60">
            Updated from subscriptions
          </span>
        </div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <div className="p-2 rounded-xl bg-blue-50/60 border border-blue-900/10">
            <p className="text-[11px] text-blue-900/60">
              Total Number of Points
            </p>
            <p className="text-[18px] font-semibold text-blue-950">
              {totalPoints}
            </p>
          </div>
          <div className="p-2 rounded-xl bg-blue-50/60 border border-blue-900/10">
            <p className="text-[11px] text-blue-900/60">Total Balance</p>
            <p className="text-[18px] font-semibold text-blue-950">
              {totalPoints}
            </p>
          </div>
        </div>
      </div>

      {/* Packages Table */}
      <div className="rounded-2xl border border-blue-900/15 bg-white shadow-sm overflow-hidden">
        <div className="px-3 py-2 border-b border-blue-900/10">
          <p className="text-[11px] uppercase tracking-[0.18em] text-blue-900/50">
            Packages
          </p>
          <h3 className="text-[15px] font-semibold text-blue-950">
            Available Packages
          </h3>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full">
            <thead>
              <tr className="bg-gradient-to-r from-blue-900 via-slate-900 to-blue-900 text-white">
                <th className="px-3 py-2 text-left text-[11px] font-semibold">
                  Name
                </th>
                <th className="px-3 py-2 text-left text-[11px] font-semibold">
                  Points
                </th>
                <th className="px-3 py-2 text-left text-[11px] font-semibold">
                  Price
                </th>
                <th className="px-3 py-2 text-left text-[11px] font-semibold">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-blue-900/10">
              {packages.map((pkg) => (
                <tr key={pkg._id} className="hover:bg-blue-50/50">
                  <td className="px-3 py-2 whitespace-nowrap text-[11px] font-semibold text-blue-950">
                    {pkg.name}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap text-[11px] text-slate-700">
                    {pkg.points}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap text-[11px] text-slate-700">
                    ${pkg.price}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap font-medium">
                    {isAdmin ? (
                      <div className="flex flex-wrap gap-2">
                        <button
                          onClick={() => handleEdit(pkg)}
                          className="rounded-md border border-blue-900/20 bg-white px-2.5 py-1.5 text-[10px] font-semibold text-blue-900 hover:bg-blue-50"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => handleDelete(pkg._id)}
                          className="rounded-md border border-rose-200 bg-rose-50 px-2.5 py-1.5 text-[10px] font-semibold text-rose-700 hover:bg-rose-100"
                        >
                          Delete
                        </button>
                        <button
                          onClick={() => handleSubscribe(pkg)}
                          className="rounded-md bg-blue-900 px-2.5 py-1.5 text-[10px] font-semibold text-white shadow-sm hover:bg-blue-800"
                        >
                          Subscribe
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => handleSubscribe(pkg)}
                        className="rounded-md bg-blue-900 px-3 py-1.5 text-[11px] font-semibold text-white shadow-sm hover:bg-blue-800"
                      >
                        Subscribe
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add/Edit Package Form - Only for Admin */}
      {isAdmin && (
        <div className="rounded-2xl border border-blue-900/15 bg-white shadow-sm p-2.5 space-y-2 w-full">
          <div>
            <p className="text-[11px] uppercase tracking-[0.18em] text-blue-900/50">
              Manage
            </p>
            <h3 className="text-[15px] font-semibold text-blue-950">
              {editingPackage ? "Edit Package" : "Add New Package"}
            </h3>
          </div>
          <form
            onSubmit={editingPackage ? handleUpdatePackage : handleAddPackage}
            className="space-y-2"
          >
            <div className="grid grid-cols-1 gap-2 md:grid-cols-4 md:items-end">
              <div className="space-y-1">
                <label className="block text-[11px] font-semibold text-blue-950">
                  Name
                </label>
                <input
                  type="text"
                  name="name"
                  value={formData.name}
                  onChange={handleInputChange}
                  className="block w-full px-2.5 py-1.5 border border-blue-900/20 rounded-lg bg-white/90 text-[11px] text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-900/20"
                  required
                />
              </div>
              <div className="space-y-1">
                <label className="block text-[11px] font-semibold text-blue-950">
                  Points
                </label>
                <input
                  type="number"
                  name="points"
                  value={formData.points}
                  onChange={handleInputChange}
                  className="block w-full px-2.5 py-1.5 border border-blue-900/20 rounded-lg bg-white/90 text-[11px] text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-900/20"
                  required
                />
              </div>
              <div className="space-y-1">
                <label className="block text-[11px] font-semibold text-blue-950">
                  Price
                </label>
                <input
                  type="number"
                  step="0.01"
                  name="price"
                  value={formData.price}
                  onChange={handleInputChange}
                  className="block w-full px-2.5 py-1.5 border border-blue-900/20 rounded-lg bg-white/90 text-[11px] text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-900/20"
                  required
                />
              </div>
              <div className="flex flex-wrap items-center justify-start gap-2 md:justify-end">
                {editingPackage && (
                  <button
                    type="button"
                    onClick={handleCancelEdit}
                    className="rounded-md border border-blue-900/20 bg-white px-3 py-1.5 text-[11px] font-semibold text-blue-900 hover:bg-blue-50"
                  >
                    Cancel
                  </button>
                )}
                <button
                  type="submit"
                  className="rounded-md bg-blue-900 px-3 py-1.5 text-[11px] font-semibold text-white shadow-sm hover:bg-blue-800"
                >
                  {editingPackage ? "Update Package" : "Add Package"}
                </button>
              </div>
            </div>
          </form>
        </div>
      )}

      {isSubscriptionsOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="w-full max-w-3xl rounded-2xl bg-white shadow-xl border border-blue-900/20 max-h-[85vh] overflow-hidden flex flex-col">
            <div className="px-4 py-3 border-b border-blue-900/10 flex items-center justify-between bg-white sticky top-0 z-10">
              <div>
                <h3 className="text-[15px] font-semibold text-blue-950">
                  Your Subscriptions
                </h3>
                <p className="text-[11px] text-slate-600">
                  Track your active packages and points.
                </p>
              </div>
              <button
                onClick={() => setIsSubscriptionsOpen(false)}
                className="inline-flex items-center gap-1 rounded-md border border-blue-900/20 bg-white px-2.5 py-1 text-[11px] font-semibold text-blue-900 hover:bg-blue-50"
              >
                <X className="h-4 w-4" />
                Close
              </button>
            </div>
            <div className="p-3 overflow-y-auto">
              <div className="overflow-x-auto rounded-xl border border-blue-900/10 bg-white">
                <table className="min-w-full">
                  <thead>
                    <tr className="bg-gradient-to-r from-blue-900 via-slate-900 to-blue-900 text-white">
                      <th className="px-3 py-2 text-left text-[11px] font-semibold">
                        Package Name
                      </th>
                      <th className="px-3 py-2 text-left text-[11px] font-semibold">
                        Points
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-blue-900/10">
                    {subscriptions.length === 0 ? (
                      <tr>
                        <td
                          colSpan="2"
                          className="px-3 py-2 text-[11px] text-slate-500"
                        >
                          No subscriptions yet.
                        </td>
                      </tr>
                    ) : (
                      subscriptions.map((sub) => (
                        <tr key={sub._id} className="hover:bg-blue-50/50">
                          <td className="px-3 py-2 text-[11px] font-semibold text-blue-950">
                            {sub.packageId.name}
                          </td>
                          <td className="px-3 py-2 text-[11px] text-slate-600">
                            {sub.packageId.points}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}

      {isRequestsOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="w-full max-w-5xl rounded-2xl bg-white shadow-xl border border-blue-900/20 max-h-[85vh] overflow-hidden flex flex-col">
            <div className="px-4 py-3 border-b border-blue-900/10 flex items-center justify-between bg-white sticky top-0 z-10">
              <div>
                <h3 className="text-[15px] font-semibold text-blue-950">
                  My Requests
                </h3>
                <p className="text-[11px] text-slate-600">
                  Upload your transfer image to send the request to the super
                  admin.
                </p>
              </div>
              <button
                onClick={() => setIsRequestsOpen(false)}
                className="inline-flex items-center gap-1 rounded-md border border-blue-900/20 bg-white px-2.5 py-1 text-[11px] font-semibold text-blue-900 hover:bg-blue-50"
              >
                <X className="h-4 w-4" />
                Close
              </button>
            </div>
            <div className="p-3 overflow-y-auto">
              <div className="overflow-x-auto rounded-xl border border-blue-900/10 bg-white">
                <table className="min-w-full">
                  <thead>
                    <tr className="bg-gradient-to-r from-blue-900 via-slate-900 to-blue-900 text-white">
                      <th className="px-3 py-2 text-left text-[11px] font-semibold">
                        Package
                      </th>
                      <th className="px-3 py-2 text-left text-[11px] font-semibold">
                        Price
                      </th>
                      <th className="px-3 py-2 text-left text-[11px] font-semibold">
                        Points
                      </th>
                      <th className="px-3 py-2 text-left text-[11px] font-semibold">
                        Account Number
                      </th>
                      <th className="px-3 py-2 text-left text-[11px] font-semibold">
                        Transfer Image
                      </th>
                      <th className="px-3 py-2 text-left text-[11px] font-semibold">
                        Status
                      </th>
                      <th className="px-3 py-2 text-left text-[11px] font-semibold">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-blue-900/10">
                    {myRequests.length === 0 ? (
                      <tr>
                        <td
                          colSpan="7"
                          className="px-3 py-2 text-[11px] text-slate-500"
                        >
                          No requests yet.
                        </td>
                      </tr>
                    ) : (
                      myRequests
                        .slice(
                          (requestsPage - 1) * REQUESTS_PAGE_SIZE,
                          requestsPage * REQUESTS_PAGE_SIZE,
                        )
                        .map((request) => {
                          const status = request.status || "pending";
                          const statusStyle =
                            statusStyles[status] || statusStyles.pending;
                          const imageUrl = request.transferImagePath
                            ? `${API_BASE_URL}${request.transferImagePath}`
                            : null;
                          const isHighlighted =
                            highlightRequestId === request._id;
                          return (
                            <React.Fragment key={request._id}>
                              <tr
                                className={`${isHighlighted ? "bg-amber-100/60 ring-1 ring-amber-300/70" : "hover:bg-blue-50/50"} transition`}
                              >
                                <td className="px-3 py-2 text-[11px] font-semibold text-blue-950">
                                  {resolvePackageName(request)}
                                </td>
                                <td className="px-3 py-2 text-[11px] text-slate-600">
                                  {formatMoney(resolvePackagePrice(request))}
                                </td>
                                <td className="px-3 py-2 text-[11px] text-slate-600">
                                  {resolvePackagePoints(request)}
                                </td>
                                <td className="px-3 py-2 text-[11px] text-slate-600">
                                  {resolveAccountNumber(request)}
                                </td>
                                <td className="px-3 py-2 text-[11px] text-slate-600">
                                  {imageUrl ? (
                                    <a
                                      href={imageUrl}
                                      target="_blank"
                                      rel="noreferrer"
                                    >
                                      <img
                                        src={imageUrl}
                                        alt="Transfer"
                                        className="h-10 w-14 rounded-md object-cover border border-blue-900/10"
                                      />
                                    </a>
                                  ) : (
                                    <span className="text-[10px] text-slate-500">
                                      No image
                                    </span>
                                  )}
                                </td>
                                <td className="px-3 py-2 text-[11px] text-slate-600">
                                  <span
                                    className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold ${statusStyle}`}
                                  >
                                    {status.charAt(0).toUpperCase() +
                                      status.slice(1)}
                                  </span>
                                </td>
                                <td className="px-3 py-2 text-[11px] text-slate-600">
                                  <div className="flex flex-col items-start gap-2">
                                    <div className="flex flex-wrap items-center gap-2">
                                      {status === "new" && (
                                        <label className="inline-flex items-center rounded-md border border-blue-900/20 bg-white px-2.5 py-1.5 text-[10px] font-semibold text-blue-900 hover:bg-blue-50 cursor-pointer">
                                          <input
                                            type="file"
                                            accept="image/*"
                                            className="hidden"
                                            disabled={
                                              uploadingRequestId === request._id
                                            }
                                            onChange={(event) => {
                                              const file =
                                                event.target.files?.[0];
                                              if (!file) return;
                                              handleUploadTransfer(
                                                request._id,
                                                file,
                                              );
                                              event.target.value = "";
                                            }}
                                          />
                                          {uploadingRequestId === request._id
                                            ? "Uploading..."
                                            : "Upload Image"}
                                        </label>
                                      )}
                                      {!["new", "pending"].includes(status) && (
                                        <span className="text-[10px] text-slate-500">
                                          Locked
                                        </span>
                                      )}
                                      <button
                                        onClick={() =>
                                          handleStartEditRequest(request)
                                        }
                                        disabled={
                                          !["new", "pending"].includes(
                                            status,
                                          ) || editingRequestId === request._id
                                        }
                                        className="inline-flex items-center gap-1 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-[10px] font-semibold text-amber-700 hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-50"
                                      >
                                        Edit
                                      </button>
                                      <button
                                        onClick={() =>
                                          handleDeleteRequest(request._id)
                                        }
                                        disabled={
                                          !["new", "pending"].includes(
                                            status,
                                          ) || deletingRequestId === request._id
                                        }
                                        className="inline-flex items-center gap-1 rounded-md border border-rose-200 bg-rose-50 px-2.5 py-1.5 text-[10px] font-semibold text-rose-700 hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-50"
                                      >
                                        {deletingRequestId === request._id
                                          ? "Deleting..."
                                          : "Delete"}
                                      </button>
                                      <button
                                        onClick={() =>
                                          toggleRequestChat(request._id)
                                        }
                                        className={`inline-flex items-center gap-1 rounded-md border px-2.5 py-1.5 text-[10px] font-semibold ${
                                          activeChatRequestId === request._id
                                            ? "border-blue-900 bg-blue-900 text-white"
                                            : "border-blue-900/20 bg-white text-blue-900 hover:bg-blue-50"
                                        }`}
                                      >
                                        <MessageCircle className="h-3.5 w-3.5" />
                                        {activeChatRequestId === request._id
                                          ? "Close chat"
                                          : "Chat"}
                                      </button>
                                    </div>
                                    {editingRequestId === request._id && (
                                      <div className="w-full space-y-2 rounded-lg border border-amber-200 bg-amber-50/60 p-2">
                                        <label className="block text-[10px] font-semibold text-amber-700">
                                          Update account number
                                        </label>
                                        <input
                                          type="text"
                                          value={editingAccountNumber}
                                          onChange={(event) =>
                                            setEditingAccountNumber(
                                              event.target.value,
                                            )
                                          }
                                          className="w-full rounded-md border border-amber-200 bg-white px-2 py-1 text-[11px] text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-200"
                                          placeholder="Account number"
                                        />
                                        {status === "pending" && (
                                          <div className="space-y-1">
                                            <label className="block text-[10px] font-semibold text-amber-700">
                                              Transfer image
                                            </label>
                                            <label className="inline-flex items-center rounded-md border border-blue-900/20 bg-white px-2.5 py-1.5 text-[10px] font-semibold text-blue-900 hover:bg-blue-50 cursor-pointer">
                                              <input
                                                type="file"
                                                accept="image/*"
                                                className="hidden"
                                                disabled={
                                                  uploadingRequestId ===
                                                  request._id
                                                }
                                                onChange={(event) => {
                                                  const file =
                                                    event.target.files?.[0];
                                                  if (!file) return;
                                                  handleUploadTransfer(
                                                    request._id,
                                                    file,
                                                  );
                                                  event.target.value = "";
                                                }}
                                              />
                                              {uploadingRequestId ===
                                              request._id
                                                ? "Uploading..."
                                                : "Replace Image"}
                                            </label>
                                          </div>
                                        )}
                                        <div className="flex flex-wrap items-center gap-2">
                                          <button
                                            onClick={() =>
                                              handleSaveRequestEdit(request._id)
                                            }
                                            disabled={
                                              updatingRequestId === request._id
                                            }
                                            className="rounded-md bg-amber-600 px-3 py-1.5 text-[10px] font-semibold text-white shadow-sm hover:bg-amber-500 disabled:opacity-60"
                                          >
                                            {updatingRequestId === request._id
                                              ? "Saving..."
                                              : "Save"}
                                          </button>
                                          <button
                                            onClick={handleCancelEditRequest}
                                            className="rounded-md border border-amber-200 bg-white px-3 py-1.5 text-[10px] font-semibold text-amber-700 hover:bg-amber-100"
                                          >
                                            Cancel
                                          </button>
                                        </div>
                                      </div>
                                    )}
                                    {status === "new" && (
                                      <span className="text-[9px] text-slate-500">
                                        Upload the transfer transaction to send
                                        it to the super admin.
                                      </span>
                                    )}
                                    {status === "pending" && (
                                      <span className="text-[9px] text-slate-500">
                                        Use Edit to replace the transfer image
                                        if needed.
                                      </span>
                                    )}
                                  </div>
                                </td>
                              </tr>
                              {renderRequestChatRow(request, 7)}
                            </React.Fragment>
                          );
                        })
                    )}
                  </tbody>
                </table>
              </div>
              {myRequests.length > REQUESTS_PAGE_SIZE && (
                <div className="mt-3 flex items-center justify-between text-[10px] text-slate-600">
                  <span>
                    Page {requestsPage} of {getPageCount(myRequests)}
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() =>
                        setRequestsPage((prev) => Math.max(1, prev - 1))
                      }
                      disabled={requestsPage === 1}
                      className="rounded-md border border-blue-900/20 bg-white px-2.5 py-1 text-[10px] font-semibold text-blue-900 hover:bg-blue-50 disabled:opacity-50"
                    >
                      Previous
                    </button>
                    <button
                      onClick={() =>
                        setRequestsPage((prev) =>
                          Math.min(getPageCount(myRequests), prev + 1),
                        )
                      }
                      disabled={requestsPage >= getPageCount(myRequests)}
                      className="rounded-md border border-blue-900/20 bg-white px-2.5 py-1 text-[10px] font-semibold text-blue-900 hover:bg-blue-50 disabled:opacity-50"
                    >
                      Next
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {isBankModalOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white shadow-xl border border-blue-900/20">
            <div className="px-4 py-3 border-b border-blue-900/10">
              <h3 className="text-[15px] font-semibold text-blue-950">
                Bank Transfer
              </h3>
              <p className="text-[11px] text-slate-600">
                Send money to this account to complete the payment process and
                receive points.
              </p>
            </div>
            <div className="px-4 py-3 space-y-3">
              <div className="rounded-xl border border-blue-900/10 bg-blue-50/60 px-3 py-2">
                <p className="text-[10px] uppercase tracking-[0.18em] text-blue-900/60">
                  Account Number
                </p>
                <p className="text-[14px] font-semibold text-blue-950">
                  {BANK_ACCOUNT_NUMBER}
                </p>
              </div>
              <div className="rounded-xl border border-blue-900/10 bg-white px-3 py-2 space-y-1">
                <label className="block text-[10px] uppercase tracking-[0.18em] text-blue-900/60">
                  Your account number
                </label>
                <input
                  type="text"
                  ref={accountNumberRef}
                  onChange={(event) =>
                    setAccountNumberInput(event.target.value)
                  }
                  placeholder="Enter your account number"
                  className="w-full rounded-lg border border-blue-900/20 bg-white px-2.5 py-1.5 text-[11px] text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-900/20"
                  required
                />
                <p className="text-[10px] text-slate-500">
                  Add your account number then click Continue to send request.
                </p>
              </div>
              {selectedPackage && (
                <div className="grid grid-cols-1 gap-2 text-[11px] text-slate-600 sm:grid-cols-3">
                  <div className="rounded-lg border border-blue-900/10 bg-white px-2.5 py-2">
                    <p className="text-[10px] uppercase tracking-[0.18em] text-blue-900/60">
                      Package
                    </p>
                    <p className="font-semibold text-blue-950">
                      {selectedPackage.name}
                    </p>
                  </div>
                  <div className="rounded-lg border border-blue-900/10 bg-white px-2.5 py-2">
                    <p className="text-[10px] uppercase tracking-[0.18em] text-blue-900/60">
                      Points
                    </p>
                    <p className="font-semibold text-blue-950">
                      {selectedPackage.points}
                    </p>
                  </div>
                  <div className="rounded-lg border border-blue-900/10 bg-white px-2.5 py-2">
                    <p className="text-[10px] uppercase tracking-[0.18em] text-blue-900/60">
                      Price
                    </p>
                    <p className="font-semibold text-blue-950">
                      {formatMoney(selectedPackage.price)}
                    </p>
                  </div>
                </div>
              )}
            </div>
            <div className="px-4 py-3 border-t border-blue-900/10 flex items-center justify-end gap-2">
              <button
                onClick={() => {
                  setIsBankModalOpen(false);
                  setSelectedPackage(null);
                  setAccountNumberInput("");
                  if (accountNumberRef.current) {
                    accountNumberRef.current.value = "";
                  }
                }}
                className="rounded-md border border-blue-900/20 bg-white px-3 py-1.5 text-[11px] font-semibold text-blue-900 hover:bg-blue-50"
              >
                Cancel
              </button>
              <button
                onClick={handleCreateRequest}
                className="rounded-md bg-blue-900 px-3 py-1.5 text-[11px] font-semibold text-white shadow-sm hover:bg-blue-800"
              >
                Continue
              </button>
            </div>
          </div>
        </div>
      )}

      {isAdminRequestsOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="w-full max-w-5xl rounded-2xl bg-white shadow-xl border border-blue-900/20 max-h-[85vh] overflow-hidden flex flex-col">
            <div className="px-4 py-3 border-b border-blue-900/10 flex items-center justify-between bg-white sticky top-0 z-10">
              <div>
                <h3 className="text-[15px] font-semibold text-blue-950">
                  Requests
                </h3>
                <p className="text-[11px] text-slate-600">
                  Approve or reject package requests.
                </p>
              </div>
              <button
                onClick={() => setIsAdminRequestsOpen(false)}
                className="inline-flex items-center gap-1 rounded-md border border-blue-900/20 bg-white px-2.5 py-1 text-[11px] font-semibold text-blue-900 hover:bg-blue-50"
              >
                <X className="h-4 w-4" />
                Close
              </button>
            </div>
            <div className="p-4 overflow-y-auto">
              <div className="overflow-x-auto rounded-xl border border-blue-900/10 bg-white">
                <table className="min-w-full">
                  <thead>
                    <tr className="bg-gradient-to-r from-blue-900 via-slate-900 to-blue-900 text-white">
                      <th className="px-3 py-2 text-left text-[11px] font-semibold">
                        User
                      </th>
                      <th className="px-3 py-2 text-left text-[11px] font-semibold">
                        Taqeem Username
                      </th>
                      <th className="px-3 py-2 text-left text-[11px] font-semibold">
                        Package
                      </th>
                      <th className="px-3 py-2 text-left text-[11px] font-semibold">
                        Price
                      </th>
                      <th className="px-3 py-2 text-left text-[11px] font-semibold">
                        Points
                      </th>
                      <th className="px-3 py-2 text-left text-[11px] font-semibold">
                        Account Number
                      </th>
                      <th className="px-3 py-2 text-left text-[11px] font-semibold">
                        Transfer Image
                      </th>
                      <th className="px-3 py-2 text-left text-[11px] font-semibold">
                        Status
                      </th>
                      <th className="px-3 py-2 text-left text-[11px] font-semibold">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-blue-900/10">
                    {requests.length === 0 ? (
                      <tr>
                        <td
                          colSpan="9"
                          className="px-3 py-2 text-[11px] text-slate-500"
                        >
                          No requests yet.
                        </td>
                      </tr>
                    ) : (
                      requests
                        .slice(
                          (adminRequestsPage - 1) * REQUESTS_PAGE_SIZE,
                          adminRequestsPage * REQUESTS_PAGE_SIZE,
                        )
                        .map((request) => {
                          const status = request.status || "pending";
                          const statusStyle =
                            statusStyles[status] || statusStyles.pending;
                          const imageUrl = request.transferImagePath
                            ? `${API_BASE_URL}${request.transferImagePath}`
                            : null;
                          const canApprove =
                            status === "pending" &&
                            Boolean(request.transferImagePath);
                          const isProcessing =
                            processingRequestId === request._id;
                          const isHighlighted =
                            highlightRequestId === request._id;
                          return (
                            <React.Fragment key={request._id}>
                              <tr
                                className={`${isHighlighted ? "bg-amber-100/60 ring-1 ring-amber-300/70" : "hover:bg-blue-50/50"} transition`}
                              >
                                <td className="px-3 py-2 text-[11px] font-semibold text-blue-950">
                                  {request.userId?.phone || "Unknown"}
                                </td>
                                <td className="px-3 py-2 text-[11px] text-slate-600">
                                  {request.userId?.taqeem?.username || "-"}
                                </td>
                                <td className="px-3 py-2 text-[11px] text-slate-600">
                                  {resolvePackageName(request)}
                                </td>
                                <td className="px-3 py-2 text-[11px] text-slate-600">
                                  {formatMoney(resolvePackagePrice(request))}
                                </td>
                                <td className="px-3 py-2 text-[11px] text-slate-600">
                                  {resolvePackagePoints(request)}
                                </td>
                                <td className="px-3 py-2 text-[11px] text-slate-600">
                                  {resolveAccountNumber(request)}
                                </td>
                                <td className="px-3 py-2 text-[11px] text-slate-600">
                                  {imageUrl ? (
                                    <a
                                      href={imageUrl}
                                      target="_blank"
                                      rel="noreferrer"
                                    >
                                      <img
                                        src={imageUrl}
                                        alt="Transfer"
                                        className="h-10 w-14 rounded-md object-cover border border-blue-900/10"
                                      />
                                    </a>
                                  ) : (
                                    <span className="text-[10px] text-slate-500">
                                      No image
                                    </span>
                                  )}
                                </td>
                                <td className="px-3 py-2 text-[11px] text-slate-600">
                                  <span
                                    className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold ${statusStyle}`}
                                  >
                                    {status.charAt(0).toUpperCase() +
                                      status.slice(1)}
                                  </span>
                                </td>
                                <td className="px-3 py-2 text-[11px] text-slate-600">
                                  <div className="flex flex-wrap gap-2">
                                    <button
                                      onClick={() =>
                                        handleUpdateRequestStatus(
                                          request._id,
                                          "confirmed",
                                        )
                                      }
                                      disabled={!canApprove || isProcessing}
                                      className="rounded-md bg-emerald-600 px-2.5 py-1.5 text-[10px] font-semibold text-white shadow-sm hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
                                    >
                                      Approve
                                    </button>
                                    <button
                                      onClick={() =>
                                        handleUpdateRequestStatus(
                                          request._id,
                                          "rejected",
                                        )
                                      }
                                      disabled={
                                        status !== "pending" || isProcessing
                                      }
                                      className="rounded-md border border-rose-200 bg-rose-50 px-2.5 py-1.5 text-[10px] font-semibold text-rose-700 hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-50"
                                    >
                                      Reject
                                    </button>
                                    <button
                                      onClick={() =>
                                        toggleRequestChat(request._id)
                                      }
                                      className={`inline-flex items-center gap-1 rounded-md border px-2.5 py-1.5 text-[10px] font-semibold ${
                                        activeChatRequestId === request._id
                                          ? "border-blue-900 bg-blue-900 text-white"
                                          : "border-blue-900/20 bg-white text-blue-900 hover:bg-blue-50"
                                      }`}
                                    >
                                      <MessageCircle className="h-3.5 w-3.5" />
                                      {activeChatRequestId === request._id
                                        ? "Close chat"
                                        : "Chat"}
                                    </button>
                                  </div>
                                  {!request.transferImagePath &&
                                    ["new", "pending"].includes(status) && (
                                      <p className="mt-1 text-[10px] text-amber-600">
                                        Transfer image required.
                                      </p>
                                    )}
                                </td>
                              </tr>
                              {renderRequestChatRow(request, 9)}
                            </React.Fragment>
                          );
                        })
                    )}
                  </tbody>
                </table>
              </div>
              {requests.length > REQUESTS_PAGE_SIZE && (
                <div className="mt-3 flex items-center justify-between text-[10px] text-slate-600">
                  <span>
                    Page {adminRequestsPage} of {getPageCount(requests)}
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() =>
                        setAdminRequestsPage((prev) => Math.max(1, prev - 1))
                      }
                      disabled={adminRequestsPage === 1}
                      className="rounded-md border border-blue-900/20 bg-white px-2.5 py-1 text-[10px] font-semibold text-blue-900 hover:bg-blue-50 disabled:opacity-50"
                    >
                      Previous
                    </button>
                    <button
                      onClick={() =>
                        setAdminRequestsPage((prev) =>
                          Math.min(getPageCount(requests), prev + 1),
                        )
                      }
                      disabled={adminRequestsPage >= getPageCount(requests)}
                      className="rounded-md border border-blue-900/20 bg-white px-2.5 py-1 text-[10px] font-semibold text-blue-900 hover:bg-blue-50 disabled:opacity-50"
                    >
                      Next
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
      {historyModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 px-4 py-6">
          <div
            className="absolute inset-0 cursor-default"
            onClick={() => {
              setHistoryModalOpen(false);
              setHistoryHighlightId(null);
            }}
          />
          <div className="relative w-full max-w-5xl rounded-[28px] bg-white shadow-[0_25px_80px_rgba(15,23,42,0.35)] border border-slate-100">
            <div className="relative rounded-[28px] bg-white text-slate-900">
              <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-6 py-4">
                <div>
                  <p className="text-[10px] uppercase tracking-[0.3em] text-slate-500">
                    Deduction
                  </p>
                  <h3 className="text-lg font-semibold text-slate-900">
                    Deduction history
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setHistoryModalOpen(false);
                    setHistoryHighlightId(null);
                  }}
                  className="rounded-full border border-slate-300 bg-white px-3 py-1 text-[10px] font-semibold text-slate-700 transition hover:border-slate-400"
                >
                  Close
                </button>
              </div>
              <div className="px-6 py-5 bg-slate-50">
                {historyLoading ? (
                  <div className="flex items-center justify-center py-20 text-[12px] text-slate-400">
                    Loading deduction history...
                  </div>
                ) : !deductionHistory.length ? (
                  <div className="flex items-center justify-center py-20 text-[12px] text-slate-400">
                    No deduction history recorded yet.
                  </div>
                ) : (
                  <div className="max-h-[420px] overflow-y-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
                    <table className="min-w-full text-[11px] text-slate-700">
                      <thead className="sticky top-0 bg-white text-left text-[10px] uppercase tracking-[0.3em] text-slate-500">
                        <tr>
                          <th className="px-3 py-3">Time</th>
                          <th className="px-3 py-3">Page</th>
                          <th className="px-3 py-3">Reports</th>
                          <th className="px-3 py-3">Client</th>
                          <th className="px-3 py-3">Submitted</th>
                          <th className="px-3 py-3">Completed</th>
                          <th className="px-3 py-3">Assets</th>
                          <th className="px-3 py-3 text-right">Amount</th>
                        </tr>
                      </thead>
                      <tbody>
                        {deductionHistory.map((record) => {
                          const isHighlighted =
                            historyHighlightId === record._id;
                          const pageLabel =
                            record.pageName ||
                            record.pageSource ||
                            record.source ||
                            "Packages";
                          const clientList = Array.isArray(
                            record.reportSummaries,
                          )
                            ? record.reportSummaries
                                .map((summary) => summary.clientName)
                                .filter(Boolean)
                                .join(", ")
                            : "—";
                          const summaryReportIds = Array.isArray(
                            record.reportSummaries,
                          )
                            ? Array.from(
                                new Set(
                                  record.reportSummaries
                                    .map((summary) => summary.reportId)
                                    .filter(Boolean),
                                ),
                              )
                            : [];
                          const reportsCellValue = summaryReportIds.length
                            ? summaryReportIds.join(", ")
                            : record.reportIds?.length
                              ? record.reportIds.join(", ")
                              : "—";
                          return (
                            <tr
                              key={record._id}
                              className={`border-b border-slate-100 transition ${
                                isHighlighted
                                  ? "bg-slate-50"
                                  : "hover:bg-slate-50"
                              }`}
                            >
                              <td className="px-3 py-3 text-[12px] text-slate-600">
                                {formatDateTime(record.createdAt)}
                              </td>
                              <td className="px-3 py-3 font-semibold text-slate-900">
                                {pageLabel}
                              </td>
                              <td className="px-3 py-3 text-[11px] text-slate-700">
                                {reportsCellValue}
                              </td>
                              <td className="px-3 py-3 text-[11px] text-slate-700">
                                {clientList}
                              </td>
                              <td className="px-3 py-3 text-[11px] text-slate-700">
                                {formatDateTime(
                                  record.reportSummaries?.[0]?.submittedAt,
                                ) || "—"}
                              </td>
                              <td className="px-3 py-3 text-[11px] text-slate-700">
                                {formatDateTime(
                                  record.reportSummaries?.[0]?.endSubmitTime,
                                ) || "—"}
                              </td>
                              <td className="px-3 py-3">
                                <span className="text-[11px] text-slate-700">
                                  {record.assetCount ?? "—"}
                                </span>
                              </td>
                              <td className="px-3 py-3 text-right font-semibold text-slate-900">
                                {record.amount ?? "—"}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
              <div className="flex items-center justify-between border-t border-slate-200 px-6 py-3 text-[10px] text-slate-500">
                <span>
                  Page {historyPagination.page} of{" "}
                  {historyPagination.totalPages || 1}
                </span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      fetchDeductionHistory(
                        Math.max(1, historyPagination.page - 1),
                      )
                    }
                    disabled={historyPagination.page <= 1}
                    className="rounded-full border border-slate-200 px-3 py-1 text-[10px] font-semibold text-slate-500 hover:border-slate-300 disabled:opacity-40"
                  >
                    Previous
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      fetchDeductionHistory(
                        Math.min(
                          historyPagination.totalPages || 1,
                          historyPagination.page + 1,
                        ),
                      )
                    }
                    disabled={
                      historyPagination.page >=
                      (historyPagination.totalPages || 1)
                    }
                    className="rounded-full border border-slate-200 px-3 py-1 text-[10px] font-semibold text-slate-500 hover:border-slate-300 disabled:opacity-40"
                  >
                    Next
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Packages;
