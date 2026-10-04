# CMP-002 RLS negative matrix (001-07)

Generated from the executed integration suite. Not hand-edited.

| table | op | case | expected | actual | result |
|---|---|---|---|---|---|
| tenant | SELECT | own | visible rows contain no T2 canary | rows=1 | PASS |
| tenant | SELECT | other | visible rows contain no T2 canary | rows=1 | PASS |
| tenant | SELECT | unset | 0 rows | rows=0 | PASS |
| tenant | SELECT | empty | 0 rows | rows=0 | PASS |
| tenant | INSERT | own | cross-tenant write refused or 0 rows | refused | PASS |
| tenant | INSERT | other | cross-tenant write refused or 0 rows | refused | PASS |
| tenant | INSERT | unset | cross-tenant write refused or 0 rows | refused | PASS |
| tenant | INSERT | empty | cross-tenant write refused or 0 rows | refused | PASS |
| tenant | UPDATE | own | cross-tenant write refused or 0 rows | affected=1 | PASS |
| tenant | UPDATE | other | cross-tenant write refused or 0 rows | affected=1 | PASS |
| tenant | UPDATE | unset | cross-tenant write refused or 0 rows | affected=0 | PASS |
| tenant | UPDATE | empty | cross-tenant write refused or 0 rows | affected=0 | PASS |
| tenant | DELETE | own | cross-tenant write refused or 0 rows | refused | PASS |
| tenant | DELETE | other | cross-tenant write refused or 0 rows | refused | PASS |
| tenant | DELETE | unset | cross-tenant write refused or 0 rows | refused | PASS |
| tenant | DELETE | empty | cross-tenant write refused or 0 rows | refused | PASS |
| tenant_cell_binding | SELECT | own | visible rows contain no T2 canary | rows=1 | PASS |
| tenant_cell_binding | SELECT | other | visible rows contain no T2 canary | rows=1 | PASS |
| tenant_cell_binding | SELECT | unset | 0 rows | rows=0 | PASS |
| tenant_cell_binding | SELECT | empty | 0 rows | rows=0 | PASS |
| tenant_cell_binding | INSERT | own | cross-tenant write refused or 0 rows | refused | PASS |
| tenant_cell_binding | INSERT | other | cross-tenant write refused or 0 rows | refused | PASS |
| tenant_cell_binding | INSERT | unset | cross-tenant write refused or 0 rows | refused | PASS |
| tenant_cell_binding | INSERT | empty | cross-tenant write refused or 0 rows | refused | PASS |
| tenant_cell_binding | UPDATE | own | cross-tenant write refused or 0 rows | refused | PASS |
| tenant_cell_binding | UPDATE | other | cross-tenant write refused or 0 rows | refused | PASS |
| tenant_cell_binding | UPDATE | unset | cross-tenant write refused or 0 rows | refused | PASS |
| tenant_cell_binding | UPDATE | empty | cross-tenant write refused or 0 rows | refused | PASS |
| tenant_cell_binding | DELETE | own | cross-tenant write refused or 0 rows | refused | PASS |
| tenant_cell_binding | DELETE | other | cross-tenant write refused or 0 rows | refused | PASS |
| tenant_cell_binding | DELETE | unset | cross-tenant write refused or 0 rows | refused | PASS |
| tenant_cell_binding | DELETE | empty | cross-tenant write refused or 0 rows | refused | PASS |
| tenant_placement_proposal | SELECT | own | visible rows contain no T2 canary | rows=0 | PASS |
| tenant_placement_proposal | SELECT | other | visible rows contain no T2 canary | rows=0 | PASS |
| tenant_placement_proposal | SELECT | unset | 0 rows | rows=0 | PASS |
| tenant_placement_proposal | SELECT | empty | 0 rows | rows=0 | PASS |
| tenant_placement_proposal | INSERT | own | cross-tenant write refused or 0 rows | refused | PASS |
| tenant_placement_proposal | INSERT | other | cross-tenant write refused or 0 rows | refused | PASS |
| tenant_placement_proposal | INSERT | unset | cross-tenant write refused or 0 rows | refused | PASS |
| tenant_placement_proposal | INSERT | empty | cross-tenant write refused or 0 rows | refused | PASS |
| tenant_placement_proposal | UPDATE | own | cross-tenant write refused or 0 rows | refused | PASS |
| tenant_placement_proposal | UPDATE | other | cross-tenant write refused or 0 rows | refused | PASS |
| tenant_placement_proposal | UPDATE | unset | cross-tenant write refused or 0 rows | refused | PASS |
| tenant_placement_proposal | UPDATE | empty | cross-tenant write refused or 0 rows | refused | PASS |
| tenant_placement_proposal | DELETE | own | cross-tenant write refused or 0 rows | refused | PASS |
| tenant_placement_proposal | DELETE | other | cross-tenant write refused or 0 rows | refused | PASS |
| tenant_placement_proposal | DELETE | unset | cross-tenant write refused or 0 rows | refused | PASS |
| tenant_placement_proposal | DELETE | empty | cross-tenant write refused or 0 rows | refused | PASS |
| organisation | SELECT | own | visible rows contain no T2 canary | rows=0 | PASS |
| organisation | SELECT | other | visible rows contain no T2 canary | rows=0 | PASS |
| organisation | SELECT | unset | 0 rows | rows=0 | PASS |
| organisation | SELECT | empty | 0 rows | rows=0 | PASS |
| organisation | INSERT | own | cross-tenant write refused or 0 rows | refused | PASS |
| organisation | INSERT | other | cross-tenant write refused or 0 rows | refused | PASS |
| organisation | INSERT | unset | cross-tenant write refused or 0 rows | refused | PASS |
| organisation | INSERT | empty | cross-tenant write refused or 0 rows | refused | PASS |
| organisation | UPDATE | own | cross-tenant write refused or 0 rows | refused | PASS |
| organisation | UPDATE | other | cross-tenant write refused or 0 rows | refused | PASS |
| organisation | UPDATE | unset | cross-tenant write refused or 0 rows | refused | PASS |
| organisation | UPDATE | empty | cross-tenant write refused or 0 rows | refused | PASS |
| organisation | DELETE | own | cross-tenant write refused or 0 rows | refused | PASS |
| organisation | DELETE | other | cross-tenant write refused or 0 rows | refused | PASS |
| organisation | DELETE | unset | cross-tenant write refused or 0 rows | refused | PASS |
| organisation | DELETE | empty | cross-tenant write refused or 0 rows | refused | PASS |
| organisation_version | SELECT | own | visible rows contain no T2 canary | rows=0 | PASS |
| organisation_version | SELECT | other | visible rows contain no T2 canary | rows=0 | PASS |
| organisation_version | SELECT | unset | 0 rows | rows=0 | PASS |
| organisation_version | SELECT | empty | 0 rows | rows=0 | PASS |
| organisation_version | INSERT | own | cross-tenant write refused or 0 rows | refused | PASS |
| organisation_version | INSERT | other | cross-tenant write refused or 0 rows | refused | PASS |
| organisation_version | INSERT | unset | cross-tenant write refused or 0 rows | refused | PASS |
| organisation_version | INSERT | empty | cross-tenant write refused or 0 rows | refused | PASS |
| organisation_version | UPDATE | own | cross-tenant write refused or 0 rows | refused | PASS |
| organisation_version | UPDATE | other | cross-tenant write refused or 0 rows | refused | PASS |
| organisation_version | UPDATE | unset | cross-tenant write refused or 0 rows | refused | PASS |
| organisation_version | UPDATE | empty | cross-tenant write refused or 0 rows | refused | PASS |
| organisation_version | DELETE | own | cross-tenant write refused or 0 rows | refused | PASS |
| organisation_version | DELETE | other | cross-tenant write refused or 0 rows | refused | PASS |
| organisation_version | DELETE | unset | cross-tenant write refused or 0 rows | refused | PASS |
| organisation_version | DELETE | empty | cross-tenant write refused or 0 rows | refused | PASS |
| organisation_relation | SELECT | own | visible rows contain no T2 canary | rows=0 | PASS |
| organisation_relation | SELECT | other | visible rows contain no T2 canary | rows=0 | PASS |
| organisation_relation | SELECT | unset | 0 rows | rows=0 | PASS |
| organisation_relation | SELECT | empty | 0 rows | rows=0 | PASS |
| organisation_relation | INSERT | own | cross-tenant write refused or 0 rows | refused | PASS |
| organisation_relation | INSERT | other | cross-tenant write refused or 0 rows | refused | PASS |
| organisation_relation | INSERT | unset | cross-tenant write refused or 0 rows | refused | PASS |
| organisation_relation | INSERT | empty | cross-tenant write refused or 0 rows | refused | PASS |
| organisation_relation | UPDATE | own | cross-tenant write refused or 0 rows | refused | PASS |
| organisation_relation | UPDATE | other | cross-tenant write refused or 0 rows | refused | PASS |
| organisation_relation | UPDATE | unset | cross-tenant write refused or 0 rows | refused | PASS |
| organisation_relation | UPDATE | empty | cross-tenant write refused or 0 rows | refused | PASS |
| organisation_relation | DELETE | own | cross-tenant write refused or 0 rows | refused | PASS |
| organisation_relation | DELETE | other | cross-tenant write refused or 0 rows | refused | PASS |
| organisation_relation | DELETE | unset | cross-tenant write refused or 0 rows | refused | PASS |
| organisation_relation | DELETE | empty | cross-tenant write refused or 0 rows | refused | PASS |
| office | SELECT | own | visible rows contain no T2 canary | rows=0 | PASS |
| office | SELECT | other | visible rows contain no T2 canary | rows=0 | PASS |
| office | SELECT | unset | 0 rows | rows=0 | PASS |
| office | SELECT | empty | 0 rows | rows=0 | PASS |
| office | INSERT | own | cross-tenant write refused or 0 rows | refused | PASS |
| office | INSERT | other | cross-tenant write refused or 0 rows | refused | PASS |
| office | INSERT | unset | cross-tenant write refused or 0 rows | refused | PASS |
| office | INSERT | empty | cross-tenant write refused or 0 rows | refused | PASS |
| office | UPDATE | own | cross-tenant write refused or 0 rows | affected=0 | PASS |
| office | UPDATE | other | cross-tenant write refused or 0 rows | affected=0 | PASS |
| office | UPDATE | unset | cross-tenant write refused or 0 rows | affected=0 | PASS |
| office | UPDATE | empty | cross-tenant write refused or 0 rows | affected=0 | PASS |
| office | DELETE | own | cross-tenant write refused or 0 rows | refused | PASS |
| office | DELETE | other | cross-tenant write refused or 0 rows | refused | PASS |
| office | DELETE | unset | cross-tenant write refused or 0 rows | refused | PASS |
| office | DELETE | empty | cross-tenant write refused or 0 rows | refused | PASS |
| idempotency_record | SELECT | own | visible rows contain no T2 canary | rows=0 | PASS |
| idempotency_record | SELECT | other | visible rows contain no T2 canary | rows=0 | PASS |
| idempotency_record | SELECT | unset | 0 rows | rows=0 | PASS |
| idempotency_record | SELECT | empty | 0 rows | rows=0 | PASS |
| idempotency_record | INSERT | own | cross-tenant write refused or 0 rows | refused | PASS |
| idempotency_record | INSERT | other | cross-tenant write refused or 0 rows | refused | PASS |
| idempotency_record | INSERT | unset | cross-tenant write refused or 0 rows | refused | PASS |
| idempotency_record | INSERT | empty | cross-tenant write refused or 0 rows | refused | PASS |
| idempotency_record | UPDATE | own | cross-tenant write refused or 0 rows | affected=0 | PASS |
| idempotency_record | UPDATE | other | cross-tenant write refused or 0 rows | affected=0 | PASS |
| idempotency_record | UPDATE | unset | cross-tenant write refused or 0 rows | affected=0 | PASS |
| idempotency_record | UPDATE | empty | cross-tenant write refused or 0 rows | affected=0 | PASS |
| idempotency_record | DELETE | own | cross-tenant write refused or 0 rows | affected=0 | PASS |
| idempotency_record | DELETE | other | cross-tenant write refused or 0 rows | affected=0 | PASS |
| idempotency_record | DELETE | unset | cross-tenant write refused or 0 rows | affected=0 | PASS |
| idempotency_record | DELETE | empty | cross-tenant write refused or 0 rows | affected=0 | PASS |
| inbox_event | SELECT | own | visible rows contain no T2 canary | rows=0 | PASS |
| inbox_event | SELECT | other | visible rows contain no T2 canary | rows=0 | PASS |
| inbox_event | SELECT | unset | 0 rows | rows=0 | PASS |
| inbox_event | SELECT | empty | 0 rows | rows=0 | PASS |
| inbox_event | INSERT | own | cross-tenant write refused or 0 rows | refused | PASS |
| inbox_event | INSERT | other | cross-tenant write refused or 0 rows | refused | PASS |
| inbox_event | INSERT | unset | cross-tenant write refused or 0 rows | refused | PASS |
| inbox_event | INSERT | empty | cross-tenant write refused or 0 rows | refused | PASS |
| inbox_event | UPDATE | own | cross-tenant write refused or 0 rows | refused | PASS |
| inbox_event | UPDATE | other | cross-tenant write refused or 0 rows | refused | PASS |
| inbox_event | UPDATE | unset | cross-tenant write refused or 0 rows | refused | PASS |
| inbox_event | UPDATE | empty | cross-tenant write refused or 0 rows | refused | PASS |
| inbox_event | DELETE | own | cross-tenant write refused or 0 rows | refused | PASS |
| inbox_event | DELETE | other | cross-tenant write refused or 0 rows | refused | PASS |
| inbox_event | DELETE | unset | cross-tenant write refused or 0 rows | refused | PASS |
| inbox_event | DELETE | empty | cross-tenant write refused or 0 rows | refused | PASS |
