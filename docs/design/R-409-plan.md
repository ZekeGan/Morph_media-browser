# R-409 分階段計畫（右側版面元件化）

2026-11-17 規劃（只讀程式整理，未動工）。需求本文見 [需求清單](../WORK_ITEMS.md) R-409；版面規則見 [LAYOUT_RULES](../LAYOUT_RULES.md)。每階段各自提交、各自測試；資料格式只在第 2 階段升一次。

## 現況（和需求文字的差異）

- R-413 已有 `layoutRules.{card,panel}`、`chooseLayout`、`editLayoutRules`、`legacyLayoutRules`、`dropLayout`；版面配置視窗只做卡片。`layoutRules.panel` 目前只存書籍模板。
- 右側模板仍是 `bookPresets`／`bookPresetId`／`folderBookPresets`／`contentCells[kind]`／`contentCover`，尚未推廣到各類型。
- R-407 書架、R-429 書架位置已完成；要刪的「骨架書架特例」是 `folderPages.*.lead`、`lead` 屬性與 FolderContent 的 `<BookShelf>` 填入。
- 專案 `schemaVersion` 仍是 1，`UPGRADE_STEPS.project` 是空的。
- `gameExtras` IPC 已能回報單一資料夾的 Steam／商店／存檔可用性，但一次只問一筆。
- R-422 已把來源圖片存成帶 `role`（hero／logo／icon）的資產，尚未使用。

## 階段

1. **資料夾封面規則與圖片元件**：圖片元件「沒有手動選圖時」加「資料夾封面」（指定封面，沒有就第一張圖），新加的圖片元件預設用它；封面解析集中一處（例如 `src/cells/folderCover.ts`），遊戲封面、漫畫封面同規則；編輯器預覽用預覽資料夾的實際封面。新欄位暫定、不升版。測試：`cell-editor-ui`、`image-nth-ui`、`game-cover-cell-ui`、`card-grid-ui` 加解析的單元測試。
2. **右側版面資料模型與唯一一次升版**：新增 `panelPresets`／`panelPresetId`，各類型有預設右側版面（書籍＝書籍模板、音樂＝專輯資訊、影片＝影片數、遊戲＝封面、一般＝名稱）；選擇存在 `layoutRules.panel`；移除 `bookPresets`、`bookPresetId`、`folderBookPresets`、`contentCells`、`contentCover`、`kindLayouts`、`folderLayouts`。`shared/upgrade.ts` 加專案 1→2 的升級步驟（含舊欄位換算），附 v1 樣本 `tests/fixtures/project-v1.json`；資料遷移需獨立審查。測試：`layout-rules`、`upgrade`、專案匯出；UI：`layout-config-ui`、`panel-preview-ui`、`appearance-ui`、`decided-ui`。
3. **版面配置視窗「卡片／右側」切換、外觀頁改為唯讀**：視窗加切換，右側用同一組規則與預覽；資料夾設定外觀頁只顯示目前卡片與右側版面及其來源，按鈕開啟版面配置視窗；「另做一份給這個資料夾」移進視窗。測試：`layout-config-ui`、`appearance-ui`、`panel-preview-ui`，截圖暗色寬窗與寬 900。
4. **寫死的主視覺改成元件，刪除舊分支**：新元件（暫定）：專輯資訊、影片數、EPUB 書卡；專輯封面用圖片元件的「資料夾封面」。刪除 `legacyCover`、書籍專用分支、R-362 舊模板相容、`lead`。內建操作列（播放、閱讀、遊戲操作）保留。測試：`panel-preview-ui`、`media-workspace-ui`、`book-volumes-ui`、`audio-playback-ui`、`video-player-ui`、`cell-editor-ui`。
5. **遊戲元件與可用性**：遊玩時間、最後遊玩、開啟資料夾放進元件區遊戲分類；「啟動遊戲」可選任一遊戲操作；新增「遊戲附加按鈕」（開啟存檔資料夾／用 Steam 啟動／在商店開啟）與系統資訊「引擎」。可用性只查畫面上看得到的卡片，批次詢問、結果記在記憶體（重新整理或重新掃描時清掉），結果出來前淡色不可按，不可用時灰色並說明原因。`gameExtras` 改為一次問多筆。安全邊界（IPC）需獨立審查；遊戲 ROOT 內部受保護，不得因此觸發掃描或初始化。
6. **R-385 與收尾**：移除「自訂工具列」對話框，新增操作的入口移到編輯器；既有按鈕保留可讀。R-422 的 hero／logo／icon 用在遊戲主視覺另登需求。

## 已決定（使用者 2026-11-17）

- **升版**：第 2 階段把專案格式升到 2 並移除舊欄位。
- **「另做一份給這個資料夾」**：放在版面配置視窗的資料夾列選單。
- **「用 Steam 啟動」**：做成獨立的遊戲附加按鈕。
- **轉換出的右側版面名稱**：「<類型> 預設」（顯示時翻成五種語系）。

## 進度

- 第 1 階段：完成（31e4e5f）。
- 第 2 階段：右側版面 `panelPresets`／`panelPresetId`、`layoutRules.panel` 依頁面類型選版面（`choosePanel`）、專案格式 1→2。音樂、影片、遊戲、一般的「內建右側」在第 4 階段改成元件版面前，維持原本的寫死主視覺。
- 第 3 階段：版面配置視窗加「卡片／右側」切換；外觀頁改為唯讀並開啟視窗；「另做一份給這個資料夾」移到視窗的資料夾列選單。
- 第 4 階段：主視覺改成右側版面元件（`album-info`、`video-info`、`book-card`，`src/cells/PanelParts.tsx`），頁面以 `PanelCard` 畫右側版面；刪掉骨架的 `lead`（書架改在內容清單開頭）與 R-362 的旁邊封面。專輯封面沿用專輯資訊元件裡的封面（內嵌封面規則不是資料夾封面規則能表達的）；含音訊的影片／一般資料夾，內建右側加一個只畫封面的專輯資訊元件。
- 第 5 階段：遊戲分類元件（遊玩時間、最後遊玩、遊戲引擎、開啟資料夾）、遊戲附加按鈕 `game-extra` 與批次可用性 `gameAvailability`、「啟動遊戲」可選任一遊戲操作；遊戲頁選了右側版面時改畫版面。原計畫的 `gameExtras` 改為一次問多筆，實作成新的輕量請求 `gameAvailability`（原請求另帶附帶程式建議與 Locale Emulator 設定，遊戲頁仍用它）。
