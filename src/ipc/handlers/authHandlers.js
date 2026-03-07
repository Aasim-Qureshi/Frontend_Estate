const { session, BrowserWindow, shell } = require('electron');
const pythonAPI = require('../../services/python/PythonAPI');

let secondaryLoginWindow = null;
const SECONDARY_PARTITION = 'persist:taqeem-secondary';
let lastExternalLoginTs = 0;
let externalLoginInFlight = false;

function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function confirmSingleReport(win, reportId) {
    const targetUrl = `https://qima.taqeem.gov.sa/report/${reportId}`;
    try {
        await win.loadURL(targetUrl);
    } catch (err) {
        return { status: 'FAILED', error: `Failed to load report ${reportId}: ${err?.message || err}` };
    }

    const result = await win.webContents.executeJavaScript(`
        new Promise((resolve) => {
            const deadline = Date.now() + 60000; // 60s to allow manual login if needed
            const attempt = () => {
                const checkbox = document.querySelector('input#agree, input[name="policy"]');
                const confirmBtn = document.querySelector('input#confirm[type="submit"]');
                if (checkbox && confirmBtn) {
                    try {
                        checkbox.checked = true;
                        checkbox.dispatchEvent(new Event('change', { bubbles: true }));
                        confirmBtn.disabled = false;
                        confirmBtn.removeAttribute('disabled');
                        confirmBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
                        resolve({ ok: true });
                        return;
                    } catch (err) {
                        resolve({ ok: false, error: err?.message || 'Failed clicking confirm' });
                        return;
                    }
                }
                if (Date.now() > deadline) {
                    resolve({ ok: false, error: 'Timeout waiting for checkbox/button (login required?)' });
                    return;
                }
                setTimeout(attempt, 750);
            };
            attempt();
        });
    `, true);

    await delay(1200); // brief pause after submit
    return result?.ok ? { status: 'SUCCESS' } : { status: 'FAILED', error: result?.error || 'Unknown error' };
}

async function confirmReportsBatch(win, reportIds = []) {
    if (!win || win.isDestroyed()) {
        return { total: reportIds.length, succeeded: 0, failed: reportIds.length, results: reportIds.map((id) => ({ reportId: id, status: 'FAILED', error: 'Secondary window not available' })) };
    }

    const results = [];
    for (const reportId of reportIds) {
        try {
            const res = await confirmSingleReport(win, reportId);
            results.push({ reportId, status: res.status, error: res.error });
        } catch (error) {
            results.push({ reportId, status: 'FAILED', error: error.message || String(error) });
        }
    }
    const summary = {
        total: reportIds.length,
        succeeded: results.filter((r) => r.status === 'SUCCESS').length,
        failed: results.filter((r) => r.status !== 'SUCCESS').length,
        results
    };
    return summary;
}

async function waitForSecondaryLogin(win, timeoutMs = 180000, intervalMs = 1500) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        if (!win || win.isDestroyed()) {
            throw new Error('Secondary login window closed.');
        }
        const currentUrl = String(win.webContents.getURL() || '').toLowerCase();
        if (currentUrl.startsWith('https://qima.taqeem.gov.sa/')) {
            return true;
        }
        await delay(intervalMs);
    }
    throw new Error('Timed out waiting for Taqeem login.');
}

