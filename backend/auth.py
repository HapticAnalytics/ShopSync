import os
import logging
from typing import Optional

import jwt
from fastapi import Depends, HTTPException, Security
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials

logger = logging.getLogger("shopsync")

SUPABASE_JWT_SECRET = os.getenv("SUPABASE_JWT_SECRET", "")
ADMIN_BOOTSTRAP_EMAIL = os.getenv("ADMIN_BOOTSTRAP_EMAIL", "")
ADMIN_BOOTSTRAP_SHOP_ID = os.getenv("ADMIN_BOOTSTRAP_SHOP_ID", "")

bearer_scheme = HTTPBearer(auto_error=False)


def _decode_token(token: str) -> dict:
    if not SUPABASE_JWT_SECRET:
        raise HTTPException(status_code=500, detail="JWT secret not configured on server")
    try:
        return jwt.decode(
            token,
            SUPABASE_JWT_SECRET,
            algorithms=["HS256"],
            audience="authenticated",
        )
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Session expired — please log in again")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid authentication token")


async def get_current_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Security(bearer_scheme),
) -> dict:
    if not credentials:
        raise HTTPException(status_code=401, detail="Authentication required")

    payload = _decode_token(credentials.credentials)
    user_id = payload.get("sub")
    user_email = payload.get("email", "")

    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid token payload")

    from database import get_supabase_client
    supabase = get_supabase_client()

    resp = supabase.table("users").select("*").eq("user_id", user_id).execute()

    if not resp.data:
        # Bootstrap: first user with matching admin email becomes admin automatically
        all_users = supabase.table("users").select("user_id").limit(1).execute()
        if (
            not all_users.data
            and ADMIN_BOOTSTRAP_EMAIL
            and user_email.lower() == ADMIN_BOOTSTRAP_EMAIL.lower()
        ):
            logger.info(f"Bootstrap: creating admin account for {user_email}")
            supabase.table("users").insert({
                "user_id": user_id,
                "email": user_email,
                "full_name": "Admin",
                "role": "admin",
                "shop_id": ADMIN_BOOTSTRAP_SHOP_ID or None,
            }).execute()
            resp = supabase.table("users").select("*").eq("user_id", user_id).execute()
        else:
            raise HTTPException(
                status_code=403,
                detail="User not found in system. Contact your administrator.",
            )

    user = resp.data[0]
    if not user.get("active", True):
        raise HTTPException(status_code=403, detail="Account is deactivated")

    return user


async def require_admin(user: dict = Depends(get_current_user)) -> dict:
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    return user
