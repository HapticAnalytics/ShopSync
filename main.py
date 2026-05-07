import logging
import os
import uuid
from datetime import datetime, date as date_type, timedelta
from typing import Optional
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

import requests
from dotenv import load_dotenv
from fastapi import Depends, FastAPI, HTTPException, Security, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from twilio.rest import Client

from auth import get_current_user, require_admin, bearer_scheme
from database import get_supabase_client, get_admin_client
from schemas import (
    VehicleCreate, VehicleResponse, StatusUpdate, MessageCreate,
    ApprovalCreate, ApprovalResponse, ShopCreate, UserInvite, UserUpdate,
    AppointmentCreate, AppointmentStatusUpdate, AdvisorAppointmentCreate,
    ShopHourEntry, BlockDateCreate, AIChatMessage,
    ALLOWED_MIME_TYPES, MAX_UPLOAD_BYTES,
)

load_dotenv()

# ── Anthropic (optional) ─────────────────────────────────────────────────────
try:
    import anthropic as _anthropic
    _anthropic_key = os.getenv("ANTHROPIC_API_KEY", "")
    anthropic_client = _anthropic.Anthropic(api_key=_anthropic_key) if _anthropic_key else None
except ImportError:
    anthropic_client = None

# ── Logging ──────────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format='{"time":"%(asctime)s","level":"%(levelname)s","logger":"%(name)s","message":"%(message)s"}',
    datefmt="%Y-%m-%dT%H:%M:%S",
)
logger = logging.getLogger("shopsync")

# ── Config ────────────────────────────────────────────────────────────────────
PORTAL_URL = os.getenv("PORTAL_URL", "").rstrip("/")
SHOP_NAME = os.getenv("SHOP_NAME", "Summit Trucks")
GOOGLE_REVIEW_URL = os.getenv("GOOGLE_REVIEW_URL", "")
UNSPLASH_ACCESS_KEY = os.getenv("UNSPLASH_ACCESS_KEY")

_raw_origins = os.getenv("ALLOWED_ORIGINS", "")
ALLOWED_ORIGINS = [o.strip() for o in _raw_origins.split(",") if o.strip()] or ["*"]

# ── App ───────────────────────────────────────────────────────────────────────
app = FastAPI(title="ShopSync API", version="2.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Clients ───────────────────────────────────────────────────────────────────
supabase = get_supabase_client()

TWILIO_ACCOUNT_SID = os.getenv("TWILIO_ACCOUNT_SID")
TWILIO_AUTH_TOKEN = os.getenv("TWILIO_AUTH_TOKEN")
TWILIO_PHONE = os.getenv("TWILIO_PHONE_NUMBER")
TWILIO_MESSAGING_SERVICE_SID = os.getenv("TWILIO_MESSAGING_SERVICE_SID")

if TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN:
    twilio_client = Client(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN)
else:
    twilio_client = None
    logger.warning("Twilio credentials not configured — SMS disabled")


# ── Helpers ───────────────────────────────────────────────────────────────────

def send_sms(to_phone: str, message: str) -> bool:
    if not twilio_client:
        return False
    try:
        kwargs = {"body": message, "to": to_phone}
        if TWILIO_MESSAGING_SERVICE_SID:
            kwargs["messaging_service_sid"] = TWILIO_MESSAGING_SERVICE_SID
        else:
            kwargs["from_"] = TWILIO_PHONE
        msg = twilio_client.messages.create(**kwargs)
        logger.info(f"SMS sent sid={msg.sid} to={to_phone}")
        return True
    except Exception as e:
        logger.error(f"SMS failed to={to_phone} error={e}")
        return False


def _shop_sms_name(shop_id: str) -> str:
    try:
        resp = supabase.table("shops").select("name").eq("shop_id", shop_id).execute()
        if resp.data:
            return resp.data[0]["name"]
    except Exception:
        pass
    return SHOP_NAME


def _verify_vehicle_access(vehicle_id: str, user: dict) -> dict:
    resp = supabase.table("vehicles").select("*").eq("vehicle_id", vehicle_id).execute()
    if not resp.data:
        raise HTTPException(status_code=404, detail="Vehicle not found")
    vehicle = resp.data[0]
    if user["role"] != "admin" and vehicle.get("shop_id") != user.get("shop_id"):
        raise HTTPException(status_code=403, detail="Access denied to this vehicle")
    return vehicle


def _get_tz(tz_str: str) -> ZoneInfo:
    try:
        return ZoneInfo(tz_str)
    except (ZoneInfoNotFoundError, KeyError):
        return ZoneInfo("America/Denver")


def _parse_dt(dt_str: str, tz: ZoneInfo) -> datetime | None:
    if not dt_str:
        return None
    try:
        if dt_str.endswith("Z"):
            dt_str = dt_str[:-1] + "+00:00"
        dt = datetime.fromisoformat(dt_str)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=ZoneInfo("UTC"))
        return dt.astimezone(tz).replace(second=0, microsecond=0)
    except Exception:
        return None