const authHandlers = {
    async handleLogin(event, credentials) {
        try {
            console.log('[MAIN] Received login request:', credentials.email);
            const result = await pythonAPI.auth.login(
                credentials.email,
                credentials.password,
                credentials.method,
                credentials.autoOtp || false
            );

            if (result.status === 'OTP_REQUIRED') {
                return { status: 'OTP_REQUIRED', message: 'Please enter OTP' };
            } else if (result.status === 'SUCCESS') {
                return { status: 'SUCCESS', message: 'Login successful' };
            } else {
                return { status: 'ERROR', error: result.error || 'Login failed' };
            }
        } catch (error) {
            console.error('[MAIN] Login error:', error);
            return { status: 'ERROR', error: error.message };
        }
    },

    async handleSubmitOtp(event, otp) {
        try {
            console.log('[MAIN] Received OTP:', otp);
            const result = await pythonAPI.auth.submitOtp(otp);

            if (result.status === 'SUCCESS') {
                return { status: 'SUCCESS', message: 'Authentication complete' };
            } else {
                return { status: 'ERROR', error: result.error || 'OTP verification failed' };
            }
        } catch (error) {
            console.error('[MAIN] OTP error:', error);
            return { status: 'ERROR', error: error.message };
        }
    },

    async getRefreshToken(event, opts = {}) {
        const COOKIE_NAME = opts.name || 'refreshToken';

        try {
            const cookies = await session.defaultSession.cookies.get({ name: COOKIE_NAME });
            if (cookies.length > 0) {
                // Return the first matching cookie's value
                return { status: 'SUCCESS', token: cookies[0].value };
            } else {
                return { status: 'NOT_FOUND' };
            }
        } catch (error) {
            console.error('[MAIN] getRefreshToken error:', error);
            return { status: 'ERROR', error: error.message || String(error) };
        }
    },


    async handleCheckStatus(event) {
        let result;
        try {
            console.log('[MAIN] Received check status request');
            result = await pythonAPI.auth.checkStatus();
            if (!result) return { status: 'ERROR', error: 'Browser status check failed' };

            console.log("Result at handler:", result);

            return {
                status: result.status,
                browserOpen: result.browserOpen,
                message: result.message,
                error: result.error
            };

        } catch (error) {
            console.error('[MAIN] Check status error:', error);
            return {
                status: 'ERROR',
                error: error.message,
                browserOpen: result?.browserOpen || false,
                message: result?.message || 'Status check failed'
            };
        }
    },

    async handleGetCompanies(event) {
        try {
            console.log('[MAIN] Received get companies request');
            const result = await pythonAPI.auth.getCompanies();
            if (!result) return { status: 'ERROR', error: 'Failed to get companies' };

            console.log("Result at handler:", result);

            return {
                status: result.status,
                data: result.data
            };

        } catch (error) {
            console.error('[MAIN] Get companies error:', error);
            return {
                status: 'ERROR',
                error: error.message
            };
        }
    },

    async handleGetProfile(event) {
        try {
            console.log('[MAIN] Received get profile request');
            const result = await pythonAPI.auth.getProfile();
            if (!result) return { status: 'ERROR', error: 'Failed to get profile' };

            return {
                status: result.status,
                data: result.data || null,
                error: result.error || null
            };

        } catch (error) {
            console.error('[MAIN] Get profile error:', error);
            return {
                status: 'ERROR',
                error: error.message
            };
        }
    },

    async handleNavigateToCompany(event, company) {
        try {
            console.log('[MAIN] Received navigate to company request:', company);
            const result = await pythonAPI.auth.navigateToCompany(company);
            if (!result) return { status: 'ERROR', error: 'Failed to navigate to company' };

            console.log("Result at handler:", result);

            return {
                status: result.status,
                message: result.message,
                url: result.url,
                selectedCompany: result.selectedCompany,
                error: result.error
            };

        } catch (error) {
            console.error('[MAIN] Navigate to company error:', error);
            return {
                status: 'ERROR',
                error: error.message
            };
        }
    },

    async handleRegister(event, userData) {
        try {
            console.log('[MAIN] Received registration request');
            const result = await pythonAPI.auth.register(userData);

            if (result.status === 'SUCCESS') {
                return { status: 'SUCCESS', message: 'Registration successful' };
            } else {
                return { status: 'ERROR', error: result.error || 'Registration failed' };
            }
        } catch (error) {
            console.error('[MAIN] Registration error:', error);
            return { status: 'ERROR', error: error.message };
        }
    },


    async handleSetRefreshToken(event, opts = {}) {
        const {
            baseUrl,
            token,
            name = 'refreshToken',
            path = '/',
            maxAgeDays = 7,
            sessionOnly = true,
            sameSite = 'lax',
            secure = (process.env.NODE_ENV === 'production'),
            httpOnly = true
        } = opts;

        if (!baseUrl || !token) {
            return { status: 'ERROR', error: 'baseUrl and token are required' };
        }

        try {
            // Ensure url includes protocol
            let cookieUrl = baseUrl;
            if (!/^https?:\/\//i.test(cookieUrl)) cookieUrl = `http://${cookieUrl}`;

            const cookieData = {
                url: cookieUrl,
                name,
                value: token,
                path,
                httpOnly: !!httpOnly,
                secure: !!secure,
                sameSite: (sameSite === 'strict' ? 'strict' : (sameSite === 'no_restriction' ? 'no_restriction' : 'lax'))
            };
            const persistForDays = Number(maxAgeDays);
            const shouldPersist = sessionOnly !== true && Number.isFinite(persistForDays) && persistForDays > 0;
            if (shouldPersist) {
                const nowSeconds = Math.floor(Date.now() / 1000);
                cookieData.expirationDate = nowSeconds + (persistForDays * 24 * 60 * 60);
            }

            await session.defaultSession.cookies.set(cookieData);
            console.log(
                '[MAIN] Set cookie:',
                name,
                'for',
                cookieUrl,
                shouldPersist ? `(persistent ${persistForDays}d)` : '(session-only)'
            );

            return { status: 'SUCCESS' };
        } catch (error) {
            console.error('[MAIN] Failed to set cookie:', error);
            return { status: 'ERROR', error: error.message || String(error) };
        }
    },

    /**
     * Clears cookie (by name) for the given baseUrl.
     * opts: { baseUrl (required), name (optional, default 'refreshToken') }
     */
    async handleClearRefreshToken(event, opts = {}) {
        const { baseUrl, name = 'refreshToken' } = opts;
        if (!baseUrl) {
            return { status: 'ERROR', error: 'baseUrl is required' };
        }
        try {
            let cookieUrl = baseUrl;
            if (!/^https?:\/\//i.test(cookieUrl)) cookieUrl = `http://${cookieUrl}`;

            // Electron cookies.remove expects (url, name)
            await session.defaultSession.cookies.remove(cookieUrl, name);
            console.log('[MAIN] Cleared cookie:', name, 'for', cookieUrl);
            return { status: 'SUCCESS' };
        } catch (error) {
            console.error('[MAIN] Failed to clear cookie:', error);
            return { status: 'ERROR', error: error.message || String(error) };
        }
    },
    async handleOpenTaqeemLogin(event, opts = {}) {
        const loginUrl = opts.url || (
            'https://sso.taqeem.gov.sa/realms/REL_TAQEEM/protocol/openid-connect/auth'
            + '?client_id=cli-qima-valuers'
            + '&redirect_uri=https%3A%2F%2Fqima.taqeem.sa%2Fkeycloak%2Flogin%2Fcallback'
            + '&scope=openid&response_type=code'
        );
        const batchId = opts.batchId;
        const preferChrome = opts.preferChrome !== false;
        const automationOnly = opts.automationOnly || opts.openInAutomation;
        const openIfClosed = opts.onlyIfClosed !== false;
        const navigateIfOpen = !!opts.navigateIfOpen;
        const forceNewAutomation = !!opts.forceNewAutomation;
        const waitForLogin = opts.waitForLogin === true;
        const loginTimeoutMs = Number(opts.loginTimeoutMs) || 180000;

        let reportIds = [];
        if (batchId) {
            try {
                const batchResult = await pythonAPI.auth.getReportsByBatch(batchId);
                if (batchResult?.status === 'SUCCESS' && Array.isArray(batchResult.reports)) {
                    reportIds = batchResult.reports.filter(Boolean);
                } else {
                    return { status: 'ERROR', error: batchResult?.error || `No reports found for batch ${batchId}` };
                }
            } catch (err) {
                return { status: 'ERROR', error: err.message || String(err) };
            }
        }

        try {
            if (automationOnly) {
                const automationResult = await pythonAPI.auth.openLoginPage(loginUrl, {
                    onlyIfClosed: openIfClosed,
                    navigateIfOpen,
                    forceNew: forceNewAutomation
                });

                if (automationResult?.status === 'SUCCESS') {
                    return {
                        status: 'SUCCESS',
                        message: automationResult.message || 'Opened Taqeem login in automation browser',
                        browserOpen: automationResult.browserOpen !== false,
                        alreadyOpen: !!automationResult.alreadyOpen,
                        openedNew: !!automationResult.openedNewBrowser,
                        navigated: !!automationResult.navigated
                    };
                }

                return { status: 'ERROR', error: automationResult?.error || 'Failed to open Taqeem login' };
            }

            if (preferChrome) {
                if (externalLoginInFlight) {
                    return {
                        status: 'SUCCESS',
                        message: 'Taqeem login already opening in external browser'
                    };
                }
                externalLoginInFlight = true;
                try {
                    if (secondaryLoginWindow && !secondaryLoginWindow.isDestroyed()) {
                        secondaryLoginWindow.close();
                        secondaryLoginWindow = null;
                    }
                } catch (err) {
                    // ignore close errors
                }

                const now = Date.now();
                if (now - lastExternalLoginTs < 4000) {
                    return {
                        status: 'SUCCESS',
                        message: 'Taqeem login already opened in external browser'
                    };
                }
                lastExternalLoginTs = now;

                await shell.openExternal(loginUrl);

                setTimeout(() => {
                    externalLoginInFlight = false;
                }, 4000);

                return {
                    status: 'SUCCESS',
                    message: 'Opened Taqeem login in external browser'
                };
            }
            if (secondaryLoginWindow && !secondaryLoginWindow.isDestroyed()) {
                secondaryLoginWindow.show();
                secondaryLoginWindow.focus();
                await secondaryLoginWindow.loadURL(loginUrl);
            } else {
                secondaryLoginWindow = new BrowserWindow({
                    width: 1200,
                    height: 800,
                    webPreferences: {
                        partition: SECONDARY_PARTITION,
                        nodeIntegration: false,
                        contextIsolation: true
                    },
                    title: 'Taqeem - Secondary Login'
                });

                secondaryLoginWindow.on('closed', () => {
                    secondaryLoginWindow = null;
                });

                await secondaryLoginWindow.loadURL(loginUrl);
            }

            let batchSummary = null;
            if (reportIds.length > 0) {
                if (waitForLogin) {
                    await waitForSecondaryLogin(secondaryLoginWindow, loginTimeoutMs);
                }
                batchSummary = await confirmReportsBatch(secondaryLoginWindow, reportIds);
            }

            return {
                status: 'SUCCESS',
                message: 'Opened Taqeem login in a separate browser window',
                batch: batchSummary
            };
        } catch (error) {
            console.error('[MAIN] Failed to open Taqeem login window:', error);
            return { status: 'ERROR', error: error.message || String(error) };
        }
    },

    async handlePublicLogin(event, isAuth) {
        try {
            console.log('[MAIN] Received public login request');
            const result = await pythonAPI.auth.publicLogin(isAuth);
            return result;
        } catch (error) {
            console.error('[MAIN] Login error:', error);
            return { status: 'ERROR', error: error.message };
        }
    }
};

module.exports = authHandlers;
