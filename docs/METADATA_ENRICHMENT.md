# 外部資料預覽與匯入

> 最後確認：2026-11-26（R-523）。從網站補充資料夾資訊的現行規則。程式：`shared/sources.ts`、`electron/metadata.ts`、`electron/metadata-public.ts`、`electron/sources/`、`src/metadata/FolderSourceImport.tsx`、`electron/explorer-source.ts`；測試：`tests/metadata.test.ts`、`tests/date-fields.test.ts`。

已接入的來源以 `shared/sources.ts` 為準（目前：E-Hentai、ExHentai、Hitomi.la、nhentai、Bangumi、AniList、DLsite、Steam、VNDB、itch.io、MusicBrainz、Open Library、Pixiv、Wikimedia Commons、Wikidata、MangaDex、Kitsu、MangaUpdates、小説家になろう、Apple Music、Deezer、Danbooru、Google Books、BOOTH、カクヨム；需要使用者金鑰的 TMDB、SteamGridDB、FANZA／DMM；以及任何 HTTPS 網頁（Web））。此頁持有來源流程與人工值保護；程式入口：[metadata](../electron/metadata.ts)、[Explorer](../electron/explorer.ts) 的 metadataPreview／applyMetadata。

## 目前能力

手動貼精確畫廊 URL → 驗證／取得公開 gdata → 預覽 → 選欄位與封面 → 明確套用至資料夾 → 保存可攜資料並更新畫面。來源欄位使用獨立 ID／來源 URL；人工欄位不混成同一值，遇既有 ID 的來源衝突拒絕。封面需要保存時複製受管資產，不能只依賴網路 URL。

保留標題、原語言標題、標籤等原語意；posted 是畫廊上傳時間，不當作品發行日。固定回應的測試證據不代表真實網站／帳號／收藏已驗收。

### E-Hentai／ExHentai 標籤與姊妹站

- 兩站視為同一來源：匯入一律寫入 `eh-` 欄位（來源網址仍記錄實際網站）；先前存在 `exh-` 的欄位在下次匯入時由 `eh-` 接手並移除舊欄位。
- 標籤是 `命名空間:名稱`。除完整的 `TAGS` 外，每個命名空間另成一個標籤欄位（`LANGUAGE`、`PARODY`、`CHARACTER`、`ARTIST`、`GROUP`、`COSPLAYER`、`FEMALE`、`MALE`、`MIXED`、`OTHER`、`RECLASS`），值不含命名空間前綴；沒有該命名空間的標籤就不產生欄位。未知命名空間只留在 `TAGS`。
- 取得範圍與公開頁面相同（公開 API；未登入、不讀網頁），登入後才看得到的標籤不會取得。

