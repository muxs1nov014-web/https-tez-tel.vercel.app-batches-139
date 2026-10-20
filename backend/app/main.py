from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from app.api.routers import auth, batches, catalog, customer_accounts, nasiya, reports, stock_sales, telegram
from app.core.config import get_settings
from app.core.errors import AppError

get_settings().check_production()
app = FastAPI(title="Telefon import nazorati", version="0.1.0")


@app.exception_handler(AppError)
async def app_error_handler(_: Request, exc: AppError) -> JSONResponse:
    return JSONResponse(status_code=exc.status_code, content={"detail": exc.detail})


@app.exception_handler(RequestValidationError)
async def validation_error_handler(_: Request, exc: RequestValidationError) -> JSONResponse:
    parts = []
    for err in exc.errors():
        field = ".".join(str(p) for p in err.get("loc", ()) if p not in ("body", "query", "path"))
        parts.append(f"{field}: {err.get('msg')}" if field else str(err.get("msg")))
    return JSONResponse(status_code=422, content={"detail": "; ".join(parts) or "Noto'g'ri ma'lumot"})


@app.get("/api/health")
async def health() -> dict:
    return {"status": "ok"}


for module in (auth, catalog, customer_accounts, batches, stock_sales, reports, telegram, nasiya):
    app.include_router(module.router, prefix="/api")
