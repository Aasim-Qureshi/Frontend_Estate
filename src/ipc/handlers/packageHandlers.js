// main process - packageHandlers.js
const { ipcMain, session } = require("electron");
const axios = require("axios");
const process = require("process");

const AUTH_EXPIRED_CHANNEL = "auth-expired";

// Spark Vision's cookie-session auth (see server/auth-tracking/config.ts)
const SV_CSRF_COOKIE_NAME = "sv_csrf";
const SV_CSRF_HEADER_NAME = "x-csrf-token";
const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

// Only auth endpoints (/api/auth/...) live on Spark Vision. Everything else
// (transactions, companies, taqeem sync, etc.) still lives on the legacy
// backend at port 3000.
const isSparkVisionRoute = (url) =>
  /^\/api\/auth(\/|$)/.test(String(url || ""));

const isAuthExpired = (status, message) => {
  const code = Number(status || 0);
  if ([401, 403, 419].includes(code)) return true;
  const text = String(message || "").toLowerCase();
  return (
    text.includes("expired token") ||
    text.includes("token expired") ||
    text.includes("session expired") ||
    text.includes("please login") ||
    text.includes("not_authenticated") ||
    text.includes("csrf_invalid")
  );
};

const notifyAuthExpired = (event, status, message) => {
  if (!event?.sender?.send) return;
  if (!isAuthExpired(status, message)) return;
  try {
    event.sender.send(AUTH_EXPIRED_CHANNEL, { status, message });
  } catch (err) {
    console.warn("[API] Failed to notify auth-expired", err);
  }
};

const parseSetCookieString = (cookieStr) => {
  const parts = cookieStr.split(";").map((p) => p.trim());
  const [nameValue, ...attrs] = parts;
  const [name, ...valParts] = nameValue.split("=");
  const value = valParts.join("=");

  const parsed = { name, value };

  attrs.forEach((attr) => {
    const [k, ...vParts] = attr.split("=");
    const key = k.trim().toLowerCase();
    const v = vParts.join("=").trim();
    if (key === "httponly") parsed.httpOnly = true;
    else if (key === "secure") parsed.secure = true;
    else if (key === "samesite") parsed.sameSite = v.toLowerCase();
    else if (key === "path") parsed.path = v;
    else if (key === "domain") parsed.domain = v;
    else if (key === "expires")
      parsed.expires = new Date(v).getTime() / 1000; // seconds
    else if (key === "max-age") parsed.maxAge = Number(v);
  });

  return parsed;
};

const setElectronCookieForBaseUrl = async (baseUrl, cookieObj) => {
  // cookieObj: { name, value, domain?, path?, httpOnly?, secure?, sameSite?, expires?, maxAge? }
  let cookieUrl = baseUrl;
  if (!/^https?:\/\//i.test(cookieUrl)) {
    cookieUrl = `http://${cookieUrl}`;
  }

  const cookieToSet = {
    url: cookieUrl,
    name: cookieObj.name,
    value: cookieObj.value,
    path: cookieObj.path || "/",
    httpOnly: !!cookieObj.httpOnly,
    secure: !!cookieObj.secure,
    sameSite:
      cookieObj.sameSite === "strict"
        ? "strict"
        : cookieObj.sameSite === "lax"
          ? "lax"
          : "no_restriction",
  };

  // A max-age of 0 (or an explicit past-dated expiry) means "delete this
  // cookie" — e.g. Spark Vision's logout clears sv_session this way.
  if (cookieObj.expires) {
    cookieToSet.expirationDate = Number(cookieObj.expires);
  } else if (cookieObj.maxAge !== undefined) {
    const nowSeconds = Math.floor(Date.now() / 1000);
    cookieToSet.expirationDate = nowSeconds + Number(cookieObj.maxAge);
  }

  try {
    if (cookieToSet.expirationDate !== undefined && cookieToSet.expirationDate <= Math.floor(Date.now() / 1000)) {
      await session.defaultSession.cookies.remove(cookieUrl, cookieToSet.name);
      console.log("[Cookies] Removed cookie:", cookieToSet.name, "for", cookieUrl);
      return;
    }
    await session.defaultSession.cookies.set(cookieToSet);
    console.log(
      "[Cookies] Set cookie:",
      cookieToSet.name,
      "for",
      cookieToSet.url,
    );
  } catch (err) {
    console.warn("[Cookies] Failed to set cookie", err);
  }
};

