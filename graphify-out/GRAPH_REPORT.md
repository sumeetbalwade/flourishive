# Graph Report - Flourishive  (2026-11-23)

## Corpus Check
- 473 files · ~191,435 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 44 file(s) not represented in the graph (top: (none) 16, .prisma 16, .css 4)

## Summary
- 3896 nodes · 11269 edges · 159 communities (129 shown, 30 thin omitted)
- Extraction: 94% EXTRACTED · 6% INFERRED · 0% AMBIGUOUS · INFERRED: 692 edges (avg confidence: 0.87)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- Backend app bootstrap and identity
- Web and admin app shell
- Web staff screens
- Audit, company and Prisma layer
- DSC test certificate generator
- Access control modules
- API client schemas
- Document templates and fill
- Access service and roles
- Role assignment and scope
- Admin sign-in and MFA enrolment
- Desktop API and batch signing
- Backend dependencies
- Company DNS (Cloudflare)
- CLI and notifications
- Web letters screens
- Desktop jobs controller
- Permissions and documents controller
- Auth controller
- Admin routing and API provider
- Controllers overview
- Desktop controller and settings
- CI workflow
- UI package dependencies
- Desktop main window and updates
- Community 25
- Community 26
- Community 27
- Community 28
- Community 29
- Community 30
- Community 31
- Community 32
- Community 33
- Community 34
- Community 35
- Community 36
- Community 37
- Community 38
- Community 39
- Community 40
- Community 41
- Community 42
- Community 43
- Community 44
- Community 45
- Community 46
- Community 47
- Community 48
- Community 49
- Community 50
- Community 51
- Community 52
- Community 53
- Community 54
- Community 55
- Community 56
- Community 57
- Community 58
- Community 59
- Community 60
- Community 61
- Community 62
- Community 63
- Community 64
- Community 65
- Community 66
- Community 67
- Community 68
- Community 69
- Community 70
- Community 71
- Community 72
- Community 73
- Community 74
- Community 75
- Community 76
- Community 77
- Community 78
- Community 79
- Community 80
- Community 81
- Community 82
- Community 83
- Community 84
- Community 85
- Community 86
- Community 87
- Community 88
- Community 89
- Community 90
- Community 91
- Community 92
- Community 93
- Community 94
- Community 95
- Community 96
- Community 97
- Community 98
- Community 99
- Community 100
- Community 101
- Community 102
- Community 103
- Community 104
- Community 105
- Community 107
- Community 108
- Community 109
- Community 110
- Community 111
- Community 112
- Community 113
- Community 114
- Community 115
- Community 116
- Community 117
- Community 118
- Community 119
- Community 120
- Community 121
- Community 122
- Community 123
- Community 124
- Community 126
- Community 127
- Community 128
- Community 129
- Community 131
- Community 132
- Community 133
- Community 134
- Community 135
- Community 136
- Community 137
- Community 138
- Community 139
- Community 141
- Community 142
- Community 143
- Community 144
- Community 145
- Community 146
- Community 147
- Community 148
- Community 149
- Community 150
- Community 151
- Community 152
- Community 153
- Community 154
- Community 155
- Community 158

## God Nodes (most connected - your core abstractions)
1. `runInTenant()` - 184 edges
2. `@nestjs/common` - 123 edges
3. `runAsSystem()` - 106 edges
4. `Button()` - 103 edges
5. `PrismaService` - 85 edges
6. `messageOf()` - 84 edges
7. `AccessClaims` - 83 edges
8. `CurrentAuth` - 79 edges
9. `RequirePermission()` - 76 edges
10. `Card()` - 74 edges

## Surprising Connections (you probably didn't know these)
- `PIN safety rules (hidden prompt only, tokens lock after wrong PINs)` --semantically_similar_to--> `Batch signing with one PIN, CA time-stamp, visible stamp, server verification`  [INFERRED] [semantically similar]
  docs/runbooks/dsc-signing-spike.md → desktop/README.md
- `Apps and deploy targets (backend, web, admin, verify, desktop, packages)` --conceptually_related_to--> `Runbook: the VPS (Contabo, Ubuntu 24.04) and company addresses`  [INFERRED]
  README.md → docs/runbooks/vps-hosting.md
- `resolveValues()` --calls--> `parseDate()`  [EXTRACTED]
  backend/src/modules/documents/fill.ts → packages/schemas/src/common.ts
- `rowSchema` --calls--> `parseDate()`  [EXTRACTED]
  backend/src/modules/people/people-import.service.ts → packages/schemas/src/common.ts