def _generate_slots(
    open_time_str: str,
    close_time_str: str,
    duration_min: int,
    date_obj: date_type,
    tz: ZoneInfo,
    existing: list,
    max_concurrent: int,
) -> list:
    open_h, open_m = map(int, open_time_str[:5].split(":"))
    close_h, close_m = map(int, close_time_str[:5].split(":"))

    now = datetime.now(tz)
    current = datetime(date_obj.year, date_obj.month, date_obj.day, open_h, open_m, tzinfo=tz)
    close_dt = datetime(date_obj.year, date_obj.month, date_obj.day, close_h, close_m, tzinfo=tz)

    slots = []
    while current + timedelta(minutes=duration_min) <= close_dt:
        if current > now:
            booked = sum(
                1 for apt in existing
                if apt["slot_dt"] == current and apt["status"] not in ("cancelled",)
            )
            slots.append({
                "time": current.strftime("%I:%M %p").lstrip("0"),
                "datetime": current.isoformat(),
                "available": booked < max_concurrent,
            })
        current += timedelta(minutes=duration_min)
    return slots


# ── Health ────────────────────────────────────────────────────────────────────

@app.get("/health")
async def health_check():
    db_ok = False
    try:
        supabase.table("vehicles").select("vehicle_id").limit(1).execute()
        db_ok = True
    except Exception as e:
        logger.error(f"Health DB error: {e}")

    return {
        "status": "ok" if db_ok else "degraded",
        "database": "ok" if db_ok else "error",
        "twilio": "configured" if twilio_client else "not_configured",
        "portal_url": PORTAL_URL or "NOT SET",
        "admin_client": "configured" if get_admin_client() else "not_configured",
    }


@app.get("/")
async def root():
    return {"message": "ShopSync API is running", "version": "2.0.0"}


# ── Me ────────────────────────────────────────────────────────────────────────

@app.get("/me")
async def get_me(user: dict = Depends(get_current_user)):
    return user


# ── Shop endpoints (public branding) ─────────────────────────────────────────

@app.get("/shop/{shop_id}")
async def get_shop(shop_id: str):
    try:
        resp = supabase.table("shops").select("*").eq("shop_id", shop_id).execute()
        if resp.data:
            return resp.data[0]
    except Exception:
        pass
    return {"shop_id": shop_id, "name": SHOP_NAME, "google_review_url": GOOGLE_REVIEW_URL}


# ── Shop endpoints (auth required) ────────────────────────────────────────────

@app.get("/shop/{shop_id}/vehicles")
async def get_shop_vehicles(shop_id: str, user: dict = Depends(get_current_user)):
    if user["role"] != "admin" and user.get("shop_id") != shop_id:
        raise HTTPException(status_code=403, detail="Access denied to this shop's data")
    try:
        resp = supabase.table("vehicles").select("*").eq("shop_id", shop_id).execute()
        return resp.data
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"get_shop_vehicles error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/shop/{shop_id}/dashboard-summary")
async def get_dashboard_summary(shop_id: str, user: dict = Depends(get_current_user)):
    if user["role"] != "admin" and user.get("shop_id") != shop_id:
        raise HTTPException(status_code=403, detail="Access denied to this shop's data")
    try:
        vehicles_resp = (
            supabase.table("vehicles")
            .select("*")
            .eq("shop_id", shop_id)
            .neq("status", "completed")
            .execute()
        )
        vehicles = vehicles_resp.data

        if not vehicles:
            return {"vehicles": [], "message_counts": {}, "approvals": {}, "photos": {}}

        vehicle_ids = [v["vehicle_id"] for v in vehicles]

        messages_resp = supabase.table("messages").select("vehicle_id,sender_type").in_("vehicle_id", vehicle_ids).execute()
        approvals_resp = supabase.table("approvals").select("*").in_("vehicle_id", vehicle_ids).execute()
        photos_resp = (
            supabase.table("media")
            .select("vehicle_id,media_url,caption")
            .in_("vehicle_id", vehicle_ids)
            .eq("caption", "vehicle_photo")
            .execute()
        )

        message_counts: dict = {}
        for msg in messages_resp.data:
            if msg["sender_type"] == "customer":
                vid = msg["vehicle_id"]
                message_counts[vid] = message_counts.get(vid, 0) + 1

        approvals_by_vehicle: dict = {}
        for approval in approvals_resp.data:
            vid = approval["vehicle_id"]
            approvals_by_vehicle.setdefault(vid, []).append(approval)

        photos: dict = {p["vehicle_id"]: p["media_url"] for p in photos_resp.data}

        return {
            "vehicles": vehicles,
            "message_counts": message_counts,
            "approvals": approvals_by_vehicle,
            "photos": photos,
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"get_dashboard_summary error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ── Admin endpoints ────────────────────────────────────────────────────────────

@app.post("/admin/shops")
async def admin_create_shop(shop: ShopCreate, admin: dict = Depends(require_admin)):
    try:
        resp = supabase.table("shops").insert({
            "name": shop.name,
            "phone": shop.phone,
            "address": shop.address,
            "google_review_url": shop.google_review_url,
            "timezone": shop.timezone,
        }).execute()
        return resp.data[0]
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"admin_create_shop error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/admin/shops")
async def admin_list_shops(admin: dict = Depends(require_admin)):
    try:
        resp = supabase.table("shops").select("*").order("created_at").execute()
        return resp.data
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"admin_list_shops error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/admin/users/invite")
async def admin_invite_user(invite: UserInvite, admin: dict = Depends(require_admin)):
    supabase_admin = get_admin_client()
    if not supabase_admin:
        raise HTTPException(
            status_code=501,
            detail="User invite requires SUPABASE_SERVICE_ROLE_KEY to be configured.",
        )
    try:
        res = supabase_admin.auth.admin.invite_user_by_email(
            invite.email,
            options={"redirect_to": f"{PORTAL_URL}/accept-invite"},
        )
        user_id = str(res.user.id)

        supabase.table("users").insert({
            "user_id": user_id,
            "email": invite.email,
            "full_name": invite.full_name,
            "role": invite.role,
            "shop_id": invite.shop_id or None,
        }).execute()

        logger.info(f"Invited user {invite.email} as {invite.role}")
        return {"success": True, "user_id": user_id, "email": invite.email}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"admin_invite_user error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/admin/users")
