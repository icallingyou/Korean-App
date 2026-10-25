# Library Reading Planner Sync — 크롬 확장 프로그램

도서관 사이트에 **본인이 로그인한 상태**에서 "대출 중(Checked Out)" 페이지를 열면,
책 제목·저자·반납일을 읽어 [Library Reading Planner](https://icallingyou.github.io/Korean-App/reading-planner/)로
자동 동기화해 주는 확장 프로그램입니다.

- 비밀번호·카드번호는 읽지도 저장하지도 않습니다. 저장되는 것은 **제목, 저자, 반납일**뿐이며, 이 컴퓨터의 브라우저 안에만 보관됩니다.
- 특정 도서관 시스템에 종속되지 않도록 화면 텍스트에서 "제목 → 저자 → Due 날짜" 패턴을 찾는 방식이라, 퀸즈 공공도서관 외의 BiblioCommons·Vega 계열 카탈로그에서도 대체로 동작합니다.

## 설치 (개발자 모드로 불러오기)

1. **확장 파일 내려받기** — 둘 중 편한 방법으로:
   - 바로 받기(권장): **https://icallingyou.github.io/Korean-App/reading-planner/extension.zip** → 내려받은 `extension.zip`의 압축을 풉니다.
   - 저장소 전체 받기: GitHub 저장소 첫 화면의 초록색 **Code → Download ZIP** → 압축을 풀고 그 안의 `reading-planner/extension` 폴더를 사용합니다.
2. 크롬 주소창에 `chrome://extensions` 입력 → 우측 상단 **개발자 모드** 켜기.
3. **압축해제된 확장 프로그램을 로드합니다** 클릭 → 압축을 푼 `extension` 폴더(안에 `manifest.json`이 바로 보이는 폴더)를 선택.
4. 툴바 퍼즐 아이콘(🧩)에서 "Library Reading Planner Sync"를 고정해 두면 편합니다.

> 압축을 푼 폴더는 지우지 마세요 — 크롬이 그 폴더를 계속 참조합니다.
> Edge, Brave, Whale 등 크로미움 기반 브라우저에서도 같은 방법으로 설치됩니다.

## 사용법

1. 도서관 사이트(예: queenslibrary.org)에 로그인 → **My Account → Checked Out(대출 중)** 페이지를 엽니다.
2. 페이지가 다 뜨면 자동으로 읽어 저장합니다. 안 되면 확장 아이콘을 눌러 **Sync this page now**를 클릭하세요.
3. 확장 팝업의 **Open planner**(또는 플래너 주소로 직접 접속)를 누르면 대출 목록이 반납일과 함께 들어와 있고, 하루 독서 분량이 계산됩니다.
4. 카탈로그에서 아무 책이나 한 번 검색하면, 플래너의 "Queens Library에서 확인" 링크에 쓸 **검색 주소가 자동으로 감지**됩니다.

## 지원 사이트

기본으로 아래 도메인에서 자동 동작합니다(`manifest.json`의 `content_scripts.matches`):

- `*.queenslibrary.org`, `*.iiivega.com`, `*.bibliocommons.com`

다른 도서관 사이트에서는 그 탭을 열어 둔 채 확장 아이콘 → **Sync this page now**를 누르면 됩니다(활성 탭 권한으로 1회 실행).
자주 쓰는 도메인이 있다면 `manifest.json`의 `matches`와 `host_permissions`에 추가한 뒤 `chrome://extensions`에서 새로고침하세요.

## 문제 해결

- **"No due dates found"**: 대출 중 페이지가 완전히 로드된 뒤 다시 시도하세요. 목록이 표 형태라면 "Due" 열 제목이 보이는 상태여야 합니다.
- **플래너에 반영이 안 됨**: 플래너 페이지를 새로고침하세요. 확장은 페이지가 열릴 때 최신 동기화 데이터를 전달합니다.
- 페이지 구조가 특이해 인식이 안 되면, 플래너의 **Import from library → 붙여넣기**로 대출 중 페이지 텍스트를 직접 붙여 넣을 수 있습니다(같은 파서 사용).

## 파일

| 파일 | 역할 |
|---|---|
| `manifest.json` | 확장 설정 (MV3) |
| `parse-checkouts.js` | 대출 목록 텍스트 파서 (`../js/parse-checkouts.js`와 동일 사본) |
| `content-library.js` | 도서관 페이지에서 대출 목록 수집·저장 |
| `content-planner.js` | 플래너 페이지로 데이터 전달(postMessage 브리지) |
| `popup.html/js/css` | 툴바 팝업 |
