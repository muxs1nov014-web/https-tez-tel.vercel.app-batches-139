"""Telegram customer buttons (SPEC §12.6): read-only menus, no Gemini involved.

Reply button "👥 Mijozlar" / `/mijozlar` → inline list of active customers (`c:<id>`) → sections
(`c:<id>:<section>`, back = `c:list`). Messages are edited in place. Every callback re-checks the whitelist.
This router is included in the dispatcher before the free-text AI router, so the button text never reaches Gemini.
"""

import logging
from contextlib import asynccontextmanager
from typing import NamedTuple

from aiogram import F, Router
from aiogram.exceptions import TelegramBadRequest
from aiogram.filters import Command
from aiogram.types import (
    CallbackQuery,
    InlineKeyboardButton,
    InlineKeyboardMarkup,
    KeyboardButton,
    Message,
    ReplyKeyboardMarkup,
    WebAppInfo,
)
from sqlalchemy import text as sql_text
from sqlalchemy.ext.asyncio import AsyncSession

from app.bot import customer_texts as texts
from app.bot.webapp import current_webapp_url
from app.core.db import SessionLocal
from app.core.errors import NotFound
from app.schemas import PaymentOut
from app.services import catalog, consignment
from app.services import customer_accounts as accounts
from app.services.users import is_bot_user_allowed

log = logging.getLogger(__name__)
router = Router(name="customers")

CUSTOMERS_BUTTON = "👥 Mijozlar"
LIST_CALLBACK = "c:list"
SECTIONS: dict[str, str] = {
    "debt": "💰 Nasiya",
    "stock": "📦 Qoldiq",
    "sales": "🧾 Savdolar",
    "payments": "💵 To'lovlar",
    "summary": "📋 Umumiy",
}
PANEL_BUTTON = "📱 Panel"


def main_keyboard(panel_url: str | None = None) -> ReplyKeyboardMarkup:
    """Persistent reply keyboard: "👥 Mijozlar", plus "📱 Panel" (opens the admin panel as a Mini App) when a
    Mini App URL is available. Telegram passes no initData to keyboard-button Mini Apps, so the panel asks for
    login and password once and then remembers the session."""
    row = [KeyboardButton(text=CUSTOMERS_BUTTON)]
    if panel_url:
        row.append(KeyboardButton(text=PANEL_BUTTON, web_app=WebAppInfo(url=panel_url)))
    return ReplyKeyboardMarkup(keyboard=[row], resize_keyboard=True, is_persistent=True)


MAIN_KEYBOARD = main_keyboard()


class CallbackTarget(NamedTuple):
    customer_id: int | None  # None = the customer list
    section: str | None  # None = the customer's section menu


def parse_callback(data: str | None) -> CallbackTarget | None:
    """`c:list` | `c:<id>` | `c:<id>:<section>`; anything else is None."""
    parts = (data or "").split(":")
    if parts == ["c", "list"]:
        return CallbackTarget(None, None)
    if len(parts) in (2, 3) and parts[0] == "c" and parts[1].isdigit():
        section = parts[2] if len(parts) == 3 else None
        if section is None or section in SECTIONS:
            return CallbackTarget(int(parts[1]), section)
    return None


def _rows(buttons: list[InlineKeyboardButton], per_row: int = 2) -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(inline_keyboard=[buttons[i:i + per_row] for i in range(0, len(buttons), per_row)])


def customers_keyboard(customers: list[tuple[int, str]]) -> InlineKeyboardMarkup | None:
    if not customers:
        return None
    return _rows([InlineKeyboardButton(text=name, callback_data=f"c:{cid}") for cid, name in customers])


def sections_keyboard(customer_id: int) -> InlineKeyboardMarkup:
    buttons = [InlineKeyboardButton(text=label, callback_data=f"c:{customer_id}:{code}")
               for code, label in SECTIONS.items()]
    buttons.append(InlineKeyboardButton(text="⬅️ Mijozlar", callback_data=LIST_CALLBACK))
    return _rows(buttons)


# ---- rendering (session in, text out; the same services as the API) ----
async def customer_list(session: AsyncSession) -> tuple[str, InlineKeyboardMarkup | None]:
    customers = await accounts.active_customers(session)
    return texts.customer_list_text(len(customers)), customers_keyboard([(c.id, c.name) for c in customers])


