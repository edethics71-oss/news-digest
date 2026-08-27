# 대입·진로 뉴스 자동 요약 웹앱

매일 "대입", "수시", "정시", "진로" 키워드로 뉴스를 자동 수집하고, Gemini AI로 2~3문장 요약을 만든 뒤, 날짜별 목록으로 보여주는 웹앱입니다.

- 날짜를 클릭하면 그날 수집된 기사들의 제목/요약/언론사/원문 링크가 펼쳐집니다.
- 매일 정해진 시각(한국시간 21:00)에 GitHub Actions가 자동으로 수집·요약을 실행하고, GitHub Pages가 그 결과를 웹페이지로 보여줍니다.
- 컴퓨터를 꺼두어도 GitHub 서버에서 자동으로 실행됩니다.

이 문서는 컴퓨터/코드에 익숙하지 않아도 따라 할 수 있도록 순서대로 설명합니다. **각 단계를 순서대로** 진행해주세요.

---

## 전체 그림

```
매일 밤 9시(자동)
  GitHub Actions → 네이버 뉴스 검색 → Gemini로 요약 → data/ 폴더에 저장 → 자동 커밋
                                                              ↓
                                          GitHub Pages가 index.html로 화면에 표시
```

---

## 1단계. 네이버 API 키 발급받기 (NAVER API HUB)

> 2026년 6월부터 뉴스 검색 API가 기존 "네이버 개발자센터(developers.naver.com)"에서 **NAVER API HUB(네이버클라우드 플랫폼)**로 옮겨졌습니다. 이 프로젝트는 새 방식(API HUB) 기준으로 만들어져 있습니다.

1. https://www.ncloud.com/product/applicationService/naverApiHub 접속
2. 오른쪽 위 **"회원 가입"**을 눌러 네이버클라우드 플랫폼 계정을 만듭니다. (기존 네이버 아이디와는 별개의 가입 절차이며, 이메일/휴대폰 인증이 필요합니다.) 이미 계정이 있다면 **"로그인"**만 하면 됩니다.
3. 가입/로그인 후 **"콘솔"** 버튼을 눌러 NAVER Cloud Platform 콘솔로 이동합니다.
4. 콘솔에서 **"API HUB"** 또는 **"AI·NAVER API"** 관련 메뉴로 들어가 **"Application 등록"**(신규 애플리케이션 생성) 화면을 찾습니다. 이름은 자유롭게 입력하세요 (예: "대입뉴스요약").
5. 사용할 API 목록에서 **"검색 - 뉴스(News)"**를 선택합니다.
6. 등록을 완료하면 **Client ID**와 **Client Secret**(또는 API Key ID / API Key)이 발급됩니다. 메모장 등에 복사해두세요. (뒤에서 사용합니다)

> ⚠️ 콘솔 화면 구성은 네이버 쪽 사정으로 계속 바뀔 수 있어, 위 메뉴 이름이 실제 화면과 조금 다를 수 있습니다. 화면이 설명과 다르거나 결제수단(카드) 등록을 요구하는 화면이 나오면, 그 화면을 캡처해서 저에게 보여주세요 — 같이 확인하겠습니다. 뉴스 검색 API 자체는 현재 무료입니다.
> 참고: 이 API HUB 전환과 함께 요청 주소와 인증 헤더 이름도 바뀌었는데, 이 프로젝트의 `scripts/naver.js`는 이미 새 방식(`naverapihub.apigw.ntruss.com`, `X-NCP-APIGW-API-KEY-ID` / `X-NCP-APIGW-API-KEY` 헤더)으로 맞춰져 있으니 신경 쓰지 않아도 됩니다.

---

## 2단계. Gemini API 키 발급받기 (Google AI Studio, 무료)

1. https://aistudio.google.com/app/apikey 접속 후 구글 계정으로 로그인
2. **"Create API key"** 버튼 클릭
3. Google Cloud 프로젝트를 선택하라는 창이 뜨면 기존 프로젝트를 선택하거나 새로 만듭니다 (이름은 자유롭게)
4. 발급된 키를 복사해서 메모장에 보관하세요.

카드 등록 없이 바로 무료로 발급되며, 이 프로젝트처럼 하루 수십 건 수준의 사용량은 무료 한도 안에서 충분히 처리됩니다. (무료 한도를 넘길 정도로 사용량이 매우 많아지면 그때만 결제 정보 등록 화면이 나옵니다.)

---

## 3단계. GitHub 계정 및 저장소(repository) 만들기

