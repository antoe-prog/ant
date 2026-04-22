from fastapi.testclient import TestClient

from app.main import app


def test_openapi_lists_core_paths() -> None:
    client = TestClient(app)
    response = client.get("/openapi.json")
    assert response.status_code == 200
    paths = response.json().get("paths", {})
    for path in ("/health", "/v1/chat", "/v1/product-vision", "/v1/usage", "/v1/models"):
        assert path in paths, f"missing OpenAPI path: {path}"
