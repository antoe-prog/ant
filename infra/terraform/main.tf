terraform {
  required_version = ">= 1.6.0"
}

provider "aws" {
  region = "ap-northeast-2"
}

# Placeholder infra template.
# Add VPC, ECS/AppRunner, RDS(Postgres), ElastiCache(Redis) resources here.