async def render_section(session: AsyncSession, customer_id: int, section: str | None) -> str:
    """Text of the customer's menu (section=None) or of one section. NotFound if the customer does not exist."""
    if section in ("stock", "sales"):
        name = (await catalog.get_customer(session, customer_id)).name
        if section == "stock":
            return texts.stock_text(name, await consignment.customer_stock_rows(session, customer_id))
        recent = await accounts.list_customer_sales(session, customer_id, limit=texts.RECENT)
        return texts.sales_text(name, await accounts.sales_stats(session, customer_id), recent)
    overview = await accounts.overview(session, customer_id)
    if section == "debt":
        return texts.debt_text(overview)
    if section == "payments":
        payments = [PaymentOut.model_validate(p) for p in await accounts.list_payments(session, customer_id)]
        return texts.payments_text(overview, payments)
    if section == "summary":
        return texts.summary_text(overview, await accounts.sales_stats(session, customer_id))
    return texts.menu_text(overview)


async def render(session: AsyncSession, target: CallbackTarget) -> tuple[str, InlineKeyboardMarkup | None]:
    if target.customer_id is None:
        return await customer_list(session)
    try:
        text = await render_section(session, target.customer_id, target.section)
    except NotFound:
        text, keyboard = await customer_list(session)
        return f"Mijoz topilmadi.\n{text}", keyboard
    return text, sections_keyboard(target.customer_id)


# ---- handlers ----
@asynccontextmanager
async def _read_only_session():
    async with SessionLocal() as session:
        await session.execute(sql_text("SET TRANSACTION READ ONLY"))  # defence in depth: this menu never writes
        yield session


def _denied(telegram_id: int) -> str:
    return f"Sizga ruxsat yo'q. Administratorga Telegram ID raqamingizni yuboring: {telegram_id}"


async def show_customer_list(message: Message, with_menu_keyboard: bool = False) -> None:
    async with _read_only_session() as session:  # DB work only; Telegram calls happen after it is released
        allowed = await is_bot_user_allowed(session, message.from_user.id)
        listing = await customer_list(session) if allowed else None
    if listing is None:
        await message.answer(_denied(message.from_user.id))
        return
    text, keyboard = listing
    if with_menu_keyboard:
        await message.answer(f"Mijozlar menyusi pastdagi «{CUSTOMERS_BUTTON}» tugmasida.",
                             reply_markup=main_keyboard(await current_webapp_url()))
    await message.answer(text, reply_markup=keyboard)


@router.message(Command("mijozlar"))
async def on_customers_command(message: Message) -> None:
    await show_customer_list(message, with_menu_keyboard=True)


@router.message(F.text == CUSTOMERS_BUTTON)
async def on_customers_button(message: Message) -> None:
    await show_customer_list(message)


async def _show(callback: CallbackQuery, text: str, keyboard: InlineKeyboardMarkup | None) -> None:
    if isinstance(callback.message, Message):
        try:
            await callback.message.edit_text(text, reply_markup=keyboard)
            return
        except TelegramBadRequest as exc:
            if "message is not modified" in str(exc):
                return
            log.warning("customer menu: cannot edit message (%s), sending a new one", exc)
    # The message is too old to edit (or the edit failed): send the content as a new message.
    await callback.bot.send_message(callback.from_user.id, text, reply_markup=keyboard)


@router.callback_query(F.data.startswith("c:"))
async def on_customer_callback(callback: CallbackQuery) -> None:
    target = parse_callback(callback.data)
    if target is None:
        await callback.answer()
        return
    try:
        async with _read_only_session() as session:  # re-checked on every callback: access may have been revoked
            allowed = await is_bot_user_allowed(session, callback.from_user.id)
            rendered = await render(session, target) if allowed else None
    except Exception:
        log.exception("customer menu failed for %s", callback.data)
        await callback.answer("Xatolik yuz berdi, keyinroq qayta urinib ko'ring.", show_alert=True)
        return
    if rendered is None:
        await callback.answer("Sizga ruxsat yo'q", show_alert=True)
        return
    await _show(callback, *rendered)
    await callback.answer()
