<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## 파이널 유도 멀티짐 하위 에이전트 조직

- 복합 작업은 [docs/TEAM_AGENT_PROMPTS.md](docs/TEAM_AGENT_PROMPTS.md)의 11팀 체계를 따른다.
- 기본 작업 방식은 주 에이전트 단독 수행이다. 사용자에게 사전 승인을 받기 전에는 하위 에이전트를 생성하거나 추가하지 않는다.
- 하위 에이전트가 꼭 필요하면 생성 전에 필요성, 투입 인원, 팀·역할, 담당 범위, 파일 소유권과 기대 결과를 사용자에게 설명하고 명시적 승인을 받는다. 이전 승인이나 11팀 조직 정의를 새 투입의 승인으로 간주하지 않는다.
- 1~10팀은 각 5명, 11팀은 유도장 현장 운영 담당 10명으로 구성한다. 주 에이전트는 60명에 포함하지 않는 통합 책임자다.
- 승인 후에도 실제로 사용 가능한 하위 에이전트와 독립 작업이 있을 때만 팀을 투입한다. 인원수를 채우기 위한 작업은 만들지 않는다.
- 일반 작업은 관련 팀 2~4개만 활성화하고 파일 소유 범위를 겹치지 않게 한다. 공통 파일은 한 팀만 수정한다.
- 11팀은 실제 유도장 운영 시나리오와 인수 조건을 검증하며, 운영 정책을 임의로 확정하거나 실제 결제·발송·개인정보 변경을 수행하지 않는다.
- 하위 에이전트 결과는 주 에이전트가 실제 diff와 통합 테스트로 다시 검증해야 완료로 인정한다.
