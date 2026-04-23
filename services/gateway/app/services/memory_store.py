from collections import defaultdict


class MemoryStore:
    def __init__(self, max_turns: int = 8) -> None:
        self.max_turns = max_turns
        self._sessions: dict[str, list[dict[str, str]]] = defaultdict(list)

    def append(self, session_id: str, role: str, text: str) -> None:
        self._sessions[session_id].append({"role": role, "text": text})
        self._sessions[session_id] = self._sessions[session_id][-self.max_turns :]

    def get_context(self, session_id: str) -> list[dict[str, str]]:
        return self._sessions.get(session_id, [])