- `Loading()` --calls--> `PageLoader()`  [EXTRACTED]
  frontend/admin/src/App.tsx → packages/ui/src/components/page-loader.tsx

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **DSC signing architecture decisions** — docs_00_master_plan_d_11, docs_00_master_plan_d_24, docs_00_master_plan_d_31, docs_phases_phase_02_documents_and_signing_d_45, docs_phases_phase_02_documents_and_signing_d_46, docs_phases_phase_02_documents_and_signing_d_48 [EXTRACTED 0.85]
- **R2 file storage decisions** — docs_phases_phase_02_documents_and_signing_d_72, docs_phases_phase_02_documents_and_signing_d_73, docs_phases_phase_02_documents_and_signing_d_74, docs_phases_phase_02_documents_and_signing_d_75 [EXTRACTED 1.00]
- **Control centre access and security decisions** — docs_phases_phase_02b_platform_control_centre_d_55, docs_phases_phase_02b_platform_control_centre_d_56, docs_phases_phase_02b_platform_control_centre_d_57, docs_phases_phase_02b_platform_control_centre_d_63, docs_phases_phase_02b_platform_control_centre_d_65, docs_phases_phase_02b_platform_control_centre_d_66 [INFERRED 0.85]
- **VPS auto-deploy pipeline (deploy.yml, SSH key, secrets, 04-deploy.sh)** — docs_runbooks_vps_hosting_runbook, docs_runbooks_vps_hosting_auto_deploy, docs_runbooks_vps_hosting_github_secrets [EXTRACTED 1.00]
- **R2 storage migration flow (bucket, env, migrate CLI, fallback, rollback)** — docs_runbooks_r2_storage_bucket, docs_runbooks_r2_storage_env, docs_runbooks_r2_storage_migrate_cli, docs_runbooks_r2_storage_local_fallback, docs_runbooks_r2_storage_rollback [EXTRACTED 1.00]
- **DSC signing and server validation chain (desktop signing, validation, test fixtures)** — desktop_readme_batch_signing, docs_runbooks_dsc_validation_check_order, backend_test_fixtures_dsc_readme_dsc_fixtures, docs_runbooks_dsc_signing_spike_pass_criteria [INFERRED 0.85]

## Communities (159 total, 30 thin omitted)

### Community 0 - "Backend app bootstrap and identity"
Cohesion: 0.04
Nodes (84): AppModule, configureApp(), bootstrap(), MIN_PASSWORD_LENGTH, PARAMS, PasswordService, SessionService, RedisService (+76 more)

### Community 1 - "Web and admin app shell"
Cohesion: 0.05
Nodes (73): SelectField(), Desktop(), Gallery(), MONTHS, NAV, STATES, Toaster(), Org() (+65 more)

### Community 2 - "Web staff screens"
Cohesion: 0.10
Nodes (84): Staff(), tone, when(), App(), Desktop, Gallery, NEEDS, Private() (+76 more)

### Community 3 - "Audit, company and Prisma layer"
Cohesion: 0.05
Nodes (33): AuditInput, AuditService, ChainCheck, GENESIS_HASH, UserRow, GoogleIdentity, GoogleService, MfaService (+25 more)

### Community 4 - "DSC test certificate generator"
Cohesion: 0.04
Nodes (38): certs(), issue(), key(), ku(), name(), save(), sign(), CertInfo (+30 more)

### Community 5 - "Access control modules"
Cohesion: 0.05
Nodes (28): AccessModule, PermissionGuard, MUTATING, AuditModule, CompanyModule, DesktopModule, DocumentsModule, FilesModule (+20 more)

### Community 6 - "API client schemas"
Cohesion: 0.03
Nodes (71): rowSchema, bulkSchema, deliverySchema, DocumentDetail, documentDetailSchema, DocumentHistory, DocumentRow, documentRowSchema (+63 more)

### Community 7 - "Document templates and fill"
Cohesion: 0.05
Nodes (42): BUILT_IN, fill(), MONTHS, placeholdersIn(), certificateLayout, alignOf(), block(), editorDocString (+34 more)

### Community 8 - "Access service and roles"
Cohesion: 0.06
Nodes (14): AccessService, BULK_JOB, DocAccess, A4, imageToPdf(), LetterheadsService, NumberingService, ALLOWED (+6 more)

### Community 9 - "Role assignment and scope"
Cohesion: 0.05
Nodes (36): cacheKey(), computeHash(), stableStringify(), DeviceService, norm(), sha256(), AuditWatchService, Delegate (+28 more)

### Community 10 - "Admin sign-in and MFA enrolment"
Cohesion: 0.08
Nodes (49): Enrol(), Frame, RecoveryCodes(), useApi(), Login(), SetPassword(), Step, Frame (+41 more)

### Community 11 - "Desktop API and batch signing"
Cohesion: 0.08
Nodes (12): Job, BatchEvent, BatchRunner, _is_token_problem(), JobResult, DesktopError, Offline, Unpaired (+4 more)

### Community 12 - "Backend dependencies"
Cohesion: 0.05
Nodes (56): author, description, devDependencies, aws-sdk-client-mock@^4.1.0, @flourishive/api-client@workspace:*, @nestjs/cli@^12.0.0, @nestjs/mau@^0.2.6, @nestjs/schematics@^12.0.0 (+48 more)

### Community 13 - "Company DNS (Cloudflare)"
Cohesion: 0.08
Nodes (6): CompanyDnsService, PlatformAdminController, PlatformAdminService, suspendedKey(), PlatformRequest, shapeOf()

### Community 14 - "CLI and notifications"
Cohesion: 0.06
Nodes (22): arg(), main(), NotificationsService, SEND_JOB, SENSITIVE_EVENTS, NotificationEvent, RenderedEmail, TEMPLATES (+14 more)

