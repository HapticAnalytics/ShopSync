from pydantic import BaseModel, field_validator
from typing import Optional, Literal
from datetime import datetime

VALID_STATUSES = {
    "checked_in", "inspection", "waiting_parts", "in_progress",
    "awaiting_warranty", "quality_check", "ready", "completed"
}

VALID_SENDER_TYPES = {"customer", "advisor"}

ALLOWED_MIME_TYPES = {
    "image/jpeg", "image/png", "image/webp", "image/gif",
    "video/mp4", "video/quicktime", "video/webm", "video/x-msvideo",
}

MAX_UPLOAD_BYTES = 50 * 1024 * 1024  # 50 MB


class VehicleCreate(BaseModel):
    customer_name: str
    customer_phone: str
    customer_email: Optional[str] = None
    make: Optional[str] = None
    model: Optional[str] = None
    year: Optional[int] = None
    vin: Optional[str] = None
    license_plate: Optional[str] = None
    estimated_completion: Optional[str] = None

    @field_validator("customer_phone")
    @classmethod
    def phone_not_empty(cls, v):
        v = v.strip()
        if not v:
            raise ValueError("customer_phone cannot be empty")
        return v

    @field_validator("year")
    @classmethod
    def year_sane(cls, v):
        if v is not None and not (1900 <= v <= 2100):
            raise ValueError("year must be between 1900 and 2100")
        return v


class StatusUpdate(BaseModel):
    new_status: str
    message: Optional[str] = None

    @field_validator("new_status")
    @classmethod
    def status_must_be_valid(cls, v):
        if v not in VALID_STATUSES:
            raise ValueError(f"new_status must be one of: {', '.join(sorted(VALID_STATUSES))}")
        return v


class MessageCreate(BaseModel):
    message_text: str
    sender_type: str

    @field_validator("sender_type")
    @classmethod
    def sender_type_must_be_valid(cls, v):
        if v not in VALID_SENDER_TYPES:
            raise ValueError("sender_type must be 'customer' or 'advisor'")
        return v

    @field_validator("message_text")
    @classmethod
    def message_not_empty(cls, v):
        if not v.strip():
            raise ValueError("message_text cannot be empty")
        return v


class ApprovalCreate(BaseModel):
    description: str
    cost: float

    @field_validator("cost")
    @classmethod
    def cost_non_negative(cls, v):
        if v < 0:
            raise ValueError("cost cannot be negative")
        return v

    @field_validator("description")
    @classmethod
    def description_not_empty(cls, v):
        if not v.strip():
            raise ValueError("description cannot be empty")
        return v


class ApprovalResponse(BaseModel):
    approved: bool


class VehicleResponse(BaseModel):
    vehicle_id: str
    customer_name: str
    customer_phone: str
    make: Optional[str]
    model: Optional[str]
    year: Optional[int]
    status: str
    estimated_completion: Optional[datetime]
    unique_link: str
    checked_in_at: datetime


class StatusResponse(BaseModel):
    success: bool
    message: str