async def admin_list_users(admin: dict = Depends(require_admin)):
    try:
        resp = supabase.table("users").select("*").order("created_at").execute()
        return resp.data
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"admin_list_users error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.patch("/admin/users/{user_id}")
async def admin_update_user(user_id: str, update: UserUpdate, admin: dict = Depends(require_admin)):
    try:
        patch = {k: v for k, v in update.model_dump(exclude_unset=True).items()}
        if not patch:
            raise HTTPException(status_code=400, detail="No fields to update")
        resp = supabase.table("users").update(patch).eq("user_id", user_id).execute()
        if not resp.data:
            raise HTTPException(status_code=404, detail="User not found")
        return resp.data[0]
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"admin_update_user error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ── Vehicle endpoints ──────────────────────────────────────────────────────────

@app.post("/vehicles/", response_model=VehicleResponse)
async def create_vehicle(vehicle: VehicleCreate, user: dict = Depends(get_current_user)):
    shop_id = user.get("shop_id")
    if not shop_id:
        raise HTTPException(status_code=400, detail="Your account is not assigned to a shop.")
    try:
        unique_link = str(uuid.uuid4())

        resp = supabase.table("vehicles").insert({
            "shop_id": shop_id,
            "customer_name": vehicle.customer_name,
            "customer_phone": vehicle.customer_phone,
            "customer_email": vehicle.customer_email,
            "make": vehicle.make,
            "model": vehicle.model,
            "year": vehicle.year,
            "vin": vehicle.vin,
            "license_plate": vehicle.license_plate,
            "unique_link": unique_link,
            "status": "checked_in",
            "estimated_completion": vehicle.estimated_completion,
        }).execute()

        if not resp.data:
            raise HTTPException(status_code=400, detail="Failed to create vehicle")

        vehicle_data = resp.data[0]

        if PORTAL_URL:
            tracking_url = f"{PORTAL_URL}/track/{unique_link}"
            shop_name = _shop_sms_name(shop_id)
            send_sms(
                vehicle.customer_phone,
                f"Hi {vehicle.customer_name}! Your vehicle is checked in at {shop_name}. "
                f"Track its status here: {tracking_url}",
            )

        return VehicleResponse(**vehicle_data)

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"create_vehicle error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/vehicles/{unique_link}")
async def get_vehicle_by_link(unique_link: str):
    try:
        resp = supabase.table("vehicles").select("*").eq("unique_link", unique_link).execute()
        if not resp.data:
            raise HTTPException(status_code=404, detail="Vehicle not found")
        return resp.data[0]
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"get_vehicle_by_link error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.patch("/vehicles/{vehicle_id}/status")
async def update_vehicle_status(
    vehicle_id: str,
    status_update: StatusUpdate,
    user: dict = Depends(get_current_user),
):
    try:
        current_vehicle = _verify_vehicle_access(vehicle_id, user)
        old_status = current_vehicle["status"]

        supabase.table("vehicles").update({"status": status_update.new_status}).eq("vehicle_id", vehicle_id).execute()

        try:
            supabase.table("updates").insert({
                "vehicle_id": vehicle_id,
                "user_id": user["user_id"],
                "old_status": old_status,
                "new_status": status_update.new_status,
                "message": status_update.message,
            }).execute()
        except Exception as err:
            logger.warning(f"Non-critical: failed to insert status update record: {err}")

        if status_update.new_status == "completed":
            return {"success": True, "message": "Vehicle archived"}

        customer_phone = current_vehicle.get("customer_phone")
        customer_name = current_vehicle.get("customer_name", "Customer")
        shop_id = current_vehicle.get("shop_id", "")

        if customer_phone:
            shop_name = _shop_sms_name(shop_id)
            first_name = customer_name.split()[0] if customer_name else "there"
            v_year = current_vehicle.get("year", "")
            v_make = current_vehicle.get("make", "")
            v_model = current_vehicle.get("model", "")
            vehicle_str = " ".join(str(p) for p in [v_year, v_make, v_model] if p)

            if status_update.new_status == "ready":
                shop_resp = supabase.table("shops").select("google_review_url").eq("shop_id", shop_id).execute()
                review_url = (shop_resp.data[0].get("google_review_url") or "") if shop_resp.data else ""
                sms_body = f"Great news {first_name}! Your vehicle is ready for pickup at {shop_name}."
                if vehicle_str:
                    sms_body += f" Thank you for trusting us with your {vehicle_str}."
                if review_url:
                    sms_body += f" If you have a moment, please leave us a review: {review_url}"
            else:
                status_messages = {
                    "checked_in": f"Hi {first_name}! Your vehicle has been checked in at {shop_name}.",
                    "inspection": "Update: Your vehicle is now being inspected.",
                    "waiting_parts": "Update: Your vehicle is awaiting parts. We'll notify you when work resumes.",
                    "in_progress": "Update: Your vehicle service is now in progress.",
                    "awaiting_warranty": "Update: Your vehicle is awaiting warranty approval. We'll keep you posted.",
                    "quality_check": "Update: Your vehicle is undergoing a final quality check.",
                }
                sms_body = status_messages.get(
                    status_update.new_status,
                    f"Update on your vehicle: {status_update.new_status.replace('_', ' ').title()}",
                )
            if status_update.message:
                sms_body += f"\n{status_update.message}"
            send_sms(customer_phone, sms_body)

        return {"success": True, "message": "Status updated successfully"}

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"update_vehicle_status error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.patch("/vehicles/{vehicle_id}/toggle-warranty")
async def toggle_warranty_status(vehicle_id: str, user: dict = Depends(get_current_user)):
    try:
        current_vehicle = _verify_vehicle_access(vehicle_id, user)
        new_warranty_status = not current_vehicle.get("awaiting_warranty", False)

        update_data = {
            "awaiting_warranty": new_warranty_status,
            "status": "awaiting_warranty" if new_warranty_status else "in_progress",
        }
        supabase.table("vehicles").update(update_data).eq("vehicle_id", vehicle_id).execute()

        customer_phone = current_vehicle.get("customer_phone")
        if customer_phone and new_warranty_status:
            send_sms(
                customer_phone,
                "Update: Your vehicle is awaiting warranty approval. We'll notify you once approved and work can continue.",
            )

        return {"success": True, "awaiting_warranty": new_warranty_status, "new_status": update_data["status"]}

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"toggle_warranty_status error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ── AI Chat endpoint ──────────────────────────────────────────────────────────