### Community 15 - "Web letters screens"
Cohesion: 0.08
Nodes (47): AccessCard(), change(), SelectField(), messageOf(), save(), run(), emailAll(), submit() (+39 more)

### Community 16 - "Desktop jobs controller"
Cohesion: 0.07
Nodes (16): DesktopJobsController, DesktopPairController, platformOf(), CurrentDevice, DeviceGuard, DeviceRequest, file, isOlder() (+8 more)

### Community 17 - "Permissions and documents controller"
Cohesion: 0.16
Nodes (5): RequirePermission(), DesktopStaffController, DocumentsController, CurrentAuth, AccessClaims

### Community 18 - "Auth controller"
Cohesion: 0.14
Nodes (23): Public(), AuthController, body(), LoginResult, Principal, code, CompanyPublic, forgotBody (+15 more)

### Community 19 - "Admin routing and API provider"
Cohesion: 0.12
Nodes (37): App(), Loading(), Private(), Routes(), ApiProvider(), Ctx, makeClient(), AuthProvider() (+29 more)

### Community 20 - "Controllers overview"
Cohesion: 0.11
Nodes (21): REQUIRED_PERMISSION, failBody, pairBody, signedQuery, ALLOWED_MIME_TYPES, IS_PUBLIC, MfaChallengeClaims, MfaChallengePurpose (+13 more)

### Community 21 - "Desktop controller and settings"
Cohesion: 0.08
Nodes (12): Controller, Credentials, data_dir(), History, HistoryEntry, KeyringCredentials, MemoryCredentials, Settings (+4 more)

### Community 22 - "CI workflow"
Cohesion: 0.04
Nodes (46): concurrency, cancel-in-progress, group, run, defaults, name, runs-on, steps (+38 more)

### Community 23 - "UI package dependencies"
Cohesion: 0.06
Nodes (46): dependencies, class-variance-authority@^0.7.1, clsx@^2.1.1, date-fns@^4.4.0, @flourishive/design-tokens@workspace:*, lucide-react@^1.75.0, motion@^14.14.0, radix-ui@^1.8.1 (+38 more)

### Community 24 - "Desktop main window and updates"
Cohesion: 0.10
Nodes (18): Paired, MainWindow, FakeApi, jobs(), make_controller(), test_a_held_upload_shows_waiting_then_finishes(), test_a_newer_version_shows_a_bar_and_a_required_one_blocks_signing(), test_a_refused_code_is_explained_in_the_form() (+10 more)

### Community 25 - "Community 25"
Cohesion: 0.06
Nodes (45): dependencies, @flourishive/design-tokens@workspace:*, @flourishive/schemas@workspace:*, @flourishive/ui@workspace:*, lucide-react@^1.75.0, react@^19.3.1, react-dom@^19.3.1, zod@^4.6.7 (+37 more)

### Community 26 - "Community 26"
Cohesion: 0.09
Nodes (23): build_manifest(), main(), sha256_of(), api(), test_a_dead_connection_is_offline_not_a_crash(), test_download_follows_a_storage_redirect_without_sending_the_credential(), test_errors_say_what_happened(), test_every_call_carries_the_device_credential() (+15 more)

### Community 27 - "Community 27"
Cohesion: 0.05
Nodes (42): dependencies, bullmq@^6.7.7, cookie-parser@^1.4.7, @flourishive/schemas@workspace:*, google-auth-library@^11.3.4, hash-wasm@^4.13.0, ioredis@^6.0.0, jose@^6.2.17 (+34 more)

### Community 28 - "Community 28"
Cohesion: 0.07
Nodes (8): ElectronicDialog, card(), HistoryPage, label(), PairPage, QueuePage, SettingsPage, Call

### Community 29 - "Community 29"
Cohesion: 0.10
Nodes (16): TokenChoice, SigningFailed, options_from(), sign_pdf(), SignOptions, _friendly(), TokenSession, sign() (+8 more)

### Community 30 - "Community 30"
Cohesion: 0.10
Nodes (25): verifyApi, App(), Accept(), Ask(), CLOSED, Confirm(), date(), Decline() (+17 more)

### Community 31 - "Community 31"
Cohesion: 0.07
Nodes (33): deliverBody, listQuery, reasonBody, supersedeBody, uploadTemplateQuery, acceptApi, ApiProblem, letterApi (+25 more)

### Community 32 - "Community 32"
Cohesion: 0.11
Nodes (8): Api, Appearance, Claim, _message(), Signs, Held, Rejected, ServerRefused

### Community 33 - "Community 33"
Cohesion: 0.07
Nodes (38): D-11 DSC signing on desktop, D-13 Three template paths, D-14 DOCX to PDF route, D-24 Desktop pairing with API (P-01), D-25 Organisation seal for OTP docs (P-02), D-28 Aadhaar eSign provider (P-05), D-33 DSC flow re-confirmed, D-35 Signatory is HR lead (+30 more)

### Community 34 - "Community 34"
Cohesion: 0.12
Nodes (4): hashRecoveryCode(), PlatformAuthService, resetKey(), revokedKey()

### Community 35 - "Community 35"
Cohesion: 0.08
Nodes (4): AuthGuard, revokedKey(), sha256(), TokenService

