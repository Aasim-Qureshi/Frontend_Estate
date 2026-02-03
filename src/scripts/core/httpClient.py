import asyncio
from typing import Any, Dict, Optional

import httpx

# ==============================
# Configuration
# ==============================

BASE_API_URL = "http://localhost:3000/api"


# ==============================
# Errors
# ==============================


class HTTPError(Exception):
    """Base HTTP error"""


class HTTPRequestFailed(HTTPError):
    def __init__(self, status_code: int, message: str, response: Any = None):
        self.status_code = status_code
        self.message = message
        self.response = response
        super().__init__(f"HTTP {status_code}: {message}")


# ==============================
# HTTP Client
# ==============================


class HttpClient:
    def __init__(
        self,
        base_url: str = BASE_API_URL,
        default_headers: Optional[Dict[str, str]] = None,
        timeout: float = 15.0,
        retries: int = 2,
    ):
        self.base_url = base_url.rstrip("/")  # normalize
        self.default_headers = default_headers or {}
        self.timeout = timeout
        self.retries = retries

    async def request(
        self,
        method: str,
        url: str,
        *,
        params: Optional[Dict[str, Any]] = None,
        json: Optional[Dict[str, Any]] = None,
        data: Optional[Any] = None,
        headers: Optional[Dict[str, str]] = None,
        timeout: Optional[float] = None,
    ) -> Dict[str, Any]:
        """
        Generic async HTTP request
        """
        final_headers = {**self.default_headers, **(headers or {})}

        # Ensure relative paths work correctly
        url = url.lstrip("/")
        request_url = f"{self.base_url}/{url}"

        attempt = 0
        last_exc = None

        while attempt <= self.retries:
            try:
                async with httpx.AsyncClient(timeout=timeout or self.timeout) as client:
                    response = await client.request(
                        method=method.upper(),
                        url=request_url,
                        params=params,
                        json=json,
                        data=data,
                        headers=final_headers,
                    )

                if response.status_code >= 400:
                    raise HTTPRequestFailed(
                        status_code=response.status_code,
                        message=response.text,
                        response=response,
                    )

                try:
                    return response.json()
                except ValueError:
                    return {"raw": response.text}

            except (httpx.RequestError, HTTPRequestFailed) as exc:
                last_exc = exc
                attempt += 1
                if attempt > self.retries:
                    raise

                await asyncio.sleep(0.5 * attempt)

        raise last_exc  # defensive


# ==============================
# Shared client + helpers
# ==============================

_shared_client = HttpClient()


async def http_get(path: str, **kwargs) -> Dict[str, Any]:
    return await _shared_client.request("GET", path, **kwargs)


async def http_post(path: str, **kwargs) -> Dict[str, Any]:
    return await _shared_client.request("POST", path, **kwargs)


async def http_put(path: str, **kwargs) -> Dict[str, Any]:
    return await _shared_client.request("PUT", path, **kwargs)


async def http_patch(path: str, **kwargs) -> Dict[str, Any]:
    return await _shared_client.request("PATCH", path, **kwargs)


async def http_delete(path: str, **kwargs) -> Dict[str, Any]:
    return await _shared_client.request("DELETE", path, **kwargs)
