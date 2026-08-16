"""SQLite 영속화.

봇이 재시작돼도 포지션·현금·주문 이력·일별 손익 기준선이 유지되어야 리스크
한도(일일 손실 한도 등)가 의미를 갖는다.
"""

from __future__ import annotations

import errno
import json
import os
import sqlite3
import stat
import threading
import uuid
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import datetime, timezone
from decimal import Decimal
from functools import wraps
from hashlib import sha256
from pathlib import Path
from typing import Any, Iterator

from .models import Order, OrderRequest, OrderStatus, Position, Side


class StoreConflict(RuntimeError):
    """캐시된 브로커 상태가 DB의 최신 상태와 달라 결제를 중단했다."""


class StoreLeaseError(RuntimeError):
    """같은 파일 DB에 이미 활성 페이퍼 브로커가 있다."""


class StoreMigrationError(RuntimeError):
    """자동으로 안전하게 고칠 수 없는 기존 DB 상태다."""


@dataclass(frozen=True)
class FillSettlement:
    """페이퍼 체결 커밋 결과. ``applied=False``는 안전한 재조회다."""

    order: Order
    applied: bool


_PAPER_LEASE_GUARD = threading.Lock()
_ACTIVE_PAPER_LEASES: set[str] = set()
_LIVE_LEASE_GUARD = threading.Lock()
_ACTIVE_LIVE_LEASES: set[str] = set()
_LIVE_LEDGER_UUID_STATE_KEY = "live.ledger_uuid"
_LIVE_ACCOUNT_SCOPE_STATE_KEY = "live.account_scope_hash"
_LIVE_IDENTITY_STATE_KEYS = frozenset(
    {_LIVE_LEDGER_UUID_STATE_KEY, _LIVE_ACCOUNT_SCOPE_STATE_KEY}
)


def _reset_lease_registries_after_fork() -> None:
    """Forget copied process-local ownership without unlocking parent flocks."""
    global _PAPER_LEASE_GUARD, _ACTIVE_PAPER_LEASES
    global _LIVE_LEASE_GUARD, _ACTIVE_LIVE_LEASES

    _PAPER_LEASE_GUARD = threading.Lock()
    _ACTIVE_PAPER_LEASES = set()
    _LIVE_LEASE_GUARD = threading.Lock()
    _ACTIVE_LIVE_LEASES = set()


if hasattr(os, "register_at_fork"):
    os.register_at_fork(after_in_child=_reset_lease_registries_after_fork)


def _serialized_db(method: Any) -> Any:
    """한 Store 연결의 모든 SQL 경계를 같은 재진입 잠금으로 직렬화한다."""

    @wraps(method)
    def locked(self: Store, *args: Any, **kwargs: Any) -> Any:
        self._assert_process_owner()
        with self._db_lock:
            return method(self, *args, **kwargs)

    return locked

SCHEMA = """
CREATE TABLE IF NOT EXISTS state (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS positions (
    symbol    TEXT PRIMARY KEY,
    quantity  INTEGER NOT NULL,
    avg_price TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS orders (
    order_id        TEXT PRIMARY KEY,
    client_order_id TEXT NOT NULL,
    symbol          TEXT NOT NULL,
    side            TEXT NOT NULL,
    quantity        INTEGER NOT NULL,
    filled_quantity INTEGER NOT NULL,
    avg_fill_price  TEXT NOT NULL,
    status          TEXT NOT NULL,
    ts              TEXT NOT NULL,
    reason          TEXT,
    order_type      TEXT,
    limit_price     TEXT,
    origin          TEXT
);

CREATE TABLE IF NOT EXISTS fills (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id   TEXT NOT NULL,
    symbol     TEXT NOT NULL,
    side       TEXT NOT NULL,
    quantity   INTEGER NOT NULL,
    price      TEXT NOT NULL,
    commission TEXT NOT NULL,
    ts         TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS position_tracking (
    symbol        TEXT PRIMARY KEY,
    high_water    TEXT,
    opened_at     TEXT,
    blocked_until TEXT
);

CREATE TABLE IF NOT EXISTS equity_curve (
    ts     TEXT PRIMARY KEY,
    equity TEXT NOT NULL,
    cash   TEXT NOT NULL
);
"""


