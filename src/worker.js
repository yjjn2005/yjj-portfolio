/**
 * 유재진 통합 포트폴리오 · 실시간 수익률 — Cloudflare Worker
 *
 *  GET  /api/quote?syms=KR:005930,US:AAPL,JP:9984.T
 *         네이버증권 → 야후 파이낸스 → 구글 파이낸스 순서로 시도해 현재가를 반환
 *  GET  /api/fx                       USD/KRW · JPY/KRW 환율
 *  GET  /api/search?q=삼성전자         종목 검색 (수동입력 화면의 티커 찾기)
 *  GET  /api/sync/:code               모든 디바이스 동기화 데이터 읽기 (Cloudflare KV)
 *  PUT  /api/sync/:code               모든 디바이스 동기화 데이터 저장
 *  GET  /api/health                   상태 점검
 *  그 외                               public/ 정적 파일 (앱 화면)
 */

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,PUT,POST,OPTIONS',
  'access-control-allow-headers': 'content-type',
  'access-control-max-age': '86400',
};

const UA_M =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const UA_D =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...CORS },
  });

const num = (v) => {
  if (v === null || v === undefined) return null;
  const n = Number(String(v).replace(/[,\s%+₩$]/g, ''));
  return Number.isFinite(n) ? n : null;
};

async function getJson(url, referer, mobile = true) {
  const res = await fetch(url, {
    headers: {
      'user-agent': mobile ? UA_M : UA_D,
      accept: 'application/json, text/plain, */*',
      'accept-language': 'ko-KR,ko;q=0.9,en;q=0.8',
      ...(referer ? { referer } : {}),
    },
    cf: { cacheTtl: 15, cacheEverything: true },
  });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return res.json();
}

async function getText(url) {
  const res = await fetch(url, {
    redirect: 'follow',
    headers: { 'user-agent': UA_D, accept: 'text/html,*/*', 'accept-language': 'en-US,en;q=0.9' },
    cf: { cacheTtl: 15, cacheEverything: true },
  });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return res.text();
}

/* ═════════════ 국내(KR) 시세 ═════════════ */

// 네이버 실시간 폴링 API (2026년 스키마: closePriceRaw)
async function krNaverPolling(code) {
  const d = await getJson(
    'https://polling.finance.naver.com/api/realtime/domestic/stock/' + encodeURIComponent(code),
    'https://finance.naver.com/'
  );
  const row = (d && d.datas && d.datas[0]) || null;
  const price = num(row && (row.closePriceRaw || row.closePrice || row.nv));
  if (!price) throw new Error('no price');
  return {
    price,
    change: num(row.compareToPreviousClosePriceRaw || row.compareToPreviousClosePrice || row.cv) || 0,
    changePct: num(row.fluctuationsRatioRaw || row.fluctuationsRatio || row.cr) || 0,
    name: row.stockName || row.nm || null,
    currency: 'KRW',
    marketStatus: row.marketStatus || null,
    source: '네이버증권',
  };
}

// 네이버 모바일 종목/ETF 기본정보
async function krNaverMobile(code) {
  let d = null;
  const paths = ['https://m.stock.naver.com/api/stock/', 'https://m.stock.naver.com/api/etf/'];
  for (let i = 0; i < paths.length; i++) {
    try {
      const r = await getJson(paths[i] + encodeURIComponent(code) + '/basic', 'https://m.stock.naver.com/');
      if (r && r.closePrice) {
        d = r;
        break;
      }
    } catch (e) {
      /* 다음 경로 */
    }
  }
  const price = num(d && d.closePrice);
  if (!price) throw new Error('no price');
  let change = num(d.compareToPreviousClosePrice) || 0;
  const dir = String((d.compareToPreviousPrice && d.compareToPreviousPrice.code) || '');
  if ((dir === '5' || dir === '4') && change > 0) change = -change; // 하락 / 하한가
  return {
    price,
    change,
    changePct: num(d.fluctuationsRatio) || 0,
    name: d.stockName || null,
    currency: 'KRW',
    source: '네이버증권',
  };
}

async function krYahoo(code) {
  return yahooChart(code + '.KS').catch(() => yahooChart(code + '.KQ'));
}

async function krGoogle(code) {
  return googleFinance(code, ['KRX']);
}

/* ═════════════ 해외(US·JP) 시세 ═════════════ */

