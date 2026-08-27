import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { GoogleGenAI } from "@google/genai";
import { searchNaverNews } from "./naver.js";
import { summarizeArticle } from "./summarize.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "..", "data");
// "정시"(제 시간에), "진로"(이동 경로) 등은 단독으로 쓰면 대입과 무관한 기사가 대량으로 섞이므로,
// 단독으로 쓰지 않고 "대입"과 함께(두 단어 모두 포함) 검색하거나, 문맥이 좁혀지는 복합어를 사용한다.
const KEYWORDS = [
  "대입",
  "대입 수시",
  "대입 정시",
  "학종",
  "교과전형",
  "수능",
  "대교협",
  "농어촌특별전형",
  "기회균형특별전형",
  "진로진학",
];

// gemini-3.5-flash-lite 무료 티어 한도: 분당 15회, 일일 500회 (일반 flash 모델보다 훨씬 넉넉하다).
// 아래 값들은 그 한도 안에서 안전하게 동작하면서도, 사용량이 갑자기 몰리는 날에도 실행이
// 지나치게 길어지지 않도록 상한을 둔 것이다.
const MAX_ARTICLES_PER_RUN = 100;
const GEMINI_CALL_INTERVAL_MS = 4500; // 분당 15회(4초 간격) 한도보다 여유 있게
const SUMMARIZE_TIME_BUDGET_MS = 9 * 60 * 1000; // 요약 단계 전체에 쓸 수 있는 최대 시간

// 도메인 -> 언론사명 매핑. 목록에 없는 언론사는 도메인 이름을 그대로 표시한다.
// 필요하면 이 목록에 언론사를 자유롭게 추가하면 된다.
const PRESS_MAP = {
  "chosun.com": "조선일보",
  "joongang.co.kr": "중앙일보",
  "donga.com": "동아일보",
  "hani.co.kr": "한겨레",
  "khan.co.kr": "경향신문",
  "hankookilbo.com": "한국일보",
  "seoul.co.kr": "서울신문",
  "kmib.co.kr": "국민일보",
  "segye.com": "세계일보",
  "munhwa.com": "문화일보",
  "mk.co.kr": "매일경제",
  "hankyung.com": "한국경제",
  "mt.co.kr": "머니투데이",
  "edaily.co.kr": "이데일리",
  "asiae.co.kr": "아시아경제",
  "etoday.co.kr": "이투데이",
  "news1.kr": "뉴스1",
  "newsis.com": "뉴시스",
  "yna.co.kr": "연합뉴스",
  "ytn.co.kr": "YTN",
  "sbs.co.kr": "SBS",
  "kbs.co.kr": "KBS",
  "imbc.com": "MBC",
  "jtbc.co.kr": "JTBC",
  "veritas-a.com": "베리타스알파",
  "edunews.co.kr": "한국교육신문",
  "eduinnews.co.kr": "에듀인뉴스",
  "unn.net": "한국대학신문",
  "edudonga.com": "에듀동아",
};

function loadEnvFile() {
  const envPath = path.join(__dirname, "..", ".env");
  if (!fs.existsSync(envPath)) return;

  const content = fs.readFileSync(envPath, "utf-8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const idx = trimmed.indexOf("=");
    if (idx === -1) continue;

    const key = trimmed.slice(0, idx).trim();
    let value = trimmed.slice(idx + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (!(key in process.env)) process.env[key] = value;
  }
}

function todayKst() {
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return kst.toISOString().slice(0, 10);
}

function normalizeLink(link) {
  return link.split("?")[0].replace(/\/$/, "");
}

function guessPress(link) {
  try {
    const host = new URL(link).hostname.replace(/^www\./, "");
    for (const domain of Object.keys(PRESS_MAP)) {
      if (host === domain || host.endsWith(`.${domain}`)) return PRESS_MAP[domain];
    }
    return host;
  } catch {
    return "알 수 없음";
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function extractRetryDelaySeconds(message) {
  const match = /"retryDelay":"(\d+)s"/.exec(message || "");
  return match ? Number(match[1]) : null;
}

// Gemini 무료 티어 사용량 한도(429 RESOURCE_EXHAUSTED)에 걸리면, 서버가 안내하는 대기 시간만큼 쉬었다가
// 재시도한다. 대기 시간에는 상한(20초)을 둬서, 서버가 큰 값을 돌려줘도 실행 시간이 과도해지지 않게 한다.
async function summarizeWithRetry(article, client, maxRetries = 2) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await summarizeArticle(article, client);
    } catch (err) {
      const isRateLimited = /RESOURCE_EXHAUSTED|"code":429/.test(err.message || "");
      if (!isRateLimited || attempt === maxRetries) throw err;

      const waitSeconds = Math.min((extractRetryDelaySeconds(err.message) ?? 15) + 3, 20);
      console.log(
        `  사용량 한도 초과, ${waitSeconds}초 대기 후 재시도합니다. (${attempt + 1}/${maxRetries})`
      );
      await sleep(waitSeconds * 1000);
    }
  }
}

