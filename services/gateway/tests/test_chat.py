from fastapi.testclient import TestClient

from app.main import app


def test_chat_endpoint() -> None:
    client = TestClient(app)
    payload = {
        "user_id": "u1",
        "session_id": "s1",
        "message": "hello",
        "temperature": 0.3,
    }
    response = client.post("/v1/chat", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert "answer" in data
    assert data["provider"] in ["openai", "anthropic"]
