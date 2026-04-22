from fastapi.testclient import TestClient

from app.main import app


def test_product_vision_response_shape() -> None:
    client = TestClient(app)
    response = client.get("/v1/product-vision")
    assert response.status_code == 200
    data = response.json()
    assert data["one_liner"]
    assert len(data["differentiation"]) == 3
    assert all(isinstance(s, str) for s in data["differentiation"])
    paths = data["doc_paths"]
    assert paths.get("competitive_comparison") == "docs/product/competitive-comparison.md"
    assert paths.get("differentiation") == "docs/product/strategic-differentiation.md"
    assert len(data["scenarios"]) == 3
    assert {s["id"] for s in data["scenarios"]} == {"S1", "S2", "S3"}


def test_cors_allows_local_admin_origin() -> None:
    client = TestClient(app)
    response = client.options(
        "/v1/product-vision",
        headers={
            "Origin": "http://localhost:5173",
            "Access-Control-Request-Method": "GET",
        },
    )
    assert response.status_code == 200
    assert response.headers.get("access-control-allow-origin") == "http://localhost:5173"


def test_cors_allows_lan_vite_origin_when_cors_env_unset() -> None:
    client = TestClient(app)
    origin = "http://192.168.77.88:5173"
    response = client.options(
        "/v1/product-vision",
        headers={
            "Origin": origin,
            "Access-Control-Request-Method": "GET",
        },
    )
    assert response.status_code == 200
    assert response.headers.get("access-control-allow-origin") == origin