1. https://github.com 에서 계정이 없다면 가입
2. 오른쪽 위 **"+"** → **"New repository"** 클릭
3. Repository name 입력 (예: `news-digest`), **Public**으로 설정 (GitHub Pages 무료 사용을 위해 Public 권장)
4. "Add a README" 등 다른 옵션은 체크하지 말고 바로 **"Create repository"**
5. 생성된 저장소 페이지에 나오는 주소를 복사해두세요. 예: `https://github.com/내계정/news-digest.git`

---

## 4단계. 이 프로젝트를 내 GitHub 저장소에 올리기

터미널(명령 프롬프트/PowerShell)을 열고, 이 프로젝트 폴더(`news-digest`)에서 아래 명령을 **하나씩** 실행하세요. (`내계정` 부분은 실제 GitHub 아이디로, 저장소 주소는 3단계에서 복사한 주소로 바꿔주세요)

```bash
git init
git add .
git commit -m "최초 커밋: 대입뉴스 자동 요약 웹앱"
git branch -M main
git remote add origin https://github.com/내계정/news-digest.git
git push -u origin main
```

> 중요: `.env` 파일은 `.gitignore`에 등록되어 있어 **절대 GitHub에 올라가지 않습니다**. API 키는 다음 단계에서 GitHub Secrets에 별도로 등록합니다.

---

## 5단계. GitHub Secrets에 API 키 등록하기

GitHub Actions가 API 키를 안전하게 사용할 수 있도록, 코드가 아닌 저장소 설정에 키를 등록합니다.

1. 내 저장소 페이지 → 상단 **"Settings"** 탭 클릭
2. 왼쪽 메뉴에서 **"Secrets and variables" → "Actions"** 클릭
3. **"New repository secret"** 버튼을 눌러 아래 3개를 하나씩 등록:

   | Name (정확히 이대로 입력) | Value |
   |---|---|
   | `NAVER_CLIENT_ID` | 1단계에서 받은 네이버 Client ID |
   | `NAVER_CLIENT_SECRET` | 1단계에서 받은 네이버 Client Secret |
   | `GEMINI_API_KEY` | 2단계에서 받은 Gemini API 키 |

4. 3개 모두 등록되면 완료입니다.

---

## 6단계. GitHub Pages 켜기 (웹페이지 주소 만들기)

1. 저장소 **"Settings" → "Pages"** 메뉴로 이동
2. **"Build and deployment"** 섹션에서 **Source**를 **"Deploy from a branch"**로 설정
3. **Branch**를 `main` / `/ (root)`로 선택 후 **Save**
4. 몇 분 후 페이지 상단에 `https://내계정.github.io/news-digest/` 같은 주소가 표시됩니다. 이 주소가 완성된 웹페이지 주소입니다. (즐겨찾기에 등록해두세요)

---

## 7단계. 수동으로 1회 실행해서 정상 동작 확인하기

매일 자동 실행을 기다리지 않고, 지금 바로 한 번 테스트해볼 수 있습니다.

1. 저장소 상단 **"Actions"** 탭 클릭
2. 왼쪽에서 **"Daily News Collect"** 워크플로 클릭
3. 오른쪽의 **"Run workflow"** 버튼 → 다시 **"Run workflow"** 클릭
4. 잠시 후(보통 1~2분) 실행 목록에 새 항목이 생기고, 클릭하면 진행 로그를 볼 수 있습니다. 초록색 체크 표시면 성공입니다.
5. 실행이 끝나면 저장소의 `data` 폴더에 오늘 날짜의 `.json` 파일이 자동으로 생기고 커밋됩니다.
6. 6단계에서 만든 웹페이지 주소로 접속해서 날짜 목록과 요약이 잘 보이는지 확인하세요. (반영까지 1분 정도 걸릴 수 있습니다)

이후로는 **매일 한국시간 밤 9시**에 자동으로 실행됩니다. 별도로 컴퓨터를 켜둘 필요가 없습니다.

---

## 자주 묻는 것들

**실행 시각을 바꾸고 싶어요.**
`.github/workflows/daily.yml` 파일 안의 `cron: "0 12 * * *"` 부분을 수정하면 됩니다. GitHub Actions의 cron 시각은 **UTC(세계표준시) 기준**이며, 한국시간(KST)은 UTC+9시간입니다. 예를 들어 한국시간 오전 7시에 실행하려면 UTC 기준 전날 22시이므로 `"0 22 * * *"`로 설정합니다.

