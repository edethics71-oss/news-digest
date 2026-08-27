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

// true면 아래 PRESS_MAP에 등록된(인지도 있는) 언론사 기사만 채택한다.
// 모르는 언론사도 포함하고 싶으면 false로 바꾸면 된다.
const ONLY_KNOWN_PRESS = true;

// true면 여러 언론사가 같은 소식을 보도했을 때(제목+본문 유사도가 DUPLICATE_SIMILARITY_THRESHOLD 이상)
// PRESS_MAP에 먼저 나열된(우선순위 높은) 언론사 기사 하나만 남기고 나머지는 아예 수집하지 않는다.
const DEDUPE_SIMILAR_ARTICLES = true;
const DUPLICATE_SIMILARITY_THRESHOLD = 0.5;

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
  "fnnews.com": "파이낸셜뉴스",
  "heraldcorp.com": "헤럴드경제",
  "newspim.com": "뉴스핌",
  "nocutnews.co.kr": "노컷뉴스",
  "ohmynews.com": "오마이뉴스",
  "etnews.com": "전자신문",
  "koreaherald.com": "코리아헤럴드",
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

// "2028 대입", "2028대입"뿐 아니라 실제 기사에서 훨씬 흔한 "2029학년도 대입" 표현도 인정한다.
function hasYearBeforeDaeip(article) {
  return /20\d{2}\s*(학년도)?\s*대입/.test(`${article.title} ${article.description}`);
}

function normalizeLink(link) {
  return link.split("?")[0].replace(/\/$/, "");
}

// PRESS_MAP에 등록된 언론사인 경우에만 이름을 돌려주고, 아니면 null을 돌려준다.
function matchKnownPress(link) {
  try {
    const host = new URL(link).hostname.replace(/^www\./, "");
    for (const domain of Object.keys(PRESS_MAP)) {
      if (host === domain || host.endsWith(`.${domain}`)) return PRESS_MAP[domain];
    }
    return null;
  } catch {
    return null;
  }
}

function guessPress(link) {
  const known = matchKnownPress(link);
  if (known) return known;
  try {
    return new URL(link).hostname.replace(/^www\./, "");
  } catch {
    return "알 수 없음";
  }
}

function isKnownPress(link) {
  return matchKnownPress(link) !== null;
}

// PRESS_MAP에 나열된 순서를 그대로 언론사 우선순위로 쓴다(먼저 나올수록 우선).
const PRESS_PRIORITY = Object.values(PRESS_MAP);

function pressPriorityRank(link) {
  const press = matchKnownPress(link);
  const rank = PRESS_PRIORITY.indexOf(press);
  return rank === -1 ? PRESS_PRIORITY.length : rank;
}

function tokenize(text) {
  return new Set((text || "").split(/[^\p{L}\p{N}]+/u).filter((t) => t.length > 1));
}

function jaccardSimilarity(setA, setB) {
  if (setA.size === 0 || setB.size === 0) return 0;
  let intersection = 0;
  for (const token of setA) {
    if (setB.has(token)) intersection++;
  }
  return intersection / (setA.size + setB.size - intersection);
}

// 같은 소식을 여러 언론사가 보도하면(제목+본문 유사도가 threshold 이상), 우선순위가 가장 높은
// 언론사 기사 하나만 남기고 나머지는 제외한다. 우선순위 높은 기사부터 순서대로 채택하면서,
// 이미 채택한 기사와 비슷한 기사는 건너뛰는 방식으로 처리한다.
function dedupeSimilarArticles(articles, threshold) {
  const withTokens = articles
    .map((a) => ({
      article: a,
      tokens: tokenize(`${a.title} ${a.description}`),
      rank: pressPriorityRank(a.link),
    }))
    .sort((a, b) => a.rank - b.rank);

  const kept = [];
  for (const candidate of withTokens) {
    const isDuplicate = kept.some(
      (k) => jaccardSimilarity(candidate.tokens, k.tokens) >= threshold
    );
    if (!isDuplicate) kept.push(candidate);
  }

  return kept.map((k) => k.article);
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
    // "대입"은 두 글자라 "부대입대"처럼 무관한 단어 속 부분 문자열로도 잡히는 경우가 있다.
    // 그래서 이 키워드로 찾은 결과만, 제목/본문에 "2028대입"처럼 연도가 바로 붙어 나올 때만 인정한다.
    const filtered = keyword === "대입" ? items.filter(hasYearBeforeDaeip) : items;
    for (const item of filtered) {
      const key = normalizeLink(item.link);
      if (!collected.has(key)) collected.set(key, item);
    }
  }

  let candidates = [...collected.values()];
  if (ONLY_KNOWN_PRESS) {
    const beforeCount = candidates.length;
    candidates = candidates.filter((a) => isKnownPress(a.link));
    console.log(
      `  인지도 있는 언론사만 채택: ${beforeCount}건 → ${candidates.length}건`
    );
  }

  if (DEDUPE_SIMILAR_ARTICLES) {
    const beforeCount = candidates.length;
    candidates = dedupeSimilarArticles(candidates, DUPLICATE_SIMILARITY_THRESHOLD);
    console.log(
      `  유사(중복 보도) 기사 제거: ${beforeCount}건 → ${candidates.length}건`
    );
  }

  const newArticles = candidates.filter(
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