### Community 36 - "Community 36"
Cohesion: 0.12
Nodes (27): ChainProblem, chainTo(), DscRejected, DscRejection, DscResult, field(), KNOWN_CRITICAL, verifyChain() (+19 more)

### Community 37 - "Community 37"
Cohesion: 0.09
Nodes (16): @aws-sdk/client-s3@^3.1175.0, @aws-sdk/lib-storage@^3.1175.0, @aws-sdk/s3-request-presigner@^3.1175.0, R2Settings, drivers, fakeBucket(), notFound(), s3 (+8 more)

### Community 38 - "Community 38"
Cohesion: 0.19
Nodes (4): highest(), AuthService, ClientMeta, IssuedTokens

### Community 39 - "Community 39"
Cohesion: 0.11
Nodes (11): EsignGateway, esc(), MockEsignController, key(), MockEsignProvider, MockState, ESIGN_PROVIDER, EsignOutcome (+3 more)

### Community 40 - "Community 40"
Cohesion: 0.11
Nodes (12): isSettingKey(), SettingDefinition, SettingKey, SettingKind, SettingLevel, SETTINGS, SettingShape, PlatformEntry (+4 more)

### Community 41 - "Community 41"
Cohesion: 0.13
Nodes (31): D-32 Other Redis uses, D-53 Visual direction v2, D-55 Platform staff roles, D-56 Support access, D-57 Runtime config and secrets, D-58 Email senders, D-59 Email templates, D-60 Mail delivery log (+23 more)

### Community 42 - "Community 42"
Cohesion: 0.11
Nodes (15): PermissionMap, ALL_PERMISSIONS, MfaLevelName, PermissionCode, PERMISSIONS, SYSTEM_ROLES, SystemRole, LEVEL_RANK (+7 more)

### Community 43 - "Community 43"
Cohesion: 0.18
Nodes (4): maskEmail(), readAll(), sha256(), SigningService

### Community 44 - "Community 44"
Cohesion: 0.07
Nodes (28): concurrency, cancel-in-progress, group, environment, if, name, runs-on, steps (+20 more)

### Community 45 - "Community 45"
Cohesion: 0.07
Nodes (28): defaults, name, runs-on, steps, strategy, timeout-minutes, run, jobs (+20 more)

### Community 46 - "Community 46"
Cohesion: 0.07
Nodes (26): compilerOptions, rootDir, exclude, extends, include, compilerOptions, allowSyntheticDefaultImports, declaration (+18 more)

### Community 47 - "Community 47"
Cohesion: 0.11
Nodes (8): _LinkServer, main(), _send_to_running_instance(), PairLink, parse_link(), register_protocol(), test_a_good_link_fills_in_the_form(), test_anything_odd_is_ignored()

### Community 48 - "Community 48"
Cohesion: 0.09
Nodes (26): Opts, platformConfirm, platformLogin, mfaSetupResponse, tokensResponse, companySlug, counts, CreateTenantBody (+18 more)

### Community 49 - "Community 49"
Cohesion: 0.14
Nodes (5): AuditableRequest, PeopleController, PeopleService, peopleListQuery, updatePersonBody

### Community 50 - "Community 50"
Cohesion: 0.14
Nodes (21): buildOcspRequest(), certId(), CertificateRevoked, checkOcsp(), FORGE_MD, kids(), Node, OcspAnswer (+13 more)

### Community 51 - "Community 51"
Cohesion: 0.20
Nodes (6): iso(), Actor, DocumentsService, readAll(), longDate(), resolveValues()

### Community 52 - "Community 52"
Cohesion: 0.14
Nodes (3): DeliveryController, DeliveryService, sha256()

### Community 53 - "Community 53"
Cohesion: 0.14
Nodes (7): SettingValueOf, A4, signatureBox(), STAMP_SIZE, DscJobsService, readAll(), sha256()

### Community 54 - "Community 54"
Cohesion: 0.14
Nodes (4): kindOf(), OrgController, OrgService, OrgKind

### Community 55 - "Community 55"
Cohesion: 0.09
Nodes (25): dependencies, @flourishive/schemas@workspace:*, zod@^4.6.7, description, devDependencies, oxlint@^1.90.0, typescript@~7.0.2, vitest@^4.1.2 (+17 more)

### Community 56 - "Community 56"
Cohesion: 0.15
Nodes (4): LocalDriver, isMissing(), R2Driver, assertSafeKey()

### Community 57 - "Community 57"
Cohesion: 0.24
Nodes (4): body(), PlatformAuthController, PlatformTokens, platformMfaSetupBody

### Community 58 - "Community 58"
Cohesion: 0.10
Nodes (23): dependencies, zod@^4.6.7, description, devDependencies, oxlint@^1.90.0, typescript@~7.0.2, vitest@^4.1.2, exports (+15 more)

### Community 59 - "Community 59"
Cohesion: 0.10
Nodes (6): FilesController, ALLOWED_FILE_TYPES, fileResponse, FileResponse, MAX_FILE_BYTES, uploadQuery

### Community 60 - "Community 60"
Cohesion: 0.25
Nodes (3): AcceptanceController, client(), SigningStaffController

