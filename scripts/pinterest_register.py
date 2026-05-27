"""
Pinterest Business Account Registration
BitBrowser (port 54345) + Playwright + IMAP
"""

import asyncio
import re
import time

import requests
from imap_tools import MailBox, AND
from playwright.async_api import async_playwright

# ── НАСТРОЙКИ ─────────────────────────────────────────────────────────────────

BITBROWSER_API = "http://127.0.0.1:54345"

# ID профиля из BitBrowser (откройте профиль → правая кнопка → "Копировать ID")
PROFILE_ID = "ВСТАВЬ_ID_ПРОФИЛЯ_ЗДЕСЬ"

# Данные для регистрации Pinterest
EMAIL           = "user@yourdomain.com"
PASSWORD        = "StrongPass123!"
BUSINESS_NAME   = "My Business"
BIRTH_DATE      = "01/01/1990"   # MM/DD/YYYY

# IMAP — почта на WordPress-сервере
IMAP_HOST = "mail.yourdomain.com"   # ← впиши свой хост
IMAP_PORT = 993
IMAP_USER = EMAIL
IMAP_PASS = "email_password_here"   # ← пароль от почты

# ──────────────────────────────────────────────────────────────────────────────


def start_profile(profile_id: str) -> str:
    """Запускает профиль BitBrowser, возвращает CDP WebSocket URL"""
    resp = requests.post(
        f"{BITBROWSER_API}/browser/open",
        json={"id": profile_id},
        timeout=30,
    )
    resp.raise_for_status()
    data = resp.json()

    if not data.get("success"):
        raise RuntimeError(f"BitBrowser: не удалось открыть профиль — {data}")

    ws_url = data["data"]["ws"]
    print(f"[BitBrowser] Профиль открыт: {ws_url[:60]}...")
    return ws_url


def stop_profile(profile_id: str):
    """Закрывает профиль BitBrowser"""
    try:
        requests.post(
            f"{BITBROWSER_API}/browser/close",
            json={"id": profile_id},
            timeout=10,
        )
        print("[BitBrowser] Профиль закрыт.")
    except Exception:
        pass


def wait_for_confirm_email(max_wait_sec: int = 180) -> str | None:
    """Ждёт письмо от Pinterest и возвращает ссылку подтверждения"""
    print(f"[IMAP] Ожидаю письмо от Pinterest (до {max_wait_sec} сек)...")
    deadline = time.time() + max_wait_sec

    while time.time() < deadline:
        try:
            with MailBox(IMAP_HOST, IMAP_PORT).login(IMAP_USER, IMAP_PASS) as mb:
                for msg in mb.fetch(AND(from_="pinterest.com", seen=False), mark_seen=True):
                    body = msg.html or msg.text or ""
                    # Ищем ссылку подтверждения
                    match = re.search(
                        r'https://[^\s"<>]*pinterest\.com[^\s"<>]*(confirm|verify|activate)[^\s"<>]*',
                        body,
                        re.IGNORECASE,
                    )
                    if match:
                        link = match.group(0).rstrip(".")
                        print(f"[IMAP] Ссылка найдена: {link[:80]}...")
                        return link
                    # Ищем 6-значный код (Pinterest иногда шлёт код вместо ссылки)
                    code_match = re.search(r'\b(\d{6})\b', body)
                    if code_match:
                        print(f"[IMAP] Найден код подтверждения: {code_match.group(1)}")
                        return f"CODE:{code_match.group(1)}"
        except Exception as e:
            print(f"[IMAP] Ошибка: {e}")

        print("  ...письмо ещё не пришло, жду 10 сек")
        time.sleep(10)

    print("[IMAP] Письмо не получено за отведённое время.")
    return None


