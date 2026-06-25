import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "./index.css"; // Add this line
import "./i18n";
import Layout from "./components/Layout";
import { SessionProvider, useSession } from "./context/SessionContext";
import { SystemControlProvider } from "./context/SystemControlContext";
import { NavStatusProvider } from "./context/NavStatusContext";
import { ElrajhiUploadProvider } from "./context/ElrajhiUploadContext";

import Registration from "./screens/Registration";
import LoginForm from "./screens/LoginForm";
import Profile from "./screens/Profile";
import CheckBrowser from "./screens/CheckBrowser";
import ValidateReport from "./screens/ValidateReport";
import CompanyMembers from "./screens/CompanyMembers";
import CompanyStatics from "./screens/CompanyStatics";
import AssetCreate from "./screens/AssetCreate";
import UploadExcel from "./screens/UploadExcel";
import RealEstateUpload from "./screens/RealEstateUpload";
import AddCommonFields from "./screens/AddCommonFields";
import GrabMacroIds from "./screens/GrabMacroIds";
import UploadAssets from "./screens/UploadAssets";
import SubmitMacro from "./screens/MacroEdits";
import DeleteReport from "./screens/DeleteReport";
import MyReports from "./screens/MyReports";
import GetCompanies from "./screens/GetCompanies";
import Packages from "./screens/Packages";
import TaqeemAuth from "./screens/TaqeemAuth";
import SystemOperatingStatus from "./screens/SystemOperatingStatus";
import SystemUpdates from "./screens/SystemUpdates";
import Statics from "./screens/Statics";
import Tickets from "./screens/Tickets";
import ElRajhiUploadReport from "./screens/ElRajhiUploadReport";
import DuplicateReport from "./screens/DuplicateReport";
import MultiExcelUpload from "./screens/MultiExcelUpload";
import SubmitReportsQuickly from "./screens/SubmitReportsQuickly";
import { RamProvider } from "./context/RAMContext";
import ValuationSystem from "./screens/ValuationSystem";
import WordCopy from "./screens/WordCopy";
import HarajData from "./screens/HarajData";
import HarajDataUpdated from "./screens/HarajDataUpdated";
import HarajScrapeData from "./screens/HarajScrapeData";
import MobasherData from "./screens/MobasherData";
import YallaMotor from "./screens/YallaMotor";
import Apps from "./screens/Apps";
import { ValueNavProvider } from "./context/ValueNavContext";
import ComingSoon from "./screens/ComingSoon";
import { useValueNav } from "./context/ValueNavContext";
import { NotificationProvider } from "./context/NotificationContext";
import {
  AUTH_EXPIRED_EVENT,
  installAuthExpiryInterceptor,
} from "./utils/authInterceptor";
import { canAccessView } from "./utils/viewAccess";

const DEFAULT_VIEW = "apps";

