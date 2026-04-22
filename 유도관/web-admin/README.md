# 유도관 회원 관리 웹 (PC)

모바일 앱의 **회원** 탭(`app/(tabs)/members.tsx`)과 같은 데이터 소스(**tRPC `members.list`**)·같은 정렬·검색 규칙을 웹 테이블로 옮긴 관리자용 화면입니다.

## 필요한 것

1. **API 서버** — 저장소 루트에서 `cd 유도관 && pnpm dev:server` (또는 `pnpm dev`에 포함된 서버). 기본 `http://127.0.0.1:3000`.
2. **관리자 세션** — `manager` 또는 `admin` 역할의 Bearer JWT. (모바일 앱과 동일한 토큰.)

## 실행

```bash
cd 유도관/web-admin
cp .env.example .env   # 필요 시 VITE_API_BASE_URL 수정
pnpm install
pnpm dev
```

브라우저: **http://localhost:5180** — API 베이스·토큰 입력 후 **회원 목록 불러오기**.

## 모바일만 쓸 때

별도 웹 없이도 `pnpm dev`의 Expo Web(기본 8081)에서 동일 탭 UI를 쓸 수 있습니다. 이 폴더는 **PC 전용 가벼운 테이블**이 필요할 때만 사용하면 됩니다.