- **用名稱搜尋**（R-418）：資料夾設定的「從網站補充資訊」上方有搜尋框，預設填入資料夾名稱（可改，上限 200 字）。按搜尋後 main 同時向 VNDB（`kana/vn`）、MusicBrainz（`release-group`）、AniList（GraphQL，含成人作品並依 `isAdult` 標示）、Bangumi（`v0/search/subjects`；有 Bangumi 個人權杖才含 NSFW 並依 `nsfw` 標示，沒有就排除）、Steam 商店搜尋（`api/storesearch`，`l`、`cc` 跟第一個偏好語言）、DLsite（`product.json?keyword=`，無排名、約取最新 50 筆符合者，標題含關鍵字的排前面；店別取自紀錄的 `site_id` 且須是 DLsite 轉接器接受的店，成人分級 `age_category` 3 標示成人）、nhentai（`api/v2/search`，舊的 `api/galleries/search` 回 403，全部標示成人）各要最多 10 筆，每家 15 秒逾時（從送出起算，排隊等候不算）、一家失敗只在候選上方提示「○○ 搜尋失敗」。來源回 429 或 503（網站暫時拒絕過多請求）時，照 Retry-After 等 1～10 秒（沒給就 2 秒）再問一次，仍被拒就顯示「來源網站暫時拒絕過多的請求」；逾時顯示「來源網站回應太慢」，不再都當成「無法連線」（R-461，所有來源適用）。候選顯示標題（依偏好語言）、年份或藝人與來源；位址由檢查過的 ID 組成，選一個就等於貼上它的網址並走一般預覽，不自動配對。成人向來源列入搜尋（C-143），已知是成人的候選在清單上標「成人」（`MetadataCandidate.adult`）；VNDB 沒有便宜的作品成人旗標，不標示。使用者設定了 TMDB 金鑰時多問 TMDB（`search/multi`，只收電影與影集，`language` 依第一個偏好語言，金鑰與來源轉接器一樣只在 main 讀取），設定了 FANZA 金鑰（API ID 與 Affiliate ID）時多問 FANZA（DMM `ItemList` 的 `keyword`，全部標示成人，位址由 `cid` 組成）；沒有金鑰就不問也不提示失敗（R-419）。搜尋框說明列出這些來源。搜尋框右邊、「搜尋」按鈕左邊的來源按鈕決定要問哪些來源（R-424；R-443 改成按鈕：寫出第一個來源名稱再「+N」，滑過列出全部，沒選時紅字「未選來源」且不能搜尋；點開分組勾選「一般」「需要金鑰」「成人向」，下方有「設定金鑰」與「還原此類型預設」）：請求 `metadataSearch` 可帶 `sources`（已知搜尋來源 ID 的清單，最多 9 個，IPC 檢查；未知 ID 整個請求被拒）；`searchSources` 只問清單內的來源，沒帶就問全部，清單是空的就丟錯（不當成全部，避免呼叫端的疏忽變成全搜）。沒金鑰的 TMDB 與 FANZA 即使被選也照舊略過；畫面上它們顯示為停用並標「需要金鑰」，選單裡附前往金鑰設定的按鈕。勾選依資料夾類型記在本機工作區偏好 `searchSources`（`{ game?, book?, music?, video?, general? }`，每個值是來源 ID 清單，不寫進專案或資料夾記錄、不隨設定包匯出）；某類型從沒選過時用預設勾選：遊戲 VNDB、Steam、DLsite；書籍 AniList、Bangumi、nhentai、DLsite；音樂 MusicBrainz；影片 TMDB、AniList；一般全部；使用者改過就記住該類型的選擇。成人向來源可以取消勾選。遊戲設定的「存檔資料夾」下，若資料夾記錄有匯入的引擎欄位（如 VNDB 的 ENGINE），並列「來源：○○｜本機：○○」，名稱在忽略大小寫、空白與標點後不同時加一句提示（R-418）。請求 `metadataSearch` 不經資料庫鎖，只問網站（electron/sources/search.ts）。
- **只貼網址**：資料夾設定的「資料」分頁上方的「從網站補充資訊」不再先選來源；由網址網域自動辨識（純數字視為 Steam App ID），辨識成功時輸入框右側顯示站名（商店網址顯示「經 VNDB」），才可按「取得預覽」；未知網址就地顯示錯誤。說明提示只有一句與範例，支援的網站依種類列在可展開的「支援的網站」裡（R-329）。不依分類限制來源。

## Steam

接受官方商店 App 網址或 App ID，預覽名稱、開發商、發行商、類型、簡介、商店日期、截圖網址及選用封面（截圖可選匯入為圖片，見「來源圖片清單」）；商店文字依第一個偏好語言（`l` 參數：`tchinese`、`schinese`、`japanese`、`english`、`spanish`；沒有偏好時用英文），Steam 沒有該語言時商店自己退回英文；匯入使用 steam- 命名空間，與 E-Hentai／人工值分開。日期保留 Steam 商店原文，不推定為作品首次發行日或購買日。

