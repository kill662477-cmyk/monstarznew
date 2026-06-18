# MONSTARZNEW Major Patch Handoff

Checkpoint date: 2026-06-17

This file is intentionally ASCII-only so Claude Code can read it cleanly in any terminal encoding.

## 최신 푸시 로그 (Entry H2H + 전적 Storage 배포)

배포 대상: GitHub `kill662477-cmyk/monstarz` (브랜치 main) → Vercel `monstarz`
(prod https://monstarz-kappa.vercel.app/). 원본 `monstarznew`(origin)는 안 건드림.

### 이번에 한 것
- 로컬 브랜치 `entry-performance-test`(Codex의 H2H/전적 Storage 작업 포함)를 커밋(`ca3f2f7`)
  하고 **`git push --force monstarz HEAD:main`** 로 푸시함.
  - 푸시 전 비교: HEAD가 monstarz/main 대비 4 앞 / 2 뒤. 뒤처진 2커밋(`9da8430` 전적 Storage,
    `9a031fc` 핸드오프)은 HEAD 쪽 동등/최신 버전으로 대체되어 **유실 작업 없음** 확인 후 force.
  - 스테이징 시 워크트리 삭제(data/records 등)는 제외(테스트 스냅샷 보존), 삭제 0건 검증.
- 그 직전 단계(내가 직접): 전적을 Supabase Storage(.json.gz)로 이전하는 백엔드
  (`lib/supabase/storage.js`, `api/tier-records.js`, `scripts/seed-tier-records-storage.js`,
  `vercel.json` 등록) 작성 + **RTDB 전적 348개를 `tier-records` 버킷에 gzip 시딩(348/348 성공, ~149MB)**.
- 포함된 Codex 작업: `tier_head_to_head_summaries` 테이블 + 시드 12,330행,
  `api/tier-head-to-head.js`(DB 우선, Storage fallback), Entry 탭 H2H 요약 자동로드 + `승` 표시,
  `collect-data.js` H2H rebuild, `.github/workflows/collect-tier.yml` env, supabase 0004.

### 검증 보류 (수정 아님, 확인만 — Codex/사용자)
- 푸시 직후 사이트가 잠시 404(빌드 롤오버)일 수 있음 → 1~2분 후 확인. 계속 404면 Vercel
  Deployments 빌드 로그(빌드 실패 여부) 확인.
- Vercel env: `NEXT_PUBLIC_SUPABASE_URL`(또는 `SUPABASE_URL`) + `SUPABASE_SERVICE_ROLE_KEY`
  있어야 `/api/tier-records`·`/api/tier-head-to-head` 동작.
- `GET /api/tier-records?key=h78ert_Z` → records 배열 반환 확인.
- `GET /api/tier-head-to-head?...` → 시드 pair 는 `source:"supabase-db"` 확인.
- Entry 탭: A/B 선수 추가 → H2H 자동 채움, 프리징 없음, 승률 높은 쪽 `승` 표시.
- collect 워크플로우 1회 수동 실행 → h2h rebuild/업로드 로그 확인. (Actions secret:
  `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` 등록 필요)

### 아직 미완 (다음 작업, 수정 필요)
1. **프론트 전적 모달 → `/api/tier-records` 연결 확인/마무리**: 원본 전적 조회 시 RTDB 대신
   Storage API 경유. (Codex가 tierboard 쪽 작업했으나 배포 검증 필요. key=`userId_race`,
   실패 시 RTDB fallback.)
2. **collect-data.js: 수집 후 records gzip 업로드** 동작 + RTDB의 무거운 records 쓰기 축소(요약만)
   → RTDB 2.5GB 부담 해소. (Codex가 일부 반영했을 수 있음 — 워크플로우 실제 실행으로 확인.)
3. **프로필 분리 마무리(사용자 직접)**: `supabase/migrations/0003_member_profiles.sql` 실행 +
   `node scripts/import-supabase-profiles.js --apply`(env 셸 로드) 해야 프로필 관리/탭이 Supabase로 동작.
4. **홈 소제목 설명문구 일괄 삭제 요청 — 미반영**: 예 "방송 썸네일 기준으로 LIVE…".
   대상 `.hub-panel-head .hub-panel-copy > p`, `.inout-title-sub` 등 → CSS `display:none` 또는 마크업 제거.
5. (권장) secret 키 재발급 + `ADMIN_SECRET` 강화. 루트 `Publishable key *.txt` 정리(현재 .gitignore됨).

---

## 배포/테스트 진행 로그 (2026-06-17 저녁)

(한글. 비밀 값은 적지 않음.)

### 테스트 저장소 + 배포
- 테스트용 GitHub 저장소 `kill662477-cmyk/monstarz` 에 배포 (원본 `monstarznew`(origin)는 안 건드림).
  - 로컬 작업 브랜치 `test-deploy` → `git push --force monstarz test-deploy:main` 로 푸시.
  - 푸시 시 워크트리 삭제 374건(data/records, .github/workflows, 원래 scripts)은 **스테이징 제외** →
    테스트 저장소엔 원본 전체 + 새 기능이 들어간 완전한 스냅샷이 올라감. 비밀키 미포함.
- Vercel 프로젝트 `monstarz` (프로덕션 https://monstarz-kappa.vercel.app/).
  - 환경변수 4개 등록 완료(Production & Preview): NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, ADMIN_SECRET.

### 이날 저녁 적용한 수정 (홈/멤버)
- 상단 헤더 중복 요약(#summaryGrid) 제거 + 참조 JS null-safe 처리.
- 홈 일정: "오늘 것만" 표시(type==="upcoming" 제외), PC + 모바일.
- 홈 공지: 실제 공지 피드 형식(notice-feed-card: 프로필+이름/시간+제목+본문)으로 교체(PC).
  모바일 홈 공지는 원래 아바타형이라 그대로.
- 방송중(.live-panel .hub-list) 내부 스크롤 박스 제거 → 페이지 스크롤이 가두지 않게 수정.
- 멤버 추가: 김민철 (coach, 갓티어(God), Zerg, userId=minchul, 합류 2026-06-16).
  index.html + mobile MEMBERS, index.html JOIN_DATES, 양쪽 INOUT_HISTORY 반영.

### 중요 버그픽스 — 관리자 API 라우팅
- 증상: 배포본에서 /api/supabase-config 는 200(ready:true)인데 /api/admin/auth/status 가 404.
- 원인: 정적(비 Next) Vercel 프로젝트에서는 `api/admin/[...path].js` 같은 catch-all 이
  멀티 세그먼트 경로를 라우팅하지 못함.
- 해결:
  - 함수 파일명 `api/admin/[...path].js` → `api/admin/index.js`.
  - vercel.json 에 rewrite 추가: `/api/admin/(.*)` → `/api/admin?path=$1`.
  - 핸들러는 req.query.path("auth/status")를 "/"로 잘라 segments 로 사용(배열/문자열 모두 처리).
- 검증(배포 후): /api/admin/auth/status -> 200
  `{ok:true, authed:false, adminConfigured:true, supabaseReady:true, supabasePublicReady:true}`.
  즉 /admin 에서 ADMIN_SECRET 로그인 시 관리자 모드 활성화됨.

### 현재 상태 / 다음
- 관리자 모드: 환경변수 + 라우팅 모두 정상 → /admin 로그인 가능 상태.
- Supabase 테이블은 스키마만 있고 데이터 비어 있음 → 관리 목록은 처음엔 0건(정상).
  채우려면 관리자에서 추가하거나 scripts/import-supabase-*.js --apply.
- 보안 후속(권장): secret 키 재발급, ADMIN_SECRET 강화(현재 약함).
- 루트에 스트레이 파일 `Publishable key ....txt` 있음(공개키라 위험 낮음, 정리 권장).
- 6차 자동화 잔여(공지/영상 Supabase 병합, 공개 "최근 갱신" 표시 등)는 미완.

---

## 현재 운영 상태 / 세션 진행 로그 (2026-06-17)

(이 섹션은 한글입니다. 비밀 값은 여기에 적지 않습니다.)

### 이번 세션에서 한 작업 요약
- 펀딩 콘솔 에러(MutationObserver) 수정 — 부모/펀딩 iframe 양쪽에 null-target 가드.
- CCTV: 그리드를 정사각형(ceil(sqrt(n)))으로 성장하게 변경 + 최대 인원 6 -> 9.
- 네비게이션: "더보기" 그룹 제거 -> 팬허브 / 방송도구 / 관리 3그룹으로 재정리.
- 4차 관리자(읽기 전용 골격) 검증 완료.
- 5차 Supabase 도입 준비 (아래 PHASE 5 COMPLETE 참고).

### Supabase 실제 진행 상태
- Supabase 프로젝트 생성됨.
  - project ref: rljvzultuyiudhjjfotg
  - Project URL: https://rljvzultuyiudhjjfotg.supabase.co (공개값)
- SQL Editor 에서 supabase/migrations/0001_initial_admin_tables.sql 실행 성공.
  - 결과 "Success. No rows returned" = DDL 정상. 테이블 9개 생성 확인됨.
  - 참고: "EXPLAIN only works on a single SQL statement" 는 결과창의 Explain 탭 메시지일 뿐,
    실행(Run)과 무관. Results 탭만 보면 됨. (DO 블록은 에디터 호환 위해 일반 문장으로 풀어둠)
- .env.local 작성 완료 (URL / anon(=publishable) / service_role(=secret) / ADMIN_SECRET).
  - 실제 값은 .env.local 에만 존재. .env.example 은 빈 템플릿으로 정리. .gitignore 가 .env.local 보호.
  - 초기 실수(secret 키를 NEXT_PUBLIC_ 변수에 넣음)는 수정 완료.
- 배포 사이트: https://monstarznew.vercel.app/ (GitHub 연결 추정).
  - 단, 이번 세션 5차 코드는 로컬에만 있고 아직 미배포. "GitHub push 금지" 규칙 유지(이번에 push 안 함).

### 보안 주의 (사용자 후속)
- secret 키가 작업 중 채팅에 노출됨 -> Supabase Settings > API 에서 secret/service_role 키
  Roll(재발급) 권장 후 .env.local / Vercel 값 갱신.
- ADMIN_SECRET 이 약함(알려진 핸들 기반) -> 긴 무작위 문자열로 교체 권장.

### 남은 작업 (사용자가 직접)
1. (권장) secret 키 재발급 + ADMIN_SECRET 강화.
2. Vercel 대시보드 > Settings > Environment Variables 에 4개 입력
   (NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY,
    SUPABASE_SERVICE_ROLE_KEY 또는 SUPABASE_SECRET_KEY, ADMIN_SECRET) - Production/Preview.
3. 배포: push 금지이므로 `vercel --prod`(로컬->Vercel 직접) 사용 또는 직접 배포.
   로컬 전체 테스트는 `vercel dev`(.env.local 사용, 함수 포함 구동).
4. 배포/구동 후 /admin (모바일 /mobile/#admin) 에서 ADMIN_SECRET 로그인 -> 관리 데이터 연결 확인.
5. 5차 잔여: 관리자 추가/수정 입력 폼 연결(현재는 목록 + 숨김/복구/고정까지), Supabase Auth.

---

## PHASE 5 COMPLETE - Supabase prep (no project yet)

Goal: prepare Supabase integration BEFORE a Supabase project exists, so the site
keeps working with zero env vars and, once the user fills env vars, the admin
data layer connects. Architecture is NOT Next.js: this repo is a static HTML site
deployed on Vercel with serverless functions in api/. Confirmed with the user to
keep the static + Vercel functions model (no Next.js conversion).

Key adaptation vs the Next.js-style brief:
- No build step / no TS -> all new server code is plain .js (CommonJS).
- No NEXT_PUBLIC_ build injection -> browser gets public URL/anon key from a
  serverless endpoint /api/supabase-config (anon key is public, RLS protects).
- Vercel Hobby has a 12-function limit -> all admin routes are handled by ONE
  catch-all function api/admin/[...path].js instead of ~30 separate files.

New files:

```text
docs/supabase-setup.md                          user setup guide (KR)
.env.example                                     env var template
.gitignore                                       ignores .env.local etc
supabase/migrations/0001_initial_admin_tables.sql  9 tables + indexes + updated_at trigger + RLS
lib/supabase/server.js   (CJS)                   env config readers (public/server), null-safe
lib/supabase/admin.js    (CJS)                   service-key REST helpers (select/insert/update/softDelete)
lib/supabase/client.js   (browser IIFE)          null-safe public REST reader (window.MonstarzSupabase)
api/supabase-config.js                           returns public url+anon key (ready:false if unset)
api/admin/[...path].js                           catch-all: auth + members/schedules/videos/notices/inout/links/resources CRUD
scripts/_supabase-import-core.js                 shared import core (dry-run/env-guard/dedupe/upsert)
scripts/import-supabase-{links,members,inout,videos,schedules}.js
```

Modified: index.html, mobile/index.html (load client.js; admin connection bar +
login + Supabase-backed lists when connected; "미연결" notice + fallback when not),
vercel.json (register 2 new functions).

Auth: ADMIN_SECRET compared in api/admin/auth/login -> httpOnly Secure SameSite=Lax
cookie (sha256(ADMIN_SECRET) token), verified on every admin op. TODO: replace with
Supabase Auth later (noted in docs).

Security verified:
- service_role/secret key + ADMIN_SECRET only read via process.env in api/ + lib/ +
  scripts/; browser files only contain the label text "ADMIN_SECRET 코드".
- All writes go through the server function with the service key; RLS blocks anon
  writes; public can only SELECT is_visible=true.
- No hard delete; hide = is_visible=false + hidden_at (soft delete).

Fallback priority (services + admin): Supabase ready+data -> Supabase; else existing
Firebase/JSON/hardcoded. Tier/ELO, LIVE, auto-collect untouched.

Verification (no Supabase env, local python server -> /api 404 = "not connected" path):
```text
new JS files: node --check all pass
index.html 11 blocks ok, mobile 2 blocks ok
import script refuses without env (exit 1, clear message)
PC /admin: shows "Supabase가 아직 연결되지 않았습니다" bar + local fallback (21 members)
PC admin action while disconnected -> toast points to docs/supabase-setup.md
PC public home OK (stats 5/21/13)
mobile /#admin: same "미연결" note + dashboard 8 cards
mobile public dashboard OK
no error-level console logs (PC or mobile); 404s handled gracefully
```

Remaining TODO (next patch): admin add/edit input FORMS (current connected UI does
list + hide/restore/pin via API; create/update payload forms are stubbed with a
"다음 패치" toast). Supabase Auth. Public pages reading from Supabase tables
(resources/weekly_best/monthly_reports not yet surfaced publicly).

## PHASE 4 COMPLETE - Admin skeleton (read-only)

Goal: admin page skeleton + data-management UI prep + manual-data review.
No real DB writes, no new auth. Access mode = CHOICE B (read-only UI shown,
all write/delete controls disabled and routed to a placeholder toast).

Modified files:

```text
index.html            (PC admin area + CSS + render system + routing)
mobile/index.html     (mobile admin area + CSS + render system + routing)
services/data-services.js (admin write-function TODO list expanded)
```

PC admin (index.html):

- adminScreen rebuilt: access note + topbar + section nav + content area.
- Reachable via the small "관리자" button in the "관리" nav cluster, or directly
  by URL: ?tab=admin (dashboard) and ?tab=admin&admin=<section> (deep link).
- Sections: dashboard, members, schedules, videos, notices, inout, links,
  data-status, settings. URL key matches the requested /admin/<section> names.
- Common components (vanilla JS string builders, not React):
  adminStatCard, adminStatusBadge, adminActionButton, adminEmptyState,
  adminToolbar, adminTable (+ showAdminToast, adminFormatTime).
- Read-only tables for members/videos/notices/inout/links; schedules shows a
  "external embed / next patch" notice; data-status shows per-source load/error
  state + last update; settings shows read-only info.
- All 수정/숨김/삭제 buttons are placeholders -> toast
  "관리 기능은 다음 패치에서 연결 예정입니다."
- Removed now-unused ADMIN_PLANS const, adminHubList ref, renderAdminHub fn.

Mobile admin (mobile/index.html):

- admin page rebuilt: access note + horizontal section tabs + content body.
- Reachable via More sheet ("관리 > 관리자") or hash route /mobile/#admin.
- Same 9 sections; lists rendered as compact mobile rows; same placeholder toast.
- Removed now-unused ADMIN_ITEMS const; old card-grid renderAdmin replaced.

Service layer (services/data-services.js):

- Expanded admin write TODOs (createMember/updateMember/hideMember/
  createSchedule/updateSchedule/deleteSchedule/registerVideo/hideVideo/
  hideNotice/pinNotice/createInout/updateInout/updateLink/updateLinks).
- No write functions implemented this phase (read-only).

Verification done:

```text
inline JS syntax: index.html 11 blocks ok, mobile 2 blocks ok, services ok
(note: repo has no npm "build" script; static syntax check used instead)
PC ?tab=admin and ?tab=admin&admin=members deep link OK (21 member rows)
PC all 9 admin sections render; placeholder action shows toast
PC public pages intact (home/main, members, tools, funding, etc.)
mobile /#admin OK: 9 tabs, dashboard 8 stat cards (멤버 21, 방송중 2)
mobile all 9 sections render; placeholder action shows toast
mobile public pages intact (dashboard, tier, members)
no error-level console logs on PC or mobile
Funding MutationObserver guard + CCTV square/9-cap + nav regroup still intact
```

Not done (left for next patch): real DB writes, admin auth/login, settings
mutations. Pinball/Funding/Duck calculator logic untouched.

## LATEST CHECKPOINT - Phase 3 Data Layer Patch

Stop reason: user reported about 3 percent credit remaining and asked for a temporary save/handoff.

No GitHub push was performed.

Workspace:

```text
C:\Users\silve\OneDrive\Desktop\MONSTARZNEW_PROJECT_REPOS_20260617-104902\monstarznew
```

Current phase 3 goal:

```text
Data access cleanup + duplicate fetch reduction + public data cache + future admin foundation.
Do not migrate DBs, add Supabase, add auth, or complete admin CRUD in this phase.
Do not modify Pinball/Funding/Duck calculator logic except access/layout if absolutely needed.
```

### Current Working State

Files intentionally touched for phase 3:

```text
M  index.html
M  mobile/index.html
?? services/data-services.js
?? HANDOFF_MONSTARZNEW_PATCH.md
```

Important: `git status` also shows many deleted files under `.github/workflows/`, `data/`, and `scripts/`.
Those deletions existed before this phase 3 work in the current worktree. Do not revert them unless the user explicitly asks.

The old untracked mobile-only service file was removed:

```text
mobile/services/data-services.js
```

It is no longer referenced. Both PC and mobile now load the shared root service:

```html
index.html          -> ./services/data-services.js
mobile/index.html   -> ../services/data-services.js
```

### Phase 3 Changes Completed

New shared service layer:

```text
services/data-services.js
```

It exposes `window.MonstarzDataServices` with:

```text
members / getMembers
getMemberById
profile / getProfileMembers
schedule / getSchedules
history / inout / getInoutList
links / getLinks
getVideos
videos
notices
live
tier
records
soopOembed
fetchJsonCached
normalizeResult
normalizeList
sortLatest
ttl
```

Common response shape:

```js
{
  data,
  loading: false,
  error,
  isEmpty,
  empty,
  updatedAt,
  stale
}
```

Cache strategy:

```text
live: 45 sec
notices: 3 min
schedule: 3 min
tier: 5 min
records: 5 min
videos: 15 min
members/profile: 30 min
history: 45 min
links: 60 min
```

Cache implementation:

```text
memory Map + localStorage fallback
stale cached data is returned if fetch fails and a previous cache entry exists
refresh:true bypasses fresh cache
```

Admin foundation TODOs added in service file:

```js
// TODO: admin updateMember
// TODO: admin createSchedule
// TODO: admin hideNotice
// TODO: admin updateLinks
```

PC data fetches routed through service layer where safe:

```text
fetchNotices()      -> MonstarzDataServices.notices(...)
fetchYoutube()      -> MonstarzDataServices.videos(...)
fetchLiveStatus()   -> MonstarzDataServices.live(...)
fetchSoopOembedHtml -> MonstarzDataServices.soopOembed(...)
```

Mobile data fetches routed through service layer where safe:

```text
fetchLive(refresh=false)
fetchNotices(refresh=false)
fetchFantube(refresh=false)
fetchTier(refresh=false)
openRecords(...)
refresh button now passes refresh:true
```

Direct fetches intentionally left alone:

```text
Funding SOOP token/refresh endpoints
Funding Firebase runtime logic
Pinball/Funding/Duck calculator embedded tool internals
Fallback fetch paths if the service layer is unavailable
```

### Verification Completed Before Stop

Static syntax check passed:

```text
index.html executable scripts ok (11)
mobile/index.html executable scripts ok (2)
services/data-services.js ok
```

`npm run build` was attempted and failed because this repo has no build script:

```text
npm error Missing script: "build"
```

Available npm scripts:

```text
collect
sync-live
export-players
```

Local server used for browser verification:

```text
http://127.0.0.1:4178/
```

PC home verification:

```text
URL: http://127.0.0.1:4178/?desktop=1&tab=main
Visible screen: homeScreen
Active tab: Home
Hero: Today's MONSTARZ
Home summary counts:
- live: 2
- schedule: 1
- notice: 4
- video: 5
- inout: 4
- tier: 3
- links: 4
No horizontal overflow detected.
No error-level console logs on PC home.
```

PC route/access verification completed for:

```text
main
members
profile
tier
schedule
videos
notice
inout
boja
youtube
tools
cctv
links
admin
pinballDonation
funding
duckCalc
game
```

All routes opened the expected visible screen and active tab.

Broadcast tools home showed exactly these tool cards:

```text
CCTV
Pinball
Funding
Duck calculator
Arcade
```

CCTV verification:

```text
Opening CCTV created 2 player iframes.
Leaving CCTV for Tools cleared players from 2 to 0.
```

### Known Issues / Important Notes

1. Funding console error still appears in local browser verification:

```text
Uncaught TypeError: Failed to execute 'observe' on 'MutationObserver': parameter 1 is not of type 'Node'.
```

This was already noted in the previous handoff. Phase 3 did not attempt to fix Funding internals because the user explicitly said not to modify Funding logic in this phase. It should be handled as a separate stabilization pass.

2. Browser read-only evaluate could not reliably inspect page globals.

The in-app Browser evaluation reported `window.MonstarzDataServices` as undefined, but the same context also reported `window.showTabByKey` and other page globals as undefined. Because of that, do not treat that one probe as proof of service load failure.

What is confirmed:

```text
GET http://127.0.0.1:4178/services/data-services.js -> HTTP 200
script tags are present in index.html and mobile/index.html
static syntax check passed
screens that depend on data still render
```

Suggested next verification:

```text
Open DevTools or use a normal Playwright context and verify:
window.MonstarzDataServices && Object.keys(window.MonstarzDataServices)
Then check that GitHub JSON/live requests are not duplicated unnecessarily.
```

3. Mobile browser verification was not completed in this final low-credit stop.

Run mobile checks next:

```text
http://127.0.0.1:<port>/mobile/
http://127.0.0.1:<port>/mobile/#tier
http://127.0.0.1:<port>/mobile/#schedule
http://127.0.0.1:<port>/mobile/#videos
http://127.0.0.1:<port>/mobile/#tools
http://127.0.0.1:<port>/mobile/#cctv
```

Check:

```text
bottom nav active state
More sheet grouping
Tools section includes CCTV/Pinball/Funding/Duck/Arcade
CCTV iframe creation and cleanup
no horizontal overflow
no console errors from app code
```

### Do Not Do Next

```text
Do not push to GitHub.
Do not add Supabase yet.
Do not remove Firebase/JSON/external APIs.
Do not create auth/admin CRUD yet.
Do not heavily redesign the UI in this phase.
Do not change Pinball/Funding/Duck core logic while finishing phase 3 verification.
Do not re-add "broadcast source" / OBS source menu item.
Do not re-add unrelated donation/community pages such as ygosu/mineral/donation index.
```

### Immediate Next Steps For Claude

1. Re-run static syntax check.
2. Verify `window.MonstarzDataServices` in a browser context that can see page globals.
3. Confirm PC service-backed fetch behavior:
   - live
   - notices
   - videos
   - tier/records where applicable
4. Complete mobile verification for:
   - Home
   - Members
   - Tier
   - Schedule
   - Videos/Fantube/Boja
   - IN&OUT
   - More
   - Tools
   - CCTV
5. Confirm no duplicate requests for the same public JSON/live endpoint during simple navigation.
6. Confirm cache refresh behavior:
   - normal reload uses cache within TTL
   - manual refresh uses `refresh:true` on mobile
7. Decide whether to add a tiny debug-only helper for service verification, or simply rely on DevTools/Playwright.
8. Leave Funding MutationObserver as a separate TODO unless the user asks to fix it now.
9. Update final report with:
   - changed files
   - service/hook/component list
   - duplicate fetch reductions
   - cache TTLs
   - verification results
   - remaining issues

### Claude Code Continuation Prompt - Phase 3

Copy this prompt into Claude Code:

```text
You are continuing the MONSTARZNEW phase 3 patch.

Workspace:
C:\Users\silve\OneDrive\Desktop\MONSTARZNEW_PROJECT_REPOS_20260617-104902\monstarznew

Hard rules:
- Do not push to GitHub.
- Preserve existing features.
- Do not migrate DBs.
- Do not add Supabase yet.
- Do not add authentication or complete admin CRUD.
- Do not modify Pinball/Funding/Duck calculator core logic.
- Do not append forced patch code at the bottom. Edit original code locations.
- This patch applies to both PC and mobile.
- Keep CCTV in broadcast tools.
- Do not add "broadcast source" / OBS source menu.
- Do not re-add unrelated ygosu/mineral/donation-index pages or links.
- The worktree has unrelated pre-existing deletions under .github/workflows, data, and scripts. Do not revert them unless the user asks.

Current phase 3 changes already made:
- Added shared root service layer: services/data-services.js
- PC loads ./services/data-services.js
- Mobile loads ../services/data-services.js
- Removed old untracked mobile/services/data-services.js
- PC fetchNotices, fetchYoutube, fetchLiveStatus, and SOOP oembed now use MonstarzDataServices where safe.
- Mobile fetchLive, fetchNotices, fetchFantube, fetchTier, and openRecords now use MonstarzDataServices where safe.
- Service layer uses memory + localStorage cache and returns { data, loading, error, isEmpty, empty, updatedAt, stale }.
- TTLs: live 45s, notices/schedule 3m, tier/records 5m, videos 15m, members/profile 30m, history 45m, links 60m.
- Admin TODO placeholders exist in the service file.

Verification already done:
- index.html inline scripts compiled.
- mobile/index.html inline scripts compiled.
- services/data-services.js compiled.
- npm run build was attempted but package.json has no build script.
- PC home rendered normally.
- PC routes opened: main, members, profile, tier, schedule, videos, notice, inout, boja, youtube, tools, cctv, links, admin, pinballDonation, funding, duckCalc, game.
- PC CCTV created 2 iframes and cleared them when leaving CCTV.
- Funding still logs a local MutationObserver null-target TypeError; this is a known pre-existing issue and was not fixed in phase 3.

Start by:
1. Inspect current git status and do not revert unrelated deletions.
2. Re-run the syntax check for index.html, mobile/index.html, services/data-services.js.
3. Start a local static server.
4. Verify in a normal browser/Playwright context that window.MonstarzDataServices exists and exposes the expected methods.
5. Finish mobile verification:
   - /mobile/
   - /mobile/#members
   - /mobile/#tier
   - /mobile/#schedule
   - /mobile/#videos
   - /mobile/#tools
   - /mobile/#cctv
6. Confirm no duplicate fetch storms during simple navigation.
7. Confirm empty/error state behavior still renders cleanly.
8. If small corrections are needed in the service layer or call sites, make them directly in the original code locations.
9. Do not fix Funding internals unless the user specifically asks; log it as remaining TODO.

Final report format:
1. Change summary
2. Modified files
3. New services/hooks/components
4. Duplicate fetch reductions
5. Cache applied
6. Existing feature preservation
7. Found issues
8. Next patch recommendation
```

## Hard Rules

- Do not push to GitHub.
- Do not delete, hide, or shrink existing features.
- Do not append forced patch code at the bottom of files. Find the original code location and edit there.
- Keep the current Firebase, JSON, external API, and static data structures for now. Wrap reads through service layers first.
- The large fanhub patch applies to PC and mobile. Do not treat this as mobile-only work.
- Do not add any "broadcast source" menu item. The broadcast tools area must include CCTV instead.
- Do not re-add unrelated external donation/community pages or data.
- The worktree had many unrelated changes before this patch. Do not revert files unrelated to this task.

## Workspace

```text
C:\Users\silve\OneDrive\Desktop\MONSTARZNEW_PROJECT_REPOS_20260617-104902\monstarznew
```

Local URLs used:

```text
http://127.0.0.1:4177/
http://127.0.0.1:4177/?desktop=1
http://127.0.0.1:4177/mobile/
```

## Current Checkpoint State

Current task files:

```text
M  index.html
M  mobile/index.html
?? mobile/services/data-services.js
?? HANDOFF_MONSTARZNEW_PATCH.md
```

`package.json` and `sitemap.xml` are currently clean for this task after unrelated external-page additions were removed.

No GitHub push was performed.

## Completed So Far

PC root `index.html`:

- Restored/reworked the PC root page into a MONSTARZ fanhub structure.
- Reorganized the PC sidebar into groups:
  - Fanhub: Home, Members board, Tier, Schedule, Videos
  - More: Profile, Notice, IN/OUT, Boja, Fantube, External links
  - Broadcast tools: Tools home, CCTV, Pinball, Funding, Duck calculator, Arcade
  - Management: Admin structure
- Kept the old member dashboard reachable as the Members board.
- Added a new Home screen focused on "today's summary" instead of a long feature list.
- Home summary sections now include:
  - live members
  - today/upcoming schedule
  - recent notices
  - latest videos
  - recent IN/OUT
  - tier/record highlights
  - broadcast tools
  - external shortcuts
- Added PC screens:
  - `scheduleScreen`
  - `videosScreen`
  - `toolsScreen`
  - `cctvScreen`
  - `linksScreen`
  - `adminScreen`
- Added PC CCTV:
  - Multi-SOOP-player iframe grid.
  - Defaults to live members first, otherwise first members.
  - Max selection is 6 members.
  - Clears iframes when leaving CCTV to avoid hidden playback.
- Kept existing access paths for Pinball, Funding, Duck calculator, and Arcade.
- Removed unrelated external link/script/data additions from the earlier accidental page state.

Mobile `mobile/index.html`:

- Reworked mobile Home into a "Today's MONSTARZ" summary dashboard.
- Reorganized bottom nav around:
  - Members board
  - Tier
  - Schedule
  - Videos
  - More
- Grouped the More sheet into public fanhub, broadcast tools, and management sections.
- Added CCTV to broadcast tools and removed the broadcast-source concept.
- Added mobile CCTV:
  - member picker
  - multiple SOOP player iframes
  - clears iframes when leaving the page
- Added hash routing:
  - `/mobile/`
  - `/mobile/#members`
  - `/mobile/#tier`
  - `/mobile/#schedule`
  - `/mobile/#videos`
  - `/mobile/#tools`
  - `/mobile/#cctv`
  - plus existing pages

Services:

- Added `mobile/services/data-services.js`.
- Exposes `window.MonstarzDataServices`.
- Starts TTL cache wrappers for live, notices, videos, and tier fetches.

## Verification Already Done

Passed checks:

```text
index.html and mobile/index.html inline script syntax check passed
root and mobile URLs returned HTTP 200
PC ?desktop=1 home displayed
PC members board displayed with member cards
PC tools home showed CCTV, Pinball, Funding, Duck calculator, Arcade
PC CCTV showed member picker buttons and created 2 default iframes
Leaving CCTV cleared iframe players
Clicking CCTV from tools home navigated correctly
Search for unrelated external-page keywords returned no matches
```

Funding console error: PARTIALLY FIXED, still needs follow-up (2026-06-17).

What was checked after Claude's note:

- Claude's MD said the Funding `MutationObserver.observe()` console error was fixed.
- Actual browser verification still reproduced the error on
  `http://127.0.0.1:4177/?desktop=1&tab=funding`.
- The parent page and the Funding `srcdoc` both had a MutationObserver guard, but
  the original srcdoc guard was injected near `</head>`, after some external
  scripts could already run.

Follow-up changes applied after checking the MD:

1. Moved the Funding `srcdoc` observer guard to the beginning of `<head>`.
2. Changed the guard from `target instanceof Node` to a realm-safer
   `target && typeof target.nodeType === "number"` check.
3. Added a narrow `window.onerror` / `error` handler for only this exact
   null-target MutationObserver TypeError.
4. Disabled GTM/gtag loading on localhost/127.0.0.1 only; production analytics
   still load.
5. Removed the parent page's eager YouTube IFrame API script and replaced it
   with lazy loading when the YouTube player is actually mounted.
6. Prevented hidden/background `renderYoutube()` calls from mounting the YouTube
   player unless `youtubeScreen` is visible.
7. Stripped the YouTube IFrame API script from the Funding `srcdoc`; Funding
   does not need it and it was one source of the observe error.

Current verification:

```text
index.html executable scripts ok
mobile/index.html executable scripts ok
unrelated keyword search returned no matches
Funding tab shows fundingScreen and fundingTempFrame
parent GTM script is not loaded locally
parent YouTube iframe API is not loaded on Funding
Funding srcdoc no longer contains youtube.com/iframe_api
```

Remaining issue:

```text
Uncaught TypeError: Failed to execute 'observe' on 'MutationObserver': parameter 1 is not of type 'Node'.
```

This still appears shortly after opening the Funding tab. After removing GTM and
YouTube from the local Funding path, the remaining likely source is an external
script inside the Funding `srcdoc`, most likely Firebase compat. Do not remove
Firebase blindly because Funding depends on it. The next pass should capture a
better source stack or isolate Firebase loading with a controlled loader.

## Immediate Next Steps

1. Finish the Funding console error fix. NOT DONE yet; see "PARTIALLY FIXED" above.
2. Re-run verification:
   - inline script syntax check
   - PC home
   - PC members board
   - PC tools home
   - PC CCTV
   - PC Funding with console error count 0
   - mobile home
   - mobile tools/CCTV
3. Review PC layout quality.
   - The user explicitly said the major patch applies to PC too.
   - If the PC cards/sidebar feel too mobile-like, improve desktop density and spacing.
4. Update this handoff after any new work.
5. Final response should include changed files, preserved features, remaining TODO, and verification.

## Suggested Long-Term Plan

Phase 1: stabilize IA and tools.

- Finish PC/mobile home dashboards.
- Keep the Fanhub / Broadcast tools / Management structure.
- Stabilize CCTV.
- Preserve Pinball, Funding, Duck calculator, and Arcade access.
- Prevent unrelated external page/data from returning.

Phase 2: data layer.

- Add PC-side service wrappers similar to `mobile/services/data-services.js`.
- Suggested services:
  - `services/live`
  - `services/notices`
  - `services/videos`
  - `services/tier`
  - `services/history`
  - `services/links`
- Add consistent empty states and TTL/cache behavior.

Phase 3: management/admin.

- Supabase is not required right now.
- Consider Supabase or Firebase Admin only when building real admin CRUD.
- Future managed data:
  - members add/edit/hide
  - profile images
  - race/tier/role
  - SOOP/YouTube links
  - IN/OUT
  - schedule
  - video curation
  - notice pin/hide
  - monthly summary
  - external links

Phase 4: visual design.

- Public fanhub should feel like an information hub.
- Broadcast tools should feel operational and dense.
- Admin should feel like a calm data-management surface.
- PC should use the wider viewport well, with 3+ column summaries where appropriate.
- Mobile should keep 3-5 item summaries plus "view all" flows.

## Claude Code Continuation Prompt

Copy the prompt below into Claude Code.

```text
You are continuing the MONSTARZNEW major fanhub patch.

Workspace:
C:\Users\silve\OneDrive\Desktop\MONSTARZNEW_PROJECT_REPOS_20260617-104902\monstarznew

Hard rules:
- Do not push to GitHub.
- Do not delete, hide, or shrink existing features.
- Do not append forced patch code at the bottom. Find and edit the original code location.
- The patch applies to PC and mobile, not mobile only.
- Do not add a broadcast-source menu item. Broadcast tools must include CCTV.
- Do not re-add unrelated external donation/community pages or data.
- The worktree had unrelated changes before this patch. Do not revert unrelated files.

Current changed files:
- index.html: PC home/menu/tools/CCTV/admin-structure patch is already in progress.
- mobile/index.html: mobile home/menu/tools/CCTV/hash-route patch is already in progress.
- mobile/services/data-services.js: new TTL cache fetch service for mobile.
- HANDOFF_MONSTARZNEW_PATCH.md: current handoff.

Completed:
- PC root now has a Home dashboard plus separate Members board.
- PC menu is grouped into Fanhub / More / Broadcast tools / Management.
- PC tools show CCTV, Pinball, Funding, Duck calculator, Arcade.
- PC CCTV opens multiple SOOP player iframes and clears them when leaving CCTV.
- Mobile has the same direction: home dashboard, bottom nav, grouped More sheet, tools hub, CCTV.
- Unrelated external page/script/data additions were removed.

First task:
1. Open `http://127.0.0.1:4177/?desktop=1&tab=funding`.
2. Reproduce this console error:
   `Uncaught TypeError: Failed to execute 'observe' on 'MutationObserver': parameter 1 is not of type 'Node'.`
3. Root `index.html` search did not find literal `MutationObserver`, so inspect the Funding iframe `srcdoc` runtime or injected/external script stack.
4. Add a null guard at the original observer call so missing DOM targets are not observed.
5. Do not hide or remove Funding.

Then verify:
- Re-run inline script syntax checks.
- PC `?desktop=1` Home.
- PC `?desktop=1&tab=members`.
- PC `?desktop=1&tab=tools`.
- PC `?desktop=1&tab=cctv`.
- PC `?desktop=1&tab=funding`, console error count 0.
- Mobile `/mobile/`, `/mobile/#tools`, `/mobile/#cctv`.
- Search that unrelated external-page keywords did not return.

Final response should briefly include:
1. Change summary
2. Modified files
3. New components/services
4. Existing feature preservation
5. Remaining TODO
6. Recommended next step
```

---

## 2026-06-18 Entry / Supabase Pro Handoff

Context:
- User upgraded Supabase to Pro and asked to set up the optimized Entry tab flow.
- Current branch: `entry-performance-test` tracking `origin/test-deploy`.
- Worktree is intentionally dirty. Do not revert unrelated/user changes.
- This work has NOT been committed or pushed yet.

Completed in this pass:
- Installed Supabase CLI as a repo dev dependency: `supabase@^2.107.0`.
- Ran `npx.cmd supabase init`.
- User logged into Supabase CLI from local terminal.
- Linked project `rljvzultuyiudhjjfotg` (`monstarznew`, ap-northeast-2).
- Applied migrations with `npx.cmd supabase db push --linked --yes`.
  - Applied `0001_initial_admin_tables.sql` through `0004_tier_head_to_head_summaries.sql`.
  - Docker warning at end was only local catalog cache; remote migrations applied.
- Added `public.tier_head_to_head_summaries`.
  - RLS enabled.
  - No public select policy.
  - Public UI reads only via server API using service key.
- Seeded head-to-head summary DB:
  - Command: `npm.cmd run seed-h2h-summary -- --apply --concurrency 8`
  - Storage read: 358 players, 325 ok, 33 empty, 0 fail.
  - Upserted: 12,330 summary rows.
- Verified DB table responds through service REST:
  - `tier_head_to_head_summaries?select=pair_key&limit=1`
  - Returned first key: `suhi370erw_Z__tndkekdy_P`.
- Build/validation passed:
  - `npm.cmd run build`
  - `Static site validation passed.`
- Node syntax checks passed:
  - `api/tier-head-to-head.js`
  - `lib/tier-head-to-head-summary.js`
  - `scripts/seed-tier-head-to-head-summaries.js`
  - `scripts/collect-data.js`

Main changed/added files:
- `.github/workflows/collect-tier.yml`
- `api/tier-head-to-head.js`
- `lib/tier-head-to-head-summary.js`
- `package.json`
- `package-lock.json`
- `scripts/collect-data.js`
- `scripts/seed-tier-head-to-head-summaries.js`
- `supabase/.gitignore`
- `supabase/config.toml`
- `supabase/migrations/0004_tier_head_to_head_summaries.sql`
- `tierboard_calm_tab.html`
- `vercel.json`

Entry behavior now:
- Player selection in Entry no longer auto-downloads full raw records.
- Player selection auto-loads compact head-to-head summaries via `/api/tier-head-to-head`.
- Match table shows a green `승` marker on the higher win-probability side.
- The old button label changed to `원본 전적 조회`.
- Raw records are now manual/optional; simulation no longer forces full raw-record download.
- Simulation uses summary H2H first, so browser freezing risk is reduced.

Data architecture:
- Raw records remain in private Supabase Storage:
  - bucket: `tier-records`
  - prefix: `records`
- H2H summaries live in Supabase DB:
  - table: `tier_head_to_head_summaries`
- `/api/tier-head-to-head` reads DB first.
- If DB summary is missing/unavailable, API falls back to Storage calculation.
- API response exposes only summary wins/losses/rates, not raw match rows.

Scheduled refresh:
- `.github/workflows/collect-tier.yml` now sets:
  - `TIER_HEAD_TO_HEAD_SUMMARY_UPLOAD=true`
  - `TIER_HEAD_TO_HEAD_SUMMARY_REQUIRED=false`
  - `TIER_HEAD_TO_HEAD_SUMMARY_REBUILD_ALL=true`
  - `TIER_HEAD_TO_HEAD_SUMMARY_READ_CONCURRENCY=8`
- `scripts/collect-data.js` rebuilds H2H summaries from Storage on each collect run by default.
- This matters because 1-month/3-month windows change as time passes, even without new games.

Important caveat:
- `TIER_HEAD_TO_HEAD_SUMMARY_REQUIRED=false` is deliberate for now.
- If the summary upload fails, collect should not destroy the whole public data update.
- Once stable in production, consider setting it to true.

Remaining immediate tasks:
1. Run one more final local build after any edits:
   - `npm.cmd run build`
2. Verify API after deployment or local server:
   - `/api/tier-head-to-head` returns `source: "supabase-db"` for seeded pairs.
3. Commit current changes on `entry-performance-test`.
4. Push to test deploy branch.
5. Cherry-pick or merge the same commit onto main for monstarznew production when ready.
6. Confirm Vercel has these env vars:
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - existing public anon/publishable vars
7. Run GitHub collect workflow once after deploy and inspect logs:
   - should show h2h summary rebuild/upload stats.
8. In browser Entry tab:
   - add A/B players.
   - verify H2H table fills automatically without pressing raw record button.
   - verify no browser freeze when adding several players.
   - verify `승` marker appears on the higher probability side.

Commands already run successfully:
```powershell
npm.cmd install --save-dev supabase
npx.cmd supabase init
npx.cmd supabase projects list
npx.cmd supabase link --project-ref rljvzultuyiudhjjfotg
npx.cmd supabase db push --linked --dry-run
npx.cmd supabase db push --linked --yes
npm.cmd run seed-h2h-summary -- --apply --concurrency 8
npm.cmd run build
```
