from fastapi import FastAPI, HTTPException, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from database import get_supabase_client
from schemas import *
from typing import List
import uuid
from datetime import datetime
import os
from dotenv import load_dotenv
from twilio.rest import Client
import requests

# Load environment variables
load_dotenv()

# Initialize FastAPI app
app = FastAPI(title="ShopSync API", version="1.0.0")

# Enable CORS (so frontend can talk to backend)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # In production, specify your frontend domain
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Get Supabase client
supabase = get_supabase_client()

# Initialize Twilio client
TWILIO_ACCOUNT_SID = os.getenv("TWILIO_ACCOUNT_SID")
TWILIO_AUTH_TOKEN = os.getenv("TWILIO_AUTH_TOKEN")
TWILIO_PHONE = os.getenv("TWILIO_PHONE_NUMBER")

if TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN:
    twilio_client = Client(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN)
else:
    twilio_client = None

def send_sms(to_phone: str, message: str):
    """Send SMS notification to customer"""
    if not twilio_client:
        print(f"Twilio not configured. Would send: {message} to {to_phone}")
        return False
    
    try:
        msg = twilio_client.messages.create(
            body=message,
            from_=TWILIO_PHONE,
            to=to_phone
        )
        print(f"SMS sent successfully! SID: {msg.sid}")
        return True
    except Exception as e:
        print(f"Failed to send SMS: {e}")
        return False

# Get Unsplash API key
UNSPLASH_ACCESS_KEY = os.getenv("UNSPLASH_ACCESS_KEY")

def get_car_image(make, model, year):
    """Fetch car image from Unsplash based on make/model"""
    if not UNSPLASH_ACCESS_KEY:
        return None
    
    try:
        # Search query
        query = f"{year} {make} {model} car"
        
        url = "https://api.unsplash.com/search/photos"
        params = {
            "query": query,
            "per_page": 1,
            "orientation": "landscape"
        }
        headers = {
            "Authorization": f"Client-ID {UNSPLASH_ACCESS_KEY}"
        }
        
        response = requests.get(url, params=params, headers=headers)
        
        if response.status_code == 200:
            data = response.json()
            if data["results"]:
                return data["results"][0]["urls"]["regular"]
        
        return None
    except Exception as e:
        print(f"Error fetching car image: {e}")
        return None

# ==================== SHOP ENDPOINTS ====================

@app.get("/")
async def root():
    """Health check endpoint"""
    return {"message": "ShopSync API is running", "version": "1.0.0"}

# ==================== VEHICLE ENDPOINTS ====================