目前使用 [Steam 商店公開資料端點](https://store.steampowered.com/api/appdetails?appids=620&l=english)，不宣稱是有相容承諾的 Steamworks API。main 固定請求主機／路徑、限制大小／逾時／重新導向並驗證 App ID；封面只允許指定官方 CDN 與同 App 路徑，失敗可略過。不需要使用者交出帳號憑證。

<a id="分類來源"></a>

<a id="分類來源2026-10-28"></a>

## 分類來源

**偏好語言順序（R-381）**：應用程式設定「一般」的「外部來源語言」，預設跟著介面語言，也可取消後調整五種語言的順序，只存這台電腦（`workspace-ui.json` 的 `sourceLanguages`，空值＝跟介面；設定包可匯出）。取得預覽時由 main 把順序交給轉接器：標題與簡介依序取來源有的第一個語言，來源沒有任何偏好語言就用網站預設；標籤固定一種語言；已匯入的資料不自動改變。目前跟語言的是 VNDB（作品與版本標題）、MusicBrainz（歌手與專輯的主要別名）、MangaDex（標題、別名、簡介）、Kitsu、AniList、Bangumi 標題與 TMDB（`language` 參數），DLsite（`locale` 參數）與 iTunes（`lang` 參數）只用第一個偏好語言向網站要翻譯，網站沒有翻譯時仍是原文；其他來源只有一種語言。預覽的簡介（沒有簡介就看標題）的文字系統不屬於任何偏好語言時（假名＝日文、韓文、只有漢字＝中文，簡介還可判斷拉丁字母；中文與日文互相接受漢字），預覽多一則提示「這個來源沒有○○的資料，顯示的是△△」（`LANGUAGE_NOTICE`，不進匯入欄位，也不擋匯入）。比對只看語言碼本身（`ja-ro` 是羅馬字，不算日文）。

已接入下列不需要 API 憑證的來源（需要金鑰的見 R-285 起），選單依種類分組，並標示適合目前專案分類的網站。以精確作品網址預覽，不搜尋、模糊配對、合併跨站作品或下載作品內容。來源註冊在 shared/sources.ts；固定端點與映射：E-Hentai、Steam 在 electron/metadata.ts；其他網站一站一個轉接器在 electron/sources/，每站允許的請求主機、封面主機、是否帶 Referer 與 User-Agent（`Morph/<版本> (M:orph; …)`，產品名稱不能含冒號）集中在 electron/sources/config.ts，請求主機不在名單內就不送出；共用請求流程在 electron/metadata-public.ts，回應大小限制與錯誤分類在 electron/metadata-common.ts。新增網站時加一個轉接器檔與一筆設定。

| 選單分類 | 來源 | 讀取方式與限制 |
| --- | --- | --- |
| 漫畫／動畫 | E-Hentai、ExHentai、Hitomi.la、nhentai、Bangumi、AniList、MangaDex、Kitsu、MangaUpdates | MangaDex 讀 `/manga/<UUID>`，封面另由 `cover_art` 組成 `uploads.mangadex.org` 網址；Kitsu 的 API 只接受 `Accept: application/vnd.api+json`，類型在 `included`；MangaUpdates 網址是 base36，換成數字 ID 查 API。E-H 系列沿用 [gdata](https://ehwiki.org/wiki/API)，封面縮圖在 `ehgt.org`（JPG、PNG 或 WebP）；Hitomi 僅解析公開 galleryinfo JSON，絕不執行遠端 JS；[Bangumi](https://bangumi.github.io/api/)／[AniList](https://docs.anilist.co/guide/auth/) 讀公開作品條目 |
| 同人／商店 | DLsite、BOOTH | BOOTH 讀商品頁旁的 `<商品>.json`（社團、分類、標籤、價格、成人標記），封面限 `booth.pximg.net`。DLsite：商品頁的作品 ID（RJ 等）。先讀 `/{站}/api/=/product.json?workno=` 取名稱：社團 `MAKER_NAME`、作品類型名稱、系列、ジャンル（`GENRES`）、作者依職位各成一個標籤欄位（`CREATED_BY`、`SCENARIO_BY`、`ILLUST_BY`、`VOICE_BY`、`MUSIC_BY`…，鍵名照來源）；再讀 `product/info/ajax` 補價格、下載數、評分，這個請求失敗不影響匯入。封面限 `img.dlsite.jp` |
| 遊戲 | Steam、VNDB；Getchu、批評空間、Melonbooks、虎之穴、FANZA 的遊戲網址經 VNDB | Steam 商店公開資料；[VNDB Kana](https://api.vndb.org/kana) 的公開視覺小說條目。商店網址（R-293）不讀商店頁：從網址取出作品 ID，以 VNDB 發行版本記錄的外部連結（`release` 的 `extlink` 篩選，例如 `["getchu", 36221]`、`["egs", 3193]`、`["dmm", "dlsoft.dmm.co.jp/detail/…/"]`）找出作品，以 VNDB 資料預覽；不需要年齡確認、金鑰，也不受地區限制。VNDB 沒有該連結時提示改貼 VNDB 或 DLsite 網址。只涵蓋遊戲，同人誌不在 VNDB。作品網址 `/v…` 取簡介、開發商與作品圖（`image.url`，不論 sexual／violence 分級都取，不請求分級欄位；圖片只收 `t.vndb.org`）；作品另取：標籤（只留劇透等級 0 且不是「lie」的，依評分取前 30 個）、遊玩時長（`length_minutes`）、評分（10 分制一位小數）與人數、外部連結（Steam 商店、DLsite、官方網站，只當文字存放不請求）、截圖網址（只留沒有性或暴力分級、位於 `t.vndb.org` 的前 12 張；網址存成 `SCREENSHOTS`，圖片可選匯入），另以 release 端點取各版本的遊戲引擎（取最多版本使用的一個，失敗時只少這個欄位；不與本機偵測的引擎對照）；版本網址 `/r…`（R-393）先用 release 端點取該版本自己的標題、發售日、平台、語言，再用它所屬的第一部作品補簡介、封面與開發商（屬於多部作品時預覽加「補充說明」與「取資料的作品」），作品那一步失敗時只保留版本自己的資料 |
| 音樂 | MusicBrainz、Apple Music、Deezer | [公開發行版本資料](https://musicbrainz.org/doc/MusicBrainz_API)，不因此加入音樂播放器。認 `/release/`（專輯版本：曲目、演出者、條碼，R-393 加唱片公司 `LABEL`、型號 `CATALOG_NUMBER`、片數 `DISC_COUNT`、媒體格式 `MEDIA_FORMAT`、曲數 `TRACK_COUNT`、曲目清單 `TRACK_LIST`（碟號-曲號、曲名、長度）、曲風 `GENRES` 與標籤 `TAGS`）、`/release-group/`（R-393，專輯：名稱、演出者、類型 `ALBUM_TYPE`、最早發行日、曲風與標籤）；**專輯版本**（R-449）：專輯（release-group，搜尋結果或貼上的網址）預覽時多取版本清單（`release?release-group=`，附媒體、曲數、唱片公司，最多 100 個），預選與資料夾音樂檔數曲數相符者，再依正式發行、最早、CD／數位排序；都不符時取最早的正式版並提示。選定版本後合併：名稱、演出者、類型、最早發行日 `RELEASE_DATE`、曲風與標籤取專輯，國家、條碼、曲目、唱片公司、型號、片數、媒體格式、曲數、曲目清單與本版發行日 `EDITION_DATE` 取版本；來源網址記版本，專輯網址另記 `RELEASE_GROUP_URL`（暫定）。預覽區有版本下拉（相符標記、日期、國家、格式、曲數、唱片公司與型號）與「不選版本，只用專輯資料」；換版本只重抓該版（專輯與清單在 main 保留 15 分鐘），已取消勾選的欄位維持不勾。貼上 `/release/` 時也列出它所屬專輯的版本並預選它。版本封面與專輯封面都列出，各自勾選（預設只勾版本封面；沒有版本封面時勾專輯封面），分別存成 `musicbrainz-cover` 與 `musicbrainz-album-cover`。版本 ID 經 IPC 驗成 UUID 且須在該專輯的清單內；所有 MusicBrainz 請求（名稱搜尋、預覽、換版本）在 main 排同一個隊，間隔至少 1 秒（R-461）、`/recording/`（R-395，單曲：曲名、演出者、時長 `DURATION` 以 m:ss 文字記、首次發行專輯與日期，R-393 加曲風與標籤）、`/artist/`（歌手：名稱、類型、國家、活動期間 `BEGIN_DATE`／`END_DATE`、辨識說明，R-393 加曲風與標籤；不取歌手照片）；MusicBrainz 沒有圖片，專輯與版本封面請求 Cover Art Archive 的 `front-500`（`coverartarchive.org`），它回應轉址到 `archive.org`：封面請求只在這類封面設定了轉址主機名單（`archive.org` 及其子網域、HTTPS、無埠號與帳密、最多三次）時逐次檢查後跟隨，其餘來源的任何轉址都失敗；沒有封面只在預覽標「封面無法取得」；ID 一律先驗成 UUID 再組成固定的 `ws/2` 請求；Apple Music 用 iTunes Lookup（專輯＋曲目，封面換成 600×600）；Deezer 讀公開專輯 API |
| 書籍 | Open Library、Google Books、小説家になろう、カクヨム | [公開書目與作者](https://openlibrary.org/developers/api)，作者補讀最多三筆；Google Books 讀 `volumes/<ID>`（不填金鑰時共用匿名額度，常遇到 429，金鑰見 R-285）；なろう用官方小說 API（R18 的 novel18 走 `novel18api`）；カクヨム讀作品頁內嵌的 Next.js 資料，不執行頁面程式 |
| 網頁 | 其他任何 HTTPS 網址（R-283） | 只讀頁面自己宣告的 JSON-LD、OpenGraph／Twitter、`<title>`：標題、簡介、作者、日期、關鍵字、網站名稱與封面。只接受不含帳號密碼的 HTTPS、不允許本機與內網位址（轉址也逐次檢查，最多三次）、2 MB、15 秒；依標頭或 `<meta charset>` 解碼（含 Shift_JIS、EUC-JP）；以只往前的掃描讀標籤，不執行頁面程式。封面主機無法事先列名單，一律經圖片網址匯入的安全下載（HTTPS、非內網、大小與影像格式檢查）。 |
| 圖片／插畫 | Pixiv、Wikimedia Commons、Wikidata、Danbooru | Pixiv 公開作品回應（插畫 `/artworks/<ID>` 與小說 `/novel/show.php?id=`）；Danbooru 讀 `posts/<ID>.json`，標籤依作者／原作／角色／一般分欄，分級存進年齡分級；[Commons API](https://commons.wikimedia.org/wiki/Commons:API/MediaWiki) 保留作者及授權，不推論私人照片身分；Wikidata（R-418）網址 `/wiki/Q…`，讀 `Special:EntityData/Q….json`：標籤與說明依偏好語言、圖片（P18，經 Commons API 取縮圖網址，圖片只收 `upload.wikimedia.org`）、其他網站的 ID 只當文字存放（MusicBrainz 藝人 P434、VNDB P3180、Steam P1733、AniList P8729、MyAnimeList P4086／P4087、官方網站 P856；ID 先驗證格式，不向那些網站請求） |

### Hitomi.la 與 nhentai 的欄位（R-365、R-367）

Hitomi 除了作者、標籤、語言、類型、日期、頁數，也取社團（GROUP）、原作（PARODY）、角色（CHARACTER）；網頁上標籤旁的 ♀／♂ 存成 `female:`／`male:` 前綴，並另有 FEMALE／MALE 欄位，與 E-Hentai 同名。Hitomi 的日期帶只寫小時的時區（如 `-05`），讀成日期時換成當地時間。

nhentai 讀官方 v2 API `/api/v2/galleries/<編號>`（2026-11-13 實測：單本作品不需金鑰，匿名每分鐘 20 次；舊的 `/api/gallery` 與網頁都回 403），只接受 `https://nhentai.net/g/<編號>/`。欄位名稱對齊 E-Hentai：TAGS（非一般標籤帶 `類型:` 前綴）、PARODY、CHARACTER、ARTIST、GROUP、LANGUAGE、GALLERY_CATEGORY、GALLERY_POSTED_UTC（上傳時間），另有 TITLE_ORIGINAL（日文標題）、TITLE_PRETTY（簡短標題）、SCANLATOR、PAGE_COUNT、FAVORITE_COUNT。封面只收 `t1.nhentai.net`，路徑先比對 `galleries/<數字>/cover.<副檔名>` 才組成網址。已移除的作品回「找不到這個作品」。

### itch.io（R-359）

itch.io 的官方 API 只能查自己的作品，改讀每個作品頁旁公開的 `data.json`（標題、封面、作者、標籤、價格、作品 ID），再讀作品頁的「More information」表格補上類型、平台、發售狀態、製作工具、語言，以及「Published」首次發行日（只有「Updated」時不填發行日）；頁面內嵌的 schema.org 資料補簡介與評分。表格讀不到時只用 `data.json`。不需登入或金鑰，成人作品也沒有年齡確認（2026-11-13 抽 7 個作品實測）；robots.txt 不禁止作品頁，條款沒有禁止自動存取。請求只送往 `<作者>.itch.io` 與 `api.vndb.org`，封面只收 `img.itch.zone`。作者帳號改名後舊網址會由 itch.io 轉到新子網域：只有讀 `data.json` 這一個請求跟著轉址，最多 3 次、只轉到其他 `<作者>.itch.io` 的 `<作品>/data.json`，之後的作品頁、VNDB 查詢與來源網址都用新網址（R-523）；轉到其他網站時報錯，轉到不是作品的位址時說找不到作品。

同一作品若在 VNDB 有 itch.io 連結（`itch:作者/作品`），預覽上方提示「VNDB 也有這部作品」，按「改看 VNDB 的資料」另開 VNDB 預覽；兩邊各自套用、各存在自己的來源命名空間，不自動合併。VNDB 查不到或失敗時不提示。

限制：除了上面的 `data.json` 與設定了 `coverRedirectHosts` 的封面請求，來源請求一律不跟隨轉址；封面只收 JPG／PNG／WebP，itch.io 常見的 GIF 封面顯示「封面無法取得」。作品頁由任何 itch.io 使用者撰寫，表格與內嵌資料用有上限的方式讀取（最多 60 列、5 段）；正式網址只採用同一作者子網域的連結。

### 需要使用者金鑰的來源（R-285～R-290、R-321）

只保留沒有免金鑰替代的網站（R-321）：動畫與漫畫用 AniList、Bangumi，電影與影集只有 TMDB，音樂用 MusicBrainz，遊戲用 Steam、VNDB、DLsite。MyAnimeList、OMDb、Trakt、TheTVDB、Last.fm、Discogs、AniDB、IGDB、RAWG、Giant Bomb、Comic Vine 已移除：這些網址改當一般網頁讀取，已匯入的欄位留在記錄裡，已存的金鑰在設定頁不再顯示，下次保存金鑰檔時清掉。來源一律走 HTTPS，不再有純 HTTP 的例外。

應用程式設定「網站金鑰」分頁每站一列：名稱、用途、必要／選填、狀態（未設定、已設定、可用、無法驗證）、遮罩輸入（可顯示）、「保存並測試」「測試」「清除」與「怎麼申請」（申請步驟）。金鑰用 Electron safeStorage（Windows 為 DPAPI）加密後存在本機 `site-keys.json`，只有 main 解密；畫面只拿到狀態，不會收到金鑰本身，也不進可攜記錄、設定包或備份。測試用每站一個範例頁：網站接受金鑰就算可用（即使範例作品不存在），被拒（401／403 或網站回報金鑰錯誤）才算無法驗證。貼了需要金鑰的網址而尚未設定時，「從網站補充資訊」就地提示並停用「取得預覽」，按「前往設定」直接開到該列；選填金鑰的網站則提示可加上金鑰的好處。

| 網站 | 金鑰 | 帶法與特殊處理 |
| --- | --- | --- |
| TMDB | API Key 或 Read Access Token | Read Access Token（JWT 格式）放 `Authorization: Bearer`，Key 放查詢參數；海報 `image.tmdb.org/t/p/w500`；影集另取季數（`SEASON_COUNT`）與各集清單（`EPISODES`，「S01E02 集名」，每季一個 `tv/{id}/season/{n}` 請求，最多 30 季、500 集，特別篇第 0 季不取，某季失敗就略過）（R-419）；預覽標示「本產品使用 TMDB API，但未經 TMDB 認可或認證」 |
| SteamGridDB | API Key | Bearer；取名稱與第一張 600×900 封面；不再取橫幅、標誌、圖示（R-511；舊記錄裡的 `HERO_URL`、`LOGO_URL`、`ICON_URL` 照常顯示） |
| Bangumi | 個人權杖（選填） | Bearer；沒填時 404 改提示「找不到作品，或是需要權杖的成人作品」並可前往設定 |
| Danbooru | 帳號＋API Key（選填） | 查詢參數 `login`、`api_key`，提高額度 |
| Google Books | API Key（選填） | 不填時共用匿名額度，常回 429 |
| FANZA／DMM | API ID＋Affiliate ID（選填） | 沒填時遊戲網址改經 VNDB 查（R-293）；網址裡的 `cid`；`dmm.co.jp` 走 FANZA、`dmm.com` 走 DMM.com；預覽標示「Powered by FANZA Webサービス」 |

金鑰類來源在使用者填入金鑰前只用固定回應測試（`tests/keys.test.ts`），尚未實站驗證。

## 來源圖片清單（R-422）

VNDB、Steam 的截圖（`SCREENSHOTS`，各最多 12 張）可選匯入為資料夾的圖片；封面匯入照舊。

- **下載**：取得預覽時 main 依序下載（`electron/source-images.ts`），只取預覽本身已檢查過的網址：HTTPS、無埠號與帳密，主機須在該來源的圖片主機（`sources/config.ts` 的 `coverHosts`；Steam 用 `metadata.ts` 的 Steam 圖片主機）；不跟轉址（只有該來源設定 `coverRedirectHosts` 的封面路徑除外）、15 秒逾時、單張 ≤ 10 MiB、以 `imageType` 檢查是 JPEG／PNG／WebP；失敗或被拒的略過。整個預覽最多 30 MiB（再放不下一張 10 MiB 就停）。其他來源不下載。
- **預覽**：視窗收到 `preview.images`（角色、截圖序號 `n`、data URI），縮圖清單預設都不勾，標示「截圖 n」「橫幅」「標誌」「圖示」。視窗不能指定任何網址，下載的圖片只存在 main 的預覽（以 token 對應，最近三個預覽保留圖片，15 分鐘到期即丟棄；匯入後釋放）。
- **匯入**：`metadataApply` 的 `images` 只帶預覽圖片的位置（整數、不重複、須在範圍內，否則整個請求拒絕、不寫任何檔案）。選中的圖片和封面一樣存進可攜記錄的 `assets/`，`originalName` 為 `<來源>-<角色>[-<n>].<副檔名>`，並帶 `role`（`screenshot`、`hero`、`logo`、`icon`，暫定，見 [DATA_FORMAT](DATA_FORMAT.md)）；已有同名圖片就不重複加入；寫入失敗時清掉本次寫的檔案。橫幅、標誌、圖示可由圖片組件選用（R-435，見 [CELL 目錄](CELL_CATALOG.md#新增組件與型別)）。

## 預覽、套用與追溯

- main 驗證精確主機及作品 ID，請求固定 API 端點，限制回應大小、逾時與重新導向；封面限白名單 HTTPS 主機及支援的影像簽名，取得失敗仍可預覽欄位。
- 任意主機的請求（通用網頁、圖片網址）在建立連線時才解析 DNS 並檢查位址，socket 直接連到檢查通過的位址，不再解析第二次，避免 DNS rebinding 把請求轉到本機或內網（R-334，`electron/pinned-fetch.ts`）。只用 GET、不跟隨重新導向（由呼叫端逐跳重新檢查）。
- **資料分頁的欄位**（R-339）：上方是「你的欄位」（自建欄位，可直接編輯）；這個專案還沒填的欄位收成一排「＋ 補填」小按鈕，按了才出現輸入框（不再有「顯示未填欄位」勾選）。下方每個網站一組「來自 VNDB」等，值唯讀並以匯入預覽的中文欄位名顯示；單一欄位按「改成手動」才變成可編輯，保存後標成手動、之後重新匯入不覆蓋。每組有「重新取得」（把該站網址帶回上方的網址欄）與「移除這個來源的資料」：確認後只移除該站在共用資料裡、沒被手動改過的值（`removeSource`，以記錄版本防衝突），手動改過的與其他網站、各專案私有值都保留。
- 預覽顯示候選值與已存在的來源值；預設只填空值，0／false 視為有值。明確勾選「覆寫已填來源欄位」才取代既有來源值，人工欄位分開保留。曾手動修改的來源欄位不會被來源再次覆寫：只填空值時跳過該欄位、其他欄位照填；勾選覆寫時整批拒絕並說明衝突。
- 屬性仍以來源前綴分開保存，可選 sourceRecord 記錄 provider、原網址與 fetchedAt；手動編輯會移除此擷取註記。schemaVersion 維持 1，不自動遷移收藏，也不把同名欄位視為相同身分。
- 日期存成日期：E-Hentai 的圖庫公開時間存成「日期時間」（換算成本機時間），各來源的發售日（Steam 的 `12 Nov, 2020`、`2020/11/12`、`2020年11月12日`、英文月份等）存成來源寫的那一天 `YYYY-MM-DD`。只有年份、年月或「TBA」等讀不成完整日期的值照原樣存文字，不補日子。專案裡該欄位已是「文字」時，新匯入照文字存。日期仍是來源寫的語意，不改稱首次發行日。封面寫入沿用可攜資產及原子保存；保存失敗移除本次新增的封面，保留原值及原資產。預設重複補空不重複加入同來源封面。
- 受控驗證入口：tests/metadata.test.ts、tests/decided-media.test.ts。涵蓋固定回應、無憑證、錯誤／過大／惡意主機、作品 ID、遠端 JS 不執行、預覽不寫入、填空／覆寫／人工保護與封面回滾。登入資料與實際收藏未執行驗證，不能由固定回應測試宣稱全部實站可用；實站是否還能用，由 `pnpm check:sources`（`scripts/check-sources.ts`）對每個來源請求一個已知作品，列出成功或上面的錯誤類型，只在手動或發布前執行。

## 不變限制與目標

- 外部資料提供候選，不替使用者決定作品身分；不以資料夾名稱直接認定作品。不自動批次模糊匹配或下載收藏。
- 來源 URL／ID 與語意應可追溯；來源資料隨資料夾攜帶。敏感憑證不進專案或可攜記錄，不把共用 secret 內建桌面應用。
- 再次匯入預設填空、預覽目前值並明確覆寫來源欄位，保護手填值；完整跨來源欄位映射、原始回應封存及批次匯入不在範圍內。
- 只有來源及使用方式明確可用時保存圖片；不能假設所有網站提供同樣 API、欄位或授權。來源 adapter 彼此隔離，不為加一站重寫整個資料模型。

查證過但不接入的來源與理由見 [查證過、未接入的外部來源](METADATA_DECLINED.md)。
