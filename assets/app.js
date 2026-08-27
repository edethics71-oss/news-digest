const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

function formatDateLabel(dateStr, count) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dateObj = new Date(Date.UTC(y, m - 1, d));
  const weekday = WEEKDAYS[dateObj.getUTCDay()];
  return `${dateStr}(${weekday}) 대입뉴스 ${count}건`;
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}

async function loadIndex() {
  const res = await fetch("data/index.json", { cache: "no-store" });
  if (!res.ok) throw new Error("날짜 목록을 불러오지 못했습니다.");
  return res.json();
}

async function loadDayArticles(date) {
  const res = await fetch(`data/${date}.json`, { cache: "no-store" });
  if (!res.ok) throw new Error("기사 목록을 불러오지 못했습니다.");
  return res.json();
}

function renderArticles(articles) {
  if (!articles.length) {
    return `<p class="empty">수집된 기사가 없습니다.</p>`;
  }

  return `<ul class="article-list">${articles
    .map(
      (a) => `
    <li class="article-item">
      <a class="article-title" href="${escapeHtml(a.link)}" target="_blank" rel="noopener noreferrer">${escapeHtml(a.title)}</a>
      <p class="article-summary">${escapeHtml(a.summary)}</p>
      <span class="article-press">${escapeHtml(a.press)}</span>
    </li>`
    )
    .join("")}</ul>`;
}

async function toggleDay(li, date) {
  const body = li.querySelector(".day-body");
  const isOpen = li.classList.contains("open");

  if (isOpen) {
    li.classList.remove("open");
    return;
  }

  li.classList.add("open");

  if (!body.dataset.loaded) {
    body.innerHTML = `<p class="loading">불러오는 중...</p>`;
    try {
      const articles = await loadDayArticles(date);
      body.innerHTML = renderArticles(articles);
      body.dataset.loaded = "true";
    } catch (err) {
      body.innerHTML = `<p class="error">오류: ${escapeHtml(err.message)}</p>`;
    }
  }
}

async function init() {
  const listEl = document.getElementById("date-list");

  try {
    const index = await loadIndex();

    if (!index.length) {
      listEl.innerHTML = `<li class="empty">아직 수집된 뉴스가 없습니다. 첫 자동 수집이 진행되면 이곳에 표시됩니다.</li>`;
      return;
    }

    listEl.innerHTML = index
      .map(
        (entry) => `
      <li class="day-item" data-date="${entry.date}">
        <button class="day-header" type="button">${formatDateLabel(entry.date, entry.count)}</button>
        <div class="day-body"></div>
      </li>`
      )
      .join("");

    listEl.querySelectorAll(".day-item").forEach((li) => {
      const date = li.dataset.date;
      li.querySelector(".day-header").addEventListener("click", () => toggleDay(li, date));
    });
  } catch (err) {
    listEl.innerHTML = `<li class="error">목록을 불러오지 못했습니다: ${escapeHtml(err.message)}</li>`;
  }
}

init();