_STATUS_LABELS = {
    "checked_in": "Checked In",
    "inspection": "Under Inspection",
    "waiting_parts": "Waiting on Parts",
    "in_progress": "In Progress",
    "awaiting_warranty": "Awaiting Warranty Approval",
    "quality_check": "Final Quality Check",
    "ready": "Ready for Pickup",
    "completed": "Completed",
}


@app.post("/vehicles/{vehicle_id}/ai-chat")
async def ai_chat(vehicle_id: str, data: AIChatMessage):
    """Customer sends a message; AI responds. Both saved to messages table."""
    # Get vehicle + shop context
    try:
        v_resp = supabase.table("vehicles").select("*").eq("vehicle_id", vehicle_id).execute()
        if not v_resp.data:
            raise HTTPException(status_code=404, detail="Vehicle not found")
        v = v_resp.data[0]
        shop_name = _shop_sms_name(v.get("shop_id", ""))
        first_name = (v.get("customer_name") or "valued customer").split()[0]
        vehicle_str = " ".join(str(x) for x in [v.get("year"), v.get("make"), v.get("model")] if x)
        status_label = _STATUS_LABELS.get(v.get("status", ""), v.get("status", ""))

        # Fetch conversation history (last 20 exchanges)
        hist_resp = (
            supabase.table("messages")
            .select("sender_type,message_text")
            .eq("vehicle_id", vehicle_id)
            .in_("sender_type", ["customer", "ai"])
            .order("sent_at")
            .limit(20)
            .execute()
        )

        conv_messages = []
        for msg in (hist_resp.data or []):
            role = "user" if msg["sender_type"] == "customer" else "assistant"
            conv_messages.append({"role": role, "content": msg["message_text"]})
        conv_messages.append({"role": "user", "content": data.message})

        if not anthropic_client:
            ai_text = "Our AI assistant isn't available right now. A service advisor will respond to your message shortly."
        else:
            system_prompt = (
                f"You are a friendly AI service assistant for {shop_name}, an auto repair shop.\n"
                f"Customer: {first_name}. Vehicle: {vehicle_str or 'vehicle on file'}. "
                f"Current status: {status_label}.\n\n"
                f"Be warm, concise, and helpful. Answer questions about service status, general automotive topics, "
                f"and shop services. For specific repair costs, timelines, or technical details you don't know, "
                f"say the service advisor can provide that. Keep responses under 3 short sentences unless more detail "
                f"is clearly needed. Do not make up information."
            )
            ai_resp = anthropic_client.messages.create(
                model="claude-3-haiku-20240307",
                max_tokens=350,
                system=system_prompt,
                messages=conv_messages,
            )
            ai_text = ai_resp.content[0].text

        # Save both messages
        supabase.table("messages").insert([
            {"vehicle_id": vehicle_id, "sender_type": "customer", "message_text": data.message},
            {"vehicle_id": vehicle_id, "sender_type": "ai", "message_text": ai_text},
        ]).execute()

        return {"response": ai_text}

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"ai_chat error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ── Message endpoints ──────────────────────────────────────────────────────────

