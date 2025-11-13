from pydantic import BaseModel
from typing import Optional
from datetime import datetime

# Request schemas (what clients send to API)
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

class StatusUpdate(BaseModel):
    new_status: str
    message: Optional[str] = None

class MessageCreate(BaseModel):
    message_text: str
    sender_type: str  # 'customer' or 'advisor'

class ApprovalCreate(BaseModel):
    description: str
    cost: float

class ApprovalResponse(BaseModel):
    approved: bool

# Response schemas (what API sends back to clients)
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