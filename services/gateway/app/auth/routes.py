"""Self-registration / login routes for admin-web."""
from __future__ import annotations

import re
from pathlib import Path
from typing import Annotated, Optional

from fastapi import APIRouter, Depends, Header, HTTPException, status
from pydantic import BaseModel, EmailStr, Field

from app.config import settings
from app.auth.password import hash_password, verify_password
from app.auth.storage import UserStore
from app.auth.tokens import sign_token, verify_token


router = APIRouter(prefix="/v1/auth", tags=["auth"])


_store_instance: Optional[UserStore] = None


def _store() -> UserStore:
    global _store_instance
    if _store_instance is not None:
        return _store_instance
    path = Path(settings.auth_user_store_path)
    if not path.is_absolute():
        path = Path.cwd() / path
    _store_instance = UserStore(path)
    return _store_instance


class RegisterRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)
    name: str = Field(min_length=1, max_length=80)


class LoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=128)


class UserPublic(BaseModel):
    id: str
    email: str
    name: str
    role: str


class AuthResponse(BaseModel):
    token: str
    user: UserPublic


def _to_public(user: dict) -> UserPublic:
    return UserPublic(
        id=user["id"],
        email=user["email"],
        name=user.get("name") or "",
        role=user.get("role") or "member",
    )


def _issue_token(user: dict) -> str:
    return sign_token(
        {"sub": user["id"], "email": user["email"], "role": user.get("role", "member")},
        secret=settings.jwt_secret,
        ttl_seconds=settings.auth_token_ttl_seconds,
    )


def _determine_role(store: UserStore, email: str) -> str:
    bootstrap = settings.auth_bootstrap_admin_email.strip().lower()
    if bootstrap and email.lower() == bootstrap:
        return "admin"
    if store.count() == 0:
        return "admin"
    return "member"


@router.post("/register", response_model=AuthResponse, status_code=status.HTTP_201_CREATED)
def register(req: RegisterRequest) -> AuthResponse:
    email = req.email.lower()
    if not re.match(r"^[^@\s]+@[^@\s]+\.[^@\s]+$", email):
        raise HTTPException(status_code=400, detail="invalid_email")
    store = _store()
    if store.get_by_email(email):
        raise HTTPException(status_code=409, detail="email_taken")
    role = _determine_role(store, email)
    try:
        user = store.create(
            email=email,
            password_hash=hash_password(req.password),
            name=req.name.strip(),
            role=role,
        )
    except ValueError:
        raise HTTPException(status_code=409, detail="email_taken")
    token = _issue_token(user)
    return AuthResponse(token=token, user=_to_public(user))


@router.post("/login", response_model=AuthResponse)
def login(req: LoginRequest) -> AuthResponse:
    store = _store()
    user = store.get_by_email(req.email.lower())
    if not user or not verify_password(req.password, user.get("passwordHash", "")):
        raise HTTPException(status_code=401, detail="invalid_credentials")
    store.touch_sign_in(user["id"])
    token = _issue_token(user)
    return AuthResponse(token=token, user=_to_public(user))


def get_current_user(
    authorization: Annotated[str | None, Header(alias="Authorization")] = None,
) -> dict:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="missing_token")
    token = authorization.split(" ", 1)[1].strip()
    payload = verify_token(token, secret=settings.jwt_secret)
    if not payload:
        raise HTTPException(status_code=401, detail="invalid_token")
    uid = payload.get("sub")
    if not isinstance(uid, str):
        raise HTTPException(status_code=401, detail="invalid_token")
    user = _store().get_by_id(uid)
    if not user:
        raise HTTPException(status_code=401, detail="user_not_found")
    return user


class ChangePasswordRequest(BaseModel):
    current_password: str = Field(min_length=1, max_length=128)
    new_password: str = Field(min_length=8, max_length=128)


@router.post("/password", status_code=204)
def change_password(
    req: ChangePasswordRequest,
    user: Annotated[dict, Depends(get_current_user)],
) -> None:
    if not verify_password(req.current_password, user.get("passwordHash", "")):
        raise HTTPException(status_code=401, detail="invalid_current_password")
    if req.current_password == req.new_password:
        raise HTTPException(status_code=400, detail="same_password")
    _store().update_password(user["id"], hash_password(req.new_password))
    return None


def require_role(*allowed: str):
    """FastAPI dependency factory that enforces the caller's role."""

    def _dep(user: Annotated[dict, Depends(get_current_user)]) -> dict:
        role = user.get("role")
        if role not in allowed:
            raise HTTPException(status_code=403, detail="forbidden_role")
        return user

    return _dep


@router.get("/me", response_model=UserPublic)
def me(user: Annotated[dict, Depends(get_current_user)]) -> UserPublic:
    return _to_public(user)


@router.post("/logout", status_code=204)
def logout() -> None:
    # Stateless token — client just discards it. Endpoint kept for symmetry.
    return None
