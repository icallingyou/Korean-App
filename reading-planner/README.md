# Library Reading Planner 📚

퀸즈 공공도서관(또는 다른 도서관)에서 빌린 책을 **반납일에 맞춰 다 읽을 수 있도록** 하루 분량을 계산해 주고,
책을 검색·추천해 주는 웹앱입니다. 설치 없이 브라우저에서 바로 쓰고, 폰 홈 화면에 앱처럼 추가할 수 있습니다.

**바로 열기:** https://icallingyou.github.io/Korean-App/reading-planner/

## 기능

| 화면 | 내용 |
|---|---|
| **Today** | 오늘 읽을 총 분량과 책별 목표(예: *Read pp. 101–120*), 하루 목표 대비 진행 막대, 연체·초과·누락 경고와 제안, 앞으로 4주 캘린더, `.ics` 캘린더 내보내기 |
| **Shelf** | 읽는 중 / 읽고 싶은 책 / 완독 목록, 반납일·페이지 수 수정, 완독 표시, 별점(추천에 반영) |
| **Discover** | Open Library 검색, "Queens Library에서 확인" 링크, 규칙 기반 추천(같은 저자·같은 주제·인기 도서) |
| **Settings** | 언어(English/한국어), 하루 독서 목표, 반납일 며칠 전 완독, 기본 대출 기간, 도서관 카탈로그 검색 주소, 백업/복원 |

### 대출 목록 가져오기 3가지 방법

1. **크롬 확장 프로그램 (권장)** — 도서관 사이트에 로그인한 상태에서 "대출 중" 페이지를 열면 제목·반납일이 자동으로 플래너에 들어옵니다. 비밀번호 저장 없음. → [설치 안내](extension/README.md)
2. **붙여넣기** — 대출 중 페이지에서 전체 선택·복사 후 *Import from library*에 붙여넣기. 폰에서도 가능.
3. **직접 추가** — *Add a book*에서 검색해 추가하고 반납일 입력.

### 계획 계산 방식

- 책마다 `남은 쪽수 ÷ (반납일 − 여유일 − 오늘 + 1)` 로 하루 분량을 정하고, 반납일이 빠른 책부터 보여 줍니다.
- 오늘 총 분량이 "하루 독서 목표"를 넘으면 가장 반납일이 먼 책을 연장/보류 후보로 제안합니다.
- 반납일이 지난 책은 남은 분량을 오늘로 몰아 경고합니다. 진행 상황을 입력하면 매일 다시 계산됩니다.

## 로컬에서 실행

```bash
# 저장소 루트에서
python3 -m http.server 8000
# → http://localhost:8000/reading-planner/
```

테스트:

```bash
cd reading-planner
node --test tests/*.test.mjs
```

## 구조

```
reading-planner/
├── index.html, css/style.css
├── js/app.js               # 화면·상태·동기화 브리지
├── js/planner.js           # 하루 분량·캘린더·ICS 계산 (순수 함수)
├── js/parse-checkouts.js   # 대출 중 페이지 텍스트 파서 (확장과 공유)
├── js/openlibrary.js       # Open Library API
├── js/i18n.js              # 영어/한국어 문자열
├── extension/              # 크롬 확장 프로그램
├── tests/                  # node:test 단위 테스트
└── sw.js, manifest.webmanifest, assets/   # PWA
```

## 데이터·개인정보

- 모든 데이터는 사용자의 브라우저(localStorage)에만 저장됩니다. 서버가 없습니다.
- 책 정보·표지는 [Open Library](https://openlibrary.org) 공개 API를 사용합니다.
- 퀸즈 공공도서관과 무관한 개인 프로젝트이며, 도서관 계정 정보(비밀번호·카드번호)는 다루지 않습니다.
