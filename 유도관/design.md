# JudoManager - 유도장 회원 관리 앱 설계

## 앱 개요
유도장 원장/관리자가 회원을 등록하고, 출석을 기록하며, 수강료 납부를 관리하는 모바일 앱.

## 역할 구조
- **admin / manager**: 원장 및 관리자 — 모든 기능 접근 가능
- **member**: 회원 — 본인 출석, 납부 내역, 일정 조회만 가능

---

## 화면 목록

### 관리자 탭 (admin/manager)
| 화면 | 설명 |
|------|------|
| 홈 (대시보드) | 오늘 출석 현황, 미납 회원 수, 이번 달 매출 요약 |
| 회원 목록 | 전체 회원 검색/필터, 등급(띠) 표시, 활성/휴회/탈퇴 상태 |
| 회원 상세 | 개인 정보, 출석 이력, 납부 이력, 등급 변경 |
| 출석 관리 | 날짜별 출석 체크, 수동 입력 |
| 납부 관리 | 수강료 납부 등록, 미납 목록, 납부 이력 |

### 회원 탭 (member)
| 화면 | 설명 |
|------|------|
| 내 현황 | 출석률, 남은 수강 기간, 등급(띠) 표시 |
| 출석 이력 | 월별 출석 캘린더 뷰 |
| 납부 내역 | 납부 이력 및 다음 납부일 안내 |
| 공지사항 | 도장 공지 및 대회 일정 |

---

## 핵심 데이터 모델

### members (회원)
- id, userId (auth 연동), name, phone, email, birthDate
- beltRank (white/yellow/orange/green/blue/brown/black)
- beltDegree (1~9단)
- status (active/suspended/withdrawn)
- joinDate, monthlyFee
- emergencyContact, notes, avatarUrl

### attendance (출석)
- id, memberId, date, checkInTime, type (regular/makeup/trial)
- recordedBy (관리자 ID)

### payments (납부)
- id, memberId, amount, paidAt, periodStart, periodEnd
- method (cash/card/transfer), notes
- recordedBy

### announcements (공지사항)
- id, title, content, isPinned, createdAt, createdBy

---

## 색상 테마
- Primary: `#1E3A5F` (진한 네이비 — 유도복 색상 연상)
- Accent: `#E63946` (빨간 포인트)
- Background: `#F0F4F8` / `#0D1117` (다크)
- Surface: `#FFFFFF` / `#161B22` (다크)
- Foreground: `#0D1117` / `#E6EDF3` (다크)
- Muted: `#57606A` / `#8B949E` (다크)
- Border: `#D0D7DE` / `#30363D` (다크)
- Success: `#2DA44E`
- Warning: `#F4A261`
- Error: `#CF222E`

---

## 주요 사용자 흐름
1. 관리자 로그인 → 홈 대시보드 → 오늘 출석 현황 확인
2. 회원 목록 → 회원 검색 → 회원 상세 → 출석/납부 이력 확인
3. 출석 관리 탭 → 날짜 선택 → 회원 목록에서 출석 체크
4. 납부 관리 탭 → 미납 회원 확인 → 납부 등록
5. 회원 로그인 → 내 현황 → 출석 이력 캘린더 확인
