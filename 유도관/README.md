# 유도관 (도장 회원 관리)

Expo 기반 **유도 도장 운영** 앱입니다. 회원·출석·납부·공지·승급 심사·관리자 기능을 포함합니다.  
**의학·난관(생식) 클리닉 용도가 아닙니다.**

## 스택

- **클라이언트:** Expo Router, React Native, NativeWind  
- **서버:** Express + tRPC, `server/routers.ts`, `server/_core/*`  
- **DB:** MySQL + Drizzle (`drizzle/schema.ts`)  
- **인증:** Manus OAuth + 소셜(카카오·구글·인스타 등) — `server/README.md` 참고

## 실행

```bash
pnpm install
pnpm dev
```

DB·`.env`는 저장소 루트의 `server/README.md` 및 `.env.example`을 따른다.

## EAS 빌드 프로필

`eas.json` — **development** / **preview** / **production** 각각 `channel`·`EXPO_PUBLIC_APP_ENV` 로 구분해 두었다. API 베이스 URL 등은 프로필별로 `EXPO_PUBLIC_API_BASE_URL` 을 EAS Secrets·프로필 `env`에 맞춰 넣으면 된다.

## PC 웹 회원 관리 (모바일 `members` 참고)

모바일 **회원** 탭과 동일한 tRPC(`members.list` 등)를 쓰는 가벼운 테이블 UI:

- [web-admin/README.md](web-admin/README.md) — `pnpm dev:web-admin` (API는 별도로 `pnpm dev:server` 필요)
- 같은 저장소의 Expo Web(`pnpm dev`에 포함)으로도 모바일과 거의 동일한 화면을 브라우저에서 쓸 수 있다.

## 이 모노레포(`mobile-genai-template`)와의 관계

루트의 `apps/ios`·`apps/android`·`services/gateway`(FastAPI)와는 **별도 클라이언트/백엔드 스택**이다. 통합·LLM 공유 전략은 루트 [`README.md`](../README.md)와 [`docs/architecture.md`](../docs/architecture.md)(및 [`docs/architecture/README.md`](../docs/architecture/README.md))를 참고한다.

## 브랜딩 메모

- 앱 표시 이름: **유도관** (`app.config.ts`의 `appName`)  
- Expo slug: `judokan`  
- 레거시 딥링크 스킴: `judomanager` (호환 유지)
