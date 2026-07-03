# 파이널 유도 멀티짐 MVP 접근성 점검

작성일: 2026-06-13
점검 환경: Codex in-app Browser, `http://localhost:3000`

## 1. 요약

| 항목 | 결과 | 근거 |
| --- | --- | --- |
| 모바일 가로 오버플로 | 통과 | 390 x 844 뷰포트에서 `/app/classes` `scrollWidth = 390` |
| 코치 출석 버튼 터치 크기 | 통과 | 출석 상태 버튼 48px 높이, 158px 너비 |
| 이름 없는 버튼 | 통과 | 모바일 `/app/classes` visible button 중 텍스트/aria-label 없는 항목 없음 |
| 상태 구분 | 통과 | 출석/결제/공지 상태가 색상과 텍스트를 함께 사용 |
| 포커스 스타일 | 통과 | `src/app/globals.css`에 `:focus-visible` outline 정의 |
| 직접 URL 403 | 통과 | 코치의 `/app/admin/roles`, `/app/payments` 접근 권한 없음 확인 |
| 주요 화면 반응형 | 통과 | 320/390/768/1440px 스캔에서 coach 주요 화면 가로 오버플로 없음 |
| 어드민 모바일 매트릭스 | 통과 | 390px에서 `/app/admin/roles` 문서 가로 오버플로 수정 후 없음 |
| Lighthouse 접근성 | 통과 | `/login` 접근성 카테고리 100점, 실패 audit 0개 |
| 정적 접근성 가드레일 | 통과 | `npm run test:a11y-static` 버튼 이름, 폼 라벨, 이미지 alt, 양수 tabIndex 검사 통과 |

## 2. 실제 브라우저 점검 기록

### `/app/classes` 코치 모바일

- 뷰포트: 390 x 844
- 결과:
  - 가로 오버플로 없음
  - 수업 단위 전체 출석 버튼 44px 이상
  - 출석/지각/결석/사유 있음 버튼 모두 48px 이상
  - 하단 모바일 내비게이션 표시
  - 출석 저장 상태 영역과 대기 출석 재시도 버튼 이름 표시
  - visible button 중 접근 가능한 이름이 없는 버튼 없음

### 권한 화면

- 코치로 `/app/admin/roles` 직접 접근 시 권한 없음 화면 확인
- 코치로 `/app/payments` 직접 접근 시 권한 없음 화면 확인
- 총괄 어드민으로 `/app/admin/roles` 접근 시 사용자/역할 목록과 권한 매트릭스 표시
- 390px 모바일에서 권한 매트릭스는 내부 가로 스크롤로 제한되고 문서 전체 오버플로 없음

### 반응형 스캔

- 코치 `/app/dashboard`, `/app/classes`, `/app/notices`: 320/390/768/1440px에서 가로 오버플로 없음
- 대표 `/app/dashboard`: 390/1440px에서 가로 오버플로 없음
- 총괄 어드민 `/app/admin/roles`: 390/1440px에서 가로 오버플로 없음
- 모든 스캔 대상에서 visible button 중 이름 없는 버튼 없음

### Lighthouse 자동 검사

- 대상: `http://localhost:3000/login`
- 명령: `CHROME_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" npx --yes lighthouse@latest http://localhost:3000/login --only-categories=accessibility --chrome-flags="--headless=new --no-sandbox" --output=json --output-path=.data/lighthouse-login.json --quiet`
- 결과: 접근성 100점, 실패 audit 0개

### 정적 접근성 가드레일

- 명령: `npm run test:a11y-static`
- 결과:
  - 네이티브 버튼 접근 가능한 이름 확인
  - 폼 컨트롤 라벨 연결 확인
  - 이미지 alt 확인
  - 양수 `tabIndex` 사용 차단
  - alert/status 기본 힌트 확인

## 3. 수동 추가 확인 권장

파일럿 전 실제 브라우저에서 다음 항목을 한 번 더 확인한다.

| 항목 | 권장 절차 |
| --- | --- |
| 키보드 이동 | Tab/Shift+Tab으로 로그인, AppShell, 출석 버튼, 공지 읽음 버튼, 권한 화면을 순서대로 이동 |
| 스크린리더 | macOS VoiceOver 또는 Android TalkBack으로 모바일 출석 상태 버튼과 공지 읽음 상태를 읽고 `docs/pilot-templates/pilot-field-evidence.template.json`의 기대/실제 낭독, 이슈 없음, 증빙 링크를 기록 |
| 색 대비 | 운영 주요 화면을 axe 또는 Lighthouse로 추가 확인 |
| 확대 | 브라우저 200% 확대에서 주요 화면 텍스트 겹침 여부 확인 |
| 모바일 실기기 | iOS Safari/Android Chrome에서 하단 nav와 sticky 저장 상태 겹침 여부 확인 |

## 4. 남은 리스크

- Lighthouse 자동 접근성 검사는 로그인 화면에서 통과했고, 정적 접근성 가드레일도 통과했다. 인증 후 운영 주요 화면 자동 axe 검사는 추가 권장이다.
- 실제 스크린리더 낭독 품질은 수동 확인이 필요하다. 단, 파일럿 종료 manifest는 출석 상태와 공지 읽음 상태의 기대/실제 낭독, 이슈 없음, 메모, 증빙 링크 누락을 `npm run test:pilot-field-evidence`로 차단한다.
- 권한 매트릭스는 모바일에서 가로 스크롤로 읽히며, 편집형 매트릭스 자동화는 P1에서 보강한다.