// Reads back whatever cookies Electron currently holds for baseUrl (i.e.
// sv_identity / sv_session / sv_csrf set from a prior login) and builds the
// "Cookie" header + CSRF header Spark Vision expects on the next request.
// Only relevant for Spark Vision (auth) requests — the legacy backend on
// port 3000 doesn't use these cookies at all.
const buildAuthHeadersForBaseUrl = async (baseUrl, method) => {
  let cookieUrl = baseUrl;
  if (!/^https?:\/\//i.test(cookieUrl)) {
    cookieUrl = `http://${cookieUrl}`;
  }

  const headers = {};
  try {
    const cookies = await session.defaultSession.cookies.get({ url: cookieUrl });
    if (cookies.length > 0) {
      headers.Cookie = cookies.map((c) => `${c.name}=${c.value}`).join("; ");
    }
    if (MUTATING_METHODS.has(String(method || "").toUpperCase())) {
      const csrfCookie = cookies.find((c) => c.name === SV_CSRF_COOKIE_NAME);
      if (csrfCookie) {
        headers[SV_CSRF_HEADER_NAME] = csrfCookie.value;
      }
    }
  } catch (err) {
    console.warn("[Cookies] Failed to read cookies for", cookieUrl, err);
  }
  return headers;
};

const packageHandlers = {
  async handleApiRequest(event, requestData) {
    if (!requestData || typeof requestData !== "object") {
      throw new Error(
        "Invalid request data: expected object with method, url, data, and headers",
      );
    }

    const { method, url, data = {}, headers = {} } = requestData;

    if (!method || !url) {
      throw new Error("Method and URL are required for API request");
    }

    const useSparkVision = isSparkVisionRoute(url);

    // Auth (/api/auth/...) goes to Spark Vision, cookie-session based.
    // Everything else stays on the legacy backend, unchanged.
    const candidates = [];
    if (useSparkVision) {
      const envUrl = process.env.SPARK_VISION_BACKEND_URL || process.env.BACKEND_URL;
      if (envUrl) candidates.push(envUrl.replace(/\/$/, ""));
      candidates.push(
        "http://167.71.231.64:5000",
        "http://localhost:5000",
        // "http://127.0.0.1:5000",
      );
    } else {
      const envUrl = process.env.BACKEND_URL;
      if (envUrl) candidates.push(envUrl.replace(/\/$/, ""));
      candidates.push(
        "http://167.71.231.64:3000",
        "http://localhost:3000",
        // "http://127.0.0.1:3000",
        // "https://future-electron-backend.onrender.com",
      );
    }

    const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

    const attemptRequest = async (baseUrl) => {
      const fullUrl = `${baseUrl}${url}`;
      const authHeaders = useSparkVision
        ? await buildAuthHeadersForBaseUrl(baseUrl, method)
        : {};
      const config = {
        method: method.toUpperCase(),
        url: fullUrl,
        headers: { "Content-Type": "application/json", ...authHeaders, ...headers },
        data,
        timeout: 10000,
        validateStatus: () => true,
      };

      const response = await axios(config);

      // Persist any cookies Spark Vision sets/refreshes/clears back into
      // Electron's cookie store so subsequent requests carry them. Only
      // relevant for Spark Vision — the legacy backend doesn't set these.
      if (useSparkVision) {
        const setCookieHeader =
          response.headers?.["set-cookie"] || response.headers?.["Set-Cookie"];
        if (setCookieHeader) {
          const cookieStrings = Array.isArray(setCookieHeader)
            ? setCookieHeader
            : [setCookieHeader];
          for (const cookieStr of cookieStrings) {
            try {
              const parsed = parseSetCookieString(cookieStr);
              await setElectronCookieForBaseUrl(baseUrl, parsed);
            } catch (err) {
              console.warn(
                "[Cookies] Could not parse/set Set-Cookie header:",
                cookieStr,
                err,
              );
            }
          }
        }
      }

      if (response.status >= 200 && response.status < 300) {
        return response.data;
      }

      let msg = response.data?.message || `HTTP ${response.status}`;
      if (
        [401, 403].includes(response.status) ||
        msg === "Invalid or expired token"
      ) {
        msg = "Please login to our system";
      }

      const err = new Error(msg);
      err.status = response.status;
      err.response = { data: response.data, headers: response.headers };
      throw err;
    };

    let lastError = null;

    for (const baseUrl of candidates) {
      try {
        return await attemptRequest(baseUrl);
      } catch (error) {
        // Retry once on ECONNREFUSED with a short delay
        if (error.code === "ECONNREFUSED") {
          console.log(
            `[API] ECONNREFUSED on ${baseUrl}${url} — retrying in 2s...`,
          );
          await sleep(2000);
          try {
            return await attemptRequest(baseUrl);
          } catch (retryError) {
            console.log(`[API] Retry also failed: ${retryError.message}`);
            error = retryError;
          }
        }

        lastError = error;
        const status = error.response?.status ?? error.status;
        const message = error.response?.data?.message || error.message;

        notifyAuthExpired(event, status, message);
        console.log(
          `[API] Failed (${status || "error"}): ${baseUrl}${url} - ${message}`,
        );

        if (status === 404) continue;

        throw error;
      }
    }

    const error = new Error(
      `No reachable backend. Last error: ${lastError?.message}`,
    );
    error.isNetworkError = true;
    throw error;
  },
};

module.exports = packageHandlers;
