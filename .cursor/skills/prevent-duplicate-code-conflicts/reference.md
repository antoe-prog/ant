# 참고: 감사·리뷰 템플릿

## 레이어 간 동일 개념 감사

다음 쌍을 같은 PR에서 대조한다.

- 모바일 기본 URL ↔ 게이트웨이 `main` 라우트 prefix  
- `product_vision` / 프롬프트 레지스트리 ↔ `docs/product/*.md`  
- 요청 DTO ↔ OpenAPI 또는 `schemas.py`  
- 환경 변수 이름 ↔ `.env.example` ↔ 배포 문서  

## 머지 후 스모크 (수동)

1. 앱 한 화면에서 **끝까지 한 유저 플로우**  
2. 게이트웨이 `/health`, 변경된 엔드포인트 **각 한 번**  
3. 로그에 **동일 요청 이중 처리** 흔적이 없는지  

## 팀 규칙 예시 (필요 시 복사)

- “비전·시나리오 문자열 변경 = `app/product_vision.py` + 관련 md 동시 커밋”  
- “클라이언트에 하드코딩 금지 항목: 베이스 URL, 비전 문구 → 원격 설정 또는 빌드 타입별 단일 소스”

## CI drift checks

- SSOT 파일(예: `app/product_vision.py`)에서 export되는 **키 목록**과, 문서·다른 코드에 등장해야 하는 문자열 집합을 **한 스크립트**로 비교한다.  
- 또는 “금지 패턴”만 검사: 예) `docs/product/`에만 있어야 할 문구가 `*.kt` / `*.swift`에 하드코딩되어 있지 않은지 `rg`로 검사.  
- 실패 시 메시지에 **어느 쪽이 SSOT인지** 한 줄 안내를 넣어 머지 담당자가 바로 고치게 한다.

**이 레포:** `services/gateway`에서 `python scripts/check_ssot_docs.py` — `ONE_LINER`와 시나리오 `id`가 `docs/product/`의 해당 md에 존재하는지 검사한다. CI `gateway-tests` 잡에서 실행된다.

## rg 복붙 패턴 (금지·중복 탐지)

저장소 루트에서 실행 예시(필요 시 경로 조정).

```bash
# 동일 라우트 덮어쓰기 의심
rg '@app\.(get|post)' services/gateway/app

# product_vision 문자열이 모바일에 하드코딩됐는지(정책에 따라 조정)
rg '바쁜 개인 사용자가' apps/

# 이전 필드명 잔재 (브레이킹 후)
rg 'old_field_name' services/gateway apps docs

# TODO로 남은 대체 구현
rg 'TODO.*(chat|gateway|replace)' services/gateway apps
```

실패 시 메시지 예: `SSOT는 app/product_vision.py — md만 고치지 말 것.`