async function yahooChart(symbol) {
  const hosts = ['https://query1.finance.yahoo.com', 'https://query2.finance.yahoo.com'];
  let err = 'yahoo';
  for (let i = 0; i < hosts.length; i++) {
    try {
      const d = await getJson(
        hosts[i] + '/v8/finance/chart/' + encodeURIComponent(symbol) + '?interval=1d&range=5d',
        null,
        false
      );
      const r = d && d.chart && d.chart.result && d.chart.result[0];
      const m = r && r.meta;
      const price = num(m && (m.regularMarketPrice || m.previousClose));
      if (!price) throw new Error('no price');
      const prev = num(m.chartPreviousClose) || num(m.previousClose) || price;
      return {
        price,
        change: price - prev,
        changePct: prev ? ((price - prev) / prev) * 100 : 0,
        name: m.shortName || m.longName || null,
        currency: m.currency || null,
        source: '야후 파이낸스',
      };
    } catch (e) {
      err = String((e && e.message) || e);
    }
  }
  throw new Error(err);
}

// 네이버 해외주식 (미국 종목 한글명 · 실시간)
async function usNaver(ticker) {
  const sfx = ['.O', '.N', '.K'];
  for (let i = 0; i < sfx.length; i++) {
    try {
      const d = await getJson(
        'https://api.stock.naver.com/stock/' + encodeURIComponent(ticker + sfx[i]) + '/basic',
        'https://m.stock.naver.com/'
      );
      const price = num(d && (d.closePrice || d.currentPrice));
      if (!price) continue;
      let change = num(d.compareToPreviousClosePrice) || 0;
      const dir = String((d.compareToPreviousPrice && d.compareToPreviousPrice.code) || '');
      if ((dir === '5' || dir === '4') && change > 0) change = -change;
      return {
        price,
        change,
        changePct: num(d.fluctuationsRatio) || 0,
        name: d.stockName || null,
        currency: d.currencyType && d.currencyType.name ? d.currencyType.name : 'USD',
        source: '네이버증권',
      };
    } catch (e) {
      /* 다음 접미사 */
    }
  }
  throw new Error('naver world failed');
}

// 구글 파이낸스 (HTML에서 현재가 추출)
async function googleFinance(ticker, exchanges) {
  for (let i = 0; i < exchanges.length; i++) {
    try {
      const html = await getText(
        'https://www.google.com/finance/quote/' + encodeURIComponent(ticker) + ':' + exchanges[i] + '?hl=en'
      );
      const mp = html.match(/data-last-price="([0-9.]+)"/);
      const price = num(mp && mp[1]);
      if (!price) continue;
      const mc = html.match(/data-last-normal-market-timestamp/); // 존재 여부만 확인
      const pv = html.match(/data-last-close-price="([0-9.]+)"/);
      const prev = num(pv && pv[1]) || price;
      const mcur = html.match(/data-currency-code="([A-Z]{3})"/);
      return {
        price,
        change: price - prev,
        changePct: prev ? ((price - prev) / prev) * 100 : 0,
        name: null,
        currency: (mcur && mcur[1]) || null,
        source: '구글 파이낸스',
        _t: !!mc,
      };
    } catch (e) {
      /* 다음 거래소 */
    }
  }
  throw new Error('google finance failed');
}

async function usGoogle(ticker) {
  return googleFinance(ticker, ['NASDAQ', 'NYSE', 'NYSEARCA', 'NYSEAMERICAN']);
}

async function jpGoogle(ticker) {
  return googleFinance(String(ticker).replace(/\.T$/i, ''), ['TYO']);
}

/* ═════════════ 시세 라우팅 ═════════════ */

const CHAINS = {
  KR: [krNaverPolling, krNaverMobile, krYahoo, krGoogle],
  US: [yahooChart, usNaver, usGoogle],
  JP: [yahooChart, jpGoogle],
};

async function quote(spec) {
  const idx = String(spec).indexOf(':');
  const market = idx > 0 ? String(spec).slice(0, idx).toUpperCase() : 'KR';
  const code = idx > 0 ? String(spec).slice(idx + 1) : String(spec);
  const chain = CHAINS[market] || CHAINS.KR;
  let last = '';
  for (let i = 0; i < chain.length; i++) {
    try {
      const q = await chain[i](code);
      if (q && q.price) return Object.assign({ sym: spec, market, code, ok: true }, q);
    } catch (e) {
      last = String((e && e.message) || e);
    }
  }
  return { sym: spec, market, code, ok: false, error: last || '조회 실패' };
}

/* ═════════════ 환율 ═════════════ */

async function fxNaver(pair) {
  const d = await getJson(
    'https://m.stock.naver.com/front-api/marketIndex/productDetail?category=exchange&reutersCode=FX_' + pair,
    'https://m.stock.naver.com/'
  );
  const r = (d && d.result) || d;
  const rate = num(r && (r.calcPrice || r.closePrice));
  if (!rate) throw new Error('no fx');
  return { rate, change: num(r.fluctuations) || 0, changePct: num(r.fluctuationsRatio) || 0, source: '네이버증권' };
}

