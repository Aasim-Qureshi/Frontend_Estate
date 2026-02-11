import React, { useEffect, useMemo, useState } from "react";
import {
  Database,
  Filter,
  Search,
  RefreshCcw,
  Eye,
  EyeOff,
  ChevronLeft,
  ChevronRight,
  MapPin,
  Phone,
  ExternalLink,
  Loader2,
  X,
  Tag,
  MessageCircle,
  CornerDownRight,
} from "lucide-react";

const COMMENTS_PAGE_LIMIT = 50;
const PRIVATE_COMMENT_MARKER = ":: \u0631\u062f \u062e\u0627\u0635. \u064a\u0638\u0647\u0631 \u0644\u0644\u0639\u0627\u0631\u0636 \u0641\u0642\u0637 ::";

const joinPath = (segments = []) =>
  segments.map((s) => String(s || "").trim()).filter(Boolean).join("/");

const safeArr = (v) => (Array.isArray(v) ? v : []);

const normalizeText = (value) =>
  String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();

const isPrivateComment = (value) =>
  normalizeText(value) === normalizeText(PRIVATE_COMMENT_MARKER);

const extractCommentText = (comment) =>
  comment?.text ?? comment?.body ?? comment?.comment ?? "";

const filterVisibleComments = (comments) =>
  safeArr(comments).filter((comment) => !isPrivateComment(extractCommentText(comment)));

const getVisibleCommentsCount = (ad) => {
  const comments = safeArr(ad?.comments);
  if (comments.length > 0) return filterVisibleComments(comments).length;
  const count = ad?.visibleCommentsCount ?? ad?.commentsCount ?? 0;
  return Number.isFinite(Number(count)) ? Number(count) : 0;
};

