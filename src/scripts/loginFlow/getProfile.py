import asyncio
import re

from scripts.core.browser import navigate


def _clean_text(value):
    if value is None:
        return ""
    return str(value).strip()


def _repair_mojibake(value):
    if not value or not isinstance(value, str):
        return value
    if any(ch in value for ch in ("\u00d8", "\u00d9", "\u00c3", "\u00c2")):
        try:
            return value.encode("latin1").decode("utf-8")
        except Exception:
            return value
    return value


def _extract_field_by_hint(fields, hints):
    if not isinstance(fields, dict):
        return None

    normalized = {
        _clean_text(key).lower(): _clean_text(value)
        for key, value in fields.items()
        if _clean_text(key)
    }

    for hint in hints:
        hint_lower = hint.lower()
        for key, value in normalized.items():
            if hint_lower in key and value:
                return value
    return None


async def get_profile():
    try:
        page = await navigate("https://qima.taqeem.sa/valuer/profile")
        await asyncio.sleep(2)

        data = await page.evaluate(
            """
            () => {
                const clean = (value) => {
                    if (value === null || value === undefined) return '';
                    return String(value).replace(/\s+/g, ' ').trim();
                };

                const result = {
                    user_id: '',
                    taqeemUser: '',
                    fullName: '',
                    email: '',
                    phone: '',
                    fields: {},
                    raw: {
                        title: document.title || '',
                        url: window.location.href || '',
                    },
                };

                const profileName =
                    document.querySelector('h1, h2, h3, h4, h5, .profile-name, .user-name') || null;
                if (profileName) {
                    result.fullName = clean(profileName.textContent || profileName.innerText || '');
                }

                const idSpan = document.querySelector(
                    '.appBox .d-flex.justify-content-between.border-top.mt-md.flex-wrap .fs-xs:nth-of-type(1) span'
                );
                if (idSpan) {
                    result.user_id = clean(idSpan.textContent || idSpan.innerText || '');
                    result.taqeemUser = result.user_id;
                }

                const rows = Array.from(document.querySelectorAll('.d-flex.justify-content-between, .row, tr'));
                rows.forEach((row) => {
                    const cells = Array.from(row.querySelectorAll('span, div, td, th'))
                        .map((cell) => clean(cell.textContent || cell.innerText || ''))
                        .filter(Boolean);
                    if (cells.length < 2) return;

                    const label = cells[0];
                    const value = cells[cells.length - 1];
                    if (!label || !value) return;

                    if (!result.fields[label]) {
                        result.fields[label] = value;
                    }
                });

                const bodyText = clean(document.body?.innerText || '');
                const emailMatch = bodyText.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
                if (emailMatch) {
                    result.email = clean(emailMatch[0]);
                }

                const phoneMatch = bodyText.match(/(?:\+?966|0)?\s*5\d{8}/);
                if (phoneMatch) {
                    result.phone = clean(phoneMatch[0]);
                }

                return result;
            }
            """
        )

        fields = data.get("fields", {}) if isinstance(data, dict) else {}

        full_name = data.get("fullName") if isinstance(data, dict) else ""
        if not full_name:
            full_name = _extract_field_by_hint(fields, ["name", "الاسم", "اسم"])

        email = data.get("email") if isinstance(data, dict) else ""
        if not email:
            email = _extract_field_by_hint(fields, ["email", "البريد"])

        phone = data.get("phone") if isinstance(data, dict) else ""
        if not phone:
            phone = _extract_field_by_hint(fields, ["phone", "mobile", "جوال", "الهاتف"])

        user_id = ""
        if isinstance(data, dict):
            user_id = _clean_text(data.get("user_id") or data.get("taqeemUser"))
        if not user_id:
            user_id = _clean_text(
                _extract_field_by_hint(fields, ["id", "user", "رقم", "مستخدم", "الهوية"]) or ""
            )

        normalized_fields = {}
        for key, value in (fields or {}).items():
            clean_key = _repair_mojibake(_clean_text(key))
            clean_value = _repair_mojibake(_clean_text(value))
            if clean_key and clean_value:
                normalized_fields[clean_key] = clean_value

        profile = {
            "user_id": _repair_mojibake(user_id) if user_id else "",
            "taqeemUser": _repair_mojibake(user_id) if user_id else "",
            "fullName": _repair_mojibake(_clean_text(full_name)) or "",
            "email": _repair_mojibake(_clean_text(email)) or "",
            "phone": _repair_mojibake(_clean_text(phone)) or "",
            "fields": normalized_fields,
            "raw": data.get("raw") if isinstance(data, dict) else {},
        }

        return {"status": "SUCCESS", "data": profile}
    except Exception as exc:
        return {"status": "FAILED", "error": str(exc)}