@app.post("/vehicles/{vehicle_id}/messages")
async def create_message(
    vehicle_id: str,
    message: MessageCreate,
    credentials: Optional[HTTPAuthorizationCredentials] = Security(bearer_scheme),
):
    if message.sender_type == "advisor" and not credentials:
        raise HTTPException(status_code=401, detail="Authentication required for advisor messages")
    try:
        resp = supabase.table("messages").insert({
            "vehicle_id": vehicle_id,
            "sender_type": message.sender_type,
            "message_text": message.message_text,
        }).execute()

        # SMS customer when advisor sends a message
        if message.sender_type == "advisor":
            try:
                v_resp = supabase.table("vehicles").select("customer_phone,customer_name,shop_id,unique_link").eq("vehicle_id", vehicle_id).execute()
                if v_resp.data:
                    v = v_resp.data[0]
                    if v.get("customer_phone"):
                        shop_name = _shop_sms_name(v.get("shop_id", ""))
                        first_name = (v.get("customer_name") or "there").split()[0]
                        preview = message.message_text[:100] + ("…" if len(message.message_text) > 100 else "")
                        portal_link = f"{PORTAL_URL}/track/{v['unique_link']}"
                        send_sms(
                            v["customer_phone"],
                            f"Hi {first_name}! New message from {shop_name}: \"{preview}\" View here: {portal_link}"
                        )
            except Exception as sms_err:
                logger.warning(f"Advisor message SMS failed (non-critical): {sms_err}")

        return resp.data[0]
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"create_message error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/vehicles/{vehicle_id}/messages")
async def get_messages(vehicle_id: str):
    try:
        resp = supabase.table("messages").select("*").eq("vehicle_id", vehicle_id).order("sent_at").execute()
        return resp.data
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"get_messages error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ── Media endpoints ────────────────────────────────────────────────────────────

@app.post("/vehicles/{vehicle_id}/media")
async def upload_media(
    vehicle_id: str,
    file: UploadFile = File(...),
    caption: str = None,
    user: dict = Depends(get_current_user),
):
    try:
        _verify_vehicle_access(vehicle_id, user)

        if file.content_type not in ALLOWED_MIME_TYPES:
            raise HTTPException(status_code=415, detail=f"File type '{file.content_type}' is not allowed.")

        file_content = await file.read(MAX_UPLOAD_BYTES + 1)
        if len(file_content) > MAX_UPLOAD_BYTES:
            raise HTTPException(status_code=413, detail="File exceeds the 50 MB upload limit.")

        ext = file.filename.rsplit(".", 1)[-1].lower() if "." in file.filename else "bin"
        unique_filename = f"{vehicle_id}_{uuid.uuid4()}.{ext}"

        supabase.storage.from_("vehicle-photos").upload(
            unique_filename,
            file_content,
            {"content-type": file.content_type or "application/octet-stream"},
        )

        public_url = supabase.storage.from_("vehicle-photos").get_public_url(unique_filename)

        media_resp = supabase.table("media").insert({
            "vehicle_id": vehicle_id,
            "user_id": user["user_id"],
            "media_type": "photo" if (file.content_type or "").startswith("image") else "video",
            "media_url": public_url,
            "caption": caption,
        }).execute()

        return {"success": True, "media_url": public_url, "media_id": media_resp.data[0]["media_id"]}

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"upload_media error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/vehicles/{vehicle_id}/media")
async def get_media(vehicle_id: str):
    try:
        resp = supabase.table("media").select("*").eq("vehicle_id", vehicle_id).order("uploaded_at", desc=True).execute()
        return resp.data
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"get_media error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ── Approval endpoints ─────────────────────────────────────────────────────────

@app.post("/vehicles/{vehicle_id}/approvals")
async def create_approval(
    vehicle_id: str,
    approval: ApprovalCreate,
    user: dict = Depends(get_current_user),
):
    try:
        _verify_vehicle_access(vehicle_id, user)
        resp = supabase.table("approvals").insert({
            "vehicle_id": vehicle_id,
            "description": approval.description,
            "cost": approval.cost,
        }).execute()
        new_approval = resp.data[0]

        # SMS customer with portal link
        try:
            v_resp = supabase.table("vehicles").select("customer_phone,customer_name,unique_link,shop_id").eq("vehicle_id", vehicle_id).execute()
            if v_resp.data:
                v = v_resp.data[0]
                if v.get("customer_phone"):
                    shop_name = _shop_sms_name(v.get("shop_id", ""))
                    first_name = (v.get("customer_name") or "there").split()[0]
                    portal_link = f"{PORTAL_URL}/track/{v['unique_link']}"
                    send_sms(
                        v["customer_phone"],
                        f"Hi {first_name}! {shop_name} has sent you a repair approval request. "
                        f"Please review and respond here: {portal_link}"
                    )
        except Exception as sms_err:
            logger.warning(f"Approval SMS failed (non-critical): {sms_err}")

        return new_approval
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"create_approval error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.patch("/approvals/{approval_id}")
async def respond_to_approval(approval_id: str, response_data: ApprovalResponse):
    try:
        resp = supabase.table("approvals").update({
            "approved": response_data.approved,
            "approved_at": datetime.now().isoformat(),
        }).eq("approval_id", approval_id).execute()
        return {"success": True, "approved": response_data.approved}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"respond_to_approval error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/vehicles/{vehicle_id}/approvals")
async def get_approvals(vehicle_id: str):
    try:
        resp = supabase.table("approvals").select("*").eq("vehicle_id", vehicle_id).execute()
        return resp.data
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"get_approvals error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ── Scheduler endpoints (public) ───────────────────────────────────────────────