const HarajDataUpdated = () => {
  const [ads, setAds] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [showData, setShowData] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [limit] = useState(20);
  const [showFilters, setShowFilters] = useState(true);

  // ✅ breadcrumb drilldown state
  const [crumbSegments, setCrumbSegments] = useState([]); // ["حراج السيارات", "تويوتا", ...]
  const [crumbOptions, setCrumbOptions] = useState([]); // next options [{value,count}]
  const [crumbLoading, setCrumbLoading] = useState(false);
  const [crumbError, setCrumbError] = useState("");

  // Filters aligned with /api/haraj-ads (removed author)
  const [filters, setFilters] = useState({
    q: "",
    city: "",
    status: "",
    hasPhone: "",
    priceText: "",
    priceValue: "",
    minComments: "",
    maxComments: "",
    fromId: "",
    toId: "",
    sort: "newest",
  });

  const [commentsModal, setCommentsModal] = useState({
    isOpen: false,
    adId: null,
    title: "",
    comments: [],
    loading: false,
    error: "",
    page: 1,
    pages: 1,
    total: 0,
  });
  const [detailsModal, setDetailsModal] = useState({ isOpen: false, ad: null });

  // --------- API helpers ----------
  const fetchBreadcrumbOptions = async (segments, status) => {
    if (!window?.electronAPI) return;
    setCrumbLoading(true);
    setCrumbError("");
    try {
      const path = joinPath(segments);
      const qs = new URLSearchParams();
      if (path) qs.append("path", path);
      if (status) qs.append("status", status);
      qs.append("limit", "200");

      const resp = await window.electronAPI.apiRequest(
        "GET",
        `/api/haraj-ads/filters/options?${qs.toString()}`
      );

      const options = resp?.options || [];
      setCrumbOptions(options);
    } catch (e) {
      setCrumbOptions([]);
      setCrumbError(e?.response?.data?.message || e?.message || "Failed to load breadcrumb options");
    } finally {
      setCrumbLoading(false);
    }
  };

  // Load ads list (✅ includes path)
  const loadAds = async (page = 1) => {
    if (!showData || !window?.electronAPI) return;

    setLoading(true);
    setError("");
    try {
      const queryParams = new URLSearchParams({
        page: page.toString(),
        limit: limit.toString(),
        sort: filters.sort || "newest",
      });

      if (filters.q) queryParams.append("q", filters.q);
      if (filters.city) queryParams.append("city", filters.city);
      if (filters.status) queryParams.append("status", filters.status);
      if (filters.priceText) queryParams.append("priceText", filters.priceText);
      if (filters.priceValue) queryParams.append("priceValue", filters.priceValue);
      if (filters.fromId) queryParams.append("fromId", filters.fromId);
      if (filters.toId) queryParams.append("toId", filters.toId);
      if (filters.minComments) queryParams.append("minComments", filters.minComments);
      if (filters.maxComments) queryParams.append("maxComments", filters.maxComments);
      if (filters.hasPhone === "yes") queryParams.append("hasPhone", "true");
      if (filters.hasPhone === "no") queryParams.append("hasPhone", "false");

      // ✅ breadcrumb path filter
      const path = joinPath(crumbSegments);
      if (path) queryParams.append("path", path);

      const response = await window.electronAPI.apiRequest(
        "GET",
        `/api/haraj-ads?${queryParams.toString()}`
      );

      if (response) {
        setAds(response.items || []);
        setTotalPages(response.pages || 1);
        setTotal(response.total || 0);
        setCurrentPage(response.page || 1);
      }
    } catch (err) {
      const msg = err?.response?.data?.message || err?.message || "Failed to load Haraj ads";
      setError(msg);
      setAds([]);
    } finally {
      setLoading(false);
    }
  };

  // load list when needed
  useEffect(() => {
    if (showData) loadAds(currentPage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showData, currentPage, filters, crumbSegments]);

  // load breadcrumb options when breadcrumb path or status changes
  useEffect(() => {
    if (!showData) return;
    fetchBreadcrumbOptions(crumbSegments, filters.status || "ACTIVE");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showData, crumbSegments, filters.status]);

  // --------- Modals ----------
  const openCommentsModal = async (ad, page = 1) => {
    if (!ad?.adId || !window?.electronAPI) return;
    setCommentsModal((prev) => ({
      ...prev,
      isOpen: true,
      adId: ad.adId,
      title: ad.title || `Ad ${ad.adId}`,
      loading: true,
      error: "",
      comments: [],
      page,
      pages: 1,
      total: 0,
    }));
    try {
      const response = await window.electronAPI.apiRequest(
        "GET",
        `/api/haraj-ads/${ad.adId}/comments?page=${page}&limit=${COMMENTS_PAGE_LIMIT}`
      );
      setCommentsModal((prev) => ({
        ...prev,
        comments: filterVisibleComments(response?.items || []),
        page: response?.page || page,
        pages: response?.pages || 1,
        total: response?.total || 0,
        loading: false,
      }));
    } catch (err) {
      setCommentsModal((prev) => ({
        ...prev,
        loading: false,
        error: err?.response?.data?.message || err?.message || "Failed to load comments",
      }));
    }
  };

  const closeCommentsModal = () => {
    setCommentsModal({
      isOpen: false,
      adId: null,
      title: "",
      comments: [],
      loading: false,
      error: "",
      page: 1,
      pages: 1,
      total: 0,
    });
  };

  const openDetailsModal = (ad) => setDetailsModal({ isOpen: true, ad });
  const closeDetailsModal = () => setDetailsModal({ isOpen: false, ad: null });

  // --------- Filters ----------
  const handleFilterChange = (key, value) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
    setCurrentPage(1);
  };

  const handleShowData = () => {
    setShowData(true);
    setCurrentPage(1);
  };

  const handleHideData = () => {
    setShowData(false);
    setAds([]);
  };

  const clearFilters = () => {
    setFilters({
      q: "",
      city: "",
      status: "",
      hasPhone: "",
      priceText: "",
      priceValue: "",
      minComments: "",
      maxComments: "",
      fromId: "",
      toId: "",
      sort: "newest",
    });
    setCrumbSegments([]);
    setCurrentPage(1);
  };

  // --------- Breadcrumb actions ----------
  const selectCrumbOption = (value) => {
    // add next segment
    setCrumbSegments((prev) => [...prev, value]);
    setCurrentPage(1);
  };

  const goToCrumbIndex = (idx) => {
    // keep up to idx
    setCrumbSegments((prev) => prev.slice(0, idx + 1));
    setCurrentPage(1);
  };

  const crumbBack = () => {
    setCrumbSegments((prev) => prev.slice(0, -1));
    setCurrentPage(1);
  };

  const crumbReset = () => {
    setCrumbSegments([]);
    setCurrentPage(1);
  };

  // --------- Formatters ----------
  const formatDate = (dateString) => {
    if (!dateString) return "N/A";
    try {
      return new Date(dateString).toLocaleDateString("en-US", {
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      return dateString;
    }
  };

  const formatPrice = (ad) => {
    if (ad?.priceValue != null && ad.priceValue !== "") {
      const formatted = new Intl.NumberFormat("en-US").format(ad.priceValue);
      return formatted;
    }
    if (ad?.priceText) return ad.priceText;
    return "N/A";
  };

  const hasAds = useMemo(() => ads && ads.length > 0, [ads]);

  // Render breadcrumbs from an ad
  const renderAdBreadcrumbs = (ad) => {
    const names = safeArr(ad?.breadcrumbNames);
    if (!names.length) return <span className="text-[11px] text-slate-400">N/A</span>;

    return (
      <div className="flex flex-wrap gap-1">
        {names.slice(0, 6).map((seg, idx) => (
          <button
            key={`${seg}-${idx}`}
            type="button"
            onClick={() => {
              // click uses that segment as filter path
              const next = names.slice(0, idx + 1);
              setCrumbSegments(next);
              setCurrentPage(1);
            }}
            className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-[10px] font-semibold text-slate-700 hover:bg-emerald-50"
            title={names.slice(0, idx + 1).join(" / ")}
          >
            <CornerDownRight className="w-3 h-3 text-slate-400" />
            {seg}
          </button>
        ))}
        {names.length > 6 && (
          <span className="text-[10px] text-slate-400 px-1">+{names.length - 6}</span>
        )}
      </div>
    );
  };

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-emerald-900/15 bg-gradient-to-r from-white via-emerald-50 to-white px-4 py-3 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 text-white flex items-center justify-center shadow-lg">
            <Database className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-emerald-950">Haraj Data Updated</h1>
            <p className="text-[11px] text-slate-600">Haraj ads with backend filters + breadcrumb drilldown</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {showData && (
            <button
              type="button"
              onClick={loadAds.bind(null, currentPage)}
              disabled={loading}
              className="inline-flex items-center gap-2 rounded-lg border border-emerald-900/20 bg-white px-3 py-2 text-[11px] font-semibold text-emerald-900 hover:bg-emerald-50 disabled:opacity-50"
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCcw className="w-4 h-4" />}
              Refresh
            </button>
          )}
          <button
            type="button"
            onClick={showData ? handleHideData : handleShowData}
            className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-[11px] font-semibold shadow-sm transition-all ${
              showData
                ? "border border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                : "bg-gradient-to-r from-emerald-500 to-teal-600 text-white hover:from-emerald-600 hover:to-teal-700"
            }`}
          >
            {showData ? (
              <>
                <EyeOff className="w-4 h-4" />
                Hide Data
              </>
            ) : (
              <>
                <Eye className="w-4 h-4" />
                Show Data
              </>
            )}
          </button>
        </div>
      </div>

      {/* Filters */}
      {showData && (
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between gap-2 mb-4">
            <div className="flex items-center gap-2">
              <Filter className="w-4 h-4 text-slate-500" />
              <h2 className="text-[13px] font-semibold text-slate-900">Filters</h2>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setShowFilters((prev) => !prev)}
                className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-[10px] font-semibold text-slate-700 hover:bg-slate-50"
              >
                {showFilters ? "Hide Filters" : "Show Filters"}
              </button>
              <button
                type="button"
                onClick={clearFilters}
                className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-[10px] font-semibold text-slate-700 hover:bg-slate-50"
              >
                Clear
              </button>
            </div>
          </div>

          {/* Breadcrumb drilldown */}
          <div className="mb-4 rounded-xl border border-slate-200 bg-slate-50 p-3">
            <div className="flex items-center justify-between gap-3">
              <div className="text-[11px] font-semibold text-slate-700">QUICK FILTERS</div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={crumbBack}
                  disabled={!crumbSegments.length}
                  className="px-2 py-1 rounded-md border border-slate-200 bg-white text-[10px] font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                >
                  Back
                </button>
                <button
                  type="button"
                  onClick={crumbReset}
                  disabled={!crumbSegments.length}
                  className="px-2 py-1 rounded-md border border-slate-200 bg-white text-[10px] font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                >
                  Reset
                </button>
              </div>
            </div>

            {/* current path */}
            <div className="mt-2 flex flex-wrap gap-1">
              {!crumbSegments.length ? (
                <span className="text-[10px] text-slate-500">No path selected</span>
              ) : (
                crumbSegments.map((seg, idx) => (
                  <button
                    key={`${seg}-${idx}`}
                    type="button"
                    onClick={() => goToCrumbIndex(idx)}
                    className="inline-flex items-center rounded-md border border-emerald-200 bg-white px-2 py-1 text-[10px] font-semibold text-emerald-800 hover:bg-emerald-50"
                    title={crumbSegments.slice(0, idx + 1).join(" / ")}
                  >
                    {seg}
                  </button>
                ))
              )}
            </div>

            {/* next options */}
            <div className="mt-3">
              <div className="text-[10px] font-semibold text-slate-600 mb-2">Next options</div>

              {crumbLoading ? (
                <div className="flex items-center gap-2 text-[10px] text-slate-500">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Loading options...
                </div>
              ) : crumbError ? (
                <div className="text-[10px] text-rose-700">{crumbError}</div>
              ) : crumbOptions.length === 0 ? (
                <div className="text-[10px] text-slate-500">No further options.</div>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {crumbOptions.slice(0, 60).map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => selectCrumbOption(opt.value)}
                      className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-[10px] font-semibold text-slate-700 hover:bg-emerald-50"
                      title={`${opt.value} (${opt.count})`}
                    >
                      {opt.value}
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[9px] text-slate-600">
                        {opt.count}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {showFilters && (
            <div className="flex items-end gap-2 overflow-x-auto">
              <div className="flex-shrink-0 w-[200px]">
                <label className="block text-[9px] font-semibold text-slate-600 mb-1 uppercase tracking-wide">
                  Search
                </label>
                <div className="relative">
                  <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
                  <input
                    type="text"
                    value={filters.q}
                    onChange={(e) => handleFilterChange("q", e.target.value)}
                    placeholder="Search text..."
                    className="w-full pl-8 pr-2 py-1.5 text-[10px] border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
                  />
                </div>
              </div>

              <div className="flex-shrink-0 w-[120px]">
                <label className="block text-[9px] font-semibold text-slate-600 mb-1 uppercase tracking-wide">
                  City
                </label>
                <input
                  type="text"
                  value={filters.city}
                  onChange={(e) => handleFilterChange("city", e.target.value)}
                  placeholder="City"
                  className="w-full px-2 py-1.5 text-[10px] border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
                />
              </div>

              <div className="flex-shrink-0 w-[120px]">
                <label className="block text-[9px] font-semibold text-slate-600 mb-1 uppercase tracking-wide">
                  Status
                </label>
                <select
                  value={filters.status}
                  onChange={(e) => handleFilterChange("status", e.target.value)}
                  className="w-full px-2 py-1.5 text-[10px] border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
                >
                  <option value="">All</option>
                  <option value="ACTIVE">Active</option>
                  <option value="REMOVED">Removed</option>
                </select>
              </div>

              <div className="flex-shrink-0 w-[120px]">
                <label className="block text-[9px] font-semibold text-slate-600 mb-1 uppercase tracking-wide">
                  Phone
                </label>
                <select
                  value={filters.hasPhone}
                  onChange={(e) => handleFilterChange("hasPhone", e.target.value)}
                  className="w-full px-2 py-1.5 text-[10px] border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
                >
                  <option value="">All</option>
                  <option value="yes">Has Phone</option>
                  <option value="no">No Phone</option>
                </select>
              </div>

              <div className="flex-shrink-0 w-[130px]">
                <label className="block text-[9px] font-semibold text-slate-600 mb-1 uppercase tracking-wide">
                  Price Text
                </label>
                <input
                  type="text"
                  value={filters.priceText}
                  onChange={(e) => handleFilterChange("priceText", e.target.value)}
                  placeholder="Negotiable..."
                  className="w-full px-2 py-1.5 text-[10px] border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
                />
              </div>

              <div className="flex-shrink-0 w-[110px]">
                <label className="block text-[9px] font-semibold text-slate-600 mb-1 uppercase tracking-wide">
                  Price Value
                </label>
                <input
                  type="text"
                  value={filters.priceValue}
                  onChange={(e) => handleFilterChange("priceValue", e.target.value)}
                  placeholder="15000"
                  className="w-full px-2 py-1.5 text-[10px] border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
                />
              </div>

              <div className="flex-shrink-0 w-[100px]">
                <label className="block text-[9px] font-semibold text-slate-600 mb-1 uppercase tracking-wide">
                  Min Comments
                </label>
                <input
                  type="number"
                  value={filters.minComments}
                  onChange={(e) => handleFilterChange("minComments", e.target.value)}
                  placeholder="0"
                  className="w-full px-2 py-1.5 text-[10px] border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
                />
              </div>

              <div className="flex-shrink-0 w-[110px]">
                <label className="block text-[9px] font-semibold text-slate-600 mb-1 uppercase tracking-wide">
                  Max Comments
                </label>
                <input
                  type="number"
                  value={filters.maxComments}
                  onChange={(e) => handleFilterChange("maxComments", e.target.value)}
                  placeholder="100"
                  className="w-full px-2 py-1.5 text-[10px] border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
                />
              </div>

              <div className="flex-shrink-0 w-[100px]">
                <label className="block text-[9px] font-semibold text-slate-600 mb-1 uppercase tracking-wide">
                  From Ad ID
                </label>
                <input
                  type="number"
                  value={filters.fromId}
                  onChange={(e) => handleFilterChange("fromId", e.target.value)}
                  placeholder="1000"
                  className="w-full px-2 py-1.5 text-[10px] border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
                />
              </div>

              <div className="flex-shrink-0 w-[90px]">
                <label className="block text-[9px] font-semibold text-slate-600 mb-1 uppercase tracking-wide">
                  To Ad ID
                </label>
                <input
                  type="number"
                  value={filters.toId}
                  onChange={(e) => handleFilterChange("toId", e.target.value)}
                  placeholder="9999"
                  className="w-full px-2 py-1.5 text-[10px] border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
                />
              </div>

              <div className="flex-shrink-0 w-[150px]">
                <label className="block text-[9px] font-semibold text-slate-600 mb-1 uppercase tracking-wide">
                  Sort
                </label>
                <select
                  value={filters.sort}
                  onChange={(e) => handleFilterChange("sort", e.target.value)}
                  className="w-full px-2 py-1.5 text-[10px] border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
                >
                  <option value="newest">Newest</option>
                  <option value="oldest">Oldest</option>
                  <option value="adIdAsc">Ad ID Asc</option>
                  <option value="adIdDesc">Ad ID Desc</option>
                  <option value="commentsDesc">Comments Desc</option>
                </select>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Error Message */}
      {error && <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-[11px] text-rose-700">{error}</div>}

      {/* Data Table */}
      {showData && (
        <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
          <div className="px-4 py-3 bg-gradient-to-r from-slate-50 to-slate-100 border-b border-slate-200 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="text-[11px] font-semibold text-slate-700">
                Total Records: <span className="text-emerald-600">{total.toLocaleString()}</span>
              </span>
              <span className="text-[10px] text-slate-500">
                Showing {((currentPage - 1) * limit) + 1} - {Math.min(currentPage * limit, total)} of {total}
              </span>
              {crumbSegments.length > 0 && (
                <span className="text-[10px] text-slate-500">
                  Path: <span className="font-semibold text-slate-700">{joinPath(crumbSegments)}</span>
                </span>
              )}
            </div>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="w-8 h-8 animate-spin text-emerald-500" />
            </div>
          ) : !hasAds ? (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <Database className="w-12 h-12 text-slate-300 mb-3" />
              <p className="text-[13px] font-semibold text-slate-600">No data found</p>
              <p className="text-[11px] text-slate-500 mt-1">Try adjusting your filters / breadcrumbs</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr>
                    <th className="px-4 py-3 text-left text-[10px] font-semibold text-slate-700 uppercase tracking-wider">Title</th>
                    <th className="px-4 py-3 text-left text-[10px] font-semibold text-slate-700 uppercase tracking-wider">City</th>
                    {/* <th className="px-4 py-3 text-left text-[10px] font-semibold text-slate-700 uppercase tracking-wider">Breadcrumbs</th> */}
                    <th className="px-4 py-3 text-left text-[10px] font-semibold text-slate-700 uppercase tracking-wider">Price</th>
                    {/* <th className="px-4 py-3 text-left text-[10px] font-semibold text-slate-700 uppercase tracking-wider">Status</th> */}
                    <th className="px-4 py-3 text-left text-[10px] font-semibold text-slate-700 uppercase tracking-wider">Phone</th>
                    <th className="px-4 py-3 text-left text-[10px] font-semibold text-slate-700 uppercase tracking-wider">Comments</th>
                    {/* <th className="px-4 py-3 text-left text-[10px] font-semibold text-slate-700 uppercase tracking-wider">Last Seen</th> */}
                    <th className="px-4 py-3 text-left text-[10px] font-semibold text-slate-700 uppercase tracking-wider">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {ads.map((ad, index) => (
                    <tr key={ad.adId || ad._id || index} className="hover:bg-emerald-50/50 transition-colors">
                      <td className="px-4 py-3">
                        <div className="max-w-xs">
                          <p className="text-[11px] font-semibold text-slate-900 line-clamp-2">{ad.title || "N/A"}</p>
                          {ad.description && <p className="text-[10px] text-slate-500 mt-1 line-clamp-1">{ad.description}</p>}
                        </div>
                      </td>

                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5">
                          <MapPin className="w-3.5 h-3.5 text-slate-400" />
                          <span className="text-[11px] text-slate-700">{ad.city || "N/A"}</span>
                        </div>
                      </td>

                      {/* <td className="px-4 py-3">{renderAdBreadcrumbs(ad)}</td> */}

                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5">
                          <Tag className="w-3.5 h-3.5 text-emerald-600" />
                          <span className="text-[11px] font-semibold text-emerald-700">{formatPrice(ad)}</span>
                        </div>
                        {ad.priceText && ad.priceValue && <div className="text-[9px] text-slate-400">{ad.priceText}</div>}
                      </td>

                      {/* <td className="px-4 py-3">
                        <span
                          className={`inline-flex items-center rounded-full px-2 py-1 text-[9px] font-semibold ${
                            ad.status === "REMOVED"
                              ? "bg-rose-50 text-rose-700 border border-rose-200"
                              : "bg-emerald-50 text-emerald-700 border border-emerald-200"
                          }`}
                        >
                          {ad.status || "N/A"}
                        </span>
                      </td> */}

                      <td className="px-4 py-3">
                        {ad?.contact?.phone ? (
                          <div className="flex items-center gap-1.5">
                            <Phone className="w-3.5 h-3.5 text-emerald-600" />
                            <span className="text-[11px] text-emerald-700 font-semibold">{ad.contact.phone}</span>
                          </div>
                        ) : (
                          <span className="text-[11px] text-slate-400">N/A</span>
                        )}
                      </td>

                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <span className="text-[11px] text-slate-700">{getVisibleCommentsCount(ad)}</span>
                          <button
                            type="button"
                            onClick={() => openCommentsModal(ad)}
                            className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-blue-50 hover:bg-blue-100 text-blue-700 text-[10px] font-semibold transition-colors"
                          >
                            <MessageCircle className="w-3.5 h-3.5" />
                            View
                          </button>
                        </div>
                      </td>

                      {/* <td className="px-4 py-3">
                        <span className="text-[10px] text-slate-600">
                          {formatDate(ad.lastSeenAt || ad.updatedAt || ad.createdAt)}
                        </span>
                      </td> */}

                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          {ad.url && (
                            <a
                              href={ad.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-emerald-50 hover:bg-emerald-100 text-emerald-700 text-[10px] font-semibold transition-colors"
                            >
                              <ExternalLink className="w-3.5 h-3.5" />
                              View
                            </a>
                          )}
                          <button
                            type="button"
                            onClick={() => openDetailsModal(ad)}
                            className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-blue-50 hover:bg-blue-100 text-blue-700 text-[10px] font-semibold transition-colors"
                          >
                            See More
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {!loading && hasAds && totalPages > 1 && (
            <div className="px-4 py-3 bg-slate-50 border-t border-slate-200 flex items-center justify-between">
              <div className="text-[11px] text-slate-600">
                Page {currentPage} of {totalPages}
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setCurrentPage((prev) => Math.max(1, prev - 1))}
                  disabled={currentPage === 1 || loading}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-semibold border border-slate-300 rounded-lg bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <ChevronLeft className="w-4 h-4" />
                  Previous
                </button>
                <button
                  type="button"
                  onClick={() => setCurrentPage((prev) => Math.min(totalPages, prev + 1))}
                  disabled={currentPage === totalPages || loading}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-semibold border border-slate-300 rounded-lg bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Next
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {!showData && (
        <div className="flex flex-col items-center justify-center py-20 text-center rounded-2xl border border-slate-200 bg-gradient-to-br from-white to-slate-50">
          <div className="h-20 w-20 rounded-full bg-gradient-to-br from-emerald-100 to-teal-100 flex items-center justify-center mb-4">
            <Database className="w-10 h-10 text-emerald-600" />
          </div>
          <h2 className="text-lg font-bold text-slate-900 mb-2">Ready to View Haraj Data Updated</h2>
          <p className="text-[12px] text-slate-600 max-w-md mb-6">
            Click "Show Data" to load Haraj ads and filter by breadcrumb categories.
          </p>
        </div>
      )}

      {/* Details + Comments modals: keep yours as-is (not changed) */}
      {detailsModal.isOpen && detailsModal.ad && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/60 backdrop-blur-sm px-4">
          <div className="w-full max-w-3xl rounded-2xl border border-slate-200 bg-white shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200 bg-slate-50">
              <div>
                <div className="text-[12px] font-semibold text-slate-900">Haraj Ad Details</div>
                <div className="text-[10px] text-slate-500 line-clamp-1">
                  {detailsModal.ad.title || "Untitled"} {detailsModal.ad.adId ? `• #${detailsModal.ad.adId}` : ""}
                </div>
              </div>
              <button type="button" onClick={closeDetailsModal} className="rounded-full p-2 text-slate-500 hover:bg-slate-100">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="max-h-[70vh] overflow-y-auto px-5 py-4 space-y-4">
              <div className="grid grid-cols-2 gap-3 text-[11px]">
                <div>
                  <div className="text-[9px] uppercase text-slate-400 font-semibold">Ad ID</div>
                  <div className="text-slate-900">{detailsModal.ad.adId ?? "N/A"}</div>
                </div>
                <div>
                  <div className="text-[9px] uppercase text-slate-400 font-semibold">Status</div>
                  <div className="text-slate-900">{detailsModal.ad.status || "N/A"}</div>
                </div>
                <div>
                  <div className="text-[9px] uppercase text-slate-400 font-semibold">City</div>
                  <div className="text-slate-900">{detailsModal.ad.city || "N/A"}</div>
                </div>
                <div>
                  <div className="text-[9px] uppercase text-slate-400 font-semibold">Price</div>
                  <div className="text-slate-900">{formatPrice(detailsModal.ad)}</div>
                </div>
                <div>
                  <div className="text-[9px] uppercase text-slate-400 font-semibold">Phone</div>
                  <div className="text-slate-900">{detailsModal.ad?.contact?.phone || "N/A"}</div>
                </div>
                {/* <div>
                  <div className="text-[9px] uppercase text-slate-400 font-semibold">Breadcrumbs</div>
                  <div className="text-slate-900">{safeArr(detailsModal.ad?.breadcrumbNames).join(" / ") || "N/A"}</div>
                </div> */}
              </div>

              <div>
                <div className="text-[9px] uppercase text-slate-400 font-semibold">Description</div>
                <p className="mt-1 text-[11px] text-slate-700 whitespace-pre-wrap">{detailsModal.ad.description || "N/A"}</p>
              </div>
            </div>
            <div className="px-5 py-3 border-t border-slate-200 bg-slate-50 flex items-center justify-end gap-2">
              {detailsModal.ad.url && (
                <a
                  href={detailsModal.ad.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-semibold transition-colors"
                >
                  <ExternalLink className="w-4 h-4" />
                  View in Haraj
                </a>
              )}
              <button
                type="button"
                onClick={closeDetailsModal}
                className="px-3 py-2 rounded-lg bg-slate-200 hover:bg-slate-300 text-slate-700 text-[11px] font-semibold transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {commentsModal.isOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm px-4">
          <div className="w-full max-w-2xl rounded-2xl border border-slate-200 bg-white shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 bg-slate-50">
              <div>
                <div className="text-[12px] font-semibold text-slate-900">Comments</div>
                <div className="text-[10px] text-slate-500 line-clamp-1">{commentsModal.title}</div>
              </div>
              <button type="button" onClick={closeCommentsModal} className="rounded-full p-2 text-slate-500 hover:bg-slate-100">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="max-h-[60vh] overflow-y-auto px-4 py-3 space-y-3">
              {commentsModal.loading && (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="w-6 h-6 animate-spin text-emerald-500" />
                </div>
              )}
              {commentsModal.error && (
                <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[11px] text-rose-700">
                  {commentsModal.error}
                </div>
              )}
              {!commentsModal.loading && !commentsModal.error && commentsModal.comments.length === 0 && (
                <div className="text-[11px] text-slate-500">No comments found.</div>
              )}
              {!commentsModal.loading &&
                commentsModal.comments.map((comment, idx) => (
                  <div key={comment.commentId || idx} className="rounded-xl border border-slate-200 bg-white px-3 py-2">
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-[11px] font-semibold text-slate-900">{comment.user || "Unknown user"}</div>
                      <div className="text-[9px] text-slate-500">{comment.timeText || ""}</div>
                    </div>
                    <p className="mt-1 text-[11px] text-slate-700 whitespace-pre-wrap">{comment.text || ""}</p>
                  </div>
                ))}
            </div>
            {commentsModal.pages > 1 && (
              <div className="px-4 py-3 border-t border-slate-200 bg-slate-50 flex items-center justify-between">
                <div className="text-[10px] text-slate-600">
                  Page {commentsModal.page} of {commentsModal.pages}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      openCommentsModal(
                        { adId: commentsModal.adId, title: commentsModal.title },
                        Math.max(1, commentsModal.page - 1)
                      )
                    }
                    disabled={commentsModal.page === 1 || commentsModal.loading}
                    className="inline-flex items-center gap-1.5 px-3 py-1 text-[10px] font-semibold border border-slate-300 rounded-lg bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <ChevronLeft className="w-3.5 h-3.5" />
                    Prev
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      openCommentsModal(
                        { adId: commentsModal.adId, title: commentsModal.title },
                        Math.min(commentsModal.pages, commentsModal.page + 1)
                      )
                    }
                    disabled={commentsModal.page === commentsModal.pages || commentsModal.loading}
                    className="inline-flex items-center gap-1.5 px-3 py-1 text-[10px] font-semibold border border-slate-300 rounded-lg bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Next
                    <ChevronRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default HarajDataUpdated;

