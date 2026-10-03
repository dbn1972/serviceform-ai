# Infrastructure as code (Terraform)

M00 skeleton only: version pins, the environment layout and module boundaries. No AWS
resources are declared yet. Resources arrive with the modules that need them, following the
AWS reference deployment (AWS v1.7 s2, Appendix A).

```
envs/<env>/        one root module per environment (dev, sit, uat, preprod, prod)
modules/<name>/    reusable modules (network, eks, aurora, s3, msk, opensearch, observability)
```

Decisions still open and deliberately not encoded (ARCHITECTURE-VERIFICATION-001 M-09):
- primary AWS region and DR region (`aws_region` has no default),
- RPO/RTO targets,
- state backend (S3 + DynamoDB/S3 lock) and account structure.

Credentials are never in Terraform files: the AWS provider uses workload identity / SSO
configured outside the repository. CI runs `terraform fmt -check`, `terraform validate` and
Checkov on this directory.