@app.post("/vehicles/", response_model=VehicleResponse)
async def create_vehicle(vehicle: VehicleCreate, shop_id: str):
    """
    Create a new vehicle and send SMS notification to customer
    """
    try:
        # Generate unique link for customer portal
        unique_link = str(uuid.uuid4())
        
        # Insert vehicle into database
        response = supabase.table("vehicles").insert({
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
        
        if not response.data:
            raise HTTPException(status_code=400, detail="Failed to create vehicle")
        
        vehicle_data = response.data[0]
        
        # Send SMS notification to customer
        portal_url = f"https://frontend-e78vqdl1n-logans-projects-ca4dfe96.vercel.app/track/{unique_link}"
        sms_message = f"Hi {vehicle.customer_name}! Your vehicle is checked in at Summit Trucks. Track its status here: {portal_url}"
        print(f"DEBUG: Attempting to send SMS to {vehicle.customer_phone}")
        print(f"DEBUG: Message: {sms_message}")
        result = send_sms(vehicle.customer_phone, sms_message)
        print(f"DEBUG: SMS send result: {result}")
        
        return VehicleResponse(**vehicle_data)
    
    except Exception as e:
        print(f"ERROR creating vehicle: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/vehicles/{unique_link}")
async def get_vehicle_by_link(unique_link: str):
    """
    Get vehicle details by unique link (for customer portal)
    """
    try:
        response = supabase.table("vehicles").select("*").eq("unique_link", unique_link).execute()
        
        if not response.data:
            raise HTTPException(status_code=404, detail="Vehicle not found")
        
        return response.data[0]
    
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/shop/{shop_id}/vehicles")
async def get_shop_vehicles(shop_id: str):
    """
    Get all vehicles for a shop (for service advisor dashboard)
    """
    try:
        response = supabase.table("vehicles").select("*").eq("shop_id", shop_id).execute()
        return response.data
    
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.patch("/vehicles/{vehicle_id}/status")
async def update_vehicle_status(vehicle_id: str, status_update: StatusUpdate, user_id: str):
    """
    Update vehicle status and create an update record
    """
    try:
        # Get current vehicle data
        vehicle_response = supabase.table("vehicles").select("*").eq("vehicle_id", vehicle_id).execute()
        
        if not vehicle_response.data:
            raise HTTPException(status_code=404, detail="Vehicle not found")
        
        current_vehicle = vehicle_response.data[0]
        old_status = current_vehicle["status"]
        
        # Update vehicle status
        update_response = supabase.table("vehicles").update({
            "status": status_update.new_status
        }).eq("vehicle_id", vehicle_id).execute()
        
        # Try to create update record (non-critical if it fails)
        try:
            supabase.table("updates").insert({
                "vehicle_id": vehicle_id,
                "user_id": user_id,
                "old_status": old_status,
                "new_status": status_update.new_status,
                "message": status_update.message
            }).execute()
        except Exception as update_error:
            print(f"Non-critical ERROR inserting status update record: {update_error}")
        
        # Send SMS notification to customer about status change
        customer_phone = current_vehicle.get("customer_phone")
        customer_name = current_vehicle.get("customer_name", "Customer")
        
        if customer_phone:
            # Create status-specific messages
            status_messages = {
                "checked_in": f"Hi {customer_name}! Your vehicle has been checked in at Summit Trucks.",
                "inspection": f"Update: Your vehicle is now being inspected.",
                "waiting_parts": f"Update: Your vehicle is awaiting parts. We'll notify you when work resumes.",
                "in_progress": f"Update: Your vehicle service is now in progress.",
                "awaiting_warranty": f"Update: Your vehicle is awaiting warranty approval. We'll keep you posted.",
                "quality_check": f"Update: Your vehicle is undergoing final quality check.",
                "ready": f"Great news! Your vehicle is ready for pickup at Summit Trucks. Thank you for your business!"
            }
            
            # Get appropriate message
            sms_message = status_messages.get(
                status_update.new_status,
                f"Update on your vehicle: {status_update.new_status.replace('_', ' ').title()}"
            )
            
            # Add custom message if provided
            if status_update.message:
                sms_message += f"\n{status_update.message}"
            
            print(f"DEBUG: Attempting to send status update SMS to {customer_phone}")
            print(f"DEBUG: Message: {sms_message}")
            result = send_sms(customer_phone, sms_message)
            print(f"DEBUG: SMS send result: {result}")
        else:
            print(f"WARNING: No customer phone number found for vehicle {vehicle_id}")
        
        return {"success": True, "message": "Status updated successfully"}
    
    except Exception as e:
        print(f"ERROR in update_vehicle_status: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.patch("/vehicles/{vehicle_id}/toggle-warranty")
async def toggle_warranty_status(vehicle_id: str):
    """
    Toggle warranty status for a vehicle
    """
    try:
        # Get current vehicle data
        vehicle_response = supabase.table("vehicles").select("*").eq("vehicle_id", vehicle_id).execute()
        
        if not vehicle_response.data:
            raise HTTPException(status_code=404, detail="Vehicle not found")
        
        current_vehicle = vehicle_response.data[0]
        
        # Toggle awaiting_warranty flag
        new_warranty_status = not current_vehicle.get("awaiting_warranty", False)
        
        # Update vehicle
        update_data = {
            "awaiting_warranty": new_warranty_status
        }
        
        # If enabling warranty, set status to awaiting_warranty
        if new_warranty_status:
            update_data["status"] = "awaiting_warranty"
        # If disabling, move back to in_progress (service continues)
        else:
            update_data["status"] = "in_progress"
        
        update_response = supabase.table("vehicles").update(update_data).eq("vehicle_id", vehicle_id).execute()
        
        # Send SMS notification
        customer_phone = current_vehicle.get("customer_phone")
        customer_name = current_vehicle.get("customer_name", "Customer")
        
        if customer_phone:
            if new_warranty_status:
                sms_message = f"Update: Your vehicle is awaiting warranty approval. We'll notify you once approved and work can continue."
            else:
                sms_message = f"Good news! Warranty approved. Your vehicle service is back in progress."
            print(f"DEBUG: Sending warranty status SMS to {customer_phone}")
            send_sms(customer_phone, sms_message)
        
        return {
            "success": True, 
            "awaiting_warranty": new_warranty_status,
            "new_status": update_data["status"]
        }
    
    except Exception as e:
        print(f"ERROR toggling warranty status: {e}")
        raise HTTPException(status_code=500, detail=str(e))

# ==================== MESSAGE ENDPOINTS ====================

@app.post("/vehicles/{vehicle_id}/messages")
async def create_message(vehicle_id: str, message: MessageCreate):
    """
    Create a new message (from customer or advisor)
    """
    try:
        response = supabase.table("messages").insert({
            "vehicle_id": vehicle_id,
            "sender_type": message.sender_type,
            "message_text": message.message_text
        }).execute()
        
        return response.data[0]
    
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/vehicles/{vehicle_id}/messages")
async def get_messages(vehicle_id: str):
    """
    Get all messages for a vehicle
    """
    try:
        response = supabase.table("messages").select("*").eq("vehicle_id", vehicle_id).order("sent_at").execute()
        return response.data
    
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# ==================== MEDIA ENDPOINTS ====================

@app.post("/vehicles/{vehicle_id}/media")
async def upload_media(
    vehicle_id: str, 
    file: UploadFile = File(...), 
    user_id: str = None, 
    caption: str = None
):
    """
    Upload photo or video for a vehicle to Supabase Storage
    """
    try:
        # Read file content
        file_content = await file.read()
        
        # Generate unique filename
        file_extension = file.filename.split('.')[-1] if '.' in file.filename else 'jpg'
        unique_filename = f"{vehicle_id}_{uuid.uuid4()}.{file_extension}"
        
        # Upload to Supabase Storage
        storage_response = supabase.storage.from_('vehicle-photos').upload(
            unique_filename,
            file_content,
            {
                'content-type': file.content_type or 'image/jpeg'
            }
        )
        
        # Get public URL
        public_url = supabase.storage.from_('vehicle-photos').get_public_url(unique_filename)
        
        # Save media record to database
        media_response = supabase.table("media").insert({
            "vehicle_id": vehicle_id,
            "user_id": user_id,
            "media_type": "photo" if file.content_type and file.content_type.startswith("image") else "video",
            "media_url": public_url,
            "caption": caption
        }).execute()
        
        print(f"Media uploaded successfully: {public_url}")
        
        return {
            "success": True,
            "media_url": public_url,
            "media_id": media_response.data[0]["media_id"]
        }
    
    except Exception as e:
        print(f"Error uploading media: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/vehicles/{vehicle_id}/media")
async def get_media(vehicle_id: str):
    """
    Get all media for a vehicle
    """
    try:
        response = supabase.table("media").select("*").eq("vehicle_id", vehicle_id).order("uploaded_at", desc=True).execute()
        return response.data
    
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# ==================== APPROVAL ENDPOINTS ====================

@app.post("/vehicles/{vehicle_id}/approvals")
async def create_approval(vehicle_id: str, approval: ApprovalCreate):
    """
    Create an approval request for additional work
    """
    try:
        response = supabase.table("approvals").insert({
            "vehicle_id": vehicle_id,
            "description": approval.description,
            "cost": approval.cost
        }).execute()
        
        return response.data[0]
    
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.patch("/approvals/{approval_id}")
async def respond_to_approval(approval_id: str, response_data: ApprovalResponse):
    """
    Customer approves or declines additional work
    """
    try:
        response = supabase.table("approvals").update({
            "approved": response_data.approved,
            "approved_at": datetime.now().isoformat()
        }).eq("approval_id", approval_id).execute()
        
        return {"success": True, "approved": response_data.approved}
    
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/vehicles/{vehicle_id}/approvals")
async def get_approvals(vehicle_id: str):
    """
    Get all approval requests for a vehicle
    """
    try:
        response = supabase.table("approvals").select("*").eq("vehicle_id", vehicle_id).execute()
        return response.data
    
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# ==================== RUN THE APP ====================

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
