const httpClient = require("./httpClient");

const getMyReports = async ({ page = 1, limit = 20, companyOfficeId = null }) => {
  const params = { page, limit };
  if (companyOfficeId) params.companyOfficeId = companyOfficeId;
  return await httpClient.get("/report-lookup/mine", {
    params,
  });
};

const searchReports = async ({ q, page = 1, limit = 20, source = "ALL", companyOfficeId = null }) => {
  const params = { q, page, limit, source };
  if (companyOfficeId) params.companyOfficeId = companyOfficeId;
  return await httpClient.get("/report-lookup/search", {
    params,
  });
};


module.exports = { getMyReports, searchReports };

// ✅ add this line so default-import works in webpack
module.exports.default = module.exports;