@app.get("/schedule/{shop_id}")
async def get_schedule_page(shop_id: str):
    """Public: shop info + open days + blocked dates for the booking calendar."""
    try:
        shop_resp = supabase.table("shops").select("*").eq("shop_id", shop_id).execute()
        if not shop_resp.data:
            raise HTTPException(status_code=404, detail="Shop not found")
        shop = shop_resp.data[0]

        hours_resp = supabase.table("shop_hours").select("day_of_week,open_time,close_time,slot_duration_minutes").eq("shop_id", shop_id).execute()
        open_days = [h["day_of_week"] for h in hours_resp.data]

        today = date_type.today()
        future = today + timedelta(days=60)
        blocked_resp = (
            supabase.table("blocked_dates")
            .select("blocked_date")
            .eq("shop_id", shop_id)
            .gte("blocked_date", today.isoformat())
            .lte("blocked_date", future.isoformat())
            .execute()
        )
        blocked_dates = [b["blocked_date"] for b in blocked_resp.data]

        return {"shop": shop, "open_days": open_days, "blocked_dates": blocked_dates}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"get_schedule_page error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/schedule/{shop_id}/slots")
async def get_available_slots(shop_id: str, date: str):
    """Public: available time slots for a specific date (YYYY-MM-DD)."""
    try:
        try:
            date_obj = datetime.strptime(date, "%Y-%m-%d").date()
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid date format. Use YYYY-MM-DD.")

        if date_obj < date_type.today():
            return {"slots": [], "reason": "past"}

        # Check blocked
        blocked_resp = supabase.table("blocked_dates").select("block_id").eq("shop_id", shop_id).eq("blocked_date", date).execute()
        if blocked_resp.data:
            return {"slots": [], "reason": "closed"}

        # Get shop timezone
        shop_resp = supabase.table("shops").select("timezone").eq("shop_id", shop_id).execute()
        tz_str = shop_resp.data[0].get("timezone", "America/Denver") if shop_resp.data else "America/Denver"
        tz = _get_tz(tz_str)

        # day_of_week: 0=Sun (JS convention, same as what we stored)
        # Python weekday(): 0=Mon → convert: (weekday + 1) % 7
        python_dow = date_obj.weekday()
        our_dow = (python_dow + 1) % 7

        hours_resp = supabase.table("shop_hours").select("*").eq("shop_id", shop_id).eq("day_of_week", our_dow).execute()
        if not hours_resp.data:
            return {"slots": [], "reason": "closed"}
        hours = hours_resp.data[0]

        # Get existing appointments for that day (UTC bounds)
        day_start = datetime(date_obj.year, date_obj.month, date_obj.day, 0, 0, 0, tzinfo=tz).astimezone(ZoneInfo("UTC"))
        day_end = datetime(date_obj.year, date_obj.month, date_obj.day, 23, 59, 59, tzinfo=tz).astimezone(ZoneInfo("UTC"))

        apts_resp = (
            supabase.table("appointments")
            .select("scheduled_at,status")
            .eq("shop_id", shop_id)
            .gte("scheduled_at", day_start.isoformat())
            .lte("scheduled_at", day_end.isoformat())
            .execute()
        )

        existing = []
        for apt in apts_resp.data:
            dt = _parse_dt(apt["scheduled_at"], tz)
            if dt:
                existing.append({"slot_dt": dt, "status": apt["status"]})

        slots = _generate_slots(
            hours["open_time"],
            hours["close_time"],
            hours["slot_duration_minutes"],
            date_obj,
            tz,
            existing,
            hours["max_concurrent"],
        )

        return {"slots": slots, "timezone": tz_str}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"get_available_slots error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/schedule/{shop_id}/book")
async def book_appointment(shop_id: str, appointment: AppointmentCreate):
    """Public: create a new appointment booking."""
    try:
        shop_resp = supabase.table("shops").select("name,timezone").eq("shop_id", shop_id).execute()
        if not shop_resp.data:
            raise HTTPException(status_code=404, detail="Shop not found")
        shop = shop_resp.data[0]

        # Parse and validate the slot time
        try:
            if appointment.scheduled_at.endswith("Z"):
                scheduled_at = appointment.scheduled_at[:-1] + "+00:00"
            else:
                scheduled_at = appointment.scheduled_at
            scheduled_dt = datetime.fromisoformat(scheduled_at)
            if scheduled_dt.tzinfo is None:
                scheduled_dt = scheduled_dt.replace(tzinfo=ZoneInfo("UTC"))
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid scheduled_at format.")

        if scheduled_dt < datetime.now(ZoneInfo("UTC")):
            raise HTTPException(status_code=400, detail="Cannot book appointments in the past.")

        resp = supabase.table("appointments").insert({
            "shop_id": shop_id,
            "customer_name": appointment.customer_name,
            "customer_phone": appointment.customer_phone,
            "customer_email": appointment.customer_email,
            "service_type": appointment.service_type,
            "notes": appointment.notes,
            "scheduled_at": scheduled_dt.isoformat(),
            "duration_minutes": appointment.duration_minutes,
            "status": "scheduled",
        }).execute()

        if not resp.data:
            raise HTTPException(status_code=400, detail="Failed to create appointment")

        # Confirmation SMS
        tz = _get_tz(shop.get("timezone", "America/Denver"))
        local_dt = scheduled_dt.astimezone(tz)
        date_str = local_dt.strftime("%A, %B %-d") if os.name != "nt" else local_dt.strftime("%A, %B %d").replace(" 0", " ")
        time_str = local_dt.strftime("%-I:%M %p") if os.name != "nt" else local_dt.strftime("%I:%M %p").lstrip("0")

        send_sms(
            appointment.customer_phone,
            f"Hi {appointment.customer_name}! Your appointment at {shop['name']} is confirmed for "
            f"{date_str} at {time_str}. We'll see you then!",
        )

        logger.info(f"Appointment booked: {appointment.customer_name} at {scheduled_dt.isoformat()}")
        return resp.data[0]

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"book_appointment error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ── Appointment endpoints (auth required) ──────────────────────────────────────