async function fxYahoo(symbol) {
  const q = await yahooChart(symbol);
  return { rate: q.price, change: q.change, changePct: q.changePct, source: '야후 파이낸스' };
}

async function onePair(naverCode, yahooSym) {
  try {
    return await fxNaver(naverCode);
  } catch (e) {
    try {
      return await fxYahoo(yahooSym);
    } catch (e2) {
      return { rate: null, error: '환율 조회 실패' };
    }
  }
}

async function fxAll() {
  const [usd, jpy] = await Promise.all([onePair('USDKRW', 'KRW=X'), onePair('JPYKRW', 'JPYKRW=X')]);
  // 네이버 JPY/KRW 는 100엔 기준으로 오는 경우가 있어 1엔 기준으로 정규화
  if (jpy.rate && jpy.rate > 100) {
    jpy.rate = jpy.rate / 100;
    jpy.change = (jpy.change || 0) / 100;
  }
  return { ok: !!(usd.rate || jpy.rate), at: new Date().toISOString(), USD: usd, JPY: jpy };
}

/* ═════════════ 종목 검색 ═════════════ */

async function search(q) {
  try {
    const d = await getJson(
      'https://m.stock.naver.com/front-api/search/autoComplete?query=' + encodeURIComponent(q) + '&target=stock',
      'https://m.stock.naver.com/'
    );
    const items = ((d && d.result && d.result.items) || []).slice(0, 12).map((it) => {
      const nation = it.nationCode || 'KOR';
      let market = 'KR';
      if (nation === 'USA') market = 'US';
      else if (nation === 'JPN') market = 'JP';
      return {
        code: it.code,
        name: it.name,
        exchange: it.typeName || '',
        market,
        cur: market === 'KR' ? 'KRW' : market === 'JP' ? 'JPY' : 'USD',
      };
    });
    return { ok: true, items };
  } catch (e) {
    return { ok: false, items: [], error: String((e && e.message) || e) };
  }
}

/* ═════════════ 동기화 (Cloudflare KV) ═════════════ */

async function syncHandler(request, env, code) {
  if (!env.SYNC) return json({ ok: false, error: 'KV(SYNC) 네임스페이스가 연결되지 않았습니다.' }, 501);
  const key = 'portfolio:' + code;

  if (request.method === 'GET') {
    const raw = await env.SYNC.get(key);
    if (!raw) return json({ ok: false, error: '해당 동기화 코드로 저장된 데이터가 없습니다.' }, 404);
    return json(Object.assign({ ok: true }, JSON.parse(raw)));
  }
  if (request.method === 'PUT' || request.method === 'POST') {
    let body;
    try {
      body = await request.json();
    } catch (e) {
      return json({ ok: false, error: '잘못된 형식입니다.' }, 400);
    }
    const data = (body && body.data) || body;
    const payload = { savedAt: new Date().toISOString(), device: (body && body.device) || '', data };
    const s = JSON.stringify(payload);
    if (s.length > 20 * 1024 * 1024) return json({ ok: false, error: '데이터가 너무 큽니다.' }, 413);
    await env.SYNC.put(key, s);
    return json({ ok: true, savedAt: payload.savedAt });
  }
  return json({ ok: false, error: 'method not allowed' }, 405);
}

/* ═════════════ 라우터 ═════════════ */

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

    if (path === '/api/quote') {
      const syms = (url.searchParams.get('syms') || '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
        .slice(0, 25); // 워커 서브리퀘스트 한도 보호
      if (!syms.length) return json({ ok: false, error: 'syms 파라미터가 필요합니다.' }, 400);
      const items = await Promise.all(syms.map(quote));
      return json({ ok: true, at: new Date().toISOString(), items });
    }

    if (path === '/api/fx') return json(await fxAll());

    if (path === '/api/search') {
      const q = (url.searchParams.get('q') || '').trim();
      if (q.length < 1) return json({ ok: false, items: [], error: 'q 파라미터가 필요합니다.' }, 400);
      return json(await search(q));
    }

    if (path === '/api/health') return json({ ok: true, kv: !!env.SYNC, at: new Date().toISOString() });

    const m = path.match(/^\/api\/sync\/([A-Za-z0-9_-]{3,40})$/);
    if (m) return syncHandler(request, env, m[1].toUpperCase());

    if (path.indexOf('/api/') === 0) return json({ ok: false, error: 'not found' }, 404);

    if (env.ASSETS) return env.ASSETS.fetch(request);
    return new Response('assets not bound', { status: 500 });
  },
};
