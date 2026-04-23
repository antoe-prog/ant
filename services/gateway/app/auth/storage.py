"""Simple JSON-file backed user store. Thread-safe via RLock."""
from __future__ import annotations

import json
import os
import threading
import uuid
from pathlib import Path
from typing import Any, Optional


class UserStore:
    def __init__(self, path: Path):
        self._path = Path(path)
        self._lock = threading.RLock()
        self._users: dict[str, dict[str, Any]] = {}
        self._email_index: dict[str, str] = {}
        self._loaded = False

    def _ensure_loaded(self) -> None:
        if self._loaded:
            return
        with self._lock:
            if self._loaded:
                return
            if self._path.exists():
                try:
                    with self._path.open("r", encoding="utf-8") as f:
                        data = json.load(f)
                    users = data.get("users", {})
                    if isinstance(users, dict):
                        self._users = users
                        self._email_index = {
                            u["email"].lower(): uid
                            for uid, u in users.items()
                            if isinstance(u, dict) and "email" in u
                        }
                except Exception:
                    self._users = {}
                    self._email_index = {}
            else:
                self._path.parent.mkdir(parents=True, exist_ok=True)
            self._loaded = True

    def _persist(self) -> None:
        # data 디렉터리가 런타임 중 삭제된 경우를 대비해 매번 보장한다.
        self._path.parent.mkdir(parents=True, exist_ok=True)
        tmp = self._path.with_suffix(self._path.suffix + ".tmp")
        payload = {"users": self._users}
        with tmp.open("w", encoding="utf-8") as f:
            json.dump(payload, f, ensure_ascii=False, indent=2)
        os.replace(tmp, self._path)

    def get_by_email(self, email: str) -> Optional[dict[str, Any]]:
        self._ensure_loaded()
        with self._lock:
            uid = self._email_index.get(email.lower())
            if not uid:
                return None
            return dict(self._users[uid])

    def get_by_id(self, user_id: str) -> Optional[dict[str, Any]]:
        self._ensure_loaded()
        with self._lock:
            u = self._users.get(user_id)
            return dict(u) if u else None

    def create(self, email: str, password_hash: str, name: str, role: str = "member") -> dict[str, Any]:
        self._ensure_loaded()
        with self._lock:
            email_l = email.lower()
            if email_l in self._email_index:
                raise ValueError("email_taken")
            user_id = uuid.uuid4().hex
            import time as _t
            user = {
                "id": user_id,
                "email": email_l,
                "name": name,
                "role": role,
                "passwordHash": password_hash,
                "createdAt": int(_t.time()),
                "lastSignedIn": None,
            }
            self._users[user_id] = user
            self._email_index[email_l] = user_id
            self._persist()
            return dict(user)

    def update_password(self, user_id: str, new_hash: str) -> None:
        self._ensure_loaded()
        with self._lock:
            u = self._users.get(user_id)
            if not u:
                raise KeyError(user_id)
            u["passwordHash"] = new_hash
            self._persist()

    def touch_sign_in(self, user_id: str) -> None:
        self._ensure_loaded()
        with self._lock:
            u = self._users.get(user_id)
            if not u:
                return
            import time as _t
            u["lastSignedIn"] = int(_t.time())
            self._persist()

    def count(self) -> int:
        self._ensure_loaded()
        with self._lock:
            return len(self._users)
