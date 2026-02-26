import React, { useEffect, useState } from "react";
import { LogOut, Phone, User, Calendar } from "lucide-react";
import { useSession } from "../context/SessionContext";
import { useValueNav } from "../context/ValueNavContext";

const API_BASE_URL = "http://167.71.231.64:3000";

const Profile = ({ onViewChange }) => {
  const { user, token, logout, updateUser } = useSession();
  const {
    companies,
    loadingCompanies,
    ensureCompaniesLoaded,
    preferredCompany,
    preferredCompanyKey,
    setPreferredCompany,
    resetAll,
  } = useValueNav();
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [defaultCompanyIndex, setDefaultCompanyIndex] = useState(0);
  const [savingDefaultCompany, setSavingDefaultCompany] = useState(false);

  const handleLogout = () => {
    resetAll();
    logout();
    onViewChange("login");
  };

  const profileImageUrl = user?.profileImagePath
    ? user.profileImagePath.startsWith("http")
      ? user.profileImagePath
      : `${API_BASE_URL}${user.profileImagePath}`
    : "";

  const handleProfileImageChange = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!token) {
      alert("Login required to upload a profile image.");
      return;
    }
    setUploading(true);
    setUploadError("");
    try {
      const formData = new FormData();
      formData.append("profileImage", file);

      const response = await fetch(`${API_BASE_URL}/api/users/profile-image`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });

      if (!response.ok) {
        let message = "Failed to upload profile image";
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
      if (payload?.user) {
        updateUser(payload.user);
      }
    } catch (err) {
      setUploadError(err.message || "Failed to upload profile image");
    } finally {
      setUploading(false);
    }
  };

  useEffect(() => {
    ensureCompaniesLoaded("equipment");
  }, [ensureCompaniesLoaded]);

  useEffect(() => {
    if (!companies || companies.length === 0) return;
    const idx = companies.findIndex((c) => {
      const key =
        c?.officeId || c?.office_id || c?.url || c?.id || c?.name || "";
      return key && key === preferredCompanyKey;
    });
    setDefaultCompanyIndex(idx >= 0 ? idx : 0);
  }, [companies, preferredCompanyKey]);

  const handleSaveDefaultCompany = async () => {
    const chosen = companies?.[defaultCompanyIndex] || companies?.[0];
    if (!chosen) return;
    setSavingDefaultCompany(true);
    try {
      await setPreferredCompany(chosen, {
        applySelection: true,
        skipNavigation: true,
        persistDefault: true,
      });
    } finally {
      setSavingDefaultCompany(false);
    }
  };

  if (!user) {
    return (
      <div className="max-w-md mx-auto bg-white rounded-lg shadow-md p-6 text-center">
        <p className="text-gray-600">
          No user session found. Please register or login.
        </p>
      </div>
    );
  }

  // Format date if available
  const createdAt = user.createdAt
    ? new Date(user.createdAt).toLocaleDateString()
    : "N/A";

  return (
    <div className="max-w-2xl mx-auto">
      <div className="bg-white rounded-lg shadow-md overflow-hidden">
        {/* Profile Header */}
        <div className="bg-gradient-to-r from-blue-600 to-blue-700 px-6 py-8">
          <div className="flex items-center space-x-4">
            <div className="w-16 h-16 bg-white rounded-full flex items-center justify-center shadow-md overflow-hidden">
              {profileImageUrl ? (
                <img
                  src={profileImageUrl}
                  alt="Profile"
                  className="h-full w-full object-cover"
                />
              ) : (
                <User className="w-8 h-8 text-blue-600" />
              )}
            </div>
            <div>
              <h1 className="text-3xl font-bold text-white">User Profile</h1>
              <p className="text-blue-100">Account Information</p>
            </div>
          </div>
        </div>

        {/* Profile Content */}
        <div className="p-6 space-y-6">
          <div className="flex flex-wrap items-center gap-3 rounded-lg border border-blue-100 bg-blue-50/60 p-4">
            <div className="text-sm font-medium text-blue-900">
              Profile photo
            </div>
            <label className="inline-flex cursor-pointer items-center gap-2 rounded-full bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700">
              <input
                type="file"
                accept="image/*"
                onChange={handleProfileImageChange}
                disabled={uploading}
                className="hidden"
              />
              {uploading ? "Uploading..." : "Change photo"}
            </label>
            {uploadError && (
              <span className="text-xs font-semibold text-red-600">
                {uploadError}
              </span>
            )}
          </div>

          {/* Phone Information */}
          <div className="flex items-center space-x-4 p-4 bg-gray-50 rounded-lg">
            <Phone className="w-6 h-6 text-blue-600" />
            <div>
              <p className="text-sm font-medium text-gray-600">Phone Number</p>
              <p className="text-lg font-semibold text-gray-900">
                {user.phone || "Not provided"}
              </p>
            </div>
          </div>

          {/* Account Type */}
          <div className="flex items-center space-x-4 p-4 bg-gray-50 rounded-lg">
            <User className="w-6 h-6 text-green-600" />
            <div>
              <p className="text-sm font-medium text-gray-600">Account Type</p>
              <p className="text-lg font-semibold text-gray-900 capitalize">
                {user.type || "Individual"}
              </p>
            </div>
          </div>

          {/* Default Company */}
          <div className="p-4 bg-gray-50 rounded-lg space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-gray-600">
                  Default company
                </p>
              </div>
              {preferredCompany && (
                <span className="text-[11px] rounded-full bg-green-100 text-green-700 px-2 py-1 font-semibold">
                  {preferredCompany.name}
                </span>
              )}
            </div>
            {loadingCompanies ? (
              <div className="text-xs text-gray-600">Loading companies...</div>
            ) : companies && companies.length > 0 ? (
              <div className="flex flex-col sm:flex-row gap-2">
                <select
                  value={String(defaultCompanyIndex)}
                  onChange={(e) =>
                    setDefaultCompanyIndex(Number(e.target.value))
                  }
                  className="flex-1 rounded-md border border-gray-200 px-3 py-2 text-sm bg-white focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                >
                  {companies.map((company, idx) => (
                    <option
                      key={
                        company.officeId ||
                        company.office_id ||
                        company.url ||
                        company.id ||
                        company.name ||
                        idx
                      }
                      value={String(idx)}
                    >
                      {company.name || "Company"}
                    </option>
                  ))}
                </select>
                <button
                  onClick={handleSaveDefaultCompany}
                  disabled={
                    savingDefaultCompany || !companies || companies.length === 0
                  }
                  className="inline-flex items-center justify-center rounded-md bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
                >
                  {savingDefaultCompany ? "Saving..." : "Set as default"}
                </button>
              </div>
            ) : (
              <div className="text-xs text-gray-500">
                Connect to Taqeem to sync your companies.
              </div>
            )}
          </div>

          {/* Member Since */}
          <div className="flex items-center space-x-4 p-4 bg-gray-50 rounded-lg">
            <Calendar className="w-6 h-6 text-purple-600" />
            <div>
              <p className="text-sm font-medium text-gray-600">Member Since</p>
              <p className="text-lg font-semibold text-gray-900">{createdAt}</p>
            </div>
          </div>

          {/* User ID (if available) */}
          {user._id && (
            <div className="p-4 bg-gray-50 rounded-lg">
              <p className="text-sm font-medium text-gray-600 mb-1">User ID</p>
              <p className="text-sm font-mono text-gray-700 break-all">
                {user._id}
              </p>
            </div>
          )}
        </div>

        {/* Action Buttons */}
        <div className="px-6 py-4 bg-gray-50 border-t border-gray-200 flex space-x-4">
          <button
            onClick={() => onViewChange("packages")}
            className="flex-1 bg-blue-600 text-white px-4 py-3 rounded-lg hover:bg-blue-700 transition-colors duration-200 font-medium"
          >
            View Packages
          </button>
          <button
            onClick={handleLogout}
            className="flex-1 bg-red-600 text-white px-4 py-3 rounded-lg hover:bg-red-700 transition-colors duration-200 font-medium flex items-center justify-center space-x-2"
          >
            <LogOut className="w-5 h-5" />
            <span>Logout</span>
          </button>
        </div>
      </div>
    </div>
  );
};

export default Profile;
