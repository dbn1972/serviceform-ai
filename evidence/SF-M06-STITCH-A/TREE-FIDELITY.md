# Tree fidelity — SF-M06-STITCH-A

Compared working tree service paths + migrations to frozen input SHAs via git blob object ids.

| Component | Frozen SHA | Files (svc+mig) | Aggregate blob digest | Result |
|---|---|---:|---|---|
| CMP-020 | `c962167f9f2cfee9bc758584de69d5792d627d92` | 47 | `e0a9848e9e3babd833797266a1f77979c4c254a3bf3faadaa96c105805653db5` | MATCH BYTE_IDENTICAL |
| CMP-025 | `b694416900d7e8107489c1d4d76bd502611056fb` | 52 | `b7e8b0079ffd421f69b64b48920e9fc204c4e225e58e8c55dc8dc677980151c5` | MATCH BYTE_IDENTICAL |
| CMP-026 | `591559bd9e480956b315b960d56e8f4329b80ecd` | 42 | `582fd4e555c505cfa81b2026a7005f2a08e9ceff2272090398ace1fa22ef9171` | MATCH BYTE_IDENTICAL |

`BYTE_IDENTICAL_TO_FROZEN_INPUTS` = **true** excluding root `pnpm-lock.yaml`, `evidence/SF-M06-STITCH-A/**`, and `orchestrator/handovers/SF-M06-STITCH-A.yaml`.