### Community 61 - "Community 61"
Cohesion: 0.17
Nodes (12): cmd_find_lib(), cmd_list(), cmd_sign(), cmd_verify(), describe_cert(), find_libraries(), load_certs(), main() (+4 more)

### Community 62 - "Community 62"
Cohesion: 0.09
Nodes (23): devDependencies, jsdom@^31.0.1, @tailwindcss/vite@^4.3.5, @testing-library/jest-dom@^7.0.1, @testing-library/react@^16.3.3, @testing-library/user-event@^14.6.12, @types/node@^24.19.2, @types/react@^19.3.0 (+15 more)

### Community 63 - "Community 63"
Cohesion: 0.12
Nodes (6): emblem(), emblem_operators(), _numbers(), stamp_style(), test_the_pen_stroke_check_and_cross_match_the_web_component(), _web_paths()

### Community 64 - "Community 64"
Cohesion: 0.10
Nodes (3): path_from_svg(), SigningAnimation, system_reduces_motion()

### Community 65 - "Community 65"
Cohesion: 0.12
Nodes (22): D-10 Signature methods, D-23 Mobile with React Native Expo, D-79 Signing without DSC, signing module, workflow engine v1, DPDP readiness, Phase 4 People core and self-service, Offboarding and exit (+14 more)

### Community 66 - "Community 66"
Cohesion: 0.12
Nodes (6): CompanyController, CompanyService, originMatcher(), slugFromOrigin(), tenantUrl(), findCompanyBody

### Community 67 - "Community 67"
Cohesion: 0.23
Nodes (13): FakeApi, job(), run(), test_a_check_that_never_becomes_possible_gives_up_and_frees_the_job(), test_a_job_taken_elsewhere_is_skipped_and_the_rest_continue(), test_a_letter_that_does_not_match_its_fingerprint_is_never_signed(), test_a_server_refusal_is_reported_with_its_reason_and_frees_the_job(), test_a_token_problem_stops_the_whole_batch() (+5 more)

### Community 68 - "Community 68"
Cohesion: 0.18
Nodes (21): D-02 Shared cPanel hosting, D-04 NestJS backend, D-06 React + Vite SPAs, D-07 Monorepo, D-08 Dark bronze visual direction, D-09 Design process, D-12 Desktop platforms, D-18 Domain flourishive.in (+13 more)

### Community 69 - "Community 69"
Cohesion: 0.10
Nodes (21): dependencies, @flourishive/api-client@workspace:*, @flourishive/design-tokens@workspace:*, @flourishive/schemas@workspace:*, @flourishive/ui@workspace:*, lucide-react@^1.75.0, motion@^14.14.0, qrcode.react@^4.2.0 (+13 more)

### Community 70 - "Community 70"
Cohesion: 0.10
Nodes (20): description, devDependencies, prettier@^3.9.10, turbo@^2.11.10, engines, node, prettier, license (+12 more)

### Community 71 - "Community 71"
Cohesion: 0.10
Nodes (20): scripts, build, db:deploy, db:migrate, db:seed, deploy, format, lint (+12 more)

### Community 72 - "Community 72"
Cohesion: 0.10
Nodes (19): compilerOptions, allowArbitraryExtensions, allowImportingTsExtensions, erasableSyntaxOnly, jsx, lib, module, moduleDetection (+11 more)

### Community 73 - "Community 73"
Cohesion: 0.10
Nodes (19): compilerOptions, allowArbitraryExtensions, allowImportingTsExtensions, erasableSyntaxOnly, jsx, lib, module, moduleDetection (+11 more)

### Community 74 - "Community 74"
Cohesion: 0.10
Nodes (19): compilerOptions, allowArbitraryExtensions, allowImportingTsExtensions, erasableSyntaxOnly, jsx, lib, module, moduleDetection (+11 more)

### Community 75 - "Community 75"
Cohesion: 0.20
Nodes (9): ApiClient, createApiClient(), ApiError, ContractError, Http, HttpOptions, queryString(), RequestOptions (+1 more)

### Community 76 - "Community 76"
Cohesion: 0.13
Nodes (13): csv-parse@^7.0.3, cell, friendlyIssue(), ImportIssue, ImportResult, key(), KNOWN, MAX_IMPORT_ROWS (+5 more)

### Community 77 - "Community 77"
Cohesion: 0.16
Nodes (4): AccessController, assignRoleBody, createRoleBody, tenantPolicyPatch

### Community 79 - "Community 79"
Cohesion: 0.14
Nodes (8): base, dir, input, make(), Revocation, DscValidator, OcspRevocationChecker, RevocationChecker

### Community 80 - "Community 80"
Cohesion: 0.15
Nodes (10): ADMIN_PERMS, open(), signedInAdmin(), ALLOWED, rect, start, ASHA, fakeClient() (+2 more)

### Community 81 - "Community 81"
Cohesion: 0.14
Nodes (17): D-01 Multi-tenant SaaS model, D-16 Login policy, D-20 SaaS controls, D-21 Razorpay payments, D-27 VPS trigger (P-04), D-29 Custom fields (P-06), Proposal P-04, Proposal P-06 (+9 more)

