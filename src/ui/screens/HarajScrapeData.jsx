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
  Tag,
  Phone,
  ExternalLink,
  Loader2,
  X,
  Calendar,
  Image as ImageIcon,
  MessageCircle,
  Layers
} from "lucide-react";

const DEFAULT_LIMIT = 20;
const TAGS_LIMIT = 120;
const PRIVATE_COMMENT_MARKER = ":: \u0631\u062f \u062e\u0627\u0635. \u064a\u0638\u0647\u0631 \u0644\u0644\u0639\u0627\u0631\u0636 \u0641\u0642\u0637 ::";

const safeArr = (value) => (Array.isArray(value) ? value : []);

const normalizeText = (value) =>
  String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();

const isPrivateComment = (value) =>
  normalizeText(value) === normalizeText(PRIVATE_COMMENT_MARKER);

const extractCommentText = (comment) =>
  comment?.body ?? comment?.text ?? comment?.comment ?? "";

const filterVisibleComments = (comments) =>
  safeArr(comments).filter((comment) => !isPrivateComment(extractCommentText(comment)));

const formatUnixSeconds = (seconds) => {
  if (!seconds && seconds !== 0) return "Not available";
  const millis = Number(seconds) * 1000;
  if (!Number.isFinite(millis)) return "Not available";
  return new Date(millis).toLocaleString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
};

const formatBool = (value) => {
  if (value === null || value === undefined) return "Not available";
  return value ? "Yes" : "No";
};

const formatPrice = (ad) => {
  const formatted = ad?.item?.price?.formattedPrice;
  if (formatted) return formatted;
  const numeric = ad?.priceNumeric ?? ad?.item?.price?.numeric;
  if (numeric !== null && numeric !== undefined && !Number.isNaN(Number(numeric))) {
    return new Intl.NumberFormat("en-US").format(Number(numeric));
  }
  return "Not available";
};

const getHarajUrl = (ad) =>
  ad?.url || ad?.item?.URL || ad?.item?.url || ad?.item?.Url || "";

const getImages = (ad) => {
  const list = ad?.item?.imagesList || ad?.item?.images || ad?.imagesList;
  return safeArr(list).filter(Boolean);
};

const getCommentsCount = (ad) =>
  safeArr(ad?.comments).length > 0
    ? filterVisibleComments(ad?.comments).length
    : ad?.visibleCommentsCount ?? ad?.commentsCount ?? 0;

