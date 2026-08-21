# 유재진 통합 포트폴리오 · 실시간 수익률

11계좌 · 65종목 통합 포트폴리오를 **실시간 시세**로 평가하고, **모든 디바이스에서 같은 데이터**를 보는 앱.

- Cloudflare: https://yjj-portfolio.yjjn2005.workers.dev  (데이터 포함 · 평소 쓰는 주소)
- GitHub Pages: https://yjjn2005.github.io/yjj-portfolio/  (코드만 · 동기화 코드로 데이터 불러옴)
- 기반: Cloudflare Workers (백엔드 + 정적 호스팅) + Cloudflare KV (동기화)
- 원본 데이터: `유재진_통합포트폴리오_최종.xlsx` (기준일 2026-05-14)

## 시세 소스 (자동 폴백)

| 시장 | 1순위 | 2순위 | 3순위 | 4순위 |
|---|---|---|---|---|
| 국내(KR) | 네이버증권 실시간 | 네이버 모바일(주식/ETF) | 야후 파이낸스 (.KS/.KQ) | 구글 파이낸스 (KRX) |
| 미국(US) | 야후 파이낸스 | 네이버 해외주식 | 구글 파이낸스 (NASDAQ/NYSE/ARCA) | — |
| 일본(JP) | 야후 파이낸스 | 구글 파이낸스 (TYO) | — | — |
| 환율 | 네이버증권 (USD/KRW·JPY/KRW) | 야후 파이낸스 | — | — |

브라우저가 직접 외부 API를 부르지 않고 **워커가 대신 호출**하므로 CORS 프록시가 필요 없다.

## API

```
GET  /api/quote?syms=KR:005930,US:AAPL,JP:9984.T   현재가·등락
GET  /api/fx                                       USD/KRW · JPY/KRW
GET  /api/search?q=삼성전자                         종목 검색(티커 찾기)
GET  /api/sync/:code                               동기화 데이터 읽기
PUT  /api/sync/:code                               동기화 데이터 저장
GET  /api/health                                   상태 점검
```

## 평가 방식

- **자동**: 수량 × 실시간 현재가 × 환율 → 원화 평가금액. 매입금액은 원화 그대로 사용.
- **수동**: 평가금액을 직접 입력 (채권·MMF·외화예수금 등 시세 조회 대상이 아닌 자산).
- 환율은 `실시간` / `기준일 고정`(USD 1,405 · JPY 9.42) 중 선택 가능.

## 엑셀 원본 대비 정정한 티커

네이버증권 조회로 검증한 결과, 엑셀의 종목코드 6건이 다른 종목을 가리키고 있어 **종목명 기준으로 정정**했다.

| 종목명 | 엑셀 코드 | 실제 그 코드의 종목 | 정정 코드 |
|---|---|---|---|
| KODEX 삼성전자SK하이닉스채권혼합50 | 409820 | KODEX 미국나스닥100레버리지 | **0177N0** |
| TIGER 반도체TOP10 | 381170 | TIGER 미국테크TOP10 INDXX | **396500** |
| TIGER 코리아TOP10 | 385720 | TIME 코스피액티브 | **292150** |
| TIGER 코리아배당다우존스 | 441680 | TIGER 미국나스닥100커버드콜 | **0052D0** |
| SOL 미국배당미국채혼합50 | 494300 | KODEX 미국나스닥100커버드콜OTM | **490490** |
| 카이노스메드 | 237370 | KODEX 코리아배당성장채권혼합 | **284620** |

미해결 2건 (앱에서 `티커 확인 필요` 로 표시):
- **국일제자수 (002N60)** — 네이버·야후 모두 조회 불가
- **미국우주항공ETF (495470)** — 네이버·야후 모두 조회 불가

## 개발 / 배포

```bash
npm run dev      # 로컬 개발 서버
npm run deploy   # Cloudflare 배포
```

KV 네임스페이스: `PORTFOLIO_SYNC` (id `20dea994176d4ff5812120e64ae63570`) → 바인딩명 `SYNC`

## 원본 데이터 재생성

`docs/seed.json` 는 엑셀에서 자동 생성한다. 재생성 스크립트는 세션 스크래치패드의 `gen_seed.py` 참고.

## GitHub Pages 와 Cloudflare 의 차이

| | Cloudflare | GitHub Pages |
|---|---|---|
| 주소 | yjj-portfolio.yjjn2005.workers.dev | yjjn2005.github.io/yjj-portfolio |
| 보유종목·금액 | `docs/seed.json` 포함 (바로 보임) | **없음** — 동기화 코드로 불러옴 |
| 시세·환율·검색·동기화 | 자체 워커 | Cloudflare 워커 호출 (CORS 허용) |

`docs/seed.json` 은 `.gitignore` 로 제외돼 **GitHub 저장소에 자산 정보가 올라가지 않는다.**
GitHub Pages 로 처음 접속하면 동기화 코드 입력 화면이 뜨고, 코드를 넣으면 Cloudflare KV 에서 전체 포트폴리오를 받아온다.

## GitHub Pages 설정

저장소 Settings → Pages → Source: `Deploy from a branch` → Branch: `main` / 폴더 `/docs` → Save