class Store:
    def __init__(self, path: Path | str) -> None:
        raw_path = str(path)
        self.path = (
            raw_path
            if raw_path == ":memory:"
            else str(Path(path).expanduser().resolve())
        )
        self._owner_pid = os.getpid()
        self._paper_lease_file: Any = None
        self._paper_lease_key: str | None = None
        self._paper_lease_active = False
        self._live_account_lease_file: Any = None
        self._live_account_lease_key: str | None = None
        self._live_account_scope_hash: str | None = None
        self._live_db_lease_file: Any = None
        self._live_db_lease_key: str | None = None
        self._live_account_lock = threading.RLock()
        self._submission_depth_by_thread: dict[int, int] = {}
        self._db_lock = threading.RLock()
        self._closed = False
        self._conn = sqlite3.connect(self.path, check_same_thread=False)
        try:
            self._conn.row_factory = sqlite3.Row
            self._conn.executescript(SCHEMA)
            self._migrate_orders()
            self._migrate_paper_client_ids()
            self._migrate_live_client_ids()
            self._migrate_fills()
            self._conn.commit()
        except Exception:
            self._conn.rollback()
            self._conn.close()
            raise

    def _assert_process_owner(self) -> None:
        if os.getpid() != self._owner_pid:
            raise StoreConflict(
                "fork로 상속된 Store는 자식 프로세스에서 사용할 수 없습니다"
            )

    def acquire_paper_lease(self) -> None:
        """파일 DB의 단일 활성 페이퍼 작성자 임대권을 획득한다."""
        self._assert_process_owner()
        if self._closed:
            raise StoreLeaseError("닫힌 Store에서는 페이퍼 임대권을 얻을 수 없습니다")
        if self._paper_lease_active:
            raise StoreLeaseError("이 Store에 이미 활성 페이퍼 브로커가 있습니다")
        if self.path == ":memory:":
            self._paper_lease_active = True
            return

        db_path = Path(self.path).expanduser().resolve()
        try:
            identity = self._paper_db_identity(db_path)
            lease_key, lease_path = self._paper_lease_details(identity)
            lease_file = self._open_secure_lock_file(
                lease_path, label="페이퍼 DB 원장 잠금 파일"
            )
        except StoreConflict as exc:
            raise StoreLeaseError(str(exc)) from exc
        try:
            with _PAPER_LEASE_GUARD:
                if lease_key in _ACTIVE_PAPER_LEASES:
                    raise StoreLeaseError(
                        f"{db_path}에서 페이퍼 브로커가 이미 실행 중입니다"
                    )
                self._lock_lease_file(lease_file)
                try:
                    current_identity = self._paper_db_identity(db_path)
                except StoreConflict as exc:
                    raise StoreLeaseError(str(exc)) from exc
                if current_identity != identity:
                    raise StoreLeaseError(
                        "페이퍼 DB 원장 경로가 임대권 획득 중 바뀌었습니다"
                    )
                _ACTIVE_PAPER_LEASES.add(lease_key)
        except Exception:
            lease_file.close()
            raise

        self._paper_lease_file = lease_file
        self._paper_lease_key = lease_key
        self._paper_lease_active = True

    @staticmethod
    def _paper_db_identity(path: Path) -> tuple[int, int]:
        try:
            metadata = path.lstat()
        except OSError as exc:
            raise StoreConflict("페이퍼 DB 원장 경로를 검사하지 못했습니다") from exc
        if not stat.S_ISREG(metadata.st_mode) or path.is_symlink():
            raise StoreConflict(
                "페이퍼 DB 원장은 심볼릭 링크가 아닌 일반 파일이어야 합니다"
            )
        return metadata.st_dev, metadata.st_ino

    @classmethod
    def _paper_lease_details(
        cls, identity: tuple[int, int]
    ) -> tuple[str, Path]:
        identity_text = f"{identity[0]}:{identity[1]}"
        identity_hash = sha256(identity_text.encode("ascii")).hexdigest()
        return (
            f"paper-db:{identity_text}",
            cls._live_lease_root() / f"paper-{identity_hash}.owner.lock",
        )

    @staticmethod
    def _lock_lease_file(
        lease_file: Any,
        *,
        conflict_message: str = "다른 프로세스에서 페이퍼 브로커가 이미 실행 중입니다",
        error_type: type[RuntimeError] = StoreLeaseError,
    ) -> None:
        try:
            if os.name == "nt":
                import msvcrt

                lease_file.seek(0, os.SEEK_END)
                if lease_file.tell() == 0:
                    lease_file.write(b"\0")
                    lease_file.flush()
                lease_file.seek(0)
                msvcrt.locking(lease_file.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl

                fcntl.flock(
                    lease_file.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB
                )
        except (BlockingIOError, OSError) as exc:
            raise error_type(conflict_message) from exc

    def release_paper_lease(self) -> None:
        self._assert_process_owner()
        if not self._paper_lease_active:
            return
        lease_file = self._paper_lease_file
        lease_key = self._paper_lease_key
        if lease_file is None:
            self._paper_lease_active = False
            return
        try:
            if os.name == "nt":
                import msvcrt

                lease_file.seek(0)
                msvcrt.locking(lease_file.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                import fcntl

                fcntl.flock(lease_file.fileno(), fcntl.LOCK_UN)
        finally:
            lease_file.close()
            self._paper_lease_file = None
            self._paper_lease_key = None
            self._paper_lease_active = False
            if lease_key is not None:
                with _PAPER_LEASE_GUARD:
                    _ACTIVE_PAPER_LEASES.discard(lease_key)

    @staticmethod
    def _live_state_base() -> Path:
        """Return a per-OS-user state path that does not depend on TMPDIR."""
        if os.name != "nt" and hasattr(os, "getuid"):
            try:
                import pwd

                home = Path(pwd.getpwuid(os.getuid()).pw_dir)
            except (KeyError, OSError) as exc:
                raise StoreConflict(
                    "OS 사용자별 라이브 주문 상태 경로를 확인하지 못했습니다"
                ) from exc
            return home / ".local" / "state" / "tossquant"

        local_app_data = os.environ.get("LOCALAPPDATA")
        base = Path(local_app_data) if local_app_data else Path.home()
        return base / "TossQuant" / "state"

    @classmethod
    def _live_lease_root(cls) -> Path:
        state_base = cls._live_state_base()
        try:
            state_base.mkdir(mode=0o700, parents=True, exist_ok=True)
            state_metadata = state_base.lstat()
            if (
                not stat.S_ISDIR(state_metadata.st_mode)
                or state_base.is_symlink()
            ):
                raise StoreConflict(
                    "계좌 공용 라이브 상태 경로가 안전한 폴더가 아닙니다"
                )
            if os.name != "nt" and hasattr(os, "getuid"):
                if state_metadata.st_uid != os.getuid():
                    raise StoreConflict(
                        "계좌 공용 라이브 상태 폴더의 소유자가 다릅니다"
                    )
                if stat.S_IMODE(state_metadata.st_mode) != 0o700:
                    raise StoreConflict(
                        "계좌 공용 라이브 상태 폴더 권한은 0700이어야 합니다"
                    )

            root = state_base / "live-leases"
            root.mkdir(mode=0o700, parents=True, exist_ok=True)
            metadata = root.lstat()
            if not stat.S_ISDIR(metadata.st_mode) or root.is_symlink():
                raise StoreConflict(
                    "계좌 공용 라이브 주문 잠금 경로가 안전한 폴더가 아닙니다"
                )
            if os.name != "nt" and hasattr(os, "getuid"):
                if metadata.st_uid != os.getuid():
                    raise StoreConflict(
                        "계좌 공용 라이브 주문 잠금 폴더의 소유자가 다릅니다"
                    )
                if stat.S_IMODE(metadata.st_mode) != 0o700:
                    raise StoreConflict(
                        "계좌 공용 라이브 주문 잠금 폴더 권한은 0700이어야 합니다"
                    )
        except OSError as exc:
            raise StoreConflict(
                "계좌 공용 라이브 주문 잠금 폴더를 준비하지 못했습니다"
            ) from exc
        return root

    @staticmethod
    def _validate_secure_file(descriptor: int, *, label: str) -> os.stat_result:
        metadata = os.fstat(descriptor)
        if not stat.S_ISREG(metadata.st_mode):
            raise StoreConflict(f"{label}이 올바른 일반 파일이 아닙니다")
        if os.name != "nt" and hasattr(os, "getuid"):
            if metadata.st_uid != os.getuid():
                raise StoreConflict(f"{label}의 소유자가 현재 OS 사용자와 다릅니다")
            if stat.S_IMODE(metadata.st_mode) != 0o600:
                raise StoreConflict(f"{label} 권한은 0600이어야 합니다")
        return metadata

    @classmethod
    def _validate_secure_path_file(
        cls, descriptor: int, path: Path, *, label: str
    ) -> os.stat_result:
        metadata = cls._validate_secure_file(descriptor, label=label)
        try:
            leaf = path.lstat()
        except OSError as exc:
            raise StoreConflict(f"{label} 경로를 검증하지 못했습니다") from exc
        if not stat.S_ISREG(leaf.st_mode):
            raise StoreConflict(f"{label} 경로는 심볼릭 링크일 수 없습니다")
        if (leaf.st_dev, leaf.st_ino) != (metadata.st_dev, metadata.st_ino):
            raise StoreConflict(f"{label} 경로가 여는 동안 바뀌었습니다")
        return metadata

    @classmethod
    def _open_secure_lock_file(cls, path: Path, *, label: str) -> Any:
        common_flags = os.O_RDWR
        if hasattr(os, "O_CLOEXEC"):
            common_flags |= os.O_CLOEXEC
        if hasattr(os, "O_NOFOLLOW"):
            common_flags |= os.O_NOFOLLOW
        created = False
        try:
            try:
                descriptor = os.open(
                    path, common_flags | os.O_CREAT | os.O_EXCL, 0o600
                )
                created = True
            except FileExistsError:
                descriptor = os.open(path, common_flags)
            if created and hasattr(os, "fchmod"):
                os.fchmod(descriptor, 0o600)
            cls._validate_secure_path_file(
                descriptor, path, label=label
            )
            if created:
                cls._fsync_directory(path.parent)
        except (OSError, StoreConflict) as exc:
            if "descriptor" in locals():
                os.close(descriptor)
            if isinstance(exc, StoreConflict):
                raise
            raise StoreConflict(f"{label}을 안전하게 열지 못했습니다") from exc
        return os.fdopen(descriptor, "r+b", buffering=0)

    @staticmethod
    def _fsync_directory(directory: Path) -> None:
        if os.name == "nt":
            return
        flags = os.O_RDONLY
        if hasattr(os, "O_DIRECTORY"):
            flags |= os.O_DIRECTORY
        descriptor = os.open(directory, flags)
        try:
            try:
                os.fsync(descriptor)
            except OSError as exc:
                unsupported = {
                    errno.EINVAL,
                    getattr(errno, "ENOTSUP", errno.EINVAL),
                    getattr(errno, "EOPNOTSUPP", errno.EINVAL),
                }
                if exc.errno not in unsupported:
                    raise
        finally:
            os.close(descriptor)

    @staticmethod
    def _unlock_lease_file(lease_file: Any) -> None:
        if os.name == "nt":
            import msvcrt

            lease_file.seek(0)
            msvcrt.locking(lease_file.fileno(), msvcrt.LK_UNLCK, 1)
        else:
            import fcntl

            fcntl.flock(lease_file.fileno(), fcntl.LOCK_UN)

    @classmethod
    def _acquire_named_live_lease(
        cls,
        lease_key: str,
        lease_path: Path,
        *,
        same_process_message: str,
        other_process_message: str,
        label: str,
    ) -> Any:
        lease_file = cls._open_secure_lock_file(lease_path, label=label)
        try:
            with _LIVE_LEASE_GUARD:
                if lease_key in _ACTIVE_LIVE_LEASES:
                    raise StoreConflict(same_process_message)
                cls._lock_lease_file(
                    lease_file,
                    conflict_message=other_process_message,
                    error_type=StoreConflict,
                )
                _ACTIVE_LIVE_LEASES.add(lease_key)
        except Exception:
            lease_file.close()
            raise
        return lease_file

    @staticmethod
    def _release_named_live_lease(lease_file: Any, lease_key: str) -> None:
        try:
            Store._unlock_lease_file(lease_file)
        finally:
            lease_file.close()
            with _LIVE_LEASE_GUARD:
                _ACTIVE_LIVE_LEASES.discard(lease_key)

    @staticmethod
    def _canonical_live_db_path(path: Path | str) -> str:
        if str(path) == ":memory:":
            raise StoreConflict(
                "라이브 계좌는 재시작 대사가 가능한 파일 DB를 사용해야 합니다"
            )
        return str(Path(path).expanduser().resolve())

    @classmethod
    def _acquire_live_db_path_lease(
        cls, canonical: str, root: Path
    ) -> tuple[Any, str]:
        path_hash = sha256(canonical.encode("utf-8")).hexdigest()
        lease_key = f"live-db:{path_hash}"
        lease_file = cls._acquire_named_live_lease(
            lease_key,
            root / f"db-{path_hash}.owner.lock",
            same_process_message=(
                "같은 DB 원장을 다른 라이브 계좌나 작업이 이미 사용 중입니다"
            ),
            other_process_message=(
                "다른 프로세스가 같은 DB 원장을 이미 사용 중입니다"
            ),
            label="라이브 DB 원장 잠금 파일",
        )
        return lease_file, lease_key

    def _bind_live_ledger_identity(self, scope_hash: str) -> str:
        """Create or validate the immutable ledger/account identity."""
        with self._db_lock:
            try:
                self._conn.execute("BEGIN IMMEDIATE")
                rows = self._conn.execute(
                    "SELECT key, value FROM state WHERE key IN (?, ?)",
                    (_LIVE_LEDGER_UUID_STATE_KEY, _LIVE_ACCOUNT_SCOPE_STATE_KEY),
                ).fetchall()
                values = {row["key"]: json.loads(row["value"]) for row in rows}
                ledger_uuid = values.get(_LIVE_LEDGER_UUID_STATE_KEY)
                recorded_scope = values.get(_LIVE_ACCOUNT_SCOPE_STATE_KEY)

                if ledger_uuid is None and recorded_scope is None:
                    ledger_uuid = uuid.uuid4().hex
                    self._conn.executemany(
                        "INSERT INTO state (key, value) VALUES (?, ?)",
                        (
                            (
                                _LIVE_LEDGER_UUID_STATE_KEY,
                                json.dumps(ledger_uuid),
                            ),
                            (
                                _LIVE_ACCOUNT_SCOPE_STATE_KEY,
                                json.dumps(scope_hash),
                            ),
                        ),
                    )
                elif ledger_uuid is None or recorded_scope is None:
                    raise StoreConflict(
                        "라이브 DB 원장 identity가 불완전합니다. 주문을 수동 대사하세요."
                    )
                elif not (
                    isinstance(ledger_uuid, str)
                    and len(ledger_uuid) == 32
                    and all(ch in "0123456789abcdef" for ch in ledger_uuid)
                ):
                    raise StoreConflict(
                        "라이브 DB 원장 UUID가 손상됐습니다. 주문을 수동 대사하세요."
                    )
                elif recorded_scope != scope_hash:
                    raise StoreConflict(
                        "이 라이브 DB 원장은 다른 계좌에 이미 바인딩되어 있습니다"
                    )
                self._conn.commit()
                return ledger_uuid
            except StoreConflict:
                self._conn.rollback()
                raise
            except (sqlite3.Error, TypeError, ValueError) as exc:
                self._conn.rollback()
                raise StoreConflict(
                    "라이브 DB 원장 identity를 기록하거나 검증하지 못했습니다"
                ) from exc

    def _bind_live_account_db(
        self,
        scope_hash: str,
        root: Path,
        canonical: str,
        ledger_uuid: str,
    ) -> None:
        """Cross-check account, canonical path, and immutable ledger UUID."""
        binding_path = root / f"{scope_hash}.db-binding.json"
        expected = {
            "account_scope_hash": scope_hash,
            "db_path": canonical,
            "ledger_uuid": ledger_uuid,
        }
        payload = json.dumps(
            expected, ensure_ascii=False, sort_keys=True
        ).encode("utf-8")
        flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL
        if hasattr(os, "O_CLOEXEC"):
            flags |= os.O_CLOEXEC
        if hasattr(os, "O_NOFOLLOW"):
            flags |= os.O_NOFOLLOW
        try:
            descriptor = os.open(binding_path, flags, 0o600)
            if hasattr(os, "fchmod"):
                os.fchmod(descriptor, 0o600)
            self._validate_secure_path_file(
                descriptor,
                binding_path,
                label="라이브 계좌 DB 바인딩 파일",
            )
        except StoreConflict:
            os.close(descriptor)
            raise
        except FileExistsError:
            read_flags = os.O_RDONLY
            if hasattr(os, "O_CLOEXEC"):
                read_flags |= os.O_CLOEXEC
            if hasattr(os, "O_NOFOLLOW"):
                read_flags |= os.O_NOFOLLOW
            try:
                descriptor = os.open(binding_path, read_flags)
                try:
                    metadata = self._validate_secure_path_file(
                        descriptor,
                        binding_path,
                        label="라이브 계좌 DB 바인딩 파일",
                    )
                    if metadata.st_size > 65536:
                        raise StoreConflict(
                            "라이브 계좌 DB 바인딩 파일이 너무 큽니다"
                        )
                    raw = b""
                    while True:
                        chunk = os.read(descriptor, 8192)
                        if not chunk:
                            break
                        raw += chunk
                finally:
                    os.close(descriptor)
                recorded = json.loads(raw.decode("utf-8"))
            except (OSError, UnicodeError, json.JSONDecodeError) as exc:
                raise StoreConflict(
                    "라이브 계좌 DB 바인딩을 읽거나 검증하지 못했습니다"
                ) from exc
            if recorded != expected:
                bound = recorded.get("db_path") if isinstance(recorded, dict) else None
                raise StoreConflict(
                    "이 라이브 계좌는 다른 DB 원장 또는 UUID에 바인딩되어 있습니다: "
                    f"{bound!r}. 원래 DB로 실행하거나 주문을 수동 대사하세요."
                )
            return
        except OSError as exc:
            raise StoreConflict(
                "라이브 계좌 DB 바인딩을 만들지 못했습니다"
            ) from exc

        try:
            view = memoryview(payload)
            while view:
                written = os.write(descriptor, view)
                if written <= 0:
                    raise OSError("short write while binding live account DB")
                view = view[written:]
            os.fsync(descriptor)
        except Exception:
            try:
                os.close(descriptor)
            finally:
                # A partial binding is safer left fail-closed, but this process
                # still owns the just-created leaf and can remove it before any
                # account lease or external order exists.
                try:
                    binding_path.unlink()
                    self._fsync_directory(root)
                except OSError:
                    pass
            raise
        else:
            os.close(descriptor)
            self._fsync_directory(root)

    def acquire_live_account_lease(self, account_scope: str) -> None:
        """Own one live account and its durable ledger for this Store lifetime."""
        self._assert_process_owner()
        with self._live_account_lock:
            if self._closed:
                raise StoreConflict(
                    "닫힌 Store에서는 라이브 계좌 소유권을 얻을 수 없습니다"
                )
            self._acquire_live_account_lease(account_scope)

    def _acquire_live_account_lease(self, account_scope: str) -> None:
        if not isinstance(account_scope, str) or not account_scope.strip():
            raise ValueError("live account scope must not be blank")
        scope_hash = sha256(account_scope.encode("utf-8")).hexdigest()
        lease_key = f"live-account:{scope_hash}"
        if self._live_account_lease_file is not None:
            if self._live_account_lease_key == lease_key:
                return
            raise StoreConflict(
                "하나의 Store를 서로 다른 라이브 계좌에 재사용할 수 없습니다"
            )

        root = self._live_lease_root()
        lease_path = root / f"{scope_hash}.owner.lock"
        lease_file = self._acquire_named_live_lease(
            lease_key,
            lease_path,
            same_process_message=(
                "같은 라이브 계좌를 다른 Store가 이미 사용 중입니다"
            ),
            other_process_message=(
                "다른 프로세스가 같은 라이브 계좌를 이미 사용 중입니다"
            ),
            label="라이브 계좌 소유권 잠금 파일",
        )
        db_lease_file: Any = None
        db_lease_key: str | None = None
        try:
            canonical = self._canonical_live_db_path(self.path)
            db_lease_file, db_lease_key = self._acquire_live_db_path_lease(
                canonical, root
            )
            ledger_uuid = self._bind_live_ledger_identity(scope_hash)
            self._bind_live_account_db(
                scope_hash, root, canonical, ledger_uuid
            )
        except Exception:
            if db_lease_file is not None and db_lease_key is not None:
                self._release_named_live_lease(db_lease_file, db_lease_key)
            self._release_named_live_lease(lease_file, lease_key)
            raise

        self._live_account_lease_file = lease_file
        self._live_account_lease_key = lease_key
        self._live_account_scope_hash = scope_hash
        self._live_db_lease_file = db_lease_file
        self._live_db_lease_key = db_lease_key

    def release_live_account_lease(self) -> None:
        self._assert_process_owner()
        with self._live_account_lock:
            if self._submission_depth_by_thread.get(threading.get_ident(), 0):
                raise StoreConflict(
                    "진행 중인 라이브 주문 제출 컨텍스트 안에서는 계좌 "
                    "소유권을 해제할 수 없습니다"
                )
            self._release_live_account_lease()

    def _release_live_account_lease(self) -> None:
        lease_file = self._live_account_lease_file
        lease_key = self._live_account_lease_key
        if lease_file is None:
            return
        try:
            db_lease_file = self._live_db_lease_file
            db_lease_key = self._live_db_lease_key
            if db_lease_file is not None and db_lease_key is not None:
                self._release_named_live_lease(db_lease_file, db_lease_key)
        finally:
            try:
                if lease_key is not None:
                    self._release_named_live_lease(lease_file, lease_key)
            finally:
                self._live_account_lease_file = None
                self._live_account_lease_key = None
                self._live_account_scope_hash = None
                self._live_db_lease_file = None
                self._live_db_lease_key = None

    @classmethod
    @contextmanager
    def _live_db_path_lease(cls, path: Path | str) -> Iterator[str]:
        """Hold the canonical ledger-path lock without opening a DB transaction."""
        canonical = cls._canonical_live_db_path(path)
        root = cls._live_lease_root()
        lease_file, lease_key = cls._acquire_live_db_path_lease(canonical, root)
        try:
            yield canonical
        finally:
            cls._release_named_live_lease(lease_file, lease_key)

    @classmethod
    @contextmanager
    def _paper_db_path_lease(
        cls, canonical: str, expected: tuple[int, int]
    ) -> Iterator[None]:
        """Prevent reset from unlinking a DB used by an active PaperBroker."""
        lease_key, lease_path = cls._paper_lease_details(expected)
        lease_file = cls._open_secure_lock_file(
            lease_path, label="페이퍼 DB 원장 잠금 파일"
        )
        registered = False
        try:
            with _PAPER_LEASE_GUARD:
                if lease_key in _ACTIVE_PAPER_LEASES:
                    raise StoreConflict(
                        "활성 페이퍼 브로커가 이 DB 원장을 사용 중이라 reset할 수 없습니다"
                    )
                cls._lock_lease_file(
                    lease_file,
                    conflict_message=(
                        "다른 프로세스의 활성 페이퍼 브로커가 이 DB 원장을 "
                        "사용 중이라 reset할 수 없습니다"
                    ),
                    error_type=StoreConflict,
                )
                cls._assert_reset_target_identity(Path(canonical), expected)
                _ACTIVE_PAPER_LEASES.add(lease_key)
                registered = True
            yield
        finally:
            try:
                if registered:
                    cls._unlock_lease_file(lease_file)
            finally:
                lease_file.close()
                if registered:
                    with _PAPER_LEASE_GUARD:
                        _ACTIVE_PAPER_LEASES.discard(lease_key)

    @classmethod
    @contextmanager
    def _reset_db_path_leases(
        cls, canonical: str, expected: tuple[int, int]
    ) -> Iterator[str]:
        root = cls._live_lease_root()
        lease_file, lease_key = cls._acquire_live_db_path_lease(
            canonical, root
        )
        try:
            with cls._paper_db_path_lease(canonical, expected):
                yield canonical
        finally:
            cls._release_named_live_lease(lease_file, lease_key)

    @staticmethod
    def _assert_reset_target_identity(
        path: Path, expected: tuple[int, int]
    ) -> os.stat_result:
        try:
            metadata = path.lstat()
        except OSError as exc:
            raise StoreConflict("reset 대상 DB 경로가 검사 후 바뀌었습니다") from exc
        if (
            not stat.S_ISREG(metadata.st_mode)
            or (metadata.st_dev, metadata.st_ino) != expected
        ):
            raise StoreConflict("reset 대상 DB 경로가 검사 후 바뀌었습니다")
        return metadata

    @classmethod
    def _open_reset_target(
        cls, path: Path, expected: tuple[int, int]
    ) -> int:
        flags = os.O_RDONLY
        if hasattr(os, "O_CLOEXEC"):
            flags |= os.O_CLOEXEC
        if hasattr(os, "O_NOFOLLOW"):
            flags |= os.O_NOFOLLOW
        try:
            descriptor = os.open(path, flags)
            metadata = os.fstat(descriptor)
            if (
                not stat.S_ISREG(metadata.st_mode)
                or (metadata.st_dev, metadata.st_ino) != expected
            ):
                raise StoreConflict("reset 대상 DB 경로가 검사 후 바뀌었습니다")
            cls._assert_reset_target_identity(path, expected)
            return descriptor
        except StoreConflict:
            if "descriptor" in locals():
                os.close(descriptor)
            raise
        except OSError as exc:
            if "descriptor" in locals():
                os.close(descriptor)
            raise StoreConflict(
                "reset 대상 DB 경로가 검사 후 바뀌었습니다"
            ) from exc
        except Exception:
            if "descriptor" in locals():
                os.close(descriptor)
            raise

    @classmethod
    def _delete_reset_target(
        cls, path: Path, expected: tuple[int, int]
    ) -> None:
        """Quarantine sidecars first, then delete only the pinned ledger set."""
        quarantine_dir = path.parent / f".{path.name}.reset-{uuid.uuid4().hex}"
        quarantine = quarantine_dir / path.name
        sidecars = tuple(
            Path(f"{path}{suffix}") for suffix in ("-wal", "-shm", "-journal")
        )
        moved_sidecars: list[tuple[Path, Path]] = []
        main_moved = False
        restore_sidecars = True
        try:
            quarantine_dir.mkdir(mode=0o700)
            cls._assert_reset_target_identity(path, expected)

            # Sidecars are path-derived. Move every existing one while the
            # pinned main inode is still the visible leaf; after the main move,
            # only unique quarantine paths may be deleted.
            for sidecar in sidecars:
                try:
                    metadata = sidecar.lstat()
                except FileNotFoundError:
                    continue
                except OSError as exc:
                    raise StoreConflict(
                        "reset 대상 DB sidecar를 검사하지 못했습니다"
                    ) from exc
                if not stat.S_ISREG(metadata.st_mode) or sidecar.is_symlink():
                    raise StoreConflict(
                        "reset 대상 DB sidecar는 심볼릭 링크가 아닌 "
                        "일반 파일이어야 합니다"
                    )
                cls._assert_reset_target_identity(path, expected)
                parked = quarantine_dir / sidecar.name
                os.rename(sidecar, parked)
                parked_metadata = parked.lstat()
                if (
                    not stat.S_ISREG(parked_metadata.st_mode)
                    or (parked_metadata.st_dev, parked_metadata.st_ino)
                    != (metadata.st_dev, metadata.st_ino)
                ):
                    raise StoreConflict(
                        "reset 대상 DB sidecar가 격리 중 바뀌었습니다"
                    )
                moved_sidecars.append((sidecar, parked))

            cls._assert_reset_target_identity(path, expected)
            os.rename(path, quarantine)
            main_moved = True
            restore_sidecars = False
            metadata = quarantine.lstat()
            if not stat.S_ISREG(metadata.st_mode):
                raise StoreConflict(
                    "reset 대상 DB 경로가 삭제 직전에 바뀌었습니다"
                )
            if (metadata.st_dev, metadata.st_ino) != expected:
                restored = False
                try:
                    os.link(quarantine, path, follow_symlinks=False)
                except OSError:
                    # Preserve the unexpected leaf in quarantine if its path
                    # cannot be restored without overwriting another file.
                    pass
                else:
                    # Persist the replacement's visible hardlink before
                    # removing its quarantine link or reporting the conflict.
                    cls._fsync_directory(path.parent)
                    quarantine.unlink()
                    main_moved = False
                    restored = True
                recovery = (
                    f" 격리 자료는 {quarantine_dir}에 보존했습니다."
                    if not restored or moved_sidecars
                    else ""
                )
                raise StoreConflict(
                    "reset 대상 DB 경로가 삭제 직전에 바뀌었습니다"
                    f"{recovery}"
                )

            for _, parked in moved_sidecars:
                parked.unlink()
            moved_sidecars.clear()
            quarantine.unlink()
            main_moved = False
            quarantine_dir.rmdir()
        except StoreConflict:
            raise
        except OSError as exc:
            raise StoreConflict("reset 대상 DB를 안전하게 삭제하지 못했습니다") from exc
        finally:
            if not main_moved:
                # If the main inode never left its path, restore quarantined
                # sidecars without overwriting any concurrently-created leaf.
                if restore_sidecars:
                    for original, parked in reversed(moved_sidecars):
                        try:
                            os.link(parked, original, follow_symlinks=False)
                        except OSError:
                            continue
                        try:
                            parked.unlink()
                        except OSError:
                            pass
                try:
                    quarantine_dir.rmdir()
                except OSError:
                    pass

    @classmethod
    def _live_binding_references_db(cls, root: Path, canonical: str) -> bool:
        """Inspect every secure account binding while reset owns this DB path."""
        for binding_path in root.glob("*.db-binding.json"):
            flags = os.O_RDONLY
            if hasattr(os, "O_CLOEXEC"):
                flags |= os.O_CLOEXEC
            if hasattr(os, "O_NOFOLLOW"):
                flags |= os.O_NOFOLLOW
            try:
                descriptor = os.open(binding_path, flags)
                try:
                    metadata = cls._validate_secure_path_file(
                        descriptor,
                        binding_path,
                        label="라이브 계좌 DB 바인딩 파일",
                    )
                    if metadata.st_size > 65536:
                        raise StoreConflict(
                            "라이브 계좌 DB 바인딩 파일이 너무 큽니다"
                        )
                    raw = b""
                    while True:
                        chunk = os.read(descriptor, 8192)
                        if not chunk:
                            break
                        raw += chunk
                        if len(raw) > 65536:
                            raise StoreConflict(
                                "라이브 계좌 DB 바인딩 파일이 너무 큽니다"
                            )
                finally:
                    os.close(descriptor)
                recorded = json.loads(raw.decode("utf-8"))
            except StoreConflict:
                raise
            except (OSError, UnicodeError, json.JSONDecodeError) as exc:
                raise StoreConflict(
                    "라이브 계좌 DB 바인딩을 읽거나 검증하지 못했습니다"
                ) from exc
            if not isinstance(recorded, dict) or not isinstance(
                recorded.get("db_path"), str
            ):
                raise StoreConflict(
                    "라이브 계좌 DB 바인딩 형식이 손상됐습니다"
                )
            if recorded["db_path"] == canonical:
                return True
        return False

    @classmethod
    def reset_paper_database(cls, path: Path | str) -> bool:
        """Delete an unbound paper ledger while holding its lifetime OS lock."""
        requested = Path(path).expanduser()
        try:
            canonical_path = requested.parent.resolve() / requested.name
            initial = canonical_path.lstat()
        except FileNotFoundError:
            return False
        except OSError as exc:
            raise StoreConflict("reset 대상 DB 경로를 검사하지 못했습니다") from exc
        if not stat.S_ISREG(initial.st_mode):
            raise StoreConflict(
                "reset 대상 DB는 심볼릭 링크가 아닌 일반 파일이어야 합니다"
            )
        expected = (initial.st_dev, initial.st_ino)
        canonical = str(canonical_path)

        with cls._reset_db_path_leases(canonical, expected):
            db_path = canonical_path
            descriptor: int | None = cls._open_reset_target(db_path, expected)
            try:
                try:
                    connection = sqlite3.connect(
                        f"{db_path.as_uri()}?mode=ro", uri=True
                    )
                    try:
                        cls._assert_reset_target_identity(db_path, expected)
                        has_state = connection.execute(
                            "SELECT 1 FROM sqlite_master "
                            "WHERE type = 'table' AND name = 'state'"
                        ).fetchone()
                        if has_state:
                            identity = connection.execute(
                                "SELECT key FROM state WHERE key IN (?, ?) LIMIT 1",
                                (
                                    _LIVE_LEDGER_UUID_STATE_KEY,
                                    _LIVE_ACCOUNT_SCOPE_STATE_KEY,
                                ),
                            ).fetchone()
                            if identity is not None:
                                raise StoreConflict(
                                    "라이브 계좌에 바인딩된 원장은 reset할 수 없습니다. "
                                    "주문을 먼저 수동 대사하세요."
                                )
                    finally:
                        connection.close()
                except StoreConflict:
                    raise
                except sqlite3.Error as exc:
                    raise StoreConflict(
                        "DB 원장의 라이브 바인딩 여부를 검증하지 못해 "
                        "reset을 중단합니다"
                    ) from exc

                if cls._live_binding_references_db(
                    cls._live_lease_root(), canonical
                ):
                    raise StoreConflict(
                        "라이브 계좌에 바인딩된 원장은 reset할 수 없습니다. "
                        "주문을 먼저 수동 대사하세요."
                    )

                cls._assert_reset_target_identity(db_path, expected)
                os.close(descriptor)
                descriptor = None
                cls._delete_reset_target(db_path, expected)

                # Never unlink path-derived sidecars after the pinned main inode
                # has been removed: they may belong to a concurrent replacement.
                cls._fsync_directory(db_path.parent)
                appeared: list[Path] = []
                for candidate in (
                    Path(f"{canonical}-wal"),
                    Path(f"{canonical}-shm"),
                    Path(f"{canonical}-journal"),
                    # A replacement SQLite database creates its main leaf
                    # before its WAL, so inspect the main path last.
                    db_path,
                ):
                    try:
                        candidate.lstat()
                    except FileNotFoundError:
                        continue
                    except OSError as exc:
                        raise StoreConflict(
                            "reset 후 DB 경로를 검증하지 못했습니다"
                        ) from exc
                    appeared.append(candidate)
                if appeared:
                    raise StoreConflict(
                        "reset 중 새 DB leaf가 나타나 교체 원장은 보존했습니다"
                    )
                return True
            finally:
                if descriptor is not None:
                    os.close(descriptor)

    @contextmanager
    def live_submission_lease(
        self,
        symbol: str,
        *,
        is_entry: bool,
        account_scope: str | None = None,
    ) -> Iterator[None]:
        self._assert_process_owner()
        with self._live_account_lock:
            if self._closed:
                raise StoreConflict(
                    "닫힌 Store에서는 라이브 주문을 제출할 수 없습니다"
                )
            thread_id = threading.get_ident()
            self._submission_depth_by_thread[thread_id] = (
                self._submission_depth_by_thread.get(thread_id, 0) + 1
            )
            try:
                with self._live_submission_lease(
                    symbol, is_entry=is_entry, account_scope=account_scope
                ):
                    yield
            finally:
                remaining = self._submission_depth_by_thread[thread_id] - 1
                if remaining:
                    self._submission_depth_by_thread[thread_id] = remaining
                else:
                    del self._submission_depth_by_thread[thread_id]

    @contextmanager
    def _live_submission_lease(
        self,
        symbol: str,
        *,
        is_entry: bool,
        account_scope: str | None = None,
    ) -> Iterator[None]:
        """라이브 주문의 claim→전송→영속화 수명주기를 직렬화한다.

        BUY는 같은 계좌 DB의 진입 임대권과 종목 임대권을 함께 잡아 낡은 현금
        스냅샷으로 여러 종목을 동시에 사는 것을 막는다. SELL은 해당 종목
        임대권만 잡으므로 다른 종목의 미확정 BUY가 안전 청산을 막지 않는다.

        SQLite 트랜잭션은 잡지 않는다. 프로세스가 죽으면 OS 파일 잠금은 풀리며,
        이미 claim을 커밋한 뒤였다면 intent 행이 남아 다음 실행을 fail-closed
        한다. claim 전이었다면 외부 주문도 보내지 않았으므로 재시도할 수 있다.
        """
        normalized = symbol.strip().upper()
        if not normalized:
            raise ValueError("live submission symbol must not be blank")

        if account_scope is not None:
            if not isinstance(account_scope, str) or not account_scope.strip():
                raise ValueError("live account scope must not be blank")
            account_key = sha256(account_scope.encode("utf-8")).hexdigest()
            symbol_key = sha256(normalized.encode("utf-8")).hexdigest()[:16]
            lease_root = self._live_lease_root()
            base_key = f"account:{account_key}"
            targets = [
                (
                    f"{base_key}:symbol:{normalized}",
                    lease_root / f"{account_key}.symbol-{symbol_key}.lock",
                )
            ]
            if is_entry:
                targets.append(
                    (
                        f"{base_key}:entry",
                        lease_root / f"{account_key}.entry.lock",
                    )
                )
        elif self.path == ":memory:":
            base_key = f"memory:{id(self)}"
            targets: list[tuple[str, Path | None]] = [
                (f"{base_key}:symbol:{normalized}", None)
            ]
            if is_entry:
                targets.append((f"{base_key}:entry", None))
        else:
            db_key = str(Path(self.path).expanduser().resolve())
            symbol_key = sha256(normalized.encode("utf-8")).hexdigest()[:16]
            targets = [
                (
                    f"{db_key}:live-symbol:{symbol_key}",
                    Path(f"{db_key}.live-symbol-{symbol_key}.lock"),
                )
            ]
            if is_entry:
                targets.append(
                    (
                        f"{db_key}:live-entry",
                        Path(f"{db_key}.live-entry.lock"),
                    )
                )

        acquired: list[tuple[str, Any]] = []
        try:
            # 모두 non-blocking이지만 순서를 고정해 동시 BUY 사이의 교착 가능성도
            # 없앤다. 일부만 잡은 뒤 충돌하면 finally에서 즉시 되돌린다.
            for lease_key, lease_path in sorted(targets, key=lambda item: item[0]):
                try:
                    lease_file = (
                        self._open_secure_lock_file(
                            lease_path, label="라이브 주문 제출 잠금 파일"
                        )
                        if lease_path is not None
                        else None
                    )
                except (OSError, StoreConflict) as exc:
                    raise StoreConflict(
                        "라이브 주문 제출 잠금 파일을 열지 못해 주문을 중단합니다"
                    ) from exc
                try:
                    with _LIVE_LEASE_GUARD:
                        if lease_key in _ACTIVE_LIVE_LEASES:
                            raise StoreConflict(
                                "같은 계좌 DB에서 충돌하는 라이브 주문 제출이 "
                                "이미 진행 중입니다"
                            )
                        if lease_file is not None:
                            self._lock_lease_file(
                                lease_file,
                                conflict_message=(
                                    "다른 프로세스에서 충돌하는 라이브 주문 "
                                    "제출이 이미 진행 중입니다"
                                ),
                                error_type=StoreConflict,
                            )
                        _ACTIVE_LIVE_LEASES.add(lease_key)
                except Exception:
                    if lease_file is not None:
                        lease_file.close()
                    raise
                acquired.append((lease_key, lease_file))
            yield
        finally:
            for lease_key, lease_file in reversed(acquired):
                try:
                    if lease_file is not None:
                        if os.name == "nt":
                            import msvcrt

                            lease_file.seek(0)
                            msvcrt.locking(lease_file.fileno(), msvcrt.LK_UNLCK, 1)
                        else:
                            import fcntl

                            fcntl.flock(lease_file.fileno(), fcntl.LOCK_UN)
                finally:
                    if lease_file is not None:
                        lease_file.close()
                    with _LIVE_LEASE_GUARD:
                        _ACTIVE_LIVE_LEASES.discard(lease_key)

    def _migrate_orders(self) -> None:
        """구형 DB에 재시작 복구용 주문 필드를 추가한다."""
        columns = {
            row["name"]
            for row in self._conn.execute("PRAGMA table_info(orders)").fetchall()
        }
        additions = {
            "order_type": "TEXT",
            "limit_price": "TEXT",
            "origin": "TEXT",
        }
        for name, sql_type in additions.items():
            if name not in columns:
                self._conn.execute(
                    f"ALTER TABLE orders ADD COLUMN {name} {sql_type}"
                )

    def _migrate_fills(self) -> None:
        """주문 하나가 현금·포지션에 두 번 반영되지 않도록 고유키를 만든다."""
        duplicates = self._conn.execute(
            "SELECT order_id, COUNT(*) AS count FROM fills "
            "GROUP BY order_id HAVING COUNT(*) > 1 ORDER BY order_id LIMIT 10"
        ).fetchall()
        if duplicates:
            detail = ", ".join(
                f"{row['order_id']}={row['count']}" for row in duplicates
            )
            raise StoreMigrationError(
                "중복 체결이 있는 기존 DB에는 fill 고유 제약을 적용할 수 없습니다: "
                f"{detail}. DB를 백업하고 각 주문을 수동 대사하세요."
            )
        self._conn.execute(
            "CREATE UNIQUE INDEX IF NOT EXISTS fills_one_per_order "
            "ON fills(order_id)"
        )

    def _migrate_paper_client_ids(self) -> None:
        """페이퍼 client_order_id를 영속적인 idempotency key로 고정한다."""
        duplicates = self._conn.execute(
            "SELECT client_order_id, COUNT(*) AS count FROM orders "
            "WHERE origin = 'paper' GROUP BY client_order_id "
            "HAVING COUNT(*) > 1 ORDER BY client_order_id LIMIT 10"
        ).fetchall()
        if duplicates:
            detail = ", ".join(
                f"{row['client_order_id']}={row['count']}" for row in duplicates
            )
            raise StoreMigrationError(
                "같은 client_order_id를 쓴 페이퍼 주문이 중복되어 idempotency "
                f"제약을 적용할 수 없습니다: {detail}. DB를 백업하고 주문 원장을 "
                "수동 대사하세요."
            )
        self._conn.execute(
            "CREATE UNIQUE INDEX IF NOT EXISTS paper_client_order_id_once "
            "ON orders(client_order_id) WHERE origin = 'paper'"
        )

    def _migrate_live_client_ids(self) -> None:
        """확정된 라이브 주문의 client ID를 영속 idempotency key로 고정한다.

        intent와 실제 주문은 응답 영속화 중 잠시 같은 client ID를 공유하므로
        ``intent:`` 행은 인덱스에서 제외한다. 구형 ``origin IS NULL`` 주문은
        라이브/미분류일 수 있어 안전하게 같은 제약에 포함한다.
        """
        duplicates = self._conn.execute(
            "SELECT client_order_id, COUNT(*) AS count FROM orders "
            "WHERE (origin IS NULL OR origin = 'live') "
            "AND order_id NOT LIKE 'intent:%' GROUP BY client_order_id "
            "HAVING COUNT(*) > 1 ORDER BY client_order_id LIMIT 10"
        ).fetchall()
        if duplicates:
            detail = ", ".join(
                f"{row['client_order_id']}={row['count']}" for row in duplicates
            )
            raise StoreMigrationError(
                "같은 client_order_id를 쓴 라이브 주문이 중복되어 idempotency "
                f"제약을 적용할 수 없습니다: {detail}. DB를 백업하고 주문 원장을 "
                "수동 대사하세요."
            )
        self._conn.execute(
            "CREATE UNIQUE INDEX IF NOT EXISTS live_client_order_id_once "
            "ON orders(client_order_id) "
            "WHERE (origin IS NULL OR origin = 'live') "
            "AND order_id NOT LIKE 'intent:%'"
        )

    # --- key/value ---------------------------------------------------------

    @_serialized_db
    def get_state(self, key: str, default: Any = None) -> Any:
        row = self._conn.execute("SELECT value FROM state WHERE key = ?", (key,)).fetchone()
        return json.loads(row["value"]) if row else default

    @_serialized_db
    def set_state(self, key: str, value: Any) -> None:
        if key in _LIVE_IDENTITY_STATE_KEYS:
            raise ValueError("라이브 DB 원장 identity는 변경할 수 없습니다")
        self._conn.execute(
            "INSERT INTO state (key, value) VALUES (?, ?) "
            "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            (key, json.dumps(value)),
        )
        self._conn.commit()

    # --- 현금 --------------------------------------------------------------

    @_serialized_db
    def get_cash(self, default: Decimal) -> Decimal:
        raw = self.get_state("cash")
        return Decimal(raw) if raw is not None else default

    @_serialized_db
    def set_cash(self, cash: Decimal) -> None:
        self.set_state("cash", str(cash))

    # --- 포지션 ------------------------------------------------------------

    @_serialized_db
    def load_positions(self) -> dict[str, Position]:
        rows = self._conn.execute("SELECT * FROM positions WHERE quantity != 0").fetchall()
        return {
            row["symbol"]: Position(
                symbol=row["symbol"],
                quantity=row["quantity"],
                avg_price=Decimal(row["avg_price"]),
            )
            for row in rows
        }

    @_serialized_db
    def save_position(self, position: Position) -> None:
        if position.quantity == 0:
            self._conn.execute("DELETE FROM positions WHERE symbol = ?", (position.symbol,))
        else:
            self._conn.execute(
                "INSERT INTO positions (symbol, quantity, avg_price) VALUES (?, ?, ?) "
                "ON CONFLICT(symbol) DO UPDATE SET "
                "quantity = excluded.quantity, avg_price = excluded.avg_price",
                (position.symbol, position.quantity, str(position.avg_price)),
            )
        self._conn.commit()

    # --- 주문/체결 ---------------------------------------------------------

    @staticmethod
    def intent_order_id(client_order_id: str) -> str:
        """브로커 응답 전에도 남길 수 있는 결정적 로컬 주문 ID."""
        return f"intent:{client_order_id}"

    @_serialized_db
    def save_order_intent(self, request: OrderRequest, ts: datetime) -> str:
        """라이브 주문 전송 전에 미확정 의도를 영속화한다.

        네트워크가 끊기면 서버가 주문을 받았는지 알 수 없다. 이 행을 먼저
        커밋해 두면 재시작 뒤에도 같은 종목 주문을 자동 재전송하지 않는다.
        """
        return self.claim_live_intent(request, ts)

    @_serialized_db
    def claim_live_intent(self, request: OrderRequest, ts: datetime) -> str:
        """미확정 fence 확인과 라이브 intent INSERT를 한 트랜잭션으로 묶는다.

        BUY는 계좌 현금이 확정돼야 하므로 어느 종목이든 기존 라이브 미확정
        주문이 있으면 거부한다. SELL은 안전 청산을 막지 않도록 같은 종목의
        미확정 주문만 fence한다. 서로 다른 Store/프로세스도 SQLite write lock
        아래 같은 순서로 검사하므로 둘이 동시에 선조회를 통과할 수 없다.
        """
        order = Order(
            order_id=self.intent_order_id(request.client_order_id),
            client_order_id=request.client_order_id,
            symbol=request.symbol,
            side=request.side,
            quantity=request.quantity,
            filled_quantity=0,
            avg_fill_price=Decimal("0"),
            status=OrderStatus.NEW,
            ts=ts,
        )
        self._validate_order_state(order)
        try:
            self._conn.execute("BEGIN IMMEDIATE")
            used_submission_key = self._conn.execute(
                "SELECT * FROM orders WHERE client_order_id = ? "
                "AND (origin IS NULL OR origin = 'live') LIMIT 1",
                (request.client_order_id,),
            ).fetchone()
            if used_submission_key is not None:
                raise StoreConflict(
                    f"라이브 제출 키 {request.client_order_id}는 이미 주문 "
                    f"{used_submission_key['order_id']}에 사용됐습니다"
                )

            same_symbol = self._conn.execute(
                "SELECT * FROM orders WHERE symbol = ? "
                "AND (origin IS NULL OR origin != 'paper') "
                "AND status IN (?, ?) ORDER BY ts DESC LIMIT 1",
                (
                    request.symbol,
                    OrderStatus.NEW.value,
                    OrderStatus.PARTIALLY_FILLED.value,
                ),
            ).fetchone()
            if same_symbol is not None:
                raise StoreConflict(
                    f"미확정 라이브 주문 {same_symbol['order_id']} "
                    f"({same_symbol['symbol']} {same_symbol['status']})이 남아 있습니다"
                )

            if request.side is Side.BUY:
                unresolved = self._conn.execute(
                    "SELECT * FROM orders "
                    "WHERE (origin IS NULL OR origin != 'paper') "
                    "AND status IN (?, ?) ORDER BY ts DESC LIMIT 1",
                    (
                        OrderStatus.NEW.value,
                        OrderStatus.PARTIALLY_FILLED.value,
                    ),
                ).fetchone()
                if unresolved is not None:
                    raise StoreConflict(
                        f"다른 종목의 미확정 라이브 주문 {unresolved['order_id']} "
                        f"({unresolved['symbol']} {unresolved['status']})이 남아 있습니다"
                    )

            self._conn.execute(
                "INSERT INTO orders (order_id, client_order_id, symbol, side, "
                "quantity, filled_quantity, avg_fill_price, status, ts, reason, "
                "origin) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    order.order_id,
                    order.client_order_id,
                    order.symbol,
                    order.side.value,
                    order.quantity,
                    order.filled_quantity,
                    str(order.avg_fill_price),
                    order.status.value,
                    order.ts.isoformat(),
                    order.reject_reason,
                    "live",
                ),
            )
        except Exception:
            self._conn.rollback()
            raise
        else:
            self._conn.commit()
            return order.order_id

    @_serialized_db
    def clear_order_intent(self, client_order_id: str) -> None:
        self._conn.execute(
            "DELETE FROM orders WHERE order_id = ?",
            (self.intent_order_id(client_order_id),),
        )
        self._conn.commit()

    @_serialized_db
    def reject_order_intent(
        self, client_order_id: str, *, reason: str, ts: datetime
    ) -> None:
        """확정 거부된 제출 키를 terminal tombstone으로 남긴다.

        NEW intent를 지우면 같은 완결 봉을 읽은 경쟁 cycle이 즉시 재전송할 수
        있다. REJECTED는 unresolved fence에는 걸리지 않으므로 다음 봉의 새 키는
        정상 진행하지만, 같은 봉의 키는 다시 사용되지 않는다.
        """
        try:
            cursor = self._conn.execute(
                "UPDATE orders SET status = ?, ts = ?, reason = ? "
                "WHERE order_id = ? AND status = ?",
                (
                    OrderStatus.REJECTED.value,
                    ts.isoformat(),
                    reason,
                    self.intent_order_id(client_order_id),
                    OrderStatus.NEW.value,
                ),
            )
            if cursor.rowcount != 1:
                raise StoreConflict(
                    f"라이브 intent {client_order_id}를 확정 거부 상태로 "
                    "바꾸지 못했습니다"
                )
        except Exception:
            self._conn.rollback()
            raise
        else:
            self._conn.commit()

    @_serialized_db
    def unresolved_order(self, symbol: str) -> sqlite3.Row | None:
        """자동 재주문 전에 사람이/브로커가 확정해야 하는 최신 주문."""
        return self._conn.execute(
            "SELECT * FROM orders WHERE symbol = ? AND status IN (?, ?) "
            "ORDER BY ts DESC LIMIT 1",
            (
                symbol,
                OrderStatus.NEW.value,
                OrderStatus.PARTIALLY_FILLED.value,
            ),
        ).fetchone()

    @_serialized_db
    def unresolved_live_order(self, symbol: str | None = None) -> sqlite3.Row | None:
        """라이브 주문/의도 중 계좌 상태가 확정되지 않은 최신 행."""
        conditions = [
            "(origin IS NULL OR origin != 'paper')",
            "status IN (?, ?)",
        ]
        params: list[Any] = [
            OrderStatus.NEW.value,
            OrderStatus.PARTIALLY_FILLED.value,
        ]
        if symbol is not None:
            conditions.append("symbol = ?")
            params.append(symbol)
        return self._conn.execute(
            "SELECT * FROM orders WHERE "
            + " AND ".join(conditions)
            + " ORDER BY ts DESC LIMIT 1",
            params,
        ).fetchone()

    @_serialized_db
    def pending_paper_orders(self) -> list[sqlite3.Row]:
        """재시작 때 복원하거나 명시적으로 복구해야 하는 페이퍼 주문."""
        return self._conn.execute(
            "SELECT * FROM orders "
            "WHERE origin = 'paper' AND status IN (?, ?) "
            "ORDER BY ts, order_id",
            (OrderStatus.NEW.value, OrderStatus.PARTIALLY_FILLED.value),
        ).fetchall()

    @_serialized_db
    def ambiguous_pending_orders(self) -> list[sqlite3.Row]:
        """origin 마이그레이션 전 행 중 자동 분류하면 위험한 미확정 주문."""
        return self._conn.execute(
            "SELECT * FROM orders WHERE origin IS NULL AND status IN (?, ?) "
            "ORDER BY ts, order_id",
            (OrderStatus.NEW.value, OrderStatus.PARTIALLY_FILLED.value),
        ).fetchall()

    @_serialized_db
    def pending_paper_order(self, order_id: str) -> sqlite3.Row | None:
        return self._conn.execute(
            "SELECT * FROM orders WHERE order_id = ? AND origin = 'paper' "
            "AND status IN (?, ?)",
            (
                order_id,
                OrderStatus.NEW.value,
                OrderStatus.PARTIALLY_FILLED.value,
            ),
        ).fetchone()

    @_serialized_db
    def paper_order_by_client_id(
        self, client_order_id: str
    ) -> sqlite3.Row | None:
        """페이퍼 idempotency key로 기존 주문을 조회한다."""
        return self._conn.execute(
            "SELECT * FROM orders WHERE origin = 'paper' AND client_order_id = ?",
            (client_order_id,),
        ).fetchone()

    @_serialized_db
    def save_pending_paper_order(
        self, order: Order, request: OrderRequest
    ) -> None:
        """미체결 페이퍼 주문과 재구성에 필요한 요청을 한 행에 저장한다."""
        if order.status is not OrderStatus.NEW or order.filled_quantity != 0:
            raise ValueError("pending paper order must be unfilled NEW")
        if not order.order_id.startswith("paper-"):
            raise ValueError("pending paper order id must start with paper-")
        try:
            self._conn.execute(
                "INSERT INTO orders (order_id, client_order_id, symbol, side, quantity, "
                "filled_quantity, avg_fill_price, status, ts, reason, order_type, "
                "limit_price, origin) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    order.order_id,
                    order.client_order_id,
                    order.symbol,
                    order.side.value,
                    order.quantity,
                    order.filled_quantity,
                    str(order.avg_fill_price),
                    order.status.value,
                    order.ts.isoformat(),
                    order.reject_reason,
                    request.order_type.value,
                    str(request.limit_price) if request.limit_price is not None else None,
                    "paper",
                ),
            )
        except Exception:
            self._conn.rollback()
            raise
        else:
            self._conn.commit()

    @_serialized_db
    def save_order(self, order: Order, *, origin: str | None = None) -> None:
        if origin not in {None, "live", "paper"}:
            raise ValueError(f"unsupported order origin {origin!r}")
        if not isinstance(order.order_id, str) or not order.order_id.strip():
            raise ValueError("order_id는 비어 있지 않은 문자열이어야 합니다")
        if origin != "paper" and order.order_id.startswith("intent:"):
            raise ValueError(
                "intent: 주문 ID 예약공간에는 외부 라이브 주문을 저장할 수 없습니다"
            )
        self._validate_order_state(order)
        try:
            self._conn.execute("BEGIN IMMEDIATE")
            existing_row = self._conn.execute(
                "SELECT * FROM orders WHERE order_id = ?", (order.order_id,)
            ).fetchone()
            if existing_row is not None:
                existing = self._order_from_row(existing_row)
                try:
                    self._validate_order_state(existing)
                except ValueError as exc:
                    raise StoreConflict(
                        f"기존 주문 {order.order_id} 상태가 손상됐습니다: {exc}"
                    ) from exc
                if not self._same_order_identity(existing, order):
                    raise StoreConflict(
                        f"주문 ID {order.order_id}가 다른 주문 identity에 재사용됐습니다"
                    )
                existing_origin = existing_row["origin"]
                if (
                    origin is not None
                    and existing_origin is not None
                    and origin != existing_origin
                ):
                    raise StoreConflict(
                        f"주문 ID {order.order_id} origin이 "
                        f"{existing_origin!r}에서 {origin!r}로 바뀌었습니다"
                    )
                resolved_origin = existing_origin or origin
                should_advance = self._validate_order_transition(existing, order)
                if should_advance:
                    self._conn.execute(
                        "UPDATE orders SET filled_quantity = ?, avg_fill_price = ?, "
                        "status = ?, ts = ?, reason = ?, origin = ? WHERE order_id = ?",
                        (
                            order.filled_quantity,
                            str(order.avg_fill_price),
                            order.status.value,
                            order.ts.isoformat(),
                            order.reject_reason,
                            resolved_origin,
                            order.order_id,
                        ),
                    )
                elif resolved_origin != existing_origin:
                    # 구형 행의 명시적 origin 백필만 허용한다. 의미적으로 같은
                    # 상태 재전송은 timestamp까지 포함해 기존 원장을 보존한다.
                    self._conn.execute(
                        "UPDATE orders SET origin = ? WHERE order_id = ?",
                        (resolved_origin, order.order_id),
                    )
            else:
                if origin != "paper":
                    reused_client_id = self._conn.execute(
                        "SELECT order_id FROM orders WHERE client_order_id = ? "
                        "AND (origin IS NULL OR origin = 'live') "
                        "AND order_id NOT LIKE 'intent:%' LIMIT 1",
                        (order.client_order_id,),
                    ).fetchone()
                    if reused_client_id is not None:
                        raise StoreConflict(
                            f"라이브 client_order_id {order.client_order_id!r}가 "
                            f"이미 주문 {reused_client_id['order_id']}에 사용됐습니다"
                        )
                self._conn.execute(
                    "INSERT INTO orders (order_id, client_order_id, symbol, side, "
                    "quantity, filled_quantity, avg_fill_price, status, ts, reason, "
                    "origin) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                    (
                        order.order_id,
                        order.client_order_id,
                        order.symbol,
                        order.side.value,
                        order.quantity,
                        order.filled_quantity,
                        str(order.avg_fill_price),
                        order.status.value,
                        order.ts.isoformat(),
                        order.reject_reason,
                        origin,
                    ),
                )
            self._conn.commit()
        except Exception:
            self._conn.rollback()
            raise

    @_serialized_db
    def record_fill(
        self,
        order_id: str,
        symbol: str,
        side: Side,
        quantity: int,
        price: Decimal,
        commission: Decimal,
        ts: datetime,
    ) -> None:
        self._conn.execute(
            "INSERT INTO fills (order_id, symbol, side, quantity, price, commission, ts) "
            "VALUES (?, ?, ?, ?, ?, ?, ?)",
            (order_id, symbol, side.value, quantity, str(price), str(commission), ts.isoformat()),
        )
        self._conn.commit()

    @staticmethod
    def _order_from_row(row: sqlite3.Row) -> Order:
        return Order(
            order_id=row["order_id"],
            client_order_id=row["client_order_id"],
            symbol=row["symbol"],
            side=Side(row["side"]),
            quantity=row["quantity"],
            filled_quantity=row["filled_quantity"],
            avg_fill_price=Decimal(row["avg_fill_price"]),
            status=OrderStatus(row["status"]),
            ts=datetime.fromisoformat(row["ts"]),
            reject_reason=row["reason"],
        )

    @staticmethod
    def _same_order_identity(stored: Order, incoming: Order) -> bool:
        return (
            stored.order_id == incoming.order_id
            and stored.client_order_id == incoming.client_order_id
            and stored.symbol == incoming.symbol
            and stored.side is incoming.side
            and stored.quantity == incoming.quantity
        )

    @staticmethod
    def _validate_order_state(order: Order) -> None:
        if (
            isinstance(order.quantity, bool)
            or not isinstance(order.quantity, int)
            or order.quantity <= 0
        ):
            raise ValueError("order quantity는 양의 정수여야 합니다")
        if (
            isinstance(order.filled_quantity, bool)
            or not isinstance(order.filled_quantity, int)
            or not 0 <= order.filled_quantity <= order.quantity
        ):
            raise ValueError("filled_quantity는 0과 order quantity 사이여야 합니다")
        if (
            not isinstance(order.avg_fill_price, Decimal)
            or not order.avg_fill_price.is_finite()
            or order.avg_fill_price < 0
        ):
            raise ValueError("avg_fill_price는 0 이상의 유한한 Decimal이어야 합니다")

        filled = order.filled_quantity
        quantity = order.quantity
        average = order.avg_fill_price
        status = order.status
        valid = False
        if status is OrderStatus.NEW:
            valid = filled == 0 and average == 0
        elif status is OrderStatus.PARTIALLY_FILLED:
            valid = 0 < filled < quantity and average > 0
        elif status is OrderStatus.FILLED:
            valid = filled == quantity and average > 0
        elif status is OrderStatus.CANCELED:
            valid = (
                0 <= filled <= quantity
                and ((filled == 0 and average == 0) or (filled > 0 and average > 0))
            )
        elif status is OrderStatus.REJECTED:
            valid = filled == 0 and average == 0
        if not valid:
            raise ValueError(
                f"order status {status.value}와 체결 수량/avg_fill_price가 "
                f"일치하지 않습니다: {filled}/{quantity} @ {average}"
            )

    @staticmethod
    def _same_order_state(stored: Order, incoming: Order) -> bool:
        return (
            stored.status is incoming.status
            and stored.filled_quantity == incoming.filled_quantity
            and stored.avg_fill_price == incoming.avg_fill_price
            and stored.reject_reason == incoming.reject_reason
        )

    @classmethod
    def _validate_order_transition(cls, stored: Order, incoming: Order) -> bool:
        """전진이면 True, 의미적으로 같은 재전송이면 False를 반환한다."""
        if cls._same_order_state(stored, incoming):
            return False

        terminal = {
            OrderStatus.FILLED,
            OrderStatus.CANCELED,
            OrderStatus.REJECTED,
        }
        if stored.status in terminal:
            raise StoreConflict(
                f"terminal 주문 {stored.order_id}의 {stored.status.value} 상태는 "
                f"{incoming.status.value}로 전이할 수 없습니다"
            )
        if incoming.filled_quantity < stored.filled_quantity:
            raise StoreConflict(
                f"주문 {stored.order_id} 체결 수량이 {stored.filled_quantity}에서 "
                f"{incoming.filled_quantity}로 감소했습니다"
            )
        if (
            incoming.filled_quantity == stored.filled_quantity
            and incoming.avg_fill_price != stored.avg_fill_price
        ):
            raise StoreConflict(
                f"주문 {stored.order_id}의 동일 체결 수량에서 평균 체결가가 "
                f"{stored.avg_fill_price}에서 {incoming.avg_fill_price}로 바뀌었습니다"
            )

        allowed = {
            OrderStatus.NEW: {
                OrderStatus.PARTIALLY_FILLED,
                OrderStatus.FILLED,
                OrderStatus.CANCELED,
                OrderStatus.REJECTED,
            },
            OrderStatus.PARTIALLY_FILLED: {
                OrderStatus.PARTIALLY_FILLED,
                OrderStatus.FILLED,
                OrderStatus.CANCELED,
            },
        }
        if incoming.status not in allowed.get(stored.status, set()):
            raise StoreConflict(
                f"주문 {stored.order_id} 상태를 {stored.status.value}에서 "
                f"{incoming.status.value}로 전이할 수 없습니다"
            )
        if (
            stored.status is OrderStatus.PARTIALLY_FILLED
            and incoming.status is OrderStatus.PARTIALLY_FILLED
            and incoming.filled_quantity == stored.filled_quantity
        ):
            raise StoreConflict(
                f"주문 {stored.order_id} PARTIAL 재저장은 체결 수량 증가 또는 "
                "의미적으로 동일한 상태여야 합니다"
            )
        return True

    @_serialized_db
    def settle_fill(
        self,
        order: Order,
        *,
        request: OrderRequest,
        commission: Decimal,
        cash: Decimal,
        position: Position,
        expected_cash: Decimal,
        expected_position: Position | None,
    ) -> FillSettlement:
        """페이퍼 체결을 원자적으로 한 번만 반영하고 재시도는 대사한다."""
        if order.status is not OrderStatus.FILLED:
            raise ValueError("settle_fill requires a FILLED order")
        if order.filled_quantity != order.quantity:
            raise ValueError("settle_fill requires a fully filled order")
        if position.symbol != order.symbol:
            raise ValueError("settlement position symbol does not match order")
        if (
            request.client_order_id != order.client_order_id
            or request.symbol != order.symbol
            or request.side is not order.side
            or request.quantity != order.quantity
        ):
            raise ValueError("settlement request identity does not match order")

        try:
            self._conn.execute("BEGIN IMMEDIATE")
            existing_row = self._conn.execute(
                "SELECT * FROM orders WHERE order_id = ?", (order.order_id,)
            ).fetchone()
            existing_order = (
                self._order_from_row(existing_row) if existing_row else None
            )
            if existing_order is not None and not self._same_order_identity(
                existing_order, order
            ):
                raise StoreConflict(
                    f"주문 ID {order.order_id}가 다른 주문에 이미 사용됐습니다"
                )
            if existing_row is not None and existing_row["origin"] != "paper":
                raise StoreConflict(
                    f"주문 {order.order_id} origin이 paper가 아닙니다: "
                    f"{existing_row['origin']!r}"
                )
            if existing_order is not None and existing_order.status is OrderStatus.FILLED:
                fill_row = self._conn.execute(
                    "SELECT * FROM fills WHERE order_id = ?", (order.order_id,)
                ).fetchone()
                if (
                    existing_order.filled_quantity != existing_order.quantity
                    or fill_row is None
                    or fill_row["symbol"] != existing_order.symbol
                    or fill_row["side"] != existing_order.side.value
                    or fill_row["quantity"] != existing_order.filled_quantity
                    or Decimal(fill_row["price"]) != existing_order.avg_fill_price
                ):
                    raise StoreConflict(
                        f"이미 FILLED인 주문 {order.order_id}의 체결 원장이 불완전합니다"
                    )
                result = FillSettlement(order=existing_order, applied=False)
            else:
                if (
                    existing_order is not None
                    and existing_order.status is not OrderStatus.NEW
                ):
                    raise StoreConflict(
                        f"주문 {order.order_id} 상태 {existing_order.status.value}에서는 "
                        "FILLED로 전환할 수 없습니다"
                    )

                cash_row = self._conn.execute(
                    "SELECT value FROM state WHERE key = 'cash'"
                ).fetchone()
                actual_cash = (
                    Decimal(json.loads(cash_row["value"])) if cash_row else None
                )
                position_row = self._conn.execute(
                    "SELECT * FROM positions WHERE symbol = ?", (order.symbol,)
                ).fetchone()
                actual_position = (
                    Position(
                        symbol=position_row["symbol"],
                        quantity=position_row["quantity"],
                        avg_price=Decimal(position_row["avg_price"]),
                    )
                    if position_row
                    else None
                )
                if actual_cash != expected_cash or actual_position != expected_position:
                    raise StoreConflict(
                        "페이퍼 계좌 상태가 다른 작성자에 의해 변경됐습니다: "
                        f"cash {expected_cash} -> {actual_cash}, "
                        f"position {expected_position!r} -> {actual_position!r}"
                    )

                if position.quantity == 0:
                    self._conn.execute(
                        "DELETE FROM positions WHERE symbol = ?", (position.symbol,)
                    )
                else:
                    self._conn.execute(
                        "INSERT INTO positions (symbol, quantity, avg_price) "
                        "VALUES (?, ?, ?) ON CONFLICT(symbol) DO UPDATE SET "
                        "quantity = excluded.quantity, avg_price = excluded.avg_price",
                        (position.symbol, position.quantity, str(position.avg_price)),
                    )

                if existing_order is None:
                    self._conn.execute(
                        "INSERT INTO orders (order_id, client_order_id, symbol, side, "
                        "quantity, filled_quantity, avg_fill_price, status, ts, reason, "
                        "order_type, limit_price, origin) "
                        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                        (
                            order.order_id,
                            order.client_order_id,
                            order.symbol,
                            order.side.value,
                            order.quantity,
                            order.filled_quantity,
                            str(order.avg_fill_price),
                            order.status.value,
                            order.ts.isoformat(),
                            order.reject_reason,
                            request.order_type.value,
                            (
                                str(request.limit_price)
                                if request.limit_price is not None
                                else None
                            ),
                            "paper",
                        ),
                    )
                else:
                    cursor = self._conn.execute(
                        "UPDATE orders SET filled_quantity = ?, avg_fill_price = ?, "
                        "status = ?, ts = ?, reason = ? "
                        "WHERE order_id = ? AND status = ?",
                        (
                            order.filled_quantity,
                            str(order.avg_fill_price),
                            order.status.value,
                            order.ts.isoformat(),
                            order.reject_reason,
                            order.order_id,
                            OrderStatus.NEW.value,
                        ),
                    )
                    if cursor.rowcount != 1:
                        raise StoreConflict(
                            f"주문 {order.order_id}의 NEW→FILLED 전환에 실패했습니다"
                        )

                self._conn.execute(
                    "INSERT INTO fills (order_id, symbol, side, quantity, price, "
                    "commission, ts) VALUES (?, ?, ?, ?, ?, ?, ?)",
                    (
                        order.order_id,
                        order.symbol,
                        order.side.value,
                        order.filled_quantity,
                        str(order.avg_fill_price),
                        str(commission),
                        order.ts.isoformat(),
                    ),
                )
                self._conn.execute(
                    "INSERT INTO state (key, value) VALUES ('cash', ?) "
                    "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                    (json.dumps(str(cash)),),
                )
                result = FillSettlement(order=order, applied=True)
        except Exception:
            self._conn.rollback()
            raise
        else:
            self._conn.commit()
            return result

    @_serialized_db
    def order_commission(self, order_id: str) -> Decimal:
        row = self._conn.execute(
            "SELECT COALESCE(SUM(CAST(commission AS REAL)), 0) AS total "
            "FROM fills WHERE order_id = ?",
            (order_id,),
        ).fetchone()
        return Decimal(str(row["total"]))

    @_serialized_db
    def recent_orders(self, limit: int = 20) -> list[sqlite3.Row]:
        return self._conn.execute(
            "SELECT * FROM orders ORDER BY ts DESC LIMIT ?", (limit,)
        ).fetchall()

    # --- 포지션 추적 (손절·트레일링·쿨다운) --------------------------------

    @_serialized_db
    def load_tracking(self, symbol: str) -> sqlite3.Row | None:
        return self._conn.execute(
            "SELECT * FROM position_tracking WHERE symbol = ?", (symbol,)
        ).fetchone()

    @_serialized_db
    def all_tracking(self) -> list[sqlite3.Row]:
        return self._conn.execute("SELECT * FROM position_tracking").fetchall()

    @_serialized_db
    def save_tracking(
        self,
        symbol: str,
        *,
        high_water: Decimal | None,
        opened_at: datetime | None,
        blocked_until: datetime | None,
    ) -> None:
        self._conn.execute(
            "INSERT INTO position_tracking (symbol, high_water, opened_at, blocked_until) "
            "VALUES (?, ?, ?, ?) "
            "ON CONFLICT(symbol) DO UPDATE SET "
            "high_water = excluded.high_water, opened_at = excluded.opened_at, "
            "blocked_until = excluded.blocked_until",
            (
                symbol,
                str(high_water) if high_water is not None else None,
                opened_at.isoformat() if opened_at else None,
                blocked_until.isoformat() if blocked_until else None,
            ),
        )
        self._conn.commit()

    @_serialized_db
    def delete_tracking(self, symbol: str) -> None:
        self._conn.execute("DELETE FROM position_tracking WHERE symbol = ?", (symbol,))
        self._conn.commit()

    # --- 평가액 곡선 -------------------------------------------------------

    @_serialized_db
    def record_equity(self, equity: Decimal, cash: Decimal, ts: datetime | None = None) -> None:
        moment = ts or datetime.now(timezone.utc)
        self._conn.execute(
            "INSERT INTO equity_curve (ts, equity, cash) VALUES (?, ?, ?) "
            "ON CONFLICT(ts) DO UPDATE SET equity = excluded.equity, cash = excluded.cash",
            (moment.isoformat(), str(equity), str(cash)),
        )
        self._conn.commit()

    @_serialized_db
    def equity_history(self, limit: int = 100) -> list[sqlite3.Row]:
        return self._conn.execute(
            "SELECT * FROM equity_curve ORDER BY ts DESC LIMIT ?", (limit,)
        ).fetchall()

    def close(self) -> None:
        self._assert_process_owner()
        # Acquire in the same account -> DB order used by live ownership. The
        # old serialized wrapper took DB -> account and could deadlock a close
        # racing first live acquisition on this Store.
        with self._live_account_lock:
            if self._submission_depth_by_thread.get(threading.get_ident(), 0):
                raise StoreConflict(
                    "진행 중인 라이브 주문 제출 컨텍스트 안에서는 Store를 "
                    "닫을 수 없습니다"
                )
            if self._closed:
                return
            try:
                self._release_live_account_lease()
            finally:
                try:
                    self.release_paper_lease()
                finally:
                    with self._db_lock:
                        self._conn.close()
                        self._closed = True
