# 관리자 가이드

MONSTARZNEW 관리자 모드는 프론트 화면만 수정하는 기능이 아니라 `/api/admin/*` 서버 API와 Supabase 테이블을 통해 실제 공개 데이터를 추가, 수정, 숨김 처리하는 구조다.

## 접속

- PC: 상단 `관리자` 탭
- 모바일: 더보기 메뉴의 `관리 구조`
- 로그인: `ADMIN_SECRET` 값으로 인증
- 인증 상태: `/api/admin/auth/status`

## 백엔드 구조

- 서버 API: `api/admin/index.js`
- Supabase 서버 쓰기: `lib/supabase/admin.js`
- 공개 보정 데이터: `api/public-overrides.js`
- 일정 프록시: `api/schedule-today.js`
- 감사 로그: `admin_audit_log`

## 활성 관리자 리소스

- `members`: 멤버 현황판, 방송 링크, 기본 로스터
- `profiles`: 프로필 상세
- `schedules`: 일정
- `videos`: 영상
- `notices`: 공지 보정, 숨김, 고정
- `inout`: IN&OUT 히스토리
- `links`: 외부 링크
- `resources`: 자료실

뉴캄 관련 관리자 리소스는 종료된 기능이라 `/api/admin`에서 `410 resource_retired`로 처리한다.

## 쓰기 동작

- 추가: `POST /api/admin/<resource>`
- 수정: `PATCH /api/admin/<resource>/<id>`
- 숨김: `PATCH /api/admin/<resource>/<id>/hide`
- 복구: `PATCH /api/admin/<resource>/<id>/restore`
- 고정: `PATCH /api/admin/notices/<id>/pin`, `PATCH /api/admin/videos/<id>/pin`
- 링크 정렬: `PATCH /api/admin/links/reorder`

모든 쓰기는 soft delete 기준이다. 실제 삭제는 하지 않는다.

## 감사 로그

`0008_admin_audit_log.sql` 마이그레이션 적용 후 관리자 쓰기 작업은 `admin_audit_log`에 남는다.

기록 항목:

- 작업 종류
- 리소스
- row id
- payload
- user agent
- IP hash
- 생성 시간

관리자 데이터 상태 화면에서 최근 감사 로그를 확인할 수 있다.

## 환경변수

- `ADMIN_SECRET`
- `SUPABASE_URL` 또는 `NEXT_PUBLIC_SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY` 또는 `SUPABASE_SECRET_KEY`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` 또는 `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`

## 점검 순서

1. Supabase 마이그레이션 적용
2. Vercel 환경변수 설정
3. `/api/admin/auth/status` 확인
4. 관리자 로그인
5. 데이터 상태에서 Supabase, 감사 로그, 자동화 로그 확인
6. 테스트 항목 하나 추가 후 숨김/복구까지 확인
