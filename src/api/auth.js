const httpClient = require("./httpClient")

const registerUser = async (userData) => {
    const url = `/users/register`;
    return await httpClient.post(url, userData);
};

const getMyReports = async ({ page = 1, limit = 20, companyOfficeId = null } = {}) => {
  const params = { page, limit };
  if (companyOfficeId) params.companyOfficeId = companyOfficeId;
  return await httpClient.get("/report-lookup/mine", {
    params,
  });
};


const lookupReportById = async (report_id, companyOfficeId = null) => {
  const params = { report_id };
  if (companyOfficeId) params.companyOfficeId = companyOfficeId;
  return await httpClient.get("/report-lookup/lookup", {
    params,
  });
};

module.exports = {
    registerUser,
    getMyReports,
    lookupReportById
};


module.exports.default = module.exports;