@app.post("/shop/{shop_id}/appointments")
async def create_advisor_appointment(
    shop_id: str,
    data: AdvisorAppointmentCreate,
    user: dict = Depends(get_current_user),
):
    if user["role"] != "admin" and user.get("shop_id") != shop_id:
        raise HTTPException(status_code=403, detail="Access denied")
    try:
        shop_resp = supabase.table("shops").select("name,timezone,phone").eq("shop_id", shop_id).execute()
        if not shop_resp.data:
            raise HTTPException(status_code=404, detail="Shop not found")
        shop = shop_resp.data[0]
        tz = _get_tz(shop.get("timezone", "America/Denver"))

        try:
            scheduled_dt = datetime.fromisoformat(data.scheduled_at)
            if scheduled_dt.tzinfo is None:
                scheduled_dt = scheduled_dt.replace(tzinfo=tz)
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid scheduled_at format. Use YYYY-MM-DDTHH:MM.")

        # Upsert customer
        cust_resp = (
            supabase.table("customers")
            .select("id")
            .eq("shop_id", shop_id)
            .eq("phone", data.customer_phone)
            .execute()
        )
        if cust_resp.data:
            customer_id = cust_resp.data[0]["id"]
            supabase.table("customers").update({
                "first_name": data.first_name,
                "last_name": data.last_name,
                "email": data.customer_email,
                "updated_at": datetime.now(ZoneInfo("UTC")).isoformat(),
            }).eq("id", customer_id).execute()
        else:
            ins = supabase.table("customers").insert({
                "shop_id": shop_id,
                "first_name": data.first_name,
                "last_name": data.last_name,
                "phone": data.customer_phone,
                "email": data.customer_email,
            }).execute()
            customer_id = ins.data[0]["id"]

        apt_resp = supabase.table("appointments").insert({
            "shop_id": shop_id,
            "customer_id": customer_id,
            "customer_name": f"{data.first_name} {data.last_name}",
            "first_name": data.first_name,
            "last_name": data.last_name,
            "customer_phone": data.customer_phone,
            "customer_email": data.customer_email,
            "vehicle_year": data.vehicle_year,
            "vehicle_make": data.vehicle_make,
            "vehicle_model": data.vehicle_model,
            "vehicle_vin": data.vehicle_vin,
            "drop_off_reason": data.drop_off_reason,
            "service_type": data.drop_off_reason,
            "scheduled_at": scheduled_dt.isoformat(),
            "duration_minutes": data.duration_minutes,
            "status": "scheduled",
        }).execute()

        apt = apt_resp.data[0]

        local_dt = scheduled_dt.astimezone(tz)
        formatted_time = local_dt.strftime("%A, %B %-d at %-I:%M %p")
        vehicle_parts = [p for p in [
            str(data.vehicle_year) if data.vehicle_year else None,
            data.vehicle_make, data.vehicle_model,
        ] if p]
        vehicle_str = " ".join(vehicle_parts) if vehicle_parts else "vehicle"
        sms_body = (
            f"Hi {data.first_name}! Your drop off for {shop['name']} is confirmed for "
            f"{formatted_time}. Thanks for trusting us with your {vehicle_str}. "
            f"Have a nice day! Reply STOP to opt out."
        )
        send_sms(data.customer_phone, sms_body)

        logger.info(f"Advisor appointment created: {data.first_name} {data.last_name} at {scheduled_dt.isoformat()}")
        return {"appointment": apt, "customer_id": customer_id}

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"create_advisor_appointment error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/shop/{shop_id}/customers/search")
async def search_customers(
    shop_id: str,
    q: str = "",
    user: dict = Depends(get_current_user),
):
    if user["role"] != "admin" and user.get("shop_id") != shop_id:
        raise HTTPException(status_code=403, detail="Access denied")
    q = q.strip()
    if len(q) < 2:
        return {"customers": []}
    try:
        results: list[dict] = []
        seen: set[str] = set()

        is_phone_like = all(c in "0123456789-+(). " for c in q)

        if is_phone_like:
            resp = (
                supabase.table("customers")
                .select("*")
                .eq("shop_id", shop_id)
                .ilike("phone", f"%{q}%")
                .limit(8)
                .execute()
            )
            for c in (resp.data or []):
                if c["id"] not in seen:
                    seen.add(c["id"])
                    results.append(c)
        else:
            for col in ("first_name", "last_name"):
                resp = (
                    supabase.table("customers")
                    .select("*")
                    .eq("shop_id", shop_id)
                    .ilike(col, f"%{q}%")
                    .limit(6)
                    .execute()
                )
                for c in (resp.data or []):
                    if c["id"] not in seen:
                        seen.add(c["id"])
                        results.append(c)

        # VIN search — find customer_ids from appointments
        if len(q) >= 4:
            vin_resp = (
                supabase.table("appointments")
                .select("customer_id,vehicle_year,vehicle_make,vehicle_model,vehicle_vin")
                .eq("shop_id", shop_id)
                .ilike("vehicle_vin", f"%{q.upper()}%")
                .limit(5)
                .execute()
            )
            vin_customer_ids = [r["customer_id"] for r in (vin_resp.data or []) if r.get("customer_id") and r["customer_id"] not in seen]
            if vin_customer_ids:
                for cid in vin_customer_ids:
                    cr = supabase.table("customers").select("*").eq("id", cid).execute()
                    for c in (cr.data or []):
                        if c["id"] not in seen:
                            seen.add(c["id"])
                            results.append(c)

        # Attach most recent vehicle to each customer
        for customer in results:
            apt_resp = (
                supabase.table("appointments")
                .select("vehicle_year,vehicle_make,vehicle_model,vehicle_vin")
                .eq("customer_id", customer["id"])
                .not_.is_("vehicle_make", "null")
                .order("scheduled_at", desc=True)
                .limit(1)
                .execute()
            )
            customer["last_vehicle"] = apt_resp.data[0] if apt_resp.data else None

        return {"customers": results[:8]}

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"search_customers error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/shop/{shop_id}/appointments")
async def get_shop_appointments(shop_id: str, user: dict = Depends(get_current_user)):
    if user["role"] != "admin" and user.get("shop_id") != shop_id:
        raise HTTPException(status_code=403, detail="Access denied")
    try:
        resp = (
            supabase.table("appointments")
            .select("*")
            .eq("shop_id", shop_id)
            .order("scheduled_at")
            .execute()
        )
        return {"appointments": resp.data or []}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"get_shop_appointments error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.patch("/appointments/{appointment_id}/status")