const AppContent = () => {
  const [currentView, setCurrentView] = useState(DEFAULT_VIEW);
  const [pendingProtectedView, setPendingProtectedView] = useState(null);
  const { isAuthenticated, logout, user } = useSession();
  const {
    syncNavForView,
    setActiveTab,
    selectedCompany,
    resetAll,
    resetNavigation,
  } = useValueNav();

  useEffect(() => {
    setActiveTab(null);
    resetNavigation();
    setCurrentView(DEFAULT_VIEW);
    setPendingProtectedView(null);
  }, [resetNavigation, setActiveTab]);

  const handleViewChange = (nextView) => {
    if (nextView === "registration") {
      setPendingProtectedView(null);
      if (syncNavForView) {
        syncNavForView(nextView);
      }
      setActiveTab(null);
      resetNavigation();
      setCurrentView("registration");
      return;
    }

    if (!canAccessView(nextView, user)) {
      setPendingProtectedView(null);
      setActiveTab(null);
      resetNavigation();
      setCurrentView(DEFAULT_VIEW);
      return;
    }

    const protectedViews = ["get-companies"];
    if (!isAuthenticated && protectedViews.includes(nextView)) {
      setPendingProtectedView(nextView);
      setCurrentView("registration");
      return;
    }
    if (syncNavForView) {
      syncNavForView(nextView);
    }
    if (!nextView || nextView === "apps") {
      setActiveTab(null);
      resetNavigation();
    }
    setCurrentView(nextView);
  };

  // Redirect to Apps once a company is auto-selected after login.
  // Keep the login page stable when a flow explicitly navigates to it.
  const hasRedirectedAfterLogin = React.useRef(false);
  React.useEffect(() => {
    if (!isAuthenticated) {
      hasRedirectedAfterLogin.current = false;
      return;
    }
    if (!selectedCompany || hasRedirectedAfterLogin.current) return;
    const canRedirect = currentView === "apps";
    if (!canRedirect) return;
    setActiveTab(null);
    setCurrentView("apps");
    hasRedirectedAfterLogin.current = true;
  }, [currentView, isAuthenticated, selectedCompany, setActiveTab]);

  useEffect(() => {
    if (isAuthenticated && pendingProtectedView) {
      if (!canAccessView(pendingProtectedView, user)) {
        setPendingProtectedView(null);
        setCurrentView(DEFAULT_VIEW);
        return;
      }
      if (syncNavForView) {
        syncNavForView(pendingProtectedView);
      }
      setCurrentView(pendingProtectedView);
      setPendingProtectedView(null);
    }
  }, [isAuthenticated, pendingProtectedView, syncNavForView, user]);

  useEffect(() => {
    try {
      const hash = currentView ? `#/${currentView}` : "#/apps";
      window.history.replaceState(null, "", hash);
    } catch (err) {
      // ignore navigation errors in desktop shell
    }
  }, [currentView]);

  useEffect(() => {
    if (canAccessView(currentView, user)) return;
    setActiveTab(null);
    resetNavigation();
    setCurrentView(DEFAULT_VIEW);
  }, [currentView, resetNavigation, setActiveTab, user]);

  useEffect(() => {
    const cleanupInterceptor = installAuthExpiryInterceptor();
    const handleAuthExpired = () => {
      if (!isAuthenticated) return;
      logout();
      resetAll();
      setActiveTab(null);
      setPendingProtectedView(null);
      setCurrentView(DEFAULT_VIEW);
    };
    window.addEventListener(AUTH_EXPIRED_EVENT, handleAuthExpired);
    return () => {
      window.removeEventListener(AUTH_EXPIRED_EVENT, handleAuthExpired);
      if (typeof cleanupInterceptor === "function") {
        cleanupInterceptor();
      }
    };
  }, [isAuthenticated, logout, resetAll, setActiveTab]);

  const renderCurrentView = () => {
    switch (currentView) {
      case "apps":
        return <Apps onViewChange={handleViewChange} />;

      case "registration":
        return <Registration onViewChange={handleViewChange} />;

      case "profile":
        return <Profile onViewChange={handleViewChange} />;

      case "login":
        return <LoginForm onViewChange={handleViewChange} />;

      case "taqeem-login":
        return <TaqeemAuth onViewChange={handleViewChange} />;

      case "check-status":
        return <CheckBrowser />;

      case "validate-report":
        return <ValidateReport />;

      case "asset-create":
        return <AssetCreate />;

      case "company-members":
        return <CompanyMembers />;

      case "company-statics":
        return <CompanyStatics />;

      case "upload-excel":
        return <UploadExcel />;

      case "common-fields":
        return <AddCommonFields />;

      case "grab-macro-ids":
        return <GrabMacroIds />;

      case "upload-assets":
        return <UploadAssets onViewChange={handleViewChange} />;

      case "macro-edit":
        return <SubmitMacro />;

      case "delete-report":
        return <DeleteReport />;
      case "my-reports":
        return <MyReports onViewChange={handleViewChange} />;

      case "my-reports":
        return <MyReports onViewChange={handleViewChange} />;

      case "get-companies":
        return <GetCompanies onViewChange={handleViewChange} />;

      case "packages":
        return <Packages />;

      case "admin-packages":
        return <Packages />;

      case "tickets":
        return <Tickets onViewChange={handleViewChange} />;

      case "system-status":
        return <SystemOperatingStatus />;

      case "system-updates":
        return <SystemUpdates />;

      case "statics":
        return <Statics />;

      case "upload-report-elrajhi":
        return <ElRajhiUploadReport onViewChange={handleViewChange} />;

      case "duplicate-report":
        return <DuplicateReport onViewChange={handleViewChange} />;

      case "multi-excel-upload":
        return <MultiExcelUpload onViewChange={handleViewChange} />;

      case "real-estate-upload":
        return <RealEstateUpload onViewChange={handleViewChange} />;

      case "submit-reports-quickly":
        return <SubmitReportsQuickly onViewChange={handleViewChange} />;

      case "valuation-system":
        return <ValuationSystem />;

      case "word-copy":
        return <WordCopy />;

      case "haraj":
      case "haraj-data":
        return <HarajData />;
      case "haraj-data-updated":
        return <HarajDataUpdated />;
      case "mobasher-data":
        return <MobasherData />;
      case "yalla-motor":
        return <YallaMotor />;
      case "haraj-scrape":
        return <HarajScrapeData />;

      case "coming-soon":
        return <ComingSoon />;

      default:
        return <Apps onViewChange={handleViewChange} />;
    }
  };

  return (
    <Layout currentView={currentView} onViewChange={handleViewChange}>
      {renderCurrentView()}
    </Layout>
  );
};

const App = () => {
  return (
    <SessionProvider>
      <SystemControlProvider>
        <NavStatusProvider>
          <RamProvider>
            <ElrajhiUploadProvider>
              <NotificationProvider>
                <ValueNavProvider>
                  <AppContent />
                </ValueNavProvider>
              </NotificationProvider>
            </ElrajhiUploadProvider>
          </RamProvider>
        </NavStatusProvider>
      </SystemControlProvider>
    </SessionProvider>
  );
};

const container = document.getElementById("root");
const root = createRoot(container);
root.render(<App />);

export default App;
