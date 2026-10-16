"""Gemini assistant: question (text or voice) -> read-only tool calls -> short Uzbek answer."""

import asyncio
import json
import logging
from datetime import datetime
from zoneinfo import ZoneInfo

from google import genai
from sqlalchemy import text as sql_text
from google.genai import types

from app.core.config import get_settings
from app.core.db import SessionLocal
from app.services import analytics

log = logging.getLogger(__name__)
MAX_TOOL_ROUNDS = 4
TOTAL_TIMEOUT_SECONDS = 45

_DATE = {"type": "string", "description": "ISO date YYYY-MM-DD"}
_PRODUCT = {"type": "string", "description": "Product words as the user said them, e.g. '17 pro max 256 silver', "
                                             "'18 pro max', 's25 ultra'. Omit for all products."}
FUNCTIONS = [
    {"name": "stock_summary",
     "description": "Current stock (qoldiq) in OUR warehouse per product: quantity, average landed unit cost, "
                    "value, by batch. Excludes units handed over to customers on consignment (those are shown "
                    "by the bot's 'Mijozlar' button, not by this tool).",
     "parameters": {"type": "object", "properties": {"product_query": _PRODUCT}}},
    {"name": "sales_summary",
     "description": "Wholesale sales in a period: quantity sold, revenue, cost, profit per product. "
                    "Use for 'nechta sotildi', 'qancha foyda'.",
     "parameters": {"type": "object", "properties": {
         "date_from": _DATE, "date_to": _DATE, "product_query": _PRODUCT,
         "customer_query": {"type": "string", "description": "Dealer/customer name fragment"}}}},
    {"name": "purchases_summary",
     "description": "Purchases in Dubai in a period: quantity, total AED, total USD, average landed unit cost.",
     "parameters": {"type": "object", "properties": {"date_from": _DATE, "date_to": _DATE,
                                                     "product_query": _PRODUCT}}},
    {"name": "unit_cost_breakdown",
     "description": "Landed unit cost (tannarx) of a product in its latest batches (or a given batch date), with "
                    "per-unit costs by category: rastamojka, perevod, IMEI, cargo, certificate, customs etc. "
                    "'overhead_per_unit_usd' is how much customs+costs fall on one phone.",
     "parameters": {"type": "object", "properties": {"product_query": _PRODUCT, "batch_date": _DATE},
                    "required": ["product_query"]}},
    {"name": "batch_summary",
     "description": "One batch (partiya = purchase date): lines, unit costs, estimated vs actual expenses.",
     "parameters": {"type": "object", "properties": {"batch_date": _DATE}, "required": ["batch_date"]}},
    {"name": "top_products",
     "description": "Best-selling products in a period by quantity or profit.",
     "parameters": {"type": "object", "properties": {
         "date_from": _DATE, "date_to": _DATE,
         "metric": {"type": "string", "enum": ["qty", "profit"]},
         "limit": {"type": "integer"}}}},
]

SYSTEM_PROMPT = """You are the internal assistant of a phone import business. Phones (iPhone, Samsung, ...) are \
bought in Dubai in AED, flown to Uzbekistan, cleared through customs, and sold wholesale in USD.
Terms: partiya = batch = all purchases of one date; tannarx = landed unit cost in USD; rastamojka = customs duty; \
"bitta telefonga qancha rastamojka/xarajat tushdi" = overhead_per_unit_usd; qoldiq = stock; sotuv = sales.

Rules:
- Today is {today} (Asia/Tashkent). Resolve "bugun", "kecha", "shu oy", "o'tgan oy", "shu hafta" to exact dates.
- ALWAYS get numbers from the tools. Never invent or estimate numbers yourself.
- If a product matches several items, show them all (briefly) or ask which one.
- If a tool returns an error, explain it simply and suggest how to rephrase.
- Answer in Uzbek (Latin script), short and concrete, even if the question is in Russian or Cyrillic.
- Plain text for Telegram: no markdown, no asterisks, no tables. Use short lines; money like 1 234.56 $.
- You are read-only: you cannot add or change data. For data entry, point to the admin panel.
- If the voice message is unclear, say what you heard and ask to repeat."""


class Assistant:
    def __init__(self) -> None:
        settings = get_settings()
        self.model = settings.gemini_model
        self.timeout = settings.gemini_timeout_seconds
        self.tz = ZoneInfo(settings.tz_name)
        self.client = genai.Client(api_key=settings.gemini_api_key)
        self.tool = types.Tool(function_declarations=[
            types.FunctionDeclaration(name=f["name"], description=f["description"],
                                      parameters_json_schema=f["parameters"]) for f in FUNCTIONS
        ])

    def _config(self) -> types.GenerateContentConfig:
        today = datetime.now(self.tz).strftime("%Y-%m-%d (%A)")
        return types.GenerateContentConfig(
            system_instruction=SYSTEM_PROMPT.format(today=today),
            tools=[self.tool],
            automatic_function_calling=types.AutomaticFunctionCallingConfig(disable=True),
            temperature=0.2,
        )

    async def _call_tool(self, name: str, args: dict) -> dict:
        func = analytics.TOOLS.get(name)
        if func is None:
            return {"error": f"unknown tool {name}"}
        try:
            async with SessionLocal() as session:
                await session.execute(sql_text("SET TRANSACTION READ ONLY"))  # defence in depth: tools never write
                return await func(session, **args)
        except TypeError as exc:
            return {"error": f"bad arguments: {exc}"}
        except Exception:
            log.exception("tool %s failed", name)
            return {"error": "internal_error"}

    async def answer(self, text: str | None = None, audio: bytes | None = None,
                     audio_mime: str = "audio/ogg") -> str:
        async with asyncio.timeout(TOTAL_TIMEOUT_SECONDS):
            return await self._answer(text, audio, audio_mime)

    async def _answer(self, text: str | None, audio: bytes | None, audio_mime: str) -> str:
        parts: list[types.Part] = []
        if audio is not None:
            parts.append(types.Part.from_bytes(data=audio, mime_type=audio_mime))
            parts.append(types.Part.from_text(text="(Ovozli xabar. Savolni tushunib, javob ber.)"))
        if text:
            parts.append(types.Part.from_text(text=text))
        contents: list[types.Content] = [types.Content(role="user", parts=parts)]
        config = self._config()

        for _ in range(MAX_TOOL_ROUNDS + 1):
            response = await asyncio.wait_for(
                self.client.aio.models.generate_content(model=self.model, contents=contents, config=config),
                timeout=self.timeout,
            )
            calls = response.function_calls or []
            if not calls:
                return (response.text or "").strip() or "Javob topilmadi, savolni boshqacha yozib ko'ring."
            # Keep the model turn as-is (it carries thought signatures required by Gemini 3).
            contents.append(response.candidates[0].content)
            results = await asyncio.gather(*(self._call_tool(c.name, dict(c.args or {})) for c in calls))
            for call, result in zip(calls, results, strict=True):
                log.info("tool %s %s -> %s", call.name, json.dumps(dict(call.args or {}), ensure_ascii=False),
                         "error" if "error" in result else "ok")
            contents.append(types.Content(role="user", parts=[
                types.Part.from_function_response(name=c.name, response={"result": r})
                for c, r in zip(calls, results, strict=True)
            ]))
        return "Savol juda murakkab bo'lib chiqdi, iltimos, soddaroq qilib so'rang."