### Community 82 - "Community 82"
Cohesion: 0.12
Nodes (17): dependencies, @flourishive/api-client@workspace:*, @flourishive/schemas@workspace:*, @flourishive/ui@workspace:*, lucide-react@^1.75.0, qrcode.react@^4.2.0, react@^19.3.1, react-dom@^19.3.1 (+9 more)

### Community 83 - "Community 83"
Cohesion: 0.12
Nodes (16): compilerOptions, allowImportingTsExtensions, erasableSyntaxOnly, lib, module, moduleDetection, noEmit, noFallthroughCasesInSwitch (+8 more)

### Community 84 - "Community 84"
Cohesion: 0.12
Nodes (16): compilerOptions, allowImportingTsExtensions, erasableSyntaxOnly, lib, module, moduleDetection, noEmit, noFallthroughCasesInSwitch (+8 more)

### Community 85 - "Community 85"
Cohesion: 0.12
Nodes (16): compilerOptions, allowImportingTsExtensions, erasableSyntaxOnly, lib, module, moduleDetection, noEmit, noFallthroughCasesInSwitch (+8 more)

### Community 86 - "Community 86"
Cohesion: 0.17
Nodes (10): node-forge@^1.4.3, SealSigner, RFC-3161, generateSealKey(), buildTimestampRequest(), requestTimestamp(), tokenFromResponse(), RFC-3161 (+2 more)

### Community 87 - "Community 87"
Cohesion: 0.23
Nodes (4): SettingsController, settingsResponse, SettingsResponse, settingValueBody

### Community 88 - "Community 88"
Cohesion: 0.17
Nodes (4): SealKey, SealService, config, SealCheck

### Community 89 - "Community 89"
Cohesion: 0.12
Nodes (15): compilerOptions, allowImportingTsExtensions, erasableSyntaxOnly, jsx, lib, module, moduleResolution, noEmit (+7 more)