const HarajScrapeData = () => {
  const [ads, setAds] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [showData, setShowData] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [limit] = useState(DEFAULT_LIMIT);
  const [showFilters, setShowFilters] = useState(true);

  const [tags, setTags] = useState([]);
  const [tagsLoading, setTagsLoading] = useState(false);
  const [tagsError, setTagsError] = useState("");

  const [filters, setFilters] = useState({
    q: "",
    city: "",
    tag: "",
    hasPrice: "",
    minPrice: "",
    maxPrice: "",
    sort: "postDate",
    order: "desc"
  });

  const [detailsModal, setDetailsModal] = useState({
    isOpen: false,
    ad: null
  });
  const [commentsModal, setCommentsModal] = useState({
    isOpen: false,
    title: "",
    comments: []
  });

  const hasAds = useMemo(() => ads && ads.length > 0, [ads]);

  const loadTags = async () => {
    if (!window?.electronAPI) return;
    setTagsLoading(true);
    setTagsError("");
    try {
      const response = await window.electronAPI.apiRequest(
        "GET",
        `/api/haraj-scrape/tags?limit=${TAGS_LIMIT}`
      );
      setTags(response?.items || []);
    } catch (err) {
      setTags([]);
      setTagsError(err?.response?.data?.message || err?.message || "Failed to load tags");
    } finally {
      setTagsLoading(false);
    }
  };

  const loadAds = async (page = 1) => {
    if (!showData || !window?.electronAPI) return;
    setLoading(true);
    setError("");
    try {
      const queryParams = new URLSearchParams({
        page: page.toString(),
        limit: limit.toString(),
        sort: filters.sort || "postDate",
        order: filters.order || "desc"
      });

      if (filters.q) queryParams.append("q", filters.q);
      if (filters.city) queryParams.append("city", filters.city);
      if (filters.tag) queryParams.append("tag", filters.tag);
      if (filters.hasPrice === "yes") queryParams.append("hasPrice", "true");
      if (filters.hasPrice === "no") queryParams.append("hasPrice", "false");
      if (filters.minPrice) queryParams.append("minPrice", filters.minPrice);
      if (filters.maxPrice) queryParams.append("maxPrice", filters.maxPrice);

      const response = await window.electronAPI.apiRequest(
        "GET",
        `/api/haraj-scrape?${queryParams.toString()}`
      );

      const items = response?.items || [];
      const totalCount = response?.total || 0;
      setAds(items);
      setTotal(totalCount);
      setCurrentPage(response?.page || page);
      setTotalPages(Math.max(1, Math.ceil(totalCount / limit)));
    } catch (err) {
      setError(err?.response?.data?.message || err?.message || "Failed to load Haraj scrape data");
      setAds([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!showData) return;
    loadAds(currentPage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showData, currentPage, filters]);

  useEffect(() => {
    loadTags();
  }, []);

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
      tag: "",
      hasPrice: "",
      minPrice: "",
      maxPrice: "",
      sort: "postDate",
      order: "desc"
    });
    setCurrentPage(1);
  };

  const openDetailsModal = (ad) => {
    setDetailsModal({ isOpen: true, ad });
  };

  const closeDetailsModal = () => {
    setDetailsModal({ isOpen: false, ad: null });
  };

  const openCommentsModal = (ad) => {
    setCommentsModal({
      isOpen: true,
      title: ad?.title || "Haraj Comments",
      comments: filterVisibleComments(ad?.comments)
    });
  };

  const closeCommentsModal = () => {
    setCommentsModal({ isOpen: false, title: "", comments: [] });
  };

  const topTags = tags.slice(0, 18);
  const visibleModalComments = filterVisibleComments(commentsModal.comments);

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-emerald-900/15 bg-gradient-to-r from-white via-emerald-50 to-white px-4 py-3 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 text-white flex items-center justify-center shadow-lg">
            <Database className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-emerald-950">Haraj Scrape Data</h1>
            <p className="text-[11px] text-slate-600">New Haraj scrape model with clean filters and details</p>
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
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm space-y-4">
          <div className="flex items-center justify-between gap-2">
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

          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
            <div className="flex items-center gap-2 text-[10px] font-semibold text-slate-700 mb-2">
              <Layers className="w-3.5 h-3.5 text-slate-400" />
              Quick Tags
            </div>
            {tagsLoading ? (
              <div className="flex items-center gap-2 text-[10px] text-slate-500">
                <Loader2 className="w-4 h-4 animate-spin" />
                Loading tags...
              </div>
            ) : tagsError ? (
              <div className="text-[10px] text-rose-700">{tagsError}</div>
            ) : topTags.length === 0 ? (
              <div className="text-[10px] text-slate-500">No tags found.</div>
            ) : (
              <div className="flex flex-wrap gap-2">
                {topTags.map((tag) => {
                  const isActive = filters.tag === tag.tag;
                  return (
                    <button
                      key={tag.tag}
                      type="button"
                      onClick={() => handleFilterChange("tag", isActive ? "" : tag.tag)}
                      className={`inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-[10px] font-semibold transition-colors ${
                        isActive
                          ? "border-emerald-400 bg-emerald-50 text-emerald-700"
                          : "border-slate-200 bg-white text-slate-700 hover:bg-emerald-50"
                      }`}
                      title={`${tag.tag} (${tag.count})`}
                    >
                      <Tag className="w-3 h-3" />
                      {tag.tag}
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[9px] text-slate-600">
                        {tag.count}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {showFilters && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              <div>
                <label className="block text-[9px] font-semibold text-slate-600 mb-1 uppercase tracking-wide">
                  Search
                </label>
                <div className="relative">
                  <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
                  <input
                    type="text"
                    value={filters.q}
                    onChange={(e) => handleFilterChange("q", e.target.value)}
                    placeholder="Search title..."
                    className="w-full pl-8 pr-2 py-1.5 text-[10px] border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
                  />
                </div>
              </div>

              <div>
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

              <div>
                <label className="block text-[9px] font-semibold text-slate-600 mb-1 uppercase tracking-wide">
                  Tag
                </label>
                <select
                  value={filters.tag}
                  onChange={(e) => handleFilterChange("tag", e.target.value)}
                  className="w-full px-2 py-1.5 text-[10px] border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
                >
                  <option value="">All</option>
                  {tags.map((tag) => (
                    <option key={tag.tag} value={tag.tag}>
                      {tag.tag} ({tag.count})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[9px] font-semibold text-slate-600 mb-1 uppercase tracking-wide">
                  Has Price
                </label>
                <select
                  value={filters.hasPrice}
                  onChange={(e) => handleFilterChange("hasPrice", e.target.value)}
                  className="w-full px-2 py-1.5 text-[10px] border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
                >
                  <option value="">All</option>
                  <option value="yes">Yes</option>
                  <option value="no">No</option>
                </select>
              </div>

              <div>
                <label className="block text-[9px] font-semibold text-slate-600 mb-1 uppercase tracking-wide">
                  Min Price
                </label>
                <input
                  type="number"
                  value={filters.minPrice}
                  onChange={(e) => handleFilterChange("minPrice", e.target.value)}
                  placeholder="0"
                  className="w-full px-2 py-1.5 text-[10px] border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
                />
              </div>

              <div>
                <label className="block text-[9px] font-semibold text-slate-600 mb-1 uppercase tracking-wide">
                  Max Price
                </label>
                <input
                  type="number"
                  value={filters.maxPrice}
                  onChange={(e) => handleFilterChange("maxPrice", e.target.value)}
                  placeholder="1000000"
                  className="w-full px-2 py-1.5 text-[10px] border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
                />
              </div>

              <div>
                <label className="block text-[9px] font-semibold text-slate-600 mb-1 uppercase tracking-wide">
                  Sort
                </label>
                <select
                  value={filters.sort}
                  onChange={(e) => handleFilterChange("sort", e.target.value)}
                  className="w-full px-2 py-1.5 text-[10px] border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
                >
                  <option value="postDate">Post Date</option>
                  <option value="firstSeenAt">First Seen</option>
                  <option value="lastSeenAt">Last Seen</option>
                  <option value="createdAt">Created</option>
                </select>
              </div>

              <div>
                <label className="block text-[9px] font-semibold text-slate-600 mb-1 uppercase tracking-wide">
                  Order
                </label>
                <select
                  value={filters.order}
                  onChange={(e) => handleFilterChange("order", e.target.value)}
                  className="w-full px-2 py-1.5 text-[10px] border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
                >
                  <option value="desc">Newest</option>
                  <option value="asc">Oldest</option>
                </select>
              </div>
            </div>
          )}
        </div>
      )}

      {error && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-[11px] text-rose-700">
          {error}
        </div>
      )}

      {showData && (
        <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
          <div className="px-4 py-3 bg-gradient-to-r from-slate-50 to-slate-100 border-b border-slate-200 flex items-center justify-between">
            <div className="flex items-center gap-3 flex-wrap">
              <span className="text-[11px] font-semibold text-slate-700">
                Total Records: <span className="text-emerald-600">{total.toLocaleString()}</span>
              </span>
              <span className="text-[10px] text-slate-500">
                Showing {Math.min((currentPage - 1) * limit + 1, total)} - {Math.min(currentPage * limit, total)} of {total}
              </span>
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
              <p className="text-[11px] text-slate-500 mt-1">Try adjusting your filters</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr>
                    <th className="px-4 py-3 text-left text-[10px] font-semibold text-slate-700 uppercase tracking-wider">Title</th>
                    <th className="px-4 py-3 text-left text-[10px] font-semibold text-slate-700 uppercase tracking-wider">City</th>
                    <th className="px-4 py-3 text-left text-[10px] font-semibold text-slate-700 uppercase tracking-wider">Price</th>
                    <th className="px-4 py-3 text-left text-[10px] font-semibold text-slate-700 uppercase tracking-wider">Phone</th>
                    <th className="px-4 py-3 text-left text-[10px] font-semibold text-slate-700 uppercase tracking-wider">Comments</th>
                    <th className="px-4 py-3 text-left text-[10px] font-semibold text-slate-700 uppercase tracking-wider">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {ads.map((ad, index) => {
                    const harajUrl = getHarajUrl(ad);
                    const priceLabel = formatPrice(ad);
                    return (
                      <tr key={ad.postId || ad._id || index} className="hover:bg-emerald-50/50 transition-colors">
                        <td className="px-4 py-3">
                          <div className="max-w-xs">
                            <p className="text-[11px] font-semibold text-slate-900 line-clamp-2">{ad.title || "Not available"}</p>
                            {ad.item?.bodyTEXT && (
                              <p className="text-[10px] text-slate-500 mt-1 line-clamp-1">{ad.item.bodyTEXT}</p>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1.5">
                            <MapPin className="w-3.5 h-3.5 text-slate-400" />
                            <span className="text-[11px] text-slate-700">{ad.city || "Not available"}</span>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1.5">
                            <Tag className="w-3.5 h-3.5 text-emerald-600" />
                            <span className="text-[11px] font-semibold text-emerald-700">{priceLabel}</span>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          {ad?.phone ? (
                            <div className="flex items-center gap-1.5">
                              <Phone className="w-3.5 h-3.5 text-emerald-600" />
                              <span className="text-[11px] text-emerald-700 font-semibold">{ad.phone}</span>
                            </div>
                          ) : (
                            <span className="text-[11px] text-slate-400">Not available</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <button
                            type="button"
                            onClick={() => openCommentsModal(ad)}
                            className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-[10px] font-semibold text-slate-700 hover:bg-emerald-50"
                          >
                            <MessageCircle className="w-3.5 h-3.5 text-slate-500" />
                            {getCommentsCount(ad)} Comments
                          </button>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            {harajUrl && (
                              <a
                                href={harajUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-emerald-50 hover:bg-emerald-100 text-emerald-700 text-[10px] font-semibold transition-colors"
                              >
                                <ExternalLink className="w-3.5 h-3.5" />
                                View in Haraj
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
                    );
                  })}
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
          <h2 className="text-lg font-bold text-slate-900 mb-2">Ready to View Haraj Scrape Data</h2>
          <p className="text-[12px] text-slate-600 max-w-md mb-6">
            Click "Show Data" to load the new Haraj scrape dataset with clean filters and a focused table.
          </p>
        </div>
      )}
      {detailsModal.isOpen && detailsModal.ad && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/60 backdrop-blur-sm px-4">
          <div className="w-full max-w-6xl rounded-2xl border border-slate-200 bg-white shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200 bg-slate-50">
              <div>
                <div className="text-[11px] font-semibold text-slate-900">Haraj Scrape Details</div>
                <div className="text-[9px] text-slate-500 line-clamp-1">
                  {detailsModal.ad.title || "Untitled"}
                </div>
              </div>
              <button type="button" onClick={closeDetailsModal} className="rounded-full p-2 text-slate-500 hover:bg-slate-100">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="max-h-[60vh] overflow-y-auto px-5 py-4 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-2 text-[10px]">
                <div className="rounded-lg border border-slate-200 bg-gradient-to-br from-white to-slate-50 p-1.5">
                  <div className="flex items-start gap-1">
                    <div className="h-4 w-4 rounded-md bg-emerald-100 flex items-center justify-center flex-shrink-0">
                      <MapPin className="w-2.5 h-2.5 text-emerald-600" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <h3 className="text-[8px] font-semibold text-slate-700 uppercase tracking-wide mb-0.5">City</h3>
                      <p className="text-[9px] text-slate-700 line-clamp-2 break-words">{detailsModal.ad.city || "Not available"}</p>
                    </div>
                  </div>
                </div>
                <div className="rounded-lg border border-slate-200 bg-gradient-to-br from-white to-slate-50 p-1.5">
                  <div className="flex items-start gap-1">
                    <div className="h-4 w-4 rounded-md bg-emerald-100 flex items-center justify-center flex-shrink-0">
                      <Tag className="w-2.5 h-2.5 text-emerald-600" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <h3 className="text-[8px] font-semibold text-slate-700 uppercase tracking-wide mb-0.5">Price</h3>
                      <p className="text-[9px] text-slate-700 line-clamp-2 break-words">
                        {formatPrice(detailsModal.ad)}
                      </p>
                    </div>
                  </div>
                </div>
                <div className="rounded-lg border border-slate-200 bg-gradient-to-br from-white to-slate-50 p-1.5">
                  <div className="flex items-start gap-1">
                    <div className="h-4 w-4 rounded-md bg-emerald-100 flex items-center justify-center flex-shrink-0">
                      <Phone className="w-2.5 h-2.5 text-emerald-600" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <h3 className="text-[8px] font-semibold text-slate-700 uppercase tracking-wide mb-0.5">Phone</h3>
                      <p className="text-[9px] text-slate-700 line-clamp-2 break-words">{detailsModal.ad.phone || "Not available"}</p>
                    </div>
                  </div>
                </div>
                <div className="rounded-lg border border-slate-200 bg-gradient-to-br from-white to-slate-50 p-1.5">
                  <div className="flex items-start gap-1">
                    <div className="h-4 w-4 rounded-md bg-emerald-100 flex items-center justify-center flex-shrink-0">
                      <MessageCircle className="w-2.5 h-2.5 text-emerald-600" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <h3 className="text-[8px] font-semibold text-slate-700 uppercase tracking-wide mb-0.5">Comments</h3>
                      <p className="text-[9px] text-slate-700 line-clamp-2 break-words">{getCommentsCount(detailsModal.ad)}</p>
                    </div>
                  </div>
                </div>
                <div className="rounded-lg border border-slate-200 bg-gradient-to-br from-white to-slate-50 p-1.5">
                  <div className="flex items-start gap-1">
                    <div className="h-4 w-4 rounded-md bg-emerald-100 flex items-center justify-center flex-shrink-0">
                      <Calendar className="w-2.5 h-2.5 text-emerald-600" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <h3 className="text-[8px] font-semibold text-slate-700 uppercase tracking-wide mb-0.5">Post Date</h3>
                      <p className="text-[9px] text-slate-700 line-clamp-2 break-words">
                        {formatUnixSeconds(detailsModal.ad.postDate)}
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              <div className="rounded-xl border border-slate-200 bg-white p-2.5 space-y-2">
                <div className="text-[8px] uppercase text-slate-400 font-semibold">Tags</div>
                <div className="flex flex-wrap gap-2">
                  {safeArr(detailsModal.ad.tags).length === 0 ? (
                    <span className="text-[9px] text-slate-500">Not available</span>
                  ) : (
                    safeArr(detailsModal.ad.tags).map((tag) => (
                      <span
                        key={tag}
                        className="inline-flex items-center gap-1 rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1 text-[9px] font-semibold text-emerald-700"
                      >
                        <Tag className="w-3 h-3" />
                        {tag}
                      </span>
                    ))
                  )}
                </div>
              </div>

              <div className="rounded-xl border border-slate-200 bg-white p-2.5 space-y-2">
                <div className="text-[8px] uppercase text-slate-400 font-semibold">Description</div>
                <p className="text-[10px] text-slate-700 whitespace-pre-wrap">
                  {detailsModal.ad?.item?.bodyTEXT || "Not available"}
                </p>
              </div>

              <div className="rounded-xl border border-slate-200 bg-white p-2.5 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="text-[8px] uppercase text-slate-400 font-semibold">Images</div>
                  <span className="text-[9px] text-slate-500">
                    {getImages(detailsModal.ad).length} image(s)
                  </span>
                </div>
                {getImages(detailsModal.ad).length === 0 ? (
                  <div className="flex items-center gap-2 text-[9px] text-slate-500">
                    <ImageIcon className="w-4 h-4 text-slate-300" />
                    Not available
                  </div>
                ) : (
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
                    {getImages(detailsModal.ad).map((imgUrl, idx) => (
                      <div
                        key={`${imgUrl}-${idx}`}
                        className="group relative aspect-square rounded-lg overflow-hidden border border-slate-200 bg-slate-100"
                      >
                        <img
                          src={imgUrl}
                          alt={`Haraj image ${idx + 1}`}
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"
                          onError={(e) => {
                            e.currentTarget.style.display = "none";
                          }}
                        />
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="rounded-xl border border-slate-200 bg-white p-2.5 space-y-2">
                <div className="text-[8px] uppercase text-slate-400 font-semibold">Comments</div>
                {(() => {
                  const visibleDetailsComments = filterVisibleComments(detailsModal.ad.comments);
                  if (visibleDetailsComments.length === 0) {
                    return <div className="text-[9px] text-slate-500">Not available</div>;
                  }
                  return (
                    <div className="space-y-2">
                      {visibleDetailsComments.map((comment, idx) => (
                        <div key={comment.id || idx} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                          <div className="flex items-center justify-between text-[9px] text-slate-600">
                            <span className="font-semibold text-slate-700">{comment.authorUsername || "Not available"}</span>
                            <span>{formatUnixSeconds(comment.date)}</span>
                          </div>
                          <p className="mt-1 text-[10px] text-slate-700 whitespace-pre-wrap">{comment.body || "Not available"}</p>
                        </div>
                      ))}
                    </div>
                  );
                })()}
              </div>

            </div>
            <div className="px-5 py-3 border-t border-slate-200 bg-slate-50 flex items-center justify-between">
              <div className="text-[9px] text-slate-500">
                Has Price: {formatBool(detailsModal.ad.hasPrice)} | Has Image: {formatBool(detailsModal.ad?.item?.hasImage)}
              </div>
              <div className="flex items-center gap-2">
                {getHarajUrl(detailsModal.ad) && (
                  <a
                    href={getHarajUrl(detailsModal.ad)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-[10px] font-semibold transition-colors"
                  >
                    <ExternalLink className="w-4 h-4" />
                    View in Haraj
                  </a>
                )}
                <button
                  type="button"
                  onClick={closeDetailsModal}
                  className="px-3 py-2 rounded-lg bg-slate-200 hover:bg-slate-300 text-slate-700 text-[10px] font-semibold transition-colors"
                >
                  Close
                </button>
              </div>
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
              {visibleModalComments.length === 0 ? (
                <div className="text-[11px] text-slate-500">No comments found.</div>
              ) : (
                visibleModalComments.map((comment, idx) => (
                  <div key={comment.id || idx} className="rounded-xl border border-slate-200 bg-white px-3 py-2">
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-[11px] font-semibold text-slate-900">{comment.authorUsername || "Unknown user"}</div>
                      <div className="text-[9px] text-slate-500">{formatUnixSeconds(comment.date)}</div>
                    </div>
                    <p className="mt-1 text-[11px] text-slate-700 whitespace-pre-wrap">{comment.body || ""}</p>
                  </div>
                ))
              )}
            </div>
            <div className="px-4 py-3 border-t border-slate-200 bg-slate-50 flex items-center justify-end">
              <button
                type="button"
                onClick={closeCommentsModal}
                className="px-3 py-2 rounded-lg bg-slate-200 hover:bg-slate-300 text-slate-700 text-[11px] font-semibold transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default HarajScrapeData;


