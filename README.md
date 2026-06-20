# 캄몬스타즈 패이지

캄몬스타즈 방송 현황, 일정, 멤버 프로필, 티어표/전적, 공지, 팬튜브, IN&OUT, 방송 운영 도구를 한곳에서 확인하는 정적 팬허브입니다.

## 주요 화면

- 홈: 오늘 볼 방송, 일정, 공지, 팬튜브, IN&OUT, 티어/전적 요약
- 공개 팬허브: 멤버 현황판, 프로필, 티어표, 일정표, 공지, 영상, IN&OUT, 외부 링크
- 방송도구: CCTV, 핀볼연동, 펀딩, 덕몽어스 계산기, 오락실
- 관리자: Supabase 연결 상태, 공개 데이터 상태, 자동화 로그, 읽기/부분 관리 기반
- 모바일: `/mobile/` 전용 하단 탭 UI

## 실행

정적 HTML 중심 프로젝트입니다. 로컬 확인은 정적 서버로 실행합니다.

```bash
npx serve .
```

정적 검증은 다음 명령으로 실행합니다.

```bash
npm run build
```

## 주요 데이터 흐름

- LIVE 상태: 외부 livecheck API와 Firebase liveStatus fallback
- 일정 요약: `/api/schedule-today`
- 공지/영상: GitHub JSON 원천 + public override/Supabase metadata
- 티어/전적: Firebase Realtime Database
- 관리자/운영 상태: `/api/admin/*`, Supabase 설정 시 확장

## 환경변수 요약

실제 값은 문서나 코드에 커밋하지 않습니다.

- Supabase: URL, anon/publishable key, service role key
- Firebase: 서비스 계정 또는 Admin SDK 관련 환경변수
- Admin: `ADMIN_SECRET`
- SOOP: OAuth client 관련 설정

자세한 설정은 [docs/supabase-setup.md](docs/supabase-setup.md), [docs/github-actions-secrets.md](docs/github-actions-secrets.md)를 참고합니다.

## 배포

Vercel 정적 배포 + serverless API 구조입니다.

1. 변경 후 `npm run build`
2. 주요 API 응답 확인
3. PC `/`와 모바일 `/mobile/` 확인
4. GitHub main으로 push
5. Vercel 배포 URL에서 OG, favicon, manifest, 404 확인

## 자동화

GitHub Actions와 scripts 폴더의 수집 스크립트가 데이터를 갱신합니다.

- `scripts/collect-data.js`
- `scripts/sync-soop-live-to-firebase.js`
- `scripts/export-manual-players.js`
- Supabase import scripts

운영 절차는 [docs/operations-guide.md](docs/operations-guide.md)를 기준으로 확인합니다.