### Community 90 - "Community 90"
Cohesion: 0.15
Nodes (15): Batch signing with one PIN, CA time-stamp, visible stamp, server verification, Flourishive Desktop (DSC signing app), Device pairing (10-minute code, flourishive:// link, OS secret store), Run from source with uv and pytest (needs SoftHSM), PKCS#11 token drivers (mToken, ePass2003, WatchData, ProxKey, HyperPKI, SafeNet), Spike pass criteria (SPIKE CHECK: PASS, timestamped, Adobe Reader valid), PIN safety rules (hidden prompt only, tokens lock after wrong PINs), Runbook: DSC signing spike with the mToken (+7 more)

### Community 91 - "Community 91"
Cohesion: 0.14
Nodes (15): D-03 Single DB tenancy, D-05 MySQL with Prisma, D-15 Single tenant URL, D-17 Messaging, D-19 Phase order: signing first, D-30 Job queue on Redis, access module, audit module (hash-chained) (+7 more)

### Community 92 - "Community 92"
Cohesion: 0.13
Nodes (15): devDependencies, jsdom@^31.0.1, tailwindcss@^4.3.5, @testing-library/jest-dom@^7.0.1, @testing-library/react@^16.3.3, @types/react-dom@^19.3.0, vite@^8.3.6, @vitejs/plugin-react@^6.1.2 (+7 more)

### Community 93 - "Community 93"
Cohesion: 0.13
Nodes (14): compilerOptions, declaration, isolatedModules, lib, module, moduleResolution, outDir, rootDir (+6 more)

### Community 94 - "Community 94"
Cohesion: 0.14
Nodes (13): @tanstack/react-query@^5.108.0, oxlint@^1.90.0, tailwindcss@^4.3.5, vite@^8.3.6, oxlint, tailwindcss, @tanstack/react-query, vite (+5 more)

### Community 95 - "Community 95"
Cohesion: 0.14
Nodes (13): @tiptap/core@^3.35.0, @tiptap/extension-table@^3.35.0, @tiptap/extension-text-align@^3.35.0, @tiptap/react@^3.35.0, @tiptap/starter-kit@^3.35.0, extensions, Props, SignatureBox (+5 more)

### Community 96 - "Community 96"
Cohesion: 0.14
Nodes (13): compilerOptions, declaration, isolatedModules, module, moduleResolution, outDir, rootDir, skipLibCheck (+5 more)

### Community 97 - "Community 97"
Cohesion: 0.14
Nodes (13): dependsOn, outputs, cache, persistent, $schema, tasks, build, dev (+5 more)

### Community 98 - "Community 98"
Cohesion: 0.19
Nodes (9): currentScope(), and(), Args, scopeArgs(), stamp(), TENANT_SCOPED_MODELS, tenantScopingExtension, UNIQUE_OPS (+1 more)

### Community 99 - "Community 99"
Cohesion: 0.15
Nodes (7): AuditController, auditEntry, auditListQuery, auditListResponse, AuditListResponse, chainCheck, ChainCheck

### Community 100 - "Community 100"
Cohesion: 0.18
Nodes (10): open(), signedIn(), DETAIL, fakeClient(), ME_STAFF, TENANT, PlatformClient, StaffItem (+2 more)

### Community 101 - "Community 101"
Cohesion: 0.24
Nodes (10): approvedDoc(), ask(), call(), codeFromMail(), lastMail(), mails, stateOf(), tok (+2 more)

### Community 102 - "Community 102"
Cohesion: 0.31
Nodes (8): definitionSchema, LETTER_FLOW, LETTER_FLOW_KEY, stateDef, Transition, transitionDef, WorkflowDefinitionData, Subject

### Community 104 - "Community 104"
Cohesion: 0.24
Nodes (10): API env: APP_NAME, APP_DOMAIN, TRUST_CLOUDFLARE, COOKIE_SECURE, TENANT_URL_TEMPLATE, brand.json per frontend (appName, tenantDomain, apiUrl), Cache Rule bypass for api.flourishive.in, Cloudflare Full (strict) SSL with 15-year Origin certificate, Runbook: Cloudflare DNS, wildcard HTTPS, company addresses, Troubleshooting errors 522-526, lockouts, mail, TRUST_CLOUDFLARE (real visitor IP for lockouts and rate limits), Move-to-new-domain checklist (companies keyed by slug, keep old domain redirecting) (+2 more)

### Community 105 - "Community 105"
Cohesion: 0.20
Nodes (9): @flourishive/design-tokens@workspace:*, vitest@^4.1.12, @flourishive/design-tokens, vitest, license, name, private, type (+1 more)

### Community 107 - "Community 107"
Cohesion: 0.20
Nodes (9): description, exports, ./tailwind.css, ./tokens.css, license, name, private, type (+1 more)

### Community 108 - "Community 108"
Cohesion: 0.31
Nodes (3): MigrationSummary, StorageMigrateService, setup()

### Community 109 - "Community 109"
Cohesion: 0.25
Nodes (7): Backend AGENTS.md (rules for working in backend), Prefer NestJS first-party packages before adding libraries, NestJS Observe production telemetry (OBSERVE_APP_KEY, OBSERVE_APP_SECRET, MCP server), StandardSchemaValidationPipe (Zod etc.), Backend README (NestJS starter boilerplate), NestJS Observe (npx @nestjs/observe link), pnpm scripts: start, start:dev, start:prod, test, test:e2e, test:cov

### Community 110 - "Community 110"
Cohesion: 0.25
Nodes (7): env, node, ignorePatterns, rules, typescript/no-explicit-any, typescript/no-floating-promises, $schema

### Community 111 - "Community 111"
Cohesion: 0.32
Nodes (8): DSC test fixtures (throwaway authority and PDFs), generate.py (certs, sign) using pyHanko, Signed PDF variants: ok, no-timestamp, expired, untrusted, Six-step validation: bytes, added content, signature, timestamp, chain, OCSP, Before go-live checklist (CCA India roots, fingerprints, TSA chain, remove ALLOW_EXPIRED_SIGNER_CERT), OCSP unreachable holds upload with 503, never accepted unverified, DSC validation on the server (D-48), Settings: TRUSTED_ROOTS_DIR, TRUSTED_TSA_DIR, API_URL, ALLOW_EXPIRED_SIGNER_CERT

### Community 112 - "Community 112"
Cohesion: 0.25
Nodes (3): scrub_event(), scrub_text(), start()

### Community 113 - "Community 113"
Cohesion: 0.29
Nodes (8): Proxied A records (@, *, app, admin, api, verify, www); mail records DNS-only, Auto-deploy: deploy.yml on main runs infra/vps/04-deploy.sh via restricted SSH key, Caddy with wildcard Let's Encrypt certificate via Cloudflare DNS challenge, api.env DNS settings: CLOUDFLARE_API_TOKEN, CLOUDFLARE_ZONE_ID, DNS_TARGET_IP, DNS_PROXIED, Repair company DNS: POST /v1/platform/tenants/id/dns; platform.tenant_dns_failed, GitHub secrets: VPS_HOST, VPS_USER, VPS_SSH_KEY, VPS_KNOWN_HOSTS, Per-company A records created by API; no wildcard DNS record, Runbook: the VPS (Contabo, Ubuntu 24.04) and company addresses

### Community 114 - "Community 114"
Cohesion: 0.25
Nodes (3): Call, ME, OK

### Community 115 - "Community 115"
Cohesion: 0.25
Nodes (7): allowBuilds, esbuild, msgpackr-extract, prisma, @prisma/engines, minimumReleaseAgeExclude, packages

### Community 118 - "Community 118"
Cohesion: 0.43
Nodes (7): Unsigned build via packaging/build.sh and Desktop build workflow (D-51), releases/desktop/manifest.json (version, min-version, sentryDsn, SHA-256), packaging/publish.py (uploads zips, writes manifest last), Runbook: releasing Flourishive Desktop and self-update, Self-update: check at start and every 6 hours, Install and restart bar, Opt-in Sentry crash reports via manifest sentryDsn, Unsigned app limits and rollback by republishing under higher version (D-51)

### Community 119 - "Community 119"
Cohesion: 0.33
Nodes (7): Private R2 bucket with scoped Object Read and Write token and CORS GET/HEAD, /etc/flourishive/api.env: R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET, STORAGE_DRIVER, STORAGE_LOCAL_FALLBACK and storage:fallback_local Redis counter, storage-migrate-r2 CLI (--dry-run, --delete-local, sha256 verify, exit 2 on mismatch), R2 rollback and caveats (nightly backup no longer covers file bytes), Runbook: file storage on Cloudflare R2 (D-72..D-75), API authorises then redirects to 5-minute signed R2 link

### Community 120 - "Community 120"
Cohesion: 0.29
Nodes (7): scripts, build, dev, lint, preview, test, typecheck

### Community 121 - "Community 121"
Cohesion: 0.29
Nodes (7): scripts, build, dev, lint, preview, test, typecheck

### Community 122 - "Community 122"
Cohesion: 0.33
Nodes (5): collection, compilerOptions, deleteOutDir, $schema, sourceRoot

### Community 124 - "Community 124"
Cohesion: 0.33
Nodes (5): plugins, rules, react/only-export-components, react/rules-of-hooks, $schema

### Community 126 - "Community 126"
Cohesion: 0.33
Nodes (5): plugins, rules, react/only-export-components, react/rules-of-hooks, $schema

### Community 127 - "Community 127"
Cohesion: 0.33
Nodes (5): plugins, rules, react/only-export-components, react/rules-of-hooks, $schema

### Community 128 - "Community 128"
Cohesion: 0.33
Nodes (5): Letter, LETTERS, LetterStatus, STATUS, TIMELINE

### Community 129 - "Community 129"
Cohesion: 0.33
Nodes (5): description, license, name, private, version

### Community 131 - "Community 131"
Cohesion: 0.70
Nodes (3): drawElectronicStamp(), ist(), latin()

### Community 132 - "Community 132"
Cohesion: 0.40
Nodes (5): Hosting requirements: Node 22/24, Redis, 1-minute cron, SSH, MariaDB 10.6+, 2 GB RAM, 50 GB disk, Runbook: check the existing cPanel hosting, Runbook: scheduled jobs (cPanel cron), Nightly verify-audit hash chain check (exit 2, emails platform admins), Worker cron every minute: dist/cli.js worker --max-seconds=55

### Community 134 - "Community 134"
Cohesion: 0.50
Nodes (3): softhsm-selftest.sh script, SOFTHSM2_CONF, SPIKE_TEST_PIN

### Community 135 - "Community 135"
Cohesion: 0.83
Nodes (3): Run(), Say(), Step()

### Community 137 - "Community 137"
Cohesion: 0.67
Nodes (3): load_env(), PATH, 04-deploy.sh script

### Community 138 - "Community 138"
Cohesion: 0.50
Nodes (3): printWidth, singleQuote, trailingComma

## Knowledge Gaps
- **63 isolated node(s):** `RFC-3161`, `RFC-3161`, `RFC-3161`, `RFC-5987`, `flourishive-desktop` (+58 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 1207 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **30 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `runInTenant()` connect `Role assignment and scope` to `Backend app bootstrap and identity`, `Audit, company and Prisma layer`, `Access control modules`, `Document templates and fill`, `Access service and roles`, `Company DNS (Cloudflare)`, `CLI and notifications`, `Community 34`, `Community 35`, `Community 38`, `Community 40`, `Community 42`, `Community 43`, `Community 49`, `Community 51`, `Community 52`, `Community 53`, `Community 54`, `Community 76`, `Community 78`, `Community 101`, `Community 102`, `Community 103`, `Community 116`?**
  _High betweenness centrality (0.067) - this node is a cross-community bridge._
- **What connects `RFC-3161`, `RFC-3161`, `RFC-3161` to the rest of the system?**
  _63 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Backend app bootstrap and identity` be split into smaller, more focused modules?**
  _Cohesion score 0.04368678969867584 - nodes in this community are weakly interconnected._
- **Why does `runAsSystem()` connect `Role assignment and scope` to `Backend app bootstrap and identity`, `Community 66`, `Audit, company and Prisma layer`, `Community 35`, `Community 34`, `Community 38`, `Community 101`, `Access service and roles`, `Community 40`, `Community 42`, `Community 43`, `Community 108`, `Company DNS (Cloudflare)`, `Community 78`, `CLI and notifications`, `Community 52`?**
  _High betweenness centrality (0.049) - this node is a cross-community bridge._
- **Should `Web and admin app shell` be split into smaller, more focused modules?**
  _Cohesion score 0.05309734513274336 - nodes in this community are weakly interconnected._
- **Why does `@nestjs/common` connect `Access control modules` to `Backend app bootstrap and identity`, `Audit, company and Prisma layer`, `Document templates and fill`, `Access service and roles`, `Backend dependencies`, `CLI and notifications`, `Desktop jobs controller`, `Auth controller`, `Controllers overview`, `Community 27`, `Community 31`, `Community 36`, `Community 40`, `Community 42`, `Community 76`, `Community 101`, `Community 102`, `Community 108`, `Community 117`?**
  _High betweenness centrality (0.041) - this node is a cross-community bridge._
- **Should `Web staff screens` be split into smaller, more focused modules?**
  _Cohesion score 0.09765122265122265 - nodes in this community are weakly interconnected._