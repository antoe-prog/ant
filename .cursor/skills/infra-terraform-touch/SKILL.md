---
name: infra-terraform-touch
description: >-
  Checklist when editing infra/terraform or infra/local: gateway env, ports,
  docs, and CI. Use for docker-compose, Terraform placeholders, or AWS region.
  Korean: 인프라, 테라폼, compose.
---

# 인프라·Terraform 손댈 때

## 관련 스킬

- 로컬: [mobile-genai-local-dev](../mobile-genai-local-dev/SKILL.md)  
- 영향 범위: [monorepo-change-blast-radius](../monorepo-change-blast-radius/SKILL.md)

## 이 레포 앵커

- Compose: [`infra/local/docker-compose.yml`](../../../infra/local/docker-compose.yml) — Postgres 5432, Redis 6379  
- Terraform: [`infra/terraform/main.tf`](../../../infra/terraform/main.tf) — 플레이스홀더

## 체크리스트

- [ ] 게이트웨이 `.env`의 DB/Redis **호스트·포트**와 compose가 맞는가  
- [ ] `docs`·`README`에 **로컬 부팅** 한 줄 갱신이 필요한가  
- [ ] CI가 인프라를 쓰지 않으면 **변경 없음** 명시
