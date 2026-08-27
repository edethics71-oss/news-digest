// 2026년 6월부터 뉴스 검색 API가 기존 개발자센터에서 NAVER API HUB(네이버클라우드 플랫폼)로 이전되었다.
const NAVER_ENDPOINT = "https://naverapihub.apigw.ntruss.com/search/v1/news";
const DISPLAY_PER_PAGE = 100;
const MAX_START = 1000;

function stripHtml(text) {
  return (text || "")
    .replace(/<[^>]+>/g, "")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .trim();
}

// 네이버 pubDate(RFC 822, 예: "Thu, 27 Aug 2026 09:00:00 +0900")를 KST 기준 YYYY-MM-DD로 변환
function toKstDateString(pubDateStr) {
  const date = new Date(pubDateStr);
  const kst = new Date(date.getTime() + 9 * 60 * 60 * 1000);
  return kst.toISOString().slice(0, 10);
}

// 키워드로 네이버 뉴스를 검색해 targetDate(KST, YYYY-MM-DD)에 발행된 기사만 반환한다.
// 최신순 정렬(sort=date)이므로, targetDate보다 오래된 기사가 나오면 더 이상 뒤 페이지를 볼 필요가 없다.
export async function searchNaverNews({ query, clientId, clientSecret, targetDate }) {
  const results = [];

  for (let start = 1; start <= MAX_START; start += DISPLAY_PER_PAGE) {
    const url = new URL(NAVER_ENDPOINT);
    url.searchParams.set("query", query);
    url.searchParams.set("display", String(DISPLAY_PER_PAGE));
    url.searchParams.set("start", String(start));
    url.searchParams.set("sort", "date");

    const res = await fetch(url, {
      headers: {
        "X-NCP-APIGW-API-KEY-ID": clientId,
        "X-NCP-APIGW-API-KEY": clientSecret,
      },
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`NAVER API HUB 뉴스 검색 오류 (${res.status}): ${body}`);
    }

    const data = await res.json();
    const items = data.items || [];
    if (items.length === 0) break;

    let sawOlderArticle = false;
    for (const item of items) {
      const itemDate = toKstDateString(item.pubDate);
      if (itemDate === targetDate) {
        results.push({
          title: stripHtml(item.title),
          description: stripHtml(item.description),
          link: item.originallink || item.link,
          pubDate: item.pubDate,
        });
      } else if (itemDate < targetDate) {
        sawOlderArticle = true;
      }
    }

    if (sawOlderArticle || items.length < DISPLAY_PER_PAGE) break;
  }

  return results;
}