function readJson(filePath, fallback) {
  if (!fs.existsSync(filePath)) return fallback;
  return JSON.parse(fs.readFileSync(filePath, "utf-8"));
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
}

function updateIndex(date, count) {
  const indexPath = path.join(DATA_DIR, "index.json");
  const index = readJson(indexPath, []);

  const entry = index.find((e) => e.date === date);
  if (entry) {
    entry.count = count;
  } else {
    index.push({ date, count });
  }

  index.sort((a, b) => (a.date < b.date ? 1 : -1));
  writeJson(indexPath, index);
}

async function main() {
  loadEnvFile();

  const { NAVER_CLIENT_ID, NAVER_CLIENT_SECRET, GEMINI_API_KEY } = process.env;

  if (!NAVER_CLIENT_ID || !NAVER_CLIENT_SECRET) {
    throw new Error("NAVER_CLIENT_ID / NAVER_CLIENT_SECRET 환경변수가 설정되어 있지 않습니다.");
  }
  if (!GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY 환경변수가 설정되어 있지 않습니다.");
  }

  const targetDate = todayKst();
  fs.mkdirSync(DATA_DIR, { recursive: true });

  const dayFilePath = path.join(DATA_DIR, `${targetDate}.json`);
  const existingArticles = readJson(dayFilePath, []);
  const existingLinks = new Set(existingArticles.map((a) => normalizeLink(a.link)));

  console.log(`[${targetDate}] 뉴스 수집을 시작합니다.`);

  const collected = new Map();
  for (const keyword of KEYWORDS) {
    console.log(`  키워드 검색 중: "${keyword}"`);
    const items = await searchNaverNews({
      query: keyword,
      clientId: NAVER_CLIENT_ID,
      clientSecret: NAVER_CLIENT_SECRET,
      targetDate,
    });
    for (const item of items) {
      const key = normalizeLink(item.link);
      if (!collected.has(key)) collected.set(key, item);
    }
  }

  const newArticles = [...collected.values()].filter(
    (a) => !existingLinks.has(normalizeLink(a.link))
  );

  console.log(
    `  검색 결과 ${collected.size}건 중 신규 기사 ${newArticles.length}건을 요약합니다.`
  );

  let articlesToSummarize = newArticles;
  if (articlesToSummarize.length > MAX_ARTICLES_PER_RUN) {
    console.log(
      `  신규 기사가 많아(${articlesToSummarize.length}건), 이번 실행에서는 최신 ${MAX_ARTICLES_PER_RUN}건만 요약합니다.`
    );
    articlesToSummarize = articlesToSummarize.slice(0, MAX_ARTICLES_PER_RUN);
  }

  const client = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
  const summarized = [];
  const summarizeStartedAt = Date.now();

  for (let i = 0; i < articlesToSummarize.length; i++) {
    if (Date.now() - summarizeStartedAt > SUMMARIZE_TIME_BUDGET_MS) {
      console.log(
        `  요약 시간 예산을 초과해 나머지 ${articlesToSummarize.length - i}건은 건너뜁니다.`
      );
      break;
    }

    const article = articlesToSummarize[i];
    try {
      const summary = await summarizeWithRetry(article, client);
      summarized.push({
        title: article.title,
        summary,
        link: article.link,
        press: guessPress(article.link),
        pubDate: article.pubDate,
      });
      console.log(`  요약 완료 (${i + 1}/${articlesToSummarize.length}): ${article.title}`);
    } catch (err) {
      console.error(`  요약 실패(건너뜀): ${article.title} - ${err.message}`);
    }

    if (i < articlesToSummarize.length - 1) {
      await sleep(GEMINI_CALL_INTERVAL_MS);
    }
  }

  const merged = [...existingArticles, ...summarized];
  writeJson(dayFilePath, merged);
  updateIndex(targetDate, merged.length);

  console.log(`완료: ${targetDate} 기준 총 ${merged.length}건이 저장되었습니다.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