async def update_appointment_status(
    appointment_id: str,
    update: AppointmentStatusUpdate,
    user: dict = Depends(get_current_user),
):
    try:
        apt_resp = supabase.table("appointments").select("*").eq("appointment_id", appointment_id).execute()
        if not apt_resp.data:
            raise HTTPException(status_code=404, detail="Appointment not found")
        apt = apt_resp.data[0]
        if user["role"] != "admin" and apt.get("shop_id") != user.get("shop_id"):
            raise HTTPException(status_code=403, detail="Access denied")

        supabase.table("appointments").update({"status": update.status}).eq("appointment_id", appointment_id).execute()
        return {"success": True, "status": update.status}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"update_appointment_status error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ── Shop hours endpoints ───────────────────────────────────────────────────────

@app.get("/shop/{shop_id}/hours")
async def get_shop_hours(shop_id: str):
    try:
        resp = supabase.table("shop_hours").select("*").eq("shop_id", shop_id).order("day_of_week").execute()
        return resp.data
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"get_shop_hours error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/shop/{shop_id}/hours")
async def upsert_shop_hours(
    shop_id: str,
    entry: ShopHourEntry,
    user: dict = Depends(get_current_user),
):
    if user["role"] != "admin" and user.get("shop_id") != shop_id:
        raise HTTPException(status_code=403, detail="Access denied")
    try:
        supabase.table("shop_hours").upsert({
            "shop_id": shop_id,
            "day_of_week": entry.day_of_week,
            "open_time": entry.open_time,
            "close_time": entry.close_time,
            "slot_duration_minutes": entry.slot_duration_minutes,
            "max_concurrent": entry.max_concurrent,
        }, on_conflict="shop_id,day_of_week").execute()
        return {"success": True}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"upsert_shop_hours error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.delete("/shop/{shop_id}/hours/{day_of_week}")
async def delete_shop_hours(shop_id: str, day_of_week: int, user: dict = Depends(get_current_user)):
    if user["role"] != "admin" and user.get("shop_id") != shop_id:
        raise HTTPException(status_code=403, detail="Access denied")
    try:
        supabase.table("shop_hours").delete().eq("shop_id", shop_id).eq("day_of_week", day_of_week).execute()
        return {"success": True}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"delete_shop_hours error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ── Blocked dates endpoints ────────────────────────────────────────────────────

@app.post("/shop/{shop_id}/blocked-dates")
async def add_blocked_date(shop_id: str, block: BlockDateCreate, user: dict = Depends(get_current_user)):
    if user["role"] != "admin" and user.get("shop_id") != shop_id:
        raise HTTPException(status_code=403, detail="Access denied")
    try:
        resp = supabase.table("blocked_dates").upsert({
            "shop_id": shop_id,
            "blocked_date": block.blocked_date,
            "reason": block.reason,
        }, on_conflict="shop_id,blocked_date").execute()
        return {"success": True}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"add_blocked_date error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.delete("/shop/{shop_id}/blocked-dates/{blocked_date}")
async def remove_blocked_date(shop_id: str, blocked_date: str, user: dict = Depends(get_current_user)):
    if user["role"] != "admin" and user.get("shop_id") != shop_id:
        raise HTTPException(status_code=403, detail="Access denied")
    try:
        supabase.table("blocked_dates").delete().eq("shop_id", shop_id).eq("blocked_date", blocked_date).execute()
        return {"success": True}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"remove_blocked_date error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ── Entry point ────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
