# Local development infrastructure

```bash
bash scripts/dev/init-local-env.sh          # writes infra/local/.env with random local-only values
docker compose -f infra/local/docker-compose.yml --env-file infra/local/.env up -d
```

| Service | Purpose | Local endpoint |
|---|---|---|
| postgres | System of record (Aurora PostgreSQL in AWS) | 127.0.0.1:5432 |
| redis | Cache / ephemeral coordination | 127.0.0.1:6379 |
| opensearch | Derived search index | 127.0.0.1:9200 |
| s3 (LocalStack) | S3-compatible object storage and KMS | 127.0.0.1:4566 |
| kafka (Redpanda) | Kafka-compatible event backbone | 127.0.0.1:19092 |
| temporal / temporal-ui | Durable workflow runtime | 127.0.0.1:7233 / :8233 |
| opa | Policy decision point (policies in `policy/opa`) | 127.0.0.1:8181 |
| otel-collector / jaeger | Telemetry pipeline and trace UI | 127.0.0.1:4317-4318 / :16686 |

Every external provider (payment, OTP, SMS, email, DigiLocker, eSign, department APIs) runs
in SIMULATED mode locally (Eng v1.4 s10.2); simulators arrive with their owning components.

GoRules ZEN is an embedded library inside the rules component, so it has no container.
