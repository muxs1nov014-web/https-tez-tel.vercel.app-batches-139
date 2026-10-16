class AppError(Exception):
    status_code = 400

    def __init__(self, detail: str):
        super().__init__(detail)
        self.detail = detail


class NotFound(AppError):
    status_code = 404


class Conflict(AppError):
    status_code = 409


class ValidationFailed(AppError):
    status_code = 422


class Forbidden(AppError):
    status_code = 403


class TooManyRequests(AppError):
    status_code = 429