async def register(ws_url: str):
    async with async_playwright() as pw:
        print("[Playwright] Подключаюсь к браузеру...")
        browser = await pw.chromium.connect_over_cdp(ws_url)
        ctx = browser.contexts[0] if browser.contexts else await browser.new_context()
        page = await ctx.new_page()

        # ── 1. Открываем страницу регистрации бизнес-аккаунта ─────────────────
        print("[Pinterest] Открываю страницу регистрации...")
        await page.goto("https://www.pinterest.com/business/create/", wait_until="domcontentloaded")
        await page.wait_for_timeout(3000)

        # ── 2. Email ───────────────────────────────────────────────────────────
        print("[Pinterest] Ввожу email...")
        email_input = page.locator('input[name="email"], input[type="email"], input[id="email"]').first
        await email_input.wait_for(state="visible", timeout=15000)
        await email_input.fill(EMAIL)
        await page.wait_for_timeout(800)

        # ── 3. Пароль ──────────────────────────────────────────────────────────
        print("[Pinterest] Ввожу пароль...")
        pass_input = page.locator('input[name="password"], input[type="password"]').first
        await pass_input.fill(PASSWORD)
        await page.wait_for_timeout(800)

        # ── 4. Дата рождения (если запросит) ──────────────────────────────────
        birth_input = page.locator('input[name="birthdate"], input[placeholder*="birth"], input[id*="birth"]').first
        if await birth_input.count() > 0:
            print("[Pinterest] Ввожу дату рождения...")
            await birth_input.fill(BIRTH_DATE)
            await page.wait_for_timeout(500)

        # ── 5. Нажимаем "Создать аккаунт" ─────────────────────────────────────
        print("[Pinterest] Нажимаю Submit...")
        submit_btn = page.locator('button[type="submit"]').first
        await submit_btn.click()

        # ── 6. CAPTCHA — решаем вручную ────────────────────────────────────────
        print()
        print("=" * 55)
        print("  ЕСЛИ ПОЯВИЛАСЬ CAPTCHA — РЕШИ ЕЁ ВРУЧНУЮ В БРАУЗЕРЕ")
        print("  У тебя есть 3 минуты.")
        print("=" * 55)
        print()
        await page.wait_for_timeout(180_000)  # 3 мин на ручное решение

        # ── 7. Подтверждение email ─────────────────────────────────────────────
        result = wait_for_confirm_email()

        if result and result.startswith("CODE:"):
            code = result.replace("CODE:", "")
            print(f"[Pinterest] Ввожу код подтверждения: {code}")
            code_input = page.locator('input[name="code"], input[autocomplete="one-time-code"], input[maxlength="6"]').first
            await code_input.fill(code)
            await page.locator('button[type="submit"]').first.click()
            await page.wait_for_timeout(3000)

        elif result:
            print("[Pinterest] Перехожу по ссылке подтверждения...")
            await page.goto(result, wait_until="domcontentloaded")
            await page.wait_for_timeout(3000)

        else:
            print("[!] Письмо не пришло — проверь IMAP-настройки.")
            await browser.close()
            return

        # ── 8. Настройка бизнес-профиля ───────────────────────────────────────
        print("[Pinterest] Настраиваю бизнес-профиль...")
        biz_input = page.locator(
            'input[name="businessName"], input[placeholder*="usiness"], input[id*="businessName"]'
        ).first
        if await biz_input.count() > 0:
            await biz_input.fill(BUSINESS_NAME)
            await page.wait_for_timeout(500)
            await page.locator('button[type="submit"]').first.click()
            await page.wait_for_timeout(3000)

        print()
        print("✅ Регистрация завершена! Аккаунт:", EMAIL)
        await page.wait_for_timeout(5000)
        await browser.close()


def main():
    print(f"Регистрируем Pinterest бизнес-аккаунт: {EMAIL}")
    print(f"BitBrowser API: {BITBROWSER_API}")
    print()

    ws_url = start_profile(PROFILE_ID)
    try:
        asyncio.run(register(ws_url))
    finally:
        stop_profile(PROFILE_ID)


if __name__ == "__main__":
    main()