**요약에 사용하는 AI 모델을 바꾸고 싶어요.**
`scripts/summarize.js` 파일의 `model: "gemini-3.5-flash-lite"` 부분을 원하는 모델 이름으로 바꾸면 됩니다. 모델마다 무료 한도(분당/일일 요청 수)가 크게 다르니, 바꾸기 전에 https://aistudio.google.com/rate-limit 에서 후보 모델의 RPD(일일 한도)를 꼭 확인하세요. "Flash Lite" 계열이 일반 "Flash"보다 한도가 훨씬 넉넉합니다.

**언론사 이름이 도메인 주소(예: xxx.com)로 표시돼요.**
`scripts/collect-and-summarize.js` 파일 안의 `PRESS_MAP` 목록에 해당 도메인과 언론사명을 한 줄 추가하면 됩니다.

**검색 키워드를 바꾸거나 추가하고 싶어요.**
`scripts/collect-and-summarize.js` 파일 상단의 `KEYWORDS` 배열에 원하는 키워드를 추가/삭제하면 됩니다. 단, "정시"나 "진로"처럼 일상적으로도 흔히 쓰이는 단어를 단독으로 넣으면(예: "기차가 정시에 도착", "태풍 진로") 대입과 무관한 기사가 대량으로 섞여 들어올 수 있습니다. 되도록 "정시모집", "진로진학"처럼 문맥이 좁혀지는 복합어를 사용하는 것을 권장합니다.

**Gemini 무료 사용량 한도(429 오류)에 걸려요.**
Gemini 무료 티어는 모델마다 분당/일일 요청 수 한도가 다릅니다. 일반 "Flash" 모델은 하루 20건 정도로 매우 적어서, 이 프로젝트는 한도가 훨씬 넉넉한 **`gemini-3.5-flash-lite`**(분당 15건, 일일 500건)를 기본값으로 씁니다. 그래도 요청 사이에 4.5초 간격을 두고, 한도 초과 시 잠시 기다렸다가 재시도하도록 되어 있습니다(`scripts/collect-and-summarize.js`의 `GEMINI_CALL_INTERVAL_MS`, `summarizeWithRetry`). 하루에 신규 기사가 너무 많으면 한 번 실행에서 최대 `MAX_ARTICLES_PER_RUN`(기본 100건)까지만, 그리고 요약 단계 전체가 `SUMMARIZE_TIME_BUDGET_MS`(기본 9분)를 넘으면 그 시점에서 멈추고 나머지는 건너뜁니다. 실행 자체도 GitHub Actions에서 15분(`timeout-minutes`)이 지나면 강제 종료되어, 어떤 경우에도 몇 시간씩 걸리는 일은 없습니다.

한도 초과가 계속되면 https://aistudio.google.com/rate-limit 에서 실제 사용량/한도를 직접 확인해보세요 (모델별로 다르고, 화면에 나오는 표시 이름과 코드의 모델 ID가 완전히 같은 표기가 아닐 수 있습니다).

**로컬 컴퓨터에서 미리 테스트해보고 싶어요.**
1. `.env.example` 파일을 복사해서 `.env`로 저장하고, 발급받은 키 3개를 입력
2. 터미널에서 아래 명령 실행:
   ```bash
   npm install
   npm run collect
   ```
3. `data/오늘날짜.json`과 `data/index.json`이 생성되는지 확인
4. `npx serve .` 명령으로 로컬 웹서버를 띄운 뒤 안내되는 주소(예: `http://localhost:3000`)로 접속해 화면을 확인

**저작권 관련해서 신경 쓴 부분이 궁금해요.**
요약 프롬프트(`scripts/summarize.js`)에 "원문 문장을 그대로 옮기지 말고 완전히 새로운 문장으로 재구성할 것"을 명시적으로 지시하고 있습니다. 또한 원문 전체를 저장하거나 게시하지 않고, 기사 링크로만 연결합니다.

---

## 폴더 구조

```
news-digest/
├── index.html                 # 웹페이지 (날짜 목록 + 요약 보기)
├── assets/
│   ├── style.css               # 화면 스타일
│   └── app.js                  # 날짜 목록/요약 렌더링 로직
├── scripts/
│   ├── collect-and-summarize.js  # 매일 실행되는 메인 스크립트
│   ├── naver.js                  # 네이버 뉴스 검색 API 호출
│   └── summarize.js               # Gemini API로 기사 요약
├── data/
│   ├── index.json               # 날짜별 기사 건수 목록
│   └── YYYY-MM-DD.json          # 해당 날짜의 기사 요약 데이터 (자동 생성)
├── .github/workflows/daily.yml  # 매일 자동 실행 설정
├── .env.example                 # 로컬 테스트용 키 입력 템플릿
└── package.json
```
