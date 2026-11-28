# Changelog

The application version is independent of portable record `schemaVersion`.

## Version guide

| Versions | Theme |
| --- | --- |
| 0.41 (0.41.0-beta.1 – 0.41.2-beta.1) | First Beta: name search across online sources with per-kind choices and keys, music / video / manga folder types (manga by page-number names), one layout window with Details layouts, novel reader, webtoon, CBR / CB7, embedded and picture subtitles, sort menu and file list toolbar, thumbnails twice as fast (sharp) |
| 0.40 | Media queue previews and covers, one play-order button; reader icon toolbar, immersive edge panels (tools, progress with previews, queue), sliding page turns, swipe to turn, resume reading, next book; src grouped by feature |
| 0.39 | Folder settings redesign (import inside Data, sticky save bar, image thumbnails and delete, "still to add" card, test launch), one top-bar refresh button, smaller package, translation fixes |
| 0.38 | First packaged Windows build (installer and portable) |
| 0.36 – 0.37 | M:orph identity, mark and icon; GPL-3.0 licence and name policy; five-language README; code split into modules; release tidy-up |
| 0.35 | Component styles: weight, italic, borders, corners, presets, tag and choice colours |
| 0.32 – 0.34 | Faster folder listing, tag "+N", per-game button hiding, search through fallback fields, help tooltips, paste-only source import |
| 0.26 – 0.31 | Remembered browse settings, fallback fields and actions, E-Hentai / ExHentai tag namespaces, scrollable cells, n-th image cell |
| 0.22 – 0.25 | Blurred cover fit, launch-game cell, single-click preview, shortcut (Locale Emulator) actions |
| 0.20 – 0.21 | Japanese visual-novel engine detection, video failure help, UI audit fixes |

## Unreleased

- Unified image/manga reader immersive interaction: non-immersive toolbar now stays stably visible on center click; immersive mode removes left/bottom/right edge-hover triggers and toggles HUD strictly on center click (manga shows left rail + bottom progress bar + right queue when embedded; image viewer shows left rail + right queue without a bottom progress bar) (R-558).
- Refined the image/manga reader toolbar: pulled the media queue toggle back up to the top bar with matching `lg` size and active state, removed the folder-name text from Reading Settings, turned Reading Settings into a labeled vertical menu (auto-hidden when empty, e.g. image viewer / webtoon), and replaced the page-jump dropdown with a plain counter in image viewer mode (R-557).
- Focused the Layout Editor and decluttered "Your fields": automatically collapse the project sidebar while editing (restoring on exit), streamline the top bar into 4 groups with a unified layout dropdown containing 3 starter card templates ("Large cover minimal", "Full details", "Compact list"), move "Your fields" to the bottom of the palette with an eye-to-pill filter (`有值 ×`), `＋` and `⋯` menu, omit single-source fold headers, and reveal per-row `⋯` on hover/focus (R-550, R-546).
- Redesigned the detail-panel media toolbar and Folder Details path row: 80/20 left/right split with type filter pills and an active "With subfolders ×" dismiss pill on the left, sort + view toggle + a View Options popover (housing Include subfolders and Group by source) on the right, balanced responsive 2-row fallback under 520px, and a click-to-copy path bar with compact two-column spacing in Folder Details (R-556).
- Redesigned Game Actions UI: compact single-row action list integrating auto-detected Steam/store/save toggles and quick-add suggestions, collapsible unbound project actions (keeping an unbound primary launch action pinned), inline Steam-style single-line launch arguments with independent save and target clear (`targetArgs`/`unbindTarget`), and primary/secondary button hierarchy with in-place launch prompt and separate playtime line on the Game page (R-555).
- Streamlined six independent UX surfaces: command-palette global search with ↑↓/single-click open and `?` syntax help (R-551), four-tab Application Settings with concise key/backup notes (R-552), 5-group Reader top toolbar with a Reading Settings popover (R-553), mini player default clearance above status/pagination bars and Esc-closes-queue-drawer first (R-554), empty home 3-step workflow without an empty Unclassified box (R-542), and neutral shield game-protection icons with separate pending/problem status bar indicators (R-543).
- Merged the right detail panel header into a single row with inline "Content | Settings" pill and a `⋯` menu for lower-frequency actions (R-548), compressed folder settings with a click-to-copy path and on-demand "Import from website…" bar (R-549), added lightweight inline "Applied" feedback for instant type/layout/cover actions (R-540), collapsed "Still to add" into a compact expandable bar with one-click missing-item shortcuts on the game detail page (R-541), and enabled adding project-shared game actions directly inside the Game Actions tab (R-539).
- Consolidated the browse toolbar into a single row at the project root (expanding a slim breadcrumb strip in subfolders or narrow panes) with a unified View Options popover (R-547), merged the folder/file and step/all-works switches into one view switcher (R-536), turned the toolbar layout button into a split button that edits the current layout directly or opens presets/configuration (R-544), and collapsed empty "by level" rules with a concise single-layout hint in Layout Configuration (R-545).
- Projects now start with full-width browsing and slide the detail panel out on single-click while remembering explicit close preferences (R-533); double-clicking leaf/game work folders expands full-width details instead of entering an empty list (R-534); right-clicking cards, table rows, or tree nodes opens a minimal folder context menu (R-535); Esc, mouse Back, and the expanded panel Back button step back layer by layer while preserving list scroll and selection (R-537).
- Categorized `docs/` into `specs/`, `architecture/`, `guides/`, and `design/`, added `docs/specs/UX_PRINCIPLES.md` (UI-agnostic UX & interaction principles), updated `scripts/stale.mjs`, `scripts/areas.mjs`, `docs/areas.json`, and all relative Markdown links (R-532).
- Confirmed `tests/media-facts.test.ts` exit code 5 under `pnpm test` was caused by Kaspersky behavioral termination (20/20 consecutive full runs passed with antivirus disabled), and stopped `media-facts.test.ts` from spawning the PowerShell hidden-file helper when no real hidden files are tested (R-473).
- Stabilized `video-embedded-ui` (await `subtitleTrack` after loading track in `VideoViewer`, pause 3s test sample inside cue window) and `explorer.test.ts` thumbnail cancellation test (fill all worker slots deterministically); added `NaN` validation and `stale.mjs` `.git-blame-ignore-revs` unit tests (R-530).
- Registered all 15 previously unlisted unit/UI tests in `docs/areas.json` and added a reverse check in `scripts/areas.mjs check` so new test files cannot go unmapped (R-529).
- `electron/explorer.ts` request routing extracted into `electron/explorer-dispatch.ts` and top-level cache `Map` types extracted into named interfaces (R-528).
- Core backend/shared entry readability pass: flattened `electron/main.ts` bootstrap into focused helpers, unified `isValid*` early-return validators in `shared/modelValidation.ts`, and extracted named plan interfaces in `electron/library.ts` (R-526).
- `src/App.tsx` internal state and handlers renamed for clarity (`projectSettingsDraft` vs `isAppSettingsOpen`, `requestLibrary` / `requestExplorer`) and layout-editor states consolidated into a single `editorSession` object (R-527).
- Minimal ESLint readability rules (single declarations, multi-line braces, deduplicated grouped imports, block spacing) added with a pure formatting pass recorded in .git-blame-ignore-revs, wired into pre-commit and CI (R-525).
- Coding readability, naming, and module structure conventions documented in docs/IMPLEMENTATION.md and referenced in CLAUDE.md (R-524).

## 0.41.2-beta.1 — 2026-11-26

Fix release; includes the Kaspersky start-up fix of 0.41.1-beta.1, which was not published.

- itch.io: the old address of a game whose author renamed their account now opens the game at its new address, instead of saying the site cannot be reached; only redirects to another itch.io author are followed (R-523). Two interface tests no longer fail now and then: the podcast step stops playback first, and the reader steps wait for the saved page (R-521, R-522).

## 0.41.1-beta.1 — 2026-11-26

Fix release for 0.41.0-beta.1, which does not start on a computer with Kaspersky: the installed or portable app shows "啟動失敗 ERR_FAILED (-2) loading 'app://ui/index.html'". Kaspersky puts its own DLL into the unsigned Morph.exe, and Chromium's sandboxed page process stops at once (0.39.0 and 0.40.0 do the same on such a computer). Not published: no tag or GitHub Release yet.

- Beta versions run without Chromium's process sandbox so they start next to such security software; context isolation, no Node in the page and the main process checks stay as they are. The sandbox comes back on its own from 1.0.0, when the releases are to be signed (C-149, R-SIGN).

## 0.41.0-beta.1 — 2026-11-25

**Do not use:** does not start on computers with Kaspersky; use 0.41.2-beta.1.

First Beta. From this version on, a change to the data format comes with an automatic upgrade, and data saved by this version is kept as a sample every later version must open unchanged (see docs/RELEASING.md). Not published yet: no tag or GitHub Release until it is confirmed ready for others.

Source check at release (pnpm check:sources): Open Library could not be reached from here and Google Books refused with "too many requests"; both adapters are unchanged and may work again later. TMDB, SteamGridDB and FANZA need your own key and were not checked.

sharp is 0.35.5 (libvips 8.18.7), which fixes advisories in its bundled libvips, libheif and librsvg found by pnpm audit at release.

- Picture thumbnails are made with sharp (libvips) in the background instead of in the app window: a big folder opened for the first time shows its pictures about twice as fast; BMP and ICO still use the old way. The installed app is about 20 MB larger (R-518).

- Pictures of a folder opened cold appear from the top down, small files first, instead of from the bottom up; scrolling still makes what is on screen first (R-519).

- Manga reader: the page list lists every page instead of the first 20, single or two-page, and opens at the current page (R-520).

- Manga: any thumbnail, the first page included, opens that page and offers the saved page for 8 seconds; only "Continue reading" goes to the saved page, and "Continue from page N / Start over" is gone. Leaving with the last page on screen always records the book as read (R-517). Interface text in plain words: about 180 sentences lose code words such as boundary, bind, draft, type, candidate and ROOT, including the game detection notes (older records show the new wording) (R-516). A commit check now refuses new interface text with those words, `pnpm i18n diff` lists a batch's new sentences for review, and UI_RULES has five checks for writing them (R-515).

- The right panel is now called "Details" everywhere (details layout, built-in details, Details layouts…) (R-513); the "?" help is rewritten in plain words, one short line each, and seven that only repeated their label are gone (R-514); folder settings › Images shows the cover first, as the folder really shows it and where it comes from, then the layouts' other pictures named "Card picture N" / "Details picture N" with the picture they get when none is chosen (R-509, provisional).

- Folder settings are less confusing for games and tools: a confirmed game or tool no longer shows the "game detected" note or asks to be confirmed again, and a detected tool says "tool" (R-508); "Look inside read-only" is gone, so the inside of a game or tool is never listed, and an older project drops that setting when saved (R-510); image components lose the imported banner / logo / icon choices (older ones show the folder cover) and SteamGridDB no longer fetches them (R-511); the "Appearance" tab is now "Type & layout" (R-512).

- Sorting a large folder's files by size or date: opening another folder stops reading the old one's sizes and dates, and coming back within a minute sorts at once without reading them again (R-504). Internal: the slowest UI test runs in about half the time (it no longer flushes its 1,500 setup records to disk one by one), and a sidebar drag check no longer loses its key press on a slow disk (R-507).

- Reading no longer rewrites a folder's record when nothing changed: closing the reader on the page it opened at (or setting a value it already had) leaves folder.json and its revision as they were (R-474). While the window sits idle, the pictures of the folders on screen get their thumbnails made in the background, so opening one shows its pictures at once; any click, wheel or key pauses it, and it stops when the thumbnail cache is well filled (R-505).

- Internal: parts of the window's state moved out of its two largest components into their own hooks (width drag, folder marks and gestures, the new project dialog, taking in snapshots, unsaved drafts); nothing changes on screen (R-243).

- Faster everyday browsing: selecting a folder, scrolling, switching the panel tab or hovering no longer draws every card on the page again (selecting one used to draw each card four times); the app starts with about 14% less code to load (the layout editor and the document viewer load when first used, and only the interface language in use is prepared); the thumbnail cache keeps up to 20,000 thumbnails or 1 GiB, dropping the least recently used first (it held 3,000 and was always full) (R-501, R-502, R-503).

- Dragging the width of the right panel, the project sidebar or a table column no longer stutters: the width follows the pointer directly and the page renders again only when you let go (R-500).

- Sharper pictures: card thumbnails are made at 640 px on the longer side (was 320) with high-quality scaling done once, and existing thumbnails are made again; picture components in the right panel show the original file (R-498, R-499). The layout dialog lists the folders under one parent by name, and in a narrow window its Cancel and Save stay on screen (R-496, R-497). "Back to top" in the right panel always gets there: a smooth scroll the browser drops without starting is followed by a jump to the top.

- A large folder opened for the first time no longer re-sorts its file list while it loads: the files come in the order the list shows (name, type, size or date), and the right side knows whether the folder is a manga or a general folder from its first moment, judged from all its files the way the scan does (R-492, R-494). Pictures named by date (2024-01-02) or by Nikon／Fujifilm／Sony cameras (DSCN0001, DSCF0001, DSC00001) no longer count as manga pages (R-493). In the tree view, cards are replaced by their compact label only when zoomed out much further (below 0.1 instead of 0.45).

- Coming back to a folder listed before no longer makes its file list jump: the complete list stays while the folder is read again and is replaced once when the new list is complete (it used to drop to the first 96 files and grow back, re-sorting each time).
- Review fixes: a folder of pictures read in the manga reader stays a manga whatever its file names (the reader's saved direction counts, not only the old reading mode) (R-479); the page-number check no longer slows large folders and the right panel counts a folder's files once per listing (R-479); the source language grip keeps keyboard focus while a move is saved (R-476); with subfolders left out nothing stays grouped by source behind the unavailable toggle (R-488).
- The picture viewer and the play queue opened from the file list follow the list's sort order: sorted from large to small, the next picture is the one shown below, not the one above (R-486).
- File list toolbar: "include subfolders" is a switch, file types are chips with counts (a dropdown in a very narrow list), a sort button (name, type, size or date, ascending or descending), three icon buttons for the layout and a group-by-source toggle; the "⋯" menu is gone (R-486, R-488).
- The file list no longer has "show hidden files" and "show dot files": files with the system Hidden attribute are never listed, names starting with a dot always are; a preference an older version saved is kept and ignored (R-485).
- Layout window: the four sources (type, level, default, own) have their own colours in each theme (blue, amber, grey, magenta), a 5px bar on each folder row and solid labels that the legend repeats; rules that follow the default are a little dimmer, set ones have their source colour on the left (R-489, R-490).
- The hints hidden by hand (card display settings, folders without picture components, source choice memory, the layout window's "如…" example and renamed headings) are removed for good with their texts (R-491).
- The tree toolbar has the layout button too (R-481). The "show type icons" switch is gone: card badges always show the folder type (R-482). The layout window has a breadcrumb above the folder list that moves where the list starts up to any folder above, without closing the window (R-483). The folder setting "In All works" is removed; works are always worked out automatically, and values older versions saved are kept untouched and no longer read (R-484).
- Dragging a row in the sort menu or the source language list shows a line where it will land (none where dropping changes nothing); both lists share one drag helper (R-480).
- Folder type: a folder of pictures is a manga only when the file names are page numbers (1, 001, p12, id_p0 … with zero padding, covers and credits ignored, mostly without gaps, at least 80% of the pictures); other picture folders are general. Folders set by hand, with comic archives, read in manga mode or filled in from a manga site stay manga (R-479).
- Search: the same folder (same path) in several projects is one result, with every project listed beside it; it opens in the current project when that is one of them (R-477).
- Settings tidy-up: theme descriptions and the hidden hint texts are removed for good; the remaining setting explanations sit in a "?" tooltip beside their title; the external source language order is reordered by dragging the grip or Alt+↑/↓ (R-475, R-476, R-478).
- Built-in right panels are laid out by the shape of the cover: music a square cover with the album name, artist · year and tracks · length beside it; books and videos a tall cover with the name and their own small components (a book its card fields; 繼續閱讀 stays in the book page's own actions); games a wide cover with the name below (the game page no longer draws a fixed banner, and the candidate note sits with the confirm buttons). The album facts, video facts and book card components are gone: saved layouts get the small components in their place when read (project format v4; older versions of M:orph open v4 projects read-only) (R-469).
- Tree: a toolbar switch draws each node as the folder's card, sized by the card layout it uses; zoomed far out the nodes go back to the compact label (R-466).
- Tests: temporary folders are removed with retries (Windows sometimes still holds a file), a check waits for the cards it counts, and "Back to top" in the right panel reaches the top even when pictures finish loading while it scrolls (R-462).
- Sorting: a sort button in the toolbar, shared by cards and the table, with up to five keys (add, remove, turn around, drag or Alt+↑/↓ to reorder), ties ordered by name; rating, release date and name are listed first. "Folders first" (on by default) puts folders that only group others before the works. In the table a header click sorts by that column alone and Shift+click adds it as a key (1↓, 2↑). Kept per project on this computer (R-467).
- The card toolbar has one layout button; every layout entry uses the same layout icon (R-470). The right panel no longer has a separate button to close folder settings; the Content tab does that (R-471).
- Game projects no longer have the "All folders / Game boundaries" switch in the toolbar; every folder is listed (R-465).
- A program's source code inside a project (a git repository, or a project file such as pyproject.toml, Cargo.toml, settings.gradle, .sln, or package.json with node_modules) is a tool candidate, so the scan no longer writes records all through it; the project's own root and the folders above it are not checked for this (R-463). Folder settings can clear the records of a folder and every folder below it at once, with the same preview and confirmation; another project's root inside is kept (R-464).
- Source sites: a site refusing too many requests (429 or 503) is asked once more after the wait it gives, and otherwise says it is busy; a reply that does not come in time says the site was too slow, instead of both reading as "cannot connect". All MusicBrainz requests, name search included, share one queue of one request a second (R-461).
- Tools among the games: a folder whose only signs are a program's runtime files (an Inno Setup uninstaller pair, Qt, CEF, .NET, PyInstaller; also inside bin/) is a tool candidate and is not scanned into. Confirm it as a tool, a game or neither; any folder can also be set as a tool in its folder settings. A tool is protected like a game ROOT but is not shown as a game (provisional, R-457). The evidence of a game or tool check is now shown in the interface language.
- Layout editor: opened for a folder (picked in the layout window, or Add field in its folder settings), it opens the layout that folder actually uses with that folder in the preview; a right panel opened without a folder previews the first folder of its kind. Closing the editor goes back to where the browser was, with the same folder selected, instead of going into it (R-459, R-460).
- UI tests no longer close a running `pnpm dev` window (which ended it with ELIFECYCLE 4294967295); the runner now stops only Electron windows left over from earlier test runs (R-456).
- Layout editor palette: a click only marks a component or field row (a component row then shows what it does); a double click, Enter or Space adds it at the bottom and dragging places it; field rows keep Ctrl+click for picking and gain "Add to layout" in their ⋯ menu (R-454). Preset rows such as Album name, Artist or Play time can now be dragged onto the canvas; before, only a click added them (R-453).
- Card album facts come faster: names, artists and years no longer wait for other folders' total lengths, which have their own queue with the folders asked about last first; hidden files are not counted, a damaged index is rebuilt and the index is closed on quit; a folder's embedded track cover is shown as a small cached thumbnail (R-455).
- Album, video and book facts as small components (provisional): album name, artist, year (not for podcasts), track count (episodes for podcasts), total length, video count, a book's title and author, a comic's pages and place, plus buttons Play video / Continue watching and Continue reading, in the Album, Video and Book groups of the right-panel editor. On cards they fill in as the card comes into view, from a local index (media-facts.sqlite, rebuilt when the folder changes, nothing written to the folder); the total length follows in the background and shows a dash until then (R-438).
- Right panel layout unified: every kind shares one cover rule (chosen cover, record picture, first track's embedded cover, the one cover/folder/front/artist image, first image), also used by cards; the cover is changed only in the folder settings' Pictures page (the game page's change-cover menu is gone). The game cover, album info and video info components are replaced by the folder-cover image component plus the new album facts and video facts components (provisional); project format v3 converts old layouts on reading, a v2 project is read-only for older versions (R-437).
- MusicBrainz albums: the preview lists the album's versions and picks the one whose track count matches the folder's music files (then official, earliest, CD or digital; the earliest official one with a note when none matches). The album's name, artists, type, first release date and genres are merged with the version's track list, label, catalogue number, barcode, discs, format and its own release date (new "Release date of this version" and "Album address" fields, provisional); a menu switches versions (fetching only that version and keeping what was ticked) or uses album data only, and the version's and album's covers can each be kept. A pasted /release/ address shows its album's versions too (R-449).
- Image components can show the banner, logo or icon imported from a website ("When no picture is chosen": Imported banner / logo / icon); a missing banner falls back to the folder cover, a missing logo or icon leaves it empty (R-435).
- Faster thumbnails: a gallery or file list opened for the first time makes 2 to 4 thumbnails at once (half the processors) instead of one by one, the newest request first (while scrolling, what is on screen), and skips ones scrolled away (R-441).
- Fix: reading on through a novel in scroll mode no longer freezes for about half a second at each chapter (the reading place was saved at every chapter crossed and redrew the whole window); the place is saved once scrolling stops, and reading places of novels, manga and volumes are saved in the background (R-448).
- Right-panel editor: the main visuals sit in a section per kind (Album, Video, Book) like the Game section; editing a kind's right panel offers only its own section (and any other whose components are already on it) (R-452).
- Fixes: a podcast's "Continue where I left off" starts the episode where it was left instead of at 0:00 (its place was overwritten with 0:00 while it loaded, R-451); in the video player a timeline or picture clicked with the mouse no longer shows a focus ring once a key is pressed, and the controls fade as usual; Tab still shows the focus (R-447).
- Name search: the sources to search are chosen in a button left of Search (the first source and "+N", the full list on hover), grouped as general, needs a key and adult, with "Reset to this kind’s defaults"; the multi-select below the search box is gone (R-443).
- Fix: switches (segmented controls) in windows and popovers no longer show their chosen item highlighted in the wrong place the first time they open; every switch now marks the chosen item directly (R-446).
- Layouts have one way in: the layout window. The toolbar's Edit layout icon is gone (Edit card layout in the window's preview edits the layout the folder actually uses), and the content header's layout icon, once only for books, opens the window on the right panel with that folder picked for every kind (R-445).
- Layout window: folder rows read as the layout name with a coloured source tag (the menu shows on hover, focus or pick) and folders with their own layout stand out; kind and level rules say how many folders use them out of how many they could apply to; filters for own and unsaved folders (the unsaved count in the footer opens the latter); the preview shows only the picked folder (or the marked ones), draws cards as wide as the preview with text at its normal size, can be folded and starts folded in a narrow window; the rules read in the order they apply with the default last and their column and each group of rules can be folded away, only the kinds and levels the project has folders for are listed, folders the level rules apply to show their level, picking the layout the rules already give a folder makes no own choice, several folders can be marked (Ctrl / Shift + click) and given a layout together, and "Edit card layout" opens the picked folder's card layout in the editor without making it the default (R-444).
- Fixes: the video player's queue list fills the panel instead of stopping halfway (R-439); moving on to the next CBZ in the same folder keeps immersive reading (R-436); novel scroll mode no longer lags at chapter boundaries while the wheel turns on (the glide stopped whenever a chapter was added after the view) nor nudges the text at every chapter crossed; chapters far from the view are taken away only once scrolling stops (R-442).
- The Custom toolbar dialog is gone: a new game action is added from the launch component in the layout editor (name and type) and is chosen for that component; existing actions keep their names, colours and order (R-385, R-409 stage 6).
- Game components: the editor's Game section offers play time, last played, the game engine (new system info `engine`) and Open folder beside the cover and launch; a new game extra button (open the save folder, start through Steam, open the store page; tentative `game-extra`) asks whether it can be used only for the cards on screen, in one request for those that appear together, faint until the answer and grey with the reason when it cannot be used. The launch component can run any game action. A right-panel layout chosen for games replaces the game page's cover (R-409, stage 5).
- The right panel's main visuals are components of its layout: album info for music, the video count with Play for video, and the book card of a folder with one EPUB; they are the built-in right panels of those kinds and can be placed in any right-panel layout (new tentative component kinds `album-info`, `video-info`, `book-card`). (R-409, stage 4).
- The layout window switches between card and right-panel layouts and saves both together; a folder's right panel is previewed, opened in the editor, or copied into a layout of its own from the folder's row menu. The folder settings' Appearance tab now only shows the folder's card and right-panel layouts and where they come from, with buttons that open the layout window at that folder (R-409, stage 3).
- Right-panel layouts are one list shared by every folder kind (`panelPresets`), chosen per folder by the panel layout rules (the folder's own, its kind's, its level's, the panel default, else the kind's built-in panel); the book template editor works on them. **Project format 2**: a project is upgraded when read (the file is rewritten only when saved, keeping the old one as the backup): book templates keep their names, other edited content templates become "<kind> default", and kind and folder layouts become layout rules. Older versions open a version-2 project read-only (R-409, stage 2).
- Image components can show the folder cover when no picture is chosen (the chosen cover, else the first picture of the record that is not a source extra, else the first image file), and new image components start with it; the game cover component, the game page and the book cover follow the same rule (R-409, stage 1; new tentative cell field `imageCover`).
- Embedded subtitles read fast with fansub effects: lines shorter than 0.1 s (karaoke and signs drawn frame by frame) are skipped, straight from the index where it gives lengths; a track past the limits keeps what was read and says "partly read" instead of failing the whole video; one video is read at a time (opening another stops the read before), a file that cannot be read is remembered, and a file whose index has no subtitle places is read from the playback time first (R-425).
- Videos can always be opened in an external player from the player's controls; application settings can name the program (PotPlayer and mpv also get the current position), otherwise the system default opens it (R-431).
- A subtitle track chosen in one episode is chosen again for the other videos of the folder, by its name or else its language; otherwise the track the file marks as default (new tentative folder field `subtitleTrack`) (R-432).
- The name search can be limited to chosen sources, remembered per folder kind with defaults for each kind; sources that need a key not set are shown greyed (R-424).
- Reading: a book read to its last two-page spread counts as finished (the list shows the last page, and it opens from the start again); the next book takes the previous one's reading settings (direction, two pages, fit) when it has none of its own, and opens without a fixed wait; the next comic archive in a folder opens with the same settings (R-426, R-430).
- Novels: scroll mode lays out enough chapters to fill the window, so a book that opens with very short pages (cover, contents) no longer gets stuck; the end card in page mode is centred (R-427, R-428).
- The book list in the right panel sits under the reading actions, where other pages show their content (R-429).
- Picture subtitles: VobSub tracks inside MKV or WebM videos can be chosen and are shown over the video, decoded in plain JavaScript (no ffmpeg); only their times and places in the file are kept, and the pictures are read in short stretches around the playback time; PGS stays listed as "can't be shown yet" (R-421).
- Source pictures: previews from VNDB, Steam and SteamGridDB list their screenshots and the hero, logo and icon as thumbnails; the checked ones are saved into the folder's record with their role (new tentative asset field `role`), never into the folder itself (R-422).
- Keyed sources: with a TMDB key the name search also lists TMDB movies and series; a TMDB series preview adds the season count and an episode list ("S01E02 Title", up to 30 seasons and 500 episodes, a failed season skipped); SteamGridDB previews add hero, logo and icon picture addresses (R-419).
- Embedded subtitles start reading as soon as an MKV or WebM video opens: the track list comes first, a file with a Cues index has only its subtitle blocks read, nearest the playback time first (a jump moves the reading there), a track chosen while reading shows what is read so far and fills in, and header-stripped tracks (mkvmerge's default compression) are read too; files without a usable index are read whole as before (R-417).
- External sources: a name search in the folder's import (prefilled with the folder name) asks VNDB, MusicBrainz, AniList, Bangumi and Steam at once and lists candidates to pick from (a failing source is only noted; nothing is matched automatically), and a new Wikidata source reads an item's label, description, picture and its IDs on other sites (R-418 parts 1 and 4).
- External sources without keys: VNDB works bring tags (no spoilers, no "lie" tags), play time, rating, links to Steam, DLsite and the official site, the game engine and screenshot addresses (releases bring their own engine and links); the Steam store source asks in the first preferred language, lists screenshot addresses and reads dates written like "2011 年 4 月 18 日"; screenshots are listed as addresses only, not imported as images (R-418 parts 2 and 3).
- External sources: DLsite and iTunes follow the first preferred language (DLsite `locale`, iTunes `lang`; DLsite also brings its short description), and every source's preview warns when its description or title is in none of the preferred languages, without blocking the import (R-420).
- Name search includes adult sources (C-143): AniList and Bangumi (NSFW only with a Bangumi token) show adult works, DLsite and nhentai are searched, FANZA too with its key, adult candidates carry an "Adult" badge, the help text lists the sources, Wikidata moves to the web group, and the game tab shows an imported engine (e.g. VNDB's) beside the one detected locally with a hint when the names differ.
- Layout setup window: the toolbar layout picker became a button (showing the layout the current folder uses) that opens one window for every card layout choice: rules on the left (the default layout, a layout per kind for works with music and video separate, a layout per level for other folders), each with how many folders it reaches; the folders as an indented list with each one's layout and where it comes from, where picking a layout makes it the folder's own; and a preview of the real cards; older kind and folder layouts are carried over (new tentative `layoutRules` project field) (R-413).
- Embedded subtitles: the player's subtitle settings list the subtitle tracks inside an MKV or WebM video ("Embedded: language / name") next to subtitle files, read in plain JavaScript in the main process (only the track list and subtitle blocks are read, with progress, size and time limits, and a local cache that follows the file's size and date); ASS/SSA keep only the words and line breaks, external .ass and .ssa files work too, and picture subtitles (PGS, VobSub) are listed as "can't be shown yet" (R-412).
- External sources by preferred language: application settings has "Languages for online sources" (follows the interface language by default, or an order of the five languages, kept on this computer only); titles and descriptions from VNDB, MusicBrainz, MangaDex, Kitsu, AniList, Bangumi and TMDB use the first language in that order the source has, otherwise the site's default; tags stay in one language and already imported data does not change (R-381).
- External sources: VNDB release addresses (/r…) read the release's own title, date, platforms and languages and take description, cover and developers from its first work; VNDB works now bring their picture; MusicBrainz release-group (album) addresses, richer release data (label, catalogue number, discs, format, track list, genres, tags), genres and tags for recordings and artists, and covers from the Cover Art Archive (R-393).
- Save folder guessing: Godot (project.godot), RPG Maker 2000/2003 (Save01.lsd), NW.js and Electron-packed TyranoScript apps (package.json name) get rules; Ren’Py reads config.save_directory from options.rpyc, loose or inside an .rpa (read-only, size-limited); a folder the engine will use but that does not exist yet shows "no saves yet" instead of "can't work it out" (R-384).
- Card layout grid: a row whose components are all hidden collapses and the rows below move up; text, tag, layout-text, name and path components get an optional "grow when content is too tall" setting (up to 1 to 20 more rows, off by default, not together with scrolling) that pushes the components below it down (new tentative `growMax` cell field) (R-398).
- Book folders: comic archives are a list under the folder details (no tiles), in file name order with numbers as numbers, each with its progress bar, 讀到 N / M 頁 and 繼續閱讀; the whole folder shares the spread, direction and webtoon settings, and every archive remembers its own page (new tentative `volumes` field in the folder record) (R-407).
- CBR (RAR) and CB7 (7z) comic archives can be read, in memory only, through 7-Zip compiled to WebAssembly (7z-wasm); the format is taken from the file's content, so a ZIP named .cbr works too (R-407, replaces R-403).
- Webtoon reading: changing the column width keeps the page on screen, the width can go down to 10%, the bottom of the last page shows the end notice with 前往下一本, and the progress bar always runs left to right (R-414).
- A comic archive (CBZ) opened from a book folder continues with the next archive of the folder at its last page, like a text book (R-415).
- Markdown files (.md) open in the text reader typeset (headings, lists, tables, code blocks) with a toolbar button back to the plain text; HTML in them is shown as text, pictures are not loaded, and only http(s) links open, in the system browser (R-399).
- Folder types are changed in one place only (folder settings, Appearance): the image viewer no longer has a manga/image mode switch and a folder read in manga mode is no longer taken for a book; the right panel title always shows the folder name and type icon (R-411).
- Image mode (not manga) always reads left to right and turns without a slide; a manga folder's saved direction is no longer used or changed by it (R-406).
- Folders: double-clicking the folder that is already selected enters it, and entering a subfolder from the right panel of a previewed folder puts that folder in the history too, so Back returns to it (R-410).
- Videos remember where they were left on this computer: reopening one goes on from there (with 從頭開始), a video folder offers 繼續觀看, and thumbnails show how far each was watched; short videos and finished ones start over (R-405).
- Websites: MusicBrainz recording and artist pages can be imported (R-395).
- Folder types: a picture-only folder inside a music or video folder, or one named like scans, booklet or artwork, is no longer taken for manga (R-404).
- Game folders: the 尚未指定啟動檔 hint follows the project's main launch action, so it no longer disappears after the toolbar's actions were changed; a project without any launch action is told so (R-397).
- Manga reader: a sideways drag moves the page with the pointer, like a strip of full-window slides with the page before or after waiting in the next slot, and springs back below the turn threshold; with the page-turn transition off (or reduced motion) the page stays still and a swipe just turns it; a click in the middle third shows or hides the toolbar (R-392).
- Book folders: a folder with one EPUB shows the book's cover, title, author and ISBN, and a folder of text books offers 繼續閱讀 for the one read last (R-390).
- Video folders get a header with their name, how many videos they hold and 播放影片, which plays them in name order in the big viewer (R-390).
- Podcasts: a music folder can be shown as a podcast (kept on this computer only): newest episodes first with date, length and how far each was heard, 從上次繼續 and 播放最新一集, and each episode goes on from where it was left (R-390).
- Music folders open as an album: cover, album name, artist, year, track count and length from the files' tags, 全部播放 and 隨機播放 that make the album the play queue (with undo), and a track list where a click plays the album from that track. With nothing chosen yet, the play order now goes on to the next track (R-390).
- Game page: the field table is gone; the folder details now also list the website and private values only the table used to show, wrap long values and mark website fields edited by hand (R-390).
- Manga page: a 開始閱讀／繼續閱讀 button with how far you have read, and a folder with several CBZ volumes shows them as tiles (R-390).
- Internal: the right panel draws every folder type through one shared set of blocks (details, subfolders, main visual, controls, type actions, content); nothing changes on screen (R-389).
- Folder types: audio/video is split into Music and Video, and detection is stricter (video beats images, music needs a majority of tracks, any EPUB or CBZ/CBR/CB7 makes a book, PDF and plain ZIP no longer decide). Folder records move to format version 2; a folder set by hand to the old audio/video type goes back to automatic detection. Older versions of M:orph open version 2 records read-only (R-387).
- Game actions tab: explanations moved into "?" tips, the scan range moved here from Advanced, and the launch wording no longer says EXE since SWF and other files can be launched (R-382, R-383, R-401).
- Game detection: Liar-soft games (an EXE with several .xfl archives) are recognised (R-396).
- File overview: the scope switch's selection mark no longer sits off its item the first time it opens (R-402).
- Folder type: choosing "Game" now also marks the folder as a game main folder, so the game page appears at once instead of after a second step under Advanced (R-380).
- Manga reader: a toolbar switch (A) turns the page-turn slide off so the new page just appears; the choice is kept for this computer and every book (R-378).
- Novel reader: in immersive reading Tab on the text no longer brings the bars out and keeps them there (R-377).
- Changing project no longer slides the right panel shut and open again when it was open (R-379).
- Webtoon mode: the pages just ahead load before they are scrolled to, so reading down no longer passes through blank pages that fill in late (R-375).
- Immersive reading: Tab on the page no longer moves the focus into the hidden tool rail, which used to bring the rail out and keep it there (R-376).
- Manga reader and image viewer: the wheel now moves a page larger than the window and turns the page at its end, and Ctrl + wheel zooms (the wheel used to zoom); Space, Page Down/Up and the up and down arrows read the rest of the page before turning it (R-372, R-373).
- Manga two-page mode: a page wider than tall (a spread saved as one picture) is shown by itself, and the pages after it pair up again from there (R-374).
- Internal: the manga reader, webtoon column and novel reader take keys and the wheel through one small shared module; what each key or wheel turn does is unchanged (R-371).
- Internal: one shared module now enumerates every layout component list of a project (card, card layouts, content templates, manga templates), so field deletion, field groups, type changes, validation and the search index can no longer miss one; grouping a cell’s fallbacks now also finds cells that live only in a content template (R-368).
- Internal: the project data model file is split into types, validation and cell helpers, and the stylesheet puts each rule on its own line; nothing changes on screen (R-369, R-370).
- Manga right panel: a project can keep several manga templates (add, copy, rename and delete them in the editor), and a folder can follow the project, use another template or get one of its own from its Appearance settings (R-363).
- Removing a field no longer risks undoing a folder or project saved while its preview was being made (R-366).
- Websites: nhentai gallery addresses import through its own API, with fields named like E-Hentai's; Hitomi.la adds circles, series, characters and the ♀/♂ marks of tags (R-365, R-367).
- Fields: a field kept as text in some folders and as a date in others (such as gallery posting times imported before R-240) can be made dates in one step from Manage fields, after a preview that lists any value that cannot be read; a backup is made first; times whose zone gives hours only (`-05`) are read as dates too (R-364).
- Manga right panel: the cover is a component of the layout (folder cover, else the first picture) that can be moved, resized or removed; a layout never edited starts with the cover and the card's fields instead of an empty column, and an older layout gets its cover component the next time it is opened in the editor (R-362).
- With the project sidebar hidden, only its top-bar button previews it; the window's left edge no longer brings it out, and Esc puts the preview away while the button's tooltip is showing (R-360).
- Layout editor: removing a component (a divider, for example) no longer leaves its empty rows on the cards; stored positions match what the editor shows (R-361).
- Websites: itch.io game addresses import the title, cover, authors, tags, price, genre, platforms, status, engine, release date and rating without a key; when VNDB lists the same game, the preview offers its data as a separate choice (R-359).
- Development: the UI test runner keeps its output short (a line for the build, and for a failure its error, the test line it stopped at and where its screenshots are), `--verbose` shows what the tests print, and `pnpm verify:old` says why the old code failed; `pnpm item` and `pnpm i18n add` handle the routine edits of the work list, spec dates and translations (R-356, R-357, R-358).
- Novel reader: scroll mode hides its scrollbar, and the mouse wheel and page keys glide instead of jumping (R-354, R-355).
- Novel reader: in immersive reading the contents panel sits between the toolbar and the progress bar instead of under them (R-353).
- Novel reader: in a book with many chapters the contents/bookmarks/search tabs keep their height; only the list below them scrolls (R-352).
- Novel reader: in immersive reading a click in the middle of the page (or the mouse at the top or bottom edge) brings the toolbar and the progress bar back together; the contents open only from the toolbar, and the left-edge strip is gone; entering immersive reading or resizing the window keeps the place in the chapter (R-351).
- Novel reader: the next book opens at its own saved place; the contents list scrolls without hiding the tabs above it; the toolbar reaches the right edge; a bookmark's delete button no longer takes half the row; immersive reading puts the contents away and brings them out at the left edge; the margin only sets the ends of a line, with a small fixed edge across the lines (R-345–R-350).
- Cards: the kind badge in the corner is always there (a plain folder for general folders) and shows the folder in the right panel; it replaces the separate "show folder contents" button. A page picked by hand (on the file page or any thumbnail but the first) opens there and offers "Go to page N" when the book was left elsewhere (R-322, R-344).
- Browsing: the card view has two ways to show levels — "One level at a time" and "All works", which goes down each branch to its first work (a game, a manga series, an album…) and passes folders that only hold folders; a folder can be marked as one work or as a category; the scan notes what each folder holds, so kind icons show without opening the folder (R-340).
- Right panel: a file page with a large preview, the kind and size in words, the main action and folded details; a text book shows its cover, title, author, chapters and how far it was read, and a folder of books lists them with their progress; folders show what they are (game, novel, manga, music, video) by their icon, with a badge on cards you can turn off; the Data tab lists your own fields first with "fill in" chips for empty ones and each website's values read-only, with "change by hand" and "remove this site's data"; a manga found by its pictures offers its layout button; (R-327, R-337, R-338, R-339, R-343).
- Novel reader: a simpler toolbar (search, bookmark, an "Aa" panel for layout, paging, font and background, immersive, close) and a bottom bar with a whole-book slider and chapter buttons that runs right to left for vertical text; scroll mode reads on into the next chapter with only a line between them; paged mode ends each chapter with a page of its own and the book with "The end"; the contents push the text aside on a wide window and float on a narrow one; in immersive reading the bars come back at the top and bottom edges (R-335, R-336, R-342).
- Website sources: game pages on Getchu, ErogameScape, Melonbooks, Toranoana and FANZA (without a key) are looked up through VNDB, so no age check, key or region matters; the address field's help is one line, with the supported sites in a list you can open (R-293, R-329).
- Website keys: only sites without a keyless alternative remain (TMDB, SteamGridDB, FANZA, and the optional Bangumi, Danbooru and Google Books keys); MyAnimeList, OMDb, Trakt, TheTVDB, Last.fm, Discogs, AniDB, IGDB, RAWG, Giant Bomb and Comic Vine are read as ordinary web pages now (R-321).
- Games: an EXE action can start with any Locale Emulator profile (Simplified Chinese and so on), not just Japanese; Flash games (.swf) start in the Flash player chosen in the app settings (R-319, R-320).
- Security: web pages and image addresses connect only to the address that passed the local-network check, closing a DNS-rebinding gap (R-334).
- Games: Start with Steam, the store button and Open save folder are hidden until the eye under "Other buttons" in the game settings shows them; the store button only comes from store sites (Steam, DLsite, FANZA, BOOTH) and names the store (R-315, R-316).
- Files list on the right: music shows its embedded cover, and clicking a row opens it (R-317, R-318).
- Novel reader: search results mark the keyword; a chapter ends with a "Next chapter" button; the settings panel shows above the page and Esc closes just the panel; vertical scrolling starts each chapter on the right (R-323–R-326).
- Fixes: the cell copy button keeps one size; jumping to another image drops the old one at once; the level switch draws correctly the first time; website import previews keep field names on one line and fold long values; the pin button in the sidebar peek is gone (R-328, R-330–R-333).
- Languages: every error and notice from the main process (archives, backups, import and export, cleanup, scanning, game detection, settings files) is now translated, including sentences with paths and counts in them (R-281).
- Website keys: a new App settings tab keeps your own keys encrypted on this computer (only the main process reads them), with save-and-test, clear and how-to-apply steps; new keyed sources TMDB, MyAnimeList, OMDb (IMDb addresses), Trakt, RAWG, Giant Bomb, Comic Vine, SteamGridDB, Last.fm, Discogs, IGDB, TheTVDB, FANZA and AniDB, and optional keys for Bangumi (NSFW entries), Danbooru and Google Books. The import panel says when a site needs a key and opens the right row (R-285–R-291).
- Website sources: any HTTPS page can fill in from its JSON-LD / OpenGraph (local and private addresses refused); new sources MangaDex, Kitsu, MangaUpdates, Shōsetsuka ni Narō, Pixiv novels, Apple Music, Deezer, Danbooru, Google Books, BOOTH and Kakuyomu; requests now identify as `Morph/<version>` (R-283, R-284, R-292).
- Novel reader for TXT and EPUB: legacy encodings detected, chapters found from headings, pages or scrolling, vertical text with upright digits and ruby, font / size / spacing / margins / line length / background settings, contents, full-text search, bookmarks, immersive mode, next book; the place in each book is kept, and cards and tables can show reading progress and last read (R-282).
- Reader: webtoon mode (V) shows pages in one gapless column with a width slider (Ctrl + wheel); tall books suggest it once; the mode and width stay with each book (R-256).
- Games: Start with Steam, Open store page and Open save folder buttons when the game offers them; bundled settings tools and manuals suggested as buttons; play time and last played for games started from M:orph (game page, table columns, card component); Locale Emulator can start an EXE action in Japanese locale (R-305–R-310).
- Games: engine detection for SRPG Studio, HSP, Flash, QLIE, Malie, Entis GLS／Cotopha, Escu:de, ExHIBIT, Light.vn, Majiro, FVP and Java; Pixel Game Maker MV is listed as a candidate (R-299).
- Media: a music folder's page shows its album cover; the central Files view can Ctrl/Shift-click music and videos and add them to the play queue from the right-click menu, and its type filter has Music (R-294, R-295).
- Website sources: E-Hentai covers show again (they are WebP now); DLsite imports the circle name, creators by role (author, scenario, illustration, voice, music), genres and series (R-311, R-296).
- Website sources: Hitomi.la works again (its data moved to a new host), and a failed source now says why — can't connect, work not found, needs a key or sign-in, or the site changed its format — in all five languages (R-297, R-300).
- `pnpm check:sources` asks every website source for one known work and lists which still answer and why the others fail; part of the release checks (R-301).
- Website sources: one adapter file per site with a shared list of allowed request and cover hosts; requests now identify as `M:orph/<version>` instead of the old `MediaViewer/0.9.0` (R-302).
- Layout editor: the Content tab names the field or group directly with [Change], without the "Shows:" label in front.
- Release checks (R-278): data saved by 0.40.0 is kept as a sample that every later version must open unchanged (part of `pnpm test`); `pnpm check:packaged` starts the packaged build with throw-away data and checks the home page and version.
- Checks (R-279): `pnpm stale` also points at docs naming functions or components the code no longer has, a first-bundle size that no longer matches the last build, and known limitations whose areas changed after they were confirmed.
- Checks (R-277): commits are refused when window text skips translation or the main process adds a message without a translation key; existing untranslated main-process messages (507) are listed so they can only shrink.

## 0.40.0 — 2026-11-12

- Fix (R-275): moving on to the next book while reading immersively also stays immersive when the app runs in development mode.
- Fixes (R-273 to R-276): the play-order tooltip shows above the player and names what a click switches to; immersive edge panels close again after their buttons are clicked; moving on to the next book keeps immersive reading; a second press-and-drag on a page no longer drags a ghost copy (nothing in the reader or queues can be selected).
- Fix (R-272): dragging a thumbnail a little while clicking it no longer leaves a ghost copy of the picture over the viewer that swallowed clicks and drags; pictures are never dragged out by the browser.
- Reading place (R-253): opening a manga from its first page continues where you left it ("Continuing from page N", with Start over); a book left on its last pages opens from the start. The play order is remembered after restart (stored in local settings as `playOrder`).
- Next book (R-255): pressing Next on the last page says "This is the last page" and names the next folder in the browse list; pressing again opens it and starts reading.
- Reader toolbar (R-263): page mode, first-page-alone, reading direction and fit are icon buttons with names and shortcuts in tooltips; the "Reading settings" menu is gone. In immersive reading the same tools slide in from the left edge, a progress bar with page previews from the bottom edge (R-262, R-254), and the media queue from the right edge (R-261); the project sidebar no longer slides out there.
- Reading (R-270, R-264, R-252, R-269): a page turn slides the new page in from the reading direction (off with reduced motion); a sideways drag on a page that fits turns it; the next two pages in reading order are prepared in advance; in immersive reading the pointer hides after two seconds at rest. Right to left, the progress bar starts at its right end.
- Image and manga queue (R-271): list or thumbnails, like the video queue.
- Media queue (R-257, R-258): the video and music queue looks like the image and manga queue: each row has a preview square (video frame, or the music file's embedded cover) with the file name; image view shows only the previews, with names on hover.
- Play order (R-268): one button decides what happens when a track or video ends: stop, play next, repeat all or repeat this one. It replaces "Auto advance" in the queue and "Play the next track automatically" in the music player, and sits in the music controls and the queue header.
- Queue fixes: adding the file that is playing as a one-off makes it the playing queue entry instead of a second copy (R-266); removing the playing entry plays the next one, or pauses when none is left, instead of closing the player (R-267).
- Fix (R-251): the image waterfall in the side panel could crash the window ("Something went wrong") when the panel or window width landed where the scrollbar kept appearing and disappearing; the scrollbar space is now kept while the waterfall is shown.
- Tests (R-250): the file overview scroll check waits for files to appear instead of a fixed 100 ms.
- Internal (R-249): the window's source files are grouped into one folder per feature (browse, panel, editor, media, video and so on) instead of one flat folder. No visible change.
- Cleanup (R-245): leftover records inside a game folder are only removed whole; clearing just a project's private values there, which would rewrite the record, is refused.
- Fix (R-246): importing from a website with "fill empty fields" no longer fails when one of the chosen fields was edited by hand; that field is left as it is and the others are filled. Replacing still refuses to overwrite a hand edit.
- Checks (R-248): commits are refused when code imports across the window, shared and main-process layers.
- Dates (R-240): imported release dates are saved as dates (Steam "12 Nov, 2020", 2020/11/12, English month names and so on become 2020-11-12) and the E-Hentai posting time as a date and time; a year alone stays text, and so does any value of a field the project uses as text. In Manage fields a date field can be changed to text (date comparisons on it are removed, with a count first) and a text field to a date, when every saved value reads as a date. Saved values are not rewritten: text in a date field is shown, sorted, compared and searched as a date. Folder text saving now refuses non-text fields (R-247).
- Internal (R-241): every request from the window to the main process is checked for a known action and correctly typed fields before it runs; malformed requests are refused. The library request handling moved out of main.ts into its own module. No visible change.
- Docs (R-242): specs describe current behaviour only (change history and "this round" notes removed), numbered headings renamed, ARCHITECTURE lists the missing modules, the metadata spec lists DLsite.
- Conditions (R-239): a component can have up to five display conditions, all or any of which must match; date fields can be compared with today ("within N days", "more than N days ago"); and layout text can show different words by rule (for example "New" for releases within 90 days, "Classic" before 2016), with its own text when no rule matches. New keys `moreConditions`, `conditionMode`, `textRules` and operators `within`/`older`.
- Cards (R-237): every field component with no value shows a dimmed "No value" (some showed nothing, others "Not set"); "Hide when empty" leaves it blank. Tag components offer namespace colouring and the prefix switch only when the field has "namespace:tag" data (R-238).
- Fix (R-234): a yes/no field's own wording now also shows on the game folder page's field table (it showed true/false) and in the editor's field list and group previews (they showed yes/no).
- Layout editor (R-236): a website field added to the project is named in plain words with its site (TITLE_ORIGINAL becomes "Original title (E-Hentai)"); keys without a plain name stay as they are, and fields already added keep their names.
- Folder settings (R-235): the folder type and the card layout moved from the Data tab into a new Appearance tab, next to Data.
- Field purposes (R-234): a new field's Date card has "Include time" instead of a separate Date and time card, and a field's details can switch between the two (components follow; saved values are kept, a date-only component shows only the date). A yes/no field can have its own wording (for example Owned / Not owned; `trueLabel`/`falseLabel`), used on cards, in the table, in folder settings and by search, and a yes/no component can show only when the value is yes.
- Layout editor, Style tab (R-233): two folding groups, Text (open) and Box (folded, its title naming what was changed). Alignment sits in one row, "None" in the background colour replaces the "Transparent background" checkbox, changed groups show a dot and can be reset, and the preset menu only applies styles while saving, deleting and clearing moved into its "⋯".
- Layout editor, Content tab (R-232): one display switch for every field (text/tags, text/badge, number/stars/progress bar), with tag colouring and prefix moved next to it. "Hide when empty" replaces the Condition tab; other conditions and the copy button (now only for text, links and several values) sit under a folded "More options". A choice field's options are edited in Manage fields ("Edit options"), and its colours show only for the badge look, noted as shared by all components. Components with no content settings show their style without tabs. "Find a folder showing a later field" is gone.
- Layout editor (R-230): the preview menu has "Sample data": each field takes a real value from any folder, and fields no folder fills show a sample of their type (text, three tags, the first option, 4, today, yes, a sample link), marked above the canvas as not real. A field component no folder fills offers "Preview with sample data" in its Content tab.
- Folder settings (R-231): field sections (sources and groups) in the Data tab start folded, with how many hold data in their titles; a single section stays open, and opened ones stay open until another folder is shown.
- Layout editor fixes (R-229): a new single-choice field now takes its options as tags, and a comma (also a full-width comma typed through an input method) or Enter makes one; the option inputs in Manage fields split full-width commas too. The left field list no longer shows "Used N times" (Manage fields still does). The Content tab says in one line what shows now, with plain imported names and the site ("Now: Original title · E-Hentai (number 1)"), with "Edit group" opening the group on the left; the arrow chain and the folder name are gone.
- Layout editor wording (R-228): field purposes have one short name everywhere: Text, Several values, Single choice (the rest unchanged; the cards keep their examples). "Manage fields" no longer has a "Used in" section; "Used N times" counts every layout and content template in both lists and lists them on hover. Component rows in the materials panel are one line with their description as a tooltip, and the opened group and Manage fields explain themselves with a "?".
- Layout editor, third batch (R-226): field groups. Drop a field on another field (or use "⋯ › Add to group", or Ctrl+click several and "Make a group") to group fields that hold the same data from different sources; a group shows the first member with a value. Groups come first in Your fields and in Manage fields, open like folders (rename, reorder, remove, "Add to card", the member the preview shows) and have details with how many folders show each member, where the group is used and Ungroup. A component's Content tab now reads "Shows: … [Change]" instead of the fallback list; older fallback components keep working and can be turned into a group. Folder settings list a group's members together and let one folder choose its member. Search by group name looks in every member, TABLE gets a column per group, the card's tooltip names the member shown, and deleting a field takes it out of its group. Stored only in the project settings (`fieldGroups`, `groupSources`, cell `groupId`); folder records are not changed.
- Fix (R-227): full removal, root retirement and cleanup no longer stop or leave an empty `.media-viewer` behind when Windows briefly keeps a just-deleted file open (antivirus, search indexer). The folder is retried briefly only while everything left in it was deleted by the same operation; anything else is kept as before.
- Tests (development only): removing a test's temporary folder now retries briefly (Node's maxRetries) when Windows still holds a just-written file open; one or two unit tests used to fail at random with ENOTEMPTY at cleanup. The leftover folders were empty, so nothing kept writing after a test.
- Layout editor, second batch (R-225, R-223): a new field is chosen by what it holds, from eight cards with examples (a piece of text, several tags, one from a list, number, date, date and time, yes/no, link). "Manage fields" (the gear on Your fields, or "Field settings…" in a row's menu) shows the fields grouped by source beside one field's details: purpose, source, real data examples, where it is used, options, rename and delete with an impact preview. "Change to…" says what will happen before changing between text, tags and a list; saved folder values are not rewritten, and changes that would break a fallback chain or a condition are refused with the reason. Own fields come first and websites by name in both lists; fields not added yet fold into one line and sources with nothing added start folded. Tags also split on a full-width comma.
- Fix: in the layout editor, choosing the folder that was already being previewed cleared the preview.
- Layout editor, first batch of the redesign (R-224): one toolbar with layout, a preview menu (folders, longest/shortest values, previous/next), undo/redo and a single primary Save. The left materials panel has one search box and four sections in one style (Folder info, Your fields grouped by source with an "Only with values" toggle on its heading, Layout, Game); every row has an icon, a name and a secondary line, fields not yet added are just a row state, rename/delete moved into "⋯", and a search with no match offers "+ Create field". The canvas has a fixed status line for cut-off content and a floating copy/remove toolbar (Ctrl+D duplicates, Esc deselects). The right side has Content / Style / Condition tabs that remember the last tab, position and size under Style › Advanced, and a whole-card overview when nothing is selected.
- Field UX: group shared and project fields by website, retain source labels after referencing, and add search (by name or source) and an "only with values" filter (the editor's look and layout were then redesigned in R-224). Folder settings hide empty fields while keeping cleared inputs available during editing. Main and fallback sources share one ordered list; text and tags can display each other's values without rewriting source data. Fix the cropped-picture outline incorrectly including blur-fill backgrounds.
- Revert R-219 after review: cards use the fixed 12-column layout again, and the editor canvas follows its own available width. Remove the provisional `trimColumns` setting and card-width controls.
- Layout editor: a picture that fills its frame by cropping, with proportions more than 20% off the frame, is flagged like cut-off text and offers "Show whole" or "Blur fill".
- Tests (development only): `closeApp` answers the app's native unsaved-changes box itself; tests that left the editor unsaved used to hang the main process on it.
- Fix: after "One row taller" the orange cut-off outline stayed until the component was dragged; the check now also runs when a component finishes resizing (the grid animates size changes).
- Tests (development only): `node scripts/run-ui-tests.mjs <name> --repeat N` runs a test N times without retries to measure flakiness, keeping the timeout and Electron cleanup; `pnpm verify:old <test>` runs today's test against the last commit in a separate worktree, to show a new test catches the old bug without touching the working tree.
- Table: a card component with fallback fields gets its own column, "<field> (with fallbacks)", which shows and sorts by the first field in the component's order that has a value.
- Layout editor: the preview can use "Longest value of each field" or "Shortest value of each field" across all folders. Components whose content is cut off are outlined in orange, and selecting one offers quick fixes (wrap, scroll when long, one row taller).
- Layout editor: a component's whole style can be saved by name ("Save as style…") and applied to other components of the same project from the style menu; saved with the layout, up to 20, not shared across projects. New optional `stylePresets` field in the project record (provisional).
- Video player: the "autoplay on entering a folder" and "play next" switches, which no longer did anything, are gone from the settings panel.
- Licensing documents: consolidate the licence, brand rules and third-party notice into LICENSE; shorten the three README summaries and contribution terms, and remove NOTICE.md and TRADEMARK.md from the repository and packaging.
- Documentation: every spec now opens with a "last confirmed" date and its code and test entry points, and states only current rules: dated notes, version tags, "first round / later" plans and old research were rewritten or removed (the video spec lost its player-selection history and the cancelled clip-preview section). Found while checking: the video settings panel still shows two switches (autoplay on entering a folder, play next) that no longer do anything — logged as R-216.
- Documentation: the workspace spec is split in two — the frame, the three modes and the right panel stay in WORKSPACE_REVISION, while the file overview, hidden files and the unified media page move to MEDIA_WORKSPACE; dated notes in them are rewritten as current rules and all links follow the move.
- Layout editor: with the three columns side by side, they fill the window height and scroll on their own, so the component list and the settings always reach the bottom and a long canvas scrolls only itself (narrower layouts keep scrolling the page). On an empty canvas, "Start from a template" sits over the grid instead of above it, fades while a component is dragged over the canvas and comes back when it leaves, so a component can be dropped anywhere.
- Fix: dragging a component over the editor canvas and then away without dropping (or ending the drag elsewhere) could leave its shadow on the canvas. The grid only clears it when its own enter/leave count returns to zero, which misses when an element moves mid-drag; the editor now clears it whenever the pointer leaves the canvas or the drag ends.
- Fix: a component thrown quickly from the editor palette onto the canvas could vanish: the grid only places its drop placeholder on dragover (through state), so a drop arriving first reported no item and nothing was added. The editor now places it under the pointer itself. The editor test had been retrying exactly this miss; a throw without dragover is now tested on its own.
- Table columns can be picked up anywhere on their header, not only on the column name.
- Fix: dragging a game toolbar button, a sidebar project or group, or a table column quickly could silently do nothing, because the drop target only accepted the drag after the next re-render. The targets now accept it at once. This was also why `game-actions-ui` failed about 1 run in 4; the test now sends the drag events itself, so it checks exactly this.
- Fix: pressing Esc (or picking a project) while the pointer rested on the left edge closed the hidden project sidebar and reopened it at once, where it then stayed open. It now stays closed until the pointer moves away from the edge. `sidebar-peek-ui` failed on every run because of this.
- Code: `FolderPanel.tsx` (1,207 → 670 lines) and `BrowseWorkspace.tsx` (1,095 → about 900 lines) are split: website import, field inputs and the Images tab, and the path bar, card grid, card display saving and table columns now live in their own files; row sorting is `sortRows` in `shared/browse.ts` with its own test. Behaviour is unchanged.
- Workflow (development only): requirements live in a structured list (docs/WORK_ITEMS.md) whose sections are their state; `pnpm status` prints the status block that now ends every reply; docs/areas.json is the one registry of areas, specs, code and tests, from which `test:ui:changed`, the routing table in docs/README.md and the new `pnpm stale` check are derived; the decision log is an index plus monthly files; CLAUDE.md is shorter. 36 translations no code used any more were removed, and outdated claims in the metadata and video specs were corrected.
- Documentation: the game-engine detection spec is now a table of the current rules (diagnosis logs, fixed-gap tables and collection titles removed); the workspace spec's removal and settings-package sections describe the current two-button removal and backup restore; dates are gone from spec headings (linked anchors kept).
- Tests (development only): a pre-commit check fails when a UI test looks for a button or text the app no longer has; every UI test now closes the app through the shared helper that skips the unsaved-changes prompt, and the UI runner stops a test stuck for more than 4 minutes (TIMEOUT, not retried). `pnpm test:ui:changed` maps every source file to its UI tests and names any file it cannot map. New `pnpm detect <folder> [--children]` runs game-engine detection read-only. The duplicate `test:ui` script is gone (`test:workspace` stays), and the test list in IMPLEMENTATION.md is replaced by how to find the right test.
- Data upgrades: stored data now carries an upgrade path. Folder and project records are upgraded in memory when read and written in the new format only when saved (the previous file stays as `.bak`); app settings are upgraded once at start-up after the original file is copied to `workspace-backups/before-upgrade-*.json`; backups and settings packages are upgraded when restored. Data written by a newer version is read-only: it is listed under "Update required" in Problems, is never restored over, recreated, overwritten by an import, cleaned up (nor anything below it) or scanned into, and app settings from a newer version stop saving. All formats are still version 1, so nothing changes for existing data.
- Licensing: replace the GPL for newly licensed project material with M:orph Source-Available License 1.0: no resale of unchanged or superficially changed copies without written permission; substantively modified versions may be sold with corresponding source. Earlier GPL grants and third-party licenses remain unchanged.
- Translations: remove corruption from 85 Simplified Chinese messages, clarify row density, automatic audio playback, image components and shared media pages, and restore the Japanese video recovery instruction. Traditional Chinese source keys are unchanged; the corruption check now rejects control characters and the observed garbled suffix.
- Documentation: clarify game launching, engine detection, portable records and search indexes in all three READMEs; improve English and Japanese wording and align the brand tagline with the homepage.
- Game detection: a Godot single-file export is recognised by its `.console.exe` beside the EXE; an Electron-packed TyranoScript game is recognised by the top-level names (`tyrano`, `data`) in the file tree at the start of `resources/app.asar` (only that header is read, never file contents). Checked read-only on 37 sample games.
- Game detection: LucaSystem, the engine of the Steam releases of Key titles (AIR, CLANNAD, Kanon, Summer Pockets), is recognised from `files/SCRIPT.PAK` with other `.PAK` packs; several `.npk` packs are now reported as Nitroplus NPK instead of an unknown engine. Checked read-only on 28 sample games.
- Fix: after saving project settings the save bar stayed and a second save failed with a version conflict, because the draft kept the old revision. The draft now follows the saved project.
- Game detection: Circus (an `AdvData` folder with CRX images or MES scripts), LiveMaker (`live.dll` beside the EXE), RPG Developer Bakin (`data/bakinplayer.exe` or `data/data.rbpack`) and SMILE GAME BUILDER (`data.sgbpack` or `sgb_rpgplayer.exe`) are now recognised, from a second set of sample folders (read only).
- Restore no longer makes an automatic backup: restoring projects only fills in missing info, so such a backup could not undo anything. After restoring settings (the only thing a restore replaces) the Backup page shows "Back to before the restore". The backup list holds only backups you made; automatic ones left by the previous build stay listed until you delete them. `pnpm shot --backup undo` shows that notice.
- Backups are one list kept by the app: "Create backup" saves straight into the app's data folder (no folder to choose); each entry shows its date, whether it was made by hand or automatically before a restore, how many projects and its size, with "Restore", "Export…" and "Delete". Every restore first makes an automatic backup (only the newest 5 are kept), which replaces the separate "go back to earlier settings" list. Backups from another computer open with "Restore from a folder…". `pnpm shot` gained `--backup [create]`.
- New project is one step: choose a folder; if it already holds a project that is not in the list (moved folder, new computer, removed from the list), the dialog offers "Bring back the project" (or "Create a new project instead"). The import and link tabs are gone, and the problem screen's relink opens the same dialog.
- Backup and restore: application settings › Backup has "Create backup" (settings plus every linked project's info in one folder, no media) and "Restore from backup" (a preview to tick settings and projects; a moved folder can be pointed at its new place or skipped; existing folder info is kept; settings are restored last and can be undone with "Go back to earlier settings"). This replaces the settings package export/import and the project's "Export project data"; the project settings tab is now just "Remove". The old settings-file channel between the window and the main process is gone.
- Project removal is now two buttons: "Remove from list" (keeps all info) and "Delete this project's info…". Deleting removes only this project's own info; clearing everything M:orph created in the folders (shared info, game decisions, projects removed from the list earlier) needs the "Also delete the other info…" box, which lists the other linked projects using those folders and where the backup goes. Folder settings show the shared / this-project switch only when another linked project shows the folder (or this project already has its own values there); the game-candidate note offers "Confirm as the game's main folder" and "Not a game" directly; the folder clean-up is no longer folded under "Danger"; the raw-data section is called "Technical details".
- Interface wording: a glossary in `docs/UI_RULES.md` now sets plain words for the interface, applied in all five languages to 56 strings: "folder info" instead of records, "this project's own info" instead of private overrides, "info shared by all projects" instead of shared values, "info M:orph created" instead of app data, "game's main folder" instead of game ROOT, "card look" instead of layout scheme, "toolbar" instead of toolbar template, and "your files (manga, images, videos)" instead of original media. The project settings tab "Data" is now "Backup and removal". Data formats and internal names are unchanged.
- Settings tidy-up (first group): project settings now use the same fixed save bar as folder settings (Discard / Save, shown only while something is unsaved; the window stays open after saving) instead of Cancel / Save project settings; the "CARD display" line that only pointed elsewhere is gone; the explanations that decide what an action affects are shown as text instead of behind "?" (settings backup scope, clearing a folder's data, restarting records after clearing, game actions scope).
- Game detection: CatSystem2 (several `.int` archives with `cs2conf.dll` or `config/startup.xml`), SoftPal (several `.pac` archives with `Pal.dll`) and fused LÖVE games (`love.dll` with `lua51.dll`, no `.love`) are now recognised, from sample folders the maintainer provided (read only). The sample labelled Majiro turned out to be NScripter and was already recognised.
- Application settings › Data and backup: the text-only "Project data" card is removed.
- Project removal and clean-up simplified: project settings › Data now has one "Remove project" choice with three levels, shown as selectable cards like the theme picker (the last one in the error colour; arrow keys move the choice) (Only unlink, the default; This project's data only; Also clear shared data), replacing the separate unlink block and the "Danger" fold. "Clear all linked app data" is gone (it also had a second, never-shown button in the editor page); to clear every trace, clear each project's shared data. Application settings › Data and backup keeps the settings package and restore points and points to where project data is exported and imported. `pnpm shot` gained `--project-settings [private|full]` and its `--theme` option no longer times out.
- README: the English and Japanese READMEs now follow the confirmed Traditional Chinese README (highlights, six feature sections, download status, data storage, development, project status, licence) with the same screenshots and data-flow diagram; React 19; the Releases link points to the new repository name.
- Game detection: confirmed the Godot rule and fixed it with a test: an EXE with its own `.pck` is Godot; a lone EXE (single-file export with an embedded PCK), a `.pak` file or an unrelated `.pck` is not a game, and a folder can still be marked as a game by hand; `Scene.pck` with `Gameexe.dat` stays SiglusEngine. No detection code changed.
- README: the Traditional Chinese README is replaced by the maintainer's revised text (features, per-feature sections, download status, alpha notice), with the screenshots, theme row and the two mermaid diagrams put back; the Releases link points to the new repository name. The English and Japanese READMEs are not changed yet.
- Documentation: new `docs/RELEASING.md` sets the stages (alpha has no tags and no public release; beta, which only the maintainer can declare, gets tags and pre-releases; stable from 1.0.0), the release steps and how `release/` is tidied. `docs/DATA_FORMAT.md` now specifies automatic data upgrades (not implemented yet): portable records upgrade in memory when read and are written back only on their next save, `%APPDATA%` upgrades at start-up after a backup, and data from a newer version is shown read-only. Decision C-119; the project rules, workflow template and document index point to them.
- Documentation: both user guides no longer describe a project "category" (each folder works out its own type); the English guide follows the new project dialog (create from a folder, import, link) and gains three screenshots; the repository URL in `package.json` points to the new repository name; `pnpm shot:docs` and the licence files are listed in the implementation guide and the document index; an old verification note in `UI_RULES.md` is removed and the video player comparison notes which versions it was written for.
- Licence: GPL-3.0-only (no "or any later version") with the name and logo policy. The policy defines the official builds (the Releases page) and forbids presenting a copy as official or as sold or endorsed by the author; the notice covers documentation and sample images; contributors also allow the maintainer to license their contributions under other terms, so selling builds or a commercial licence stays possible later. The three READMEs say that the GPL allows selling copies with their source but not under the name or logo.
- Documentation: the architecture is drawn as mermaid diagrams (data path from folders to the screen, and the renderer / preload / main layers with storage) in `docs/ARCHITECTURE.md`, replacing `architecture.svg`; the Traditional Chinese README shows a simplified data-flow diagram and a three-layer diagram.
- Documentation screenshots: `pnpm shot:docs` rebuilds the eight images in `docs/images/` from a generated sample library (flat covers drawn by the script, fictional titles, no personal paths). The Traditional Chinese README and user guide now use them.
- Fix: a tag cell that is not in the first row of a card showed only a "+N" badge, because the tags were measured against the wrong box. The tag list now measures against itself.
- README: the Traditional Chinese README is rewritten for first-time users (what it is, why use it, download placeholder with the unsigned-build note, features, data storage, developer section); the Simplified Chinese and Spanish READMEs are removed and the language bars of the remaining three now link only English, Traditional Chinese and Japanese. The app's own interface languages are unchanged.
- Problems and recovery: a "Games to confirm" group lists folders that look like games but nobody has confirmed, with "Confirm game ROOT" and "This is not a game" on each, so they can be settled without opening each folder's settings.
- Layout editor: a selected component can be duplicated (the copy goes under the last component and gets its own image slot), and the landing spot of a dragged component is drawn in the theme's accent colour.
- Game toolbar editor: the button colour is picked from a row of ten ready-made swatches (the chosen one shows a tick), "custom colour" opens an inline picker instead of a drop-down that landed below the dialog, and a preview button shows the label in the chosen colour.
- The version number is shown in the app: "v0.39.0" in the status bar and "M:orph 0.39.0" at the bottom of Application settings (read from package.json when the interface is built).
- Problems and recovery: scan messages that only say a game folder is protected ("inside is not written to") are no longer counted as problems; they sit in a folded "Game folder protection notes" section with an explanation, so the status bar and the dialog only show things that need doing.
- Motion: dialogs, menus and popovers share one short pop-in; sidebar group actions, row-info and column-hide buttons fade instead of popping; groups ease open and the chevron turns; the narrow-window scrim, status text and settings tabs fade in; entering a folder fades the list; reordering table columns slides them to their new place. All of it stops under reduced motion. The hidden-sidebar peek no longer nudges the page when it opens or closes.
- Layout editor (formerly "block editor"): the title now says "Layout editor" like the toolbar button; an empty card offers three starting templates (simple, with rating and tags, game card); the component list is grouped (information to show, layout helpers) with the game-only components folded away unless the project has a game; the title shows an unsaved dot and the cancel button reads "Discard changes" ("Close" when nothing changed); only the Content section of the settings starts open.
- Right panel opening: its code is fetched while the app is idle, recently seen folder listings are kept so reopening shows at once, and an outline of the page replaces the empty "loading" line.
- Game detection: CRYENGINE, Adventure Game Studio, MonoGame／FNA／XNA, Source, Source 2, Adobe AIR, DOSBox bundles and PC-98 emulator collections (candidates until checked against real folders).
- Problems and recovery: the status bar says how many problems there are (or that there are none); the dialog groups them (project location lost, duplicate folder ID, damaged record, recording stopped) with a plain explanation and the fixing button on each item, folder names jump to the folder, and raw error text is folded under "Technical details".
- Project sidebar: while hidden, resting the pointer on the left edge (or its button) lays it over the page without moving anything; picking a project or Esc puts it away, and a pin button opens it for good.
- Removed the importer for data from the very first versions (the "older data" section and dialog) and the old category names for content templates; project files keep loading, old templates under those names are just no longer used.
- Folder details: the location shows only the last two folders (the hover title and the copy button still give the whole path).
- Packages are written to `release/morph <version>/` (one folder per version; the 0.38.0 files moved to `release/morph 0.38.0/`).
- Housekeeping: the folder settings Advanced tab and the folders table were split out of their big files (`FolderAdvanced.tsx`, `FolderTable.tsx`).
- Folder details: the location now shows the folder's full path (wrapping instead of only its name), and a "Data source" row lists the website(s) the data was imported from as links that open in the browser (on every kind of folder page); the line above the game field table is gone and its rows name the site instead.
- Game field table: imported fields show plain names (Source URL, Circle / brand ID, Work ID, …; the stored code is a hover hint), the source column shows the site's name instead of repeating the whole address on every row, and a "Data from: DLsite" line above the table names the site once (rows from other places, such as typed by hand, still say so).
- Folder settings: explanations that only matter sometimes moved into "?" hints (folder type reason, layout priority, shared / this-project effect, settings backup scope, per-type default layouts); the layout dropdown's first option now names the layout in force. The scan-boundary block says in plain words what was found and what each button does, with the raw detection evidence tucked under "Why it was detected".
- Selecting and un-selecting a folder is instant: a folder that can be visited as-is is shown in the panel at once while its visit runs behind it (a refused visit goes back to the previous folder), and clearing the selection no longer waits for a double-click timer.
- Files view groups: space between the heading line and its files, and between tile rows.
- Clicking the selected folder again (or pressing Esc) clears the selection and the right panel goes back to the folder the path bar is on; a double click still enters the folder.
- Files view: air between list rows and above each group heading (which now has a divider line).
- Folders table: the dragged column dims, the drop line is thicker and fades in, the moved column flashes once, a hover button hides a column, and the column picker is a labelled "Columns" button.
- Settings backups: only the newest 30 restore points are kept (older ones are deleted when a new one is made).
- Project settings: "Remove project" and "Remove all project data" are one section with a choice (this project's data only, or also clear shared data, which lists the other projects it may affect); "Export project data" moved here from the sidebar menu (Data tab).
- New project dialog: a third choice, "Link an existing project" (replaces the separate re-link buttons on the home page and in Application settings). Application settings, Data and backup: only settings backup (export, import, collapsed restore points), older data (when found) and Dangerous actions are left.
- Housekeeping: the test output folder is pruned automatically (anything older than a day is removed when `pnpm test`, `pnpm shot` or the UI runner starts; `pnpm clean:test` removes all of it). It had grown to 5 GB.
- Fixed: the folder settings Advanced tab showed nothing because the record details and the collapsed Dangerous actions section had been placed inside the "record recovery" block that only appears for broken folders.
- Narrow windows: the layout editor button stays visible (icon only) and only the layout dropdown folds away; the card display button no longer shows the per-row count.
- Toolbar: the controls keep the same places in every view (folders | files, view mode, the view's own tools on the left; scope, columns, folder settings on the right), so switching card / table / tree no longer makes anything jump. Controls share one height and type size, wrap instead of overlapping in narrow windows, and the card / table / tree, thumbnails / groups / list and edit-layout buttons are icon-only with a tooltip. The two scope settings now share one "Scope" button.
- Files view follows the path bar: the separate scope-folder dropdown is gone, switching from a selected folder goes there first, group headings enter their folder, and the path bar's folder count only shows in the folders view.
- Right panel: a single click shows the folder at once, the panel is only opened or closed by you (the "open content automatically" setting is removed), hidden-panel cards and rows have a "show folder content" icon, the panel title has "Open this folder", unsaved folder settings are resolved inside the panel instead of a dialog, and the duplicate settings gear and long settings tab title are gone.
- Application settings: two pages, General (language and theme apply as soon as you choose) and Data and backup (project data, settings backup, a collapsed Dangerous actions section with every description). Folder and project settings also collapse their destructive actions.
- New project dialog: one door with a switch between "Create from a folder" and "Import exported project data" (both folders are chosen in the dialog before the preview); the folder name becomes the default project name. The sidebar and home page no longer carry a separate import button.
- Empty projects get an "Add common fields" button (rating, tags, status, notes) in folder settings and the layout editor; the toolbar's pencil is now a labelled layout button.
- Folder type, steps 3 to 5: card layouts can be set per folder type (project settings, with a note on the priority folder > type > project), project categories and media conversion are removed (new projects no longer ask for one), export format version 2 upgrades older exports on import, and folders can be marked in the list (Ctrl / Shift click) and given a type in bulk.
- Game field table: when the panel is narrow each field becomes a small card (name and source on one line, value below) instead of a column of single characters.
- Folder type, step 2: Folder settings (game tab, scan boundary, cover and launch hints, images), the comic reader default and the folder content view now follow the folder's type instead of the project category. A project's category still supplies the default (manga project → book, game project → game) when nothing else tells, so existing projects look the same; setting a folder's type by hand now changes its features in any project.
- Folder type, step 1: every folder now has a type (game, book / comic, video / audio, general) that is detected from a detected game boundary, an existing comic reading mode, or the files inside (unsure means general), and can be set by hand in Folder settings → Data. Nothing else changes behaviour yet; later steps make the UI follow the folder type instead of the project category.
- One-click project data export / import: the project menu has "Export project data" (a folder with a verified manifest plus the project's records, images and subtitles, no media), and Application settings → Links and maintenance has "Import project data" (preview first, existing records kept, overwrites backed up, rolled back on failure). Imports pass through a versioned migration hook so older exports can be upgraded when the data model changes.
- Folder settings: the scan-boundary block (mark as game root, etc.) is only shown for game projects or when a game was detected in the folder; non-game projects also get a short "game detected, internals protected" note with a shortcut to those settings.
- Folder settings, round three: the panel remembers the tab you were on when you switch folders; the Shared / This project switch moved from Advanced into the Data tab with a line explaining its effect; the website-import preview is now a current-vs-new table with a sticky action bar; the saved-images list became an always-open image library that shows where each image is used; game actions that are not bound yet get an accent border. (Source notes under fields, Ctrl+S to save and the danger-zone divider arrived in the same batch.)
## 0.39.0 — 2026-11-03

- Folder settings, round two: a "Still to add" card lists what a folder lacks (launch file, cover, work data) with a button that jumps to the right place; the path is one slim line and the duplicate "open in Explorer" button is gone (the panel header icon remains); an empty project shows an "Add field" button; each game action has a "test launch" icon and its target path sits on one line.
- Folder settings redesign (fewer steps): website import now sits at the top of the Data tab instead of its own tab; a sticky Save / Discard bar with an unsaved count appears at the bottom (plus a dot on the Data tab); image and game-cover choices are a thumbnail that opens a menu to pick a saved image, import a new one or clear it.
- Fixed 161 Simplified Chinese interface strings that ended in garbled characters; a data test now rejects corrupted characters in any language.
- Folder settings: saved images can now be deleted (Images tab → Saved images → Delete image). A confirmation lists the components/cover that use it; the image entry, its cover/component references and its managed file are removed in one safe write, and your original media files are never touched.
- One refresh button: the folder toolbar's "Rescan" and the right panel's "Refresh" buttons are merged into a single "Refresh" button in the top bar next to the application settings; it rescans the current project and reloads the right-hand content.
- UI test runner (`pnpm test:ui:*`, `test:workspace`) now guarantees a current build: it prints the `out/` build time and runs `pnpm build` first when `out/` is missing or older than `src/`, `shared/`, `electron/` or the build config, so a stale build can no longer show old UI.
- Packaging: electron-builder now ships only the app's five UI locales (`electronLanguages`), dropping unused Chromium language packs, and renderer-only libraries (bundled by Vite already) moved to `devDependencies` so they are no longer copied into `app.asar` a second time (`app.asar` 47 MB → 4 MB; unpacked app 402 MB → 316 MB). The app's own translations are unaffected.
- Game folder panel: the field table's columns (field / source) can be resized by dragging the header separators; widths are remembered on this computer.
- Watching UI tests (`MEDIA_VIEWER_TEST_VISIBLE=1`) no longer takes over your screen: the test window is half transparent, click-through and never activated, so the window you are using keeps the focus.
- Fixed thumbnails and video/audio not loading when running `pnpm dev` (React 19 StrictMode re-attaches the same element after its `src` was cleared on detach): the gallery image, video and audio refs now restore the source. Packaged and production builds were not affected.
- Folder settings: a choice (single-select) field now has an "Add option" box under its dropdown, so a new option no longer needs a trip to the block editor. The option is saved to the project (shared by every folder) and selected for this folder; the folder's own value still needs the usual save.
- UI tests no longer stall on native Windows message boxes (e.g. "discard unsaved changes?"): the test launcher answers them automatically; a test that checks a prompt installs its own stub.
- Docs: end-user guide (English and Traditional Chinese), portable data format reference, architecture diagram, English contributor overview, and a superseded-decisions index in `DECISIONS.md`; `WORK_ITEMS.md` refreshed. The pending-UI test now waits for the back-to-top button to disappear instead of racing React 19's update.
- Merged Dependabot updates (React 19, Electron 45, `@types/node` 26, `tsx`, GitHub Actions) were checked: after importing a settings package the page reload was blocked by a native "discard unsaved changes?" dialog, because React 19 no longer applies a state update made after an `await` before a timer callback runs. The import now commits the state first (`flushSync`) and then reloads.
- UI tests no longer pop windows over your work: in test mode (`MEDIA_VIEWER_TEST_DATA`) the app window is fully transparent, click-through, not activated and not in the taskbar, yet still rendered normally. Set `MEDIA_VIEWER_TEST_VISIBLE=1` to watch a test run.
- `pnpm clean:test` and the test runner skip folders that are still in use instead of failing.
- README (all languages) now says the project is close to its first release instead of being in an early development stage; `SECURITY.md` no longer mentions an early-development state.
- Workflow: changes are collected here and the version number is only raised when a release is made. A shared git hook (`.githooks/pre-commit`, enabled by `pnpm install`) runs the type check, the format check and the link check of the Markdown being committed; slow tests stay manual.
- The UI test runner first stops Electron processes left over from an interrupted run (only those started from this project's `node_modules`). CI also runs the UI smoke tests in a separate, non-blocking job and uploads the screenshots on failure.
- `src/index.html`, `release/` and `build/` are ignored by Prettier, so formatting no longer touches them.
- `CLAUDE.md` and the workflow prompt record the new rules: push after passing checks and ask only for minor/major version bumps, acceptance checklist with screenshots for every batch, independent review only for high-risk changes, translations in the same batch, and suggesting a new conversation after a big topic.

## 0.38.0 — 2026-11-02

- First packaged build: `pnpm dist` creates `release/Morph-Setup-<version>.exe` (installer) and `release/Morph-Portable-<version>.exe` (no installation) with electron-builder; `pnpm dist:dir` only makes the unpacked folder. The licence, notice and name policy files are placed next to the program. The builds are not code-signed, so Windows SmartScreen will warn on first run.

## 0.37.2 — 2026-11-02

- Public-release tidy-up: the documentation no longer names the maintainer's real game folders or collection paths (examples use neutral sample names, tests included), and the AI-generated reference pictures in `docs/design/explorations` were removed.
- README notes that some supported sites carry adult content and that using them is up to the user; added `SECURITY.md` (private vulnerability reporting), `CONTRIBUTING.md` and a weekly Dependabot configuration.
- `AGENTS.md` now only points to `CLAUDE.md`, which is the single source of the working rules.
- 76 interface strings that nothing references any more were removed from the translation file; unused imports were removed and `noUnusedLocals` is now on.
- Theme contrast is checked by a test (WCAG AA for text pairs in all three themes); the secondary text colour of the glass and paper themes is slightly darker to pass.

## 0.37.1 — 2026-11-02

- `Library` and `Explorer` were split by feature into sibling modules (scan, field removal, project removal, cleanup, legacy import; content, streaming and thumbnails, external sources, overview). The classes keep thin wrappers, so callers and behaviour are unchanged.
- The UI test runner deletes the files a passing run created in `.test-output` (failures keep theirs); `pnpm clean:test` clears the leftovers of earlier runs and keeps the fixtures cache.
- README: states that the project is human-led and the code is written by AI coding agents.

## 0.37.0 — 2026-11-02

- Open-source licensing: the code is GPL-3.0-or-later (`LICENSE`, `NOTICE.md`); the name "M:orph" and the logo are excluded and covered by `TRADEMARK.md`, so a modified version cannot just swap the logo and be published as the official one.
- README in English, Traditional Chinese, Simplified Chinese, Japanese and Spanish, with a language switcher.
- Package renamed to `morph` (product name "Morph"); the window title is "M:orph". The data folder in `%APPDATA%` stays `media-viewer` so no settings are lost, and the hidden `.media-viewer` record folder is unchanged.

## 0.36.0 — 2026-11-02

- New product identity: **M:orph** (subtitle "Media Browser"). The mark — a blocky M with the colon in its notch — replaces the book icon in the title bar and is drawn in the current text colour, so it suits all three themes.
- Windows app icon: `build/icon.ico` (16 to 256 px, with a heavier drawing for the small sizes) and `build/icon.png`, used for the taskbar and Alt+Tab; `scripts/render-icons.cjs` regenerates them from `docs/brand`.
- README rewritten around the new name and mark (light and dark versions on GitHub).

## 0.35.0 — 2026-11-02

- More component styles in the editor's Style section: five text sizes, text weight (light/normal/bold), italic, underline and strikethrough, vertical alignment, and a "More styles" group with padding, corner radius, border (thickness and colour), opacity, line spacing and letter spacing.
- Ready-made looks (heading, secondary note, highlight) and "clear styles (keep colours)" from one menu.
- Tag cells can colour tags by category (female, male, language…) and hide the category prefix.
- Single-choice fields can give each option its own badge colour.

## 0.34.0 — 2026-11-02

- Importing information from a website now needs only the address: the source is recognised from it (shown as a badge), and "Get preview" is enabled only for a known site. The separate source picker is gone.

## 0.33.2 — 2026-11-02

- Moved the file type table and the file probe out of the explorer module into `electron/media-files.ts` (no behaviour change).

## 0.33.1 — 2026-11-02

- Added a GitHub Actions workflow (Windows) that runs typecheck, format check and the data tests on every push.
- The UI test runner repeats a failing test once and marks a second-run pass as FLAKY.
- The legacy import code no longer uses untyped data.

## 0.33.0 — 2026-11-02

- Explanations moved into small "?" icons with tooltips instead of text lines in settings, the component inspector and the new fallback sections.
- Game boundaries are marked with a flag icon (cards, table, tree); the words are in the tooltip.
- The editor's field list shows the previewed folder's current value for each field on one line (full value on hover), so the real data is visible without placing a component.
- New interface strings are translated into all languages; the Windows ACL test uses absolute system paths.

## 0.32.1 — 2026-11-02

- A game's action row now shows only the buttons that are bound in that folder; the eye icon in the folder settings can still hide any of them for that game. An action that is not bound yet has its eye disabled with an explanation.

## 0.32.0 — 2026-11-02

- Opening a folder in the right panel is much faster on Windows: the hidden/system-attribute check no longer starts a new PowerShell for every listing (about 0.6 s each); one helper is kept running and started when the app opens.
- Tag cells that do not scroll show the tags that fit followed by a "+N" badge, with the full list in the tooltip.
- Game folder settings: an eye icon on each action hides or shows that button in this game's action row (the binding is kept).
- Searching a field also finds values stored in the fallback fields that cells list after it, without indexing anything extra.

## 0.31.0 — 2026-11-02

- Image cells can show the folder's n-th image file (sorted by name, direct files only) when no picture was picked by hand for that folder; useful for manga (first page) while media folders keep picking by hand. A folder without that image shows an empty placeholder.

## 0.30.0 — 2026-11-02

- Text, tag and layout-text cells have an option "scroll when the content is long": the cell keeps its height and its content scrolls (mouse wheel or keyboard) instead of being cut off.

## 0.29.0 — 2026-11-02

- E-Hentai and ExHentai are treated as one site: both import into the same `eh-` fields (fields saved earlier under `exh-` are taken over on the next import).
- Gallery tags are also split by namespace into their own fields: language, parody, character, artist, group, cosplayer, female, male, mixed, other and reclass. The full tag list is kept as before.

## 0.28.0 — 2026-11-02

- The launch-game cell can list fallback actions: it starts the first action that the folder has a target bound for, so one cell covers games started from an EXE and games started from a shortcut. The button shows the label of the action actually used.

## 0.27.1 — 2026-11-02

- Fallback fields can also be picked from the fields that exist in the folders' records but are not in the project yet (they are added to the project when chosen).
- Palette drag picture is now drawn by the app and follows the cursor with its middle under the pointer, instead of the system picture that landed below it.

## 0.27.0 — 2026-11-02

- Field cells can list fallback fields: the first field in order that has a value is shown, so one cell can cover the same meaning from different source sites (Steam, DLsite…) without copying data.
- Dragging a component from the palette now keeps the cursor in the middle of the dragged picture instead of leaving it hanging below.

## 0.26.0 — 2026-11-02

- The folder-list filter (all folders / boundary folders) and the right panel's file scope (current folder / with subfolders), file type, layout and source grouping are now saved per project and restored after closing the panel or leaving the project.

## 0.25.0 — 2026-11-02

- New action type "shortcut" for game folders: pick a `.lnk`/`.url` that sits inside the game folder (for example one made by Locale Emulator) and run it through the system, keeping its own arguments.
- The launch-game cell can choose which action it starts, and falls back to another launcher when the default launch action was deleted.
- Launch arguments: Windows paths pasted with single backslashes are accepted, and other JSON mistakes get a plain explanation with an example.
- The "new field" dialog lost its extra blank space and divider.

## 0.24.0 — 2026-11-02

- A single click on a folder (card, table row or tree node) now shows that folder's details in the right panel without entering it; a double click still enters it. Game info is visible while the center stays where it is.

## 0.23.0 — 2026-11-02

- New "launch game" cell for game projects: a button on the card that starts the game with the folder's bound launch file (disabled with a hint while nothing is bound, confirmation before starting, same validation as the game page).

## 0.22.0 — 2026-11-02

- Cover and image cells have a third fit, "show everything, fill the gaps with a blurred background" (`blur`). Game cover cells use it by default, so tall and wide covers are no longer cropped (titles stay visible); cells that explicitly chose "fill and crop" or "show whole" keep their choice.

## 0.21.0 — 2026-11-02

- Video playback failures now say the likely cause (a ZIP/RAR/7z archive or web page named like a video, or an empty file) and offer "open with the default player" and "show in File Explorer".
- Game page: a candidate game gets "confirm as a game" / "not a game" buttons, and a missing launch file explains why Launch is unavailable with a shortcut to set it.
- Editor: "+ New field" is a button opening a dialog (the form was below the fold), the title and hints use one term ("積木編輯器").
- The panel's back/forward icons repeat the center's only when the panel covers the center; paper theme tabs have readable contrast; the tree minimap appears only for larger trees; an empty favorites section is one line; the search dialog explains saved searches and the disabled save button; the create dialog no longer shows "unsaved" while merely open; the narrow-window veil is lighter.

## 0.20.2 — 2026-11-01

- The folder icon in the right panel header now opens the folder in Windows Explorer (it used to only navigate inside the app, which looked like "nothing happened").

## 0.20.1 — 2026-11-01

- Video previews are now generated at up to 480 px (was 160×90) and JPEG quality 85, so they stay sharp at tile size; previously cached low-resolution video previews are regenerated automatically.

## 0.20.0 — 2026-11-01

- Game detection now recognises Japanese visual-novel engines (Artemis, AI6WIN, BGI/Ethornell, ONScripter/NScripter, RealLive/AVG32, SiglusEngine, YU-RIS, Nitroplus NPA), and lists `.npk`-packaged and Steam releases of unknown engines as candidates. A game folder is now protected instead of publishing its internal folders (backups, patches, `files`, `data`) as folders of their own.

## 0.19.0 — 2026-11-01

- Opening a project lists the root's folders instead of one lone root card; a folder without subfolders shows its own card instead of an empty page.
- CARD display settings (levels, cards per row, page size) moved into one "card display settings" popover with a summary button, freeing a toolbar row.
- On narrow windows the overlaid right panel dims the folder list behind it, and clicking the dimmed area closes the panel.
- Create-project dialog: the default name follows the interface language (it showed English in Chinese), and a line says what is still missing before "create" is enabled.

## 0.18.1 — 2026-11-01

- Tooling only: `pnpm shot` can switch the real app theme (`--theme dark|glass|paper`), stay on the home screen (`--home`), click a button (`--click`) and press a key (`--press`).

## 0.18.0 — 2026-11-01

- Error and recovery experience: system errors (permission, file in use, disk full, not found, offline, revision conflict) now say what happened and what to do next, with the original text under "technical details".
- Uncaught async failures show a toast instead of vanishing; interrupted work (aborts) stays quiet.
- A render failure shows a recovery screen with a reload button instead of a blank window, and a crashed renderer reloads automatically.
- Docs: stale references to removed groups, tests and the drawer cleaned up; architecture and test tables list the split editor and browse components.

## 0.17.2 — 2026-11-01

- Refactor only: `BrowseWorkspace.tsx` (1450 → 999 lines) is split into `BrowseToolbar.tsx` and `BrowsePanel.tsx`; behavior is unchanged.

## 0.17.1 — 2026-11-01

- Refactor only: the CELL editor is split into `Editor.tsx` (1632 → 847 lines), `EditorInspector.tsx` and `EditorPalette.tsx`; behavior is unchanged.
- Tests: cell-editor-ui retries missed drags instead of failing on a busy machine.

## 0.17.0 — 2026-11-01

- CELL: long-text wrapping (name, path and text cells), text size (S/M/L) and alignment for every cell, decimals and unit text for number cells, and greater/less display conditions for number and date fields.

## 0.16.0 — 2026-11-01

- CELL editor: rename fields from the field list or the inspector (display name only; duplicate names refused inline).
- Single-choice options in use cannot be removed (usage counts shown); enum display conditions compare against a dropdown of the options.
- Inspector grouped into collapsible Content / Condition / Position / Style sections with the remove button beside the title; position inputs keep X + width within 12 columns.
- Clearer names and hints: "版面文字" (layout text) vs "文字欄位" (text field), one-line purpose tooltips, field-type descriptions in the new-field form, and guidance when nothing is selected or the canvas is empty.

## 0.15.1 — 2026-11-01

- Tooling only: `.gitattributes` normalizes line endings to LF; `pnpm test:ui:smoke` / `test:ui:changed` pick UI tests by changed files; `pnpm shot` takes a screenshot of sample data in one command; test helpers report failures and delete their own folders.

## 0.15.0 — 2026-11-01

- Remove CELL groups (older projects load without them) and the video project autoplay/auto-next fields.
- Game page toolbar: below 620px the boundary-folder filter becomes an icon menu so tools no longer overlap.
- History navigation keeps working while folder settings are open; settings follow the folder.

## 0.14.0 — 2026-11-01

- Folder settings always dock into the right panel as a tab (drawer and dock toggle removed), follow the folder being viewed, and have a close icon in the tab row.
- Copy full path now works (clipboard write moved to the main process).
- Manga page no longer repeats the folder name and path; the game page uses the same spacing and framing as other folder pages.
- The game boundary-folder filter moved into the top toolbar, next to the layout selector.

## 0.13.5 — 2026-11-01

- Error toasts no longer show Electron's "Error invoking remote method" prefix; only the cause is shown.
- The folder page's subfolder list is height-limited and scrolls, so a folder with many subfolders no longer pushes its files out of view.
- Tests: workspace-ui, workspace-polish-ui, media-feedback-ui, gallery-performance-ui, appearance-ui and video-player-ui follow the current folder page, playback queue and inline CARD controls; drag-and-drop steps retry instead of flaking; add `pnpm test:ui:all` and remove the historical media-final-ui and ui-smoke harnesses.

## 0.13.4 — 2026-11-01

- Fix the right panel collapsing to zero width for video folders (mixed media browser inside the video panel), so the file list is readable again.
- Tests: remove obsolete editing-ui, stages-ui, shell-ui and the video auto-next/lifecycle groups; update appearance-ui and video-player-ui to the unified folder page and fix a reset race.

## 0.13.3 — 2026-11-01

- Group editing is visibly distinct (accent border and tinted bar), shows the group's 12 × N capacity with used and free rows, and the group inspector states the minimum height set by its contents.

## 0.13.2 — 2026-11-01

- Add Prettier as a dev dependency with format and format:check scripts, and format all TypeScript sources and tests (formatting only, no behaviour change).

## 0.13.1 — 2026-11-01

- DocumentViewer now uses the shared full-window overlay frame.
- Fix the folder settings drawer losing its accessible name after the dock toggle was added (the toggle moved into the drawer body).

## 0.13.0 — 2026-11-01

- Fix non-game folders in game projects showing a bare name/path card; every folder page now shares the details / subfolders / files frame.
- Add one-level CELL groups with an inner editing mode.
- Refactor: RightPanel frame, shared overlay-frame, FileMenu and ViewToggle components, shared UI test harness.

## 0.12.0 — 2026-11-01

- Folder settings can be docked as a tab in the right panel (content | settings) with a per-project preference; narrow windows fall back to the drawer.

## 0.11.1 — 2026-11-01

- Fix the game cover cell and image cells not filling their container when resized; add an image fit option (fill/crop or show whole) with fill as the default for game covers.

## 0.11.0 — 2026-11-01

- Queue panel: the toolbar badge is no longer clipped, both tabs share list/image views, auto-advance is an icon toggle, and counts read "N items" / "N files".
- Add a game cover image URL import (preview, confirm, portable asset) with main-process download limits that reject private addresses, credentials, unsupported content and oversized files.
- Add the "game cover" base cell for game projects in the block editor.
- Add DLsite as a metadata source (exact product URL; FANZA is not supported).
- File context menu with file info; friendly file type names; aligned folder text in the reader toolbar; pagination buttons get accessible names; narrow media toolbars can switch the display mode from the more-options menu.
- Remove the obsolete media-ui test and stale video-viewer queue assertions.

## 0.10.0 — 2026-11-01

- Queue: single click only plays (unqueued files are trial playback); right-click, Ctrl/Shift multi-select and Shift+arrows add to the queue; the queue entry moves to the top toolbar; the queue panel offers list and image views.
- Fix the mini player moving the native window when dragged over the title bar.
- Add a collapsed folder-details section and a shared subfolder list across media and manga pages.
- Archive legacy POC and stage documents under docs/archive; add CLAUDE.md for Claude Code.
- Commit previously pending game-detection, navigation and App changes.

## 0.9.0 — 2026-10-30

- Add a unified media workspace with source-aware cross-folder browsing, collapsible source groups and virtualized file layouts.
- Add shared audio/video playback, cross-project mixed queues, independent duplicate entries, drag ordering, removal and optional auto-advance.
- Add a draggable in-app mini player with edge snapping, background playback and playback continuity across project and window changes.
- Add MP3 playback and embedded artwork extraction; fix StrictMode source cleanup that left music duration at zero and playback unresponsive.
- Display audio volume on a 0–100 scale and improve the visibility of unfilled slider tracks across themes.
- Share folder back/forward history across panes and accept both native and DOM mouse side-button events with duplicate suppression.
- Add per-project conversion previews, atomic backups and original-category restoration; preserve project/folder identity, templates and original media.
- Retire legacy categories from project creation while keeping compatible reads and applicable single-file previews.
- Keep unsupported files visible without opening unsupported full-screen previews; retain queue transitions, source validation and file visibility controls.
- Refine Agent task batching, focused reading and verification rules; expand controlled-data and Electron UI regression coverage.

Known follow-ups: S9–S12 cover manual-only queue addition, folder-details presentation, queue UI redesign and mini-player dragging near the native title bar. These requests are recorded but are not included as implemented fixes. Physical mouse drivers, sound output and other platforms still require user acceptance.

Portable record `schemaVersion` remains 1. Optional `mediaSourceCategory` preserves legacy template selection during conversion. No bulk scan, migration or cleanup of actual user collections accompanies this release.

## 0.8.0 — 2026-10-29

- Consolidate folder/file tools, expose CARD controls inline and add persistent TABLE column visibility.
- Redesign saved searches with inline creation, matching and deletion while preserving stable query identities.
- Add status badges, rating/progress displays, field-value copying and conditional CELL content using existing field types.
- Correct palette and canvas drag coordinates; improve editor and folder-settings layout and shared overlay backgrounds.
- Add explicit game launch defaults, application/file and URL actions, per-action arguments, contextual settings and drag ordering.
- Fix shared reader hit areas, directional navigation, page selection and zoom reset; preserve manga work boundaries in file overview.
- Add confirmed field deletion and full project-data removal with impact previews, verified external backups and guarded recovery.
- Streamline Agent instructions and task navigation; add controlled data and Electron regression coverage.

Portable record schemaVersion remains 1 with optional validated capabilities. Original media is retained; no actual collection migration or scan accompanies this release. Music playback, nested containers and native macOS game launching remain deferred.

## 0.7.0 — 2026-10-29

- Add dark, glass-white and paper themes, five UI languages, shared SVG icons and system-language defaults.
- Add a paged, virtualized file overview with thumbnails, source grouping, full-path lists and source-aware previews.
- Fix large file-list scroll crashes caused by deferred event access; show an empty state for filters with no matches.
- Add read-only ZIP/CBZ image reading and the native Chromium PDF viewer without extracting or modifying original documents.
- Add static-text, spacer and cached system-information components, plus boolean, enum, URL and date-only fields.
- Add layout creation, copying, renaming, deletion, draft protection, undo/redo and per-folder assignment to project schemes.
- Add settings export/import with an explicit allowlist, difference previews, merge/replace modes and recoverable backups.
- Expand metadata selection to 11 grouped, no-key sources with provenance, fill/replace previews and manual-value protection; exclude IGDB and TMDB.
- Redesign video controls with hover volume, inline subtitle groups, playback speed, fullscreen and optional cancellable auto-next.
- Add stable saved-query field identities and numeric/date comparisons; preserve ambiguous legacy queries for explicit review.
- Strengthen embedded NW.js/WOLF runtime boundaries and ancestor protection; refactor validation, playback and search-index synchronization.
- Add controlled-data and Electron UI regression coverage, including image/video lists with 1,200 files each.

Portable record `schemaVersion` remains 1. No bulk migration or scan of actual user collections is performed by this version bump.

Known limitations: live metadata-site/login access, media-format and game-engine variants still need real samples. Native macOS game launching is not implemented. Music playback, cloud sync and nested component groups remain deferred. See `docs/WORK_ITEMS.md`.

## 0.6.0 — 2026-10-27

- Add group renaming, drag ordering and contextual hover actions in the project sidebar.
- Synchronize CARD/TABLE/TREE folder locations with backslash breadcrumbs; add draggable TABLE columns and collapsible TREE branches.
- Refine CARD display controls, folder settings tabs and advanced data-management options.
- Add CELL dividers, Delete-key removal, multiple optional image slots and clearer field/component palettes.
- Keep manga content layouts independent of CARD layouts; add validated Steam metadata preview/import alongside E-Hentai.
- Add project-removal previews, verified local recovery copies and safe cleanup of unused empty root metadata; preserve shared data, other projects and original media.
- Improve recreation/relink errors around missing folder records and archived project settings without silently replacing recoverable identities.
- Extend recognized game-runtime layouts and ancestor-boundary protection, including nested Tyrano deployments and macOS app bundles.
- Add progressive album/manga content loading, viewport-based gallery rendering and asynchronous thumbnail decoding over scoped media streams.
- Prioritize cached thumbnails, coalesce duplicate work, skip cancelled queued jobs and throttle cache maintenance; stabilize image geometry while scrolling.
- Improve manga fullscreen reading, zoom/pan, page selection and spread transitions; keep navigation icons fixed when RTL key bindings change.
- Add per-project video autoplay preferences, release playback sources on navigation and combine subtitle settings under an icon-only video settings menu.
- Remove resume prompts and full-video control shading; support horizontal mouse-wheel scrolling in the video strip.
- Simplify folder search, move advanced controls out of the primary flow and reduce routine success notifications.
- Remove the default TITLE field from new projects, retain existing data and expose F12 DevTools access.
- Update focused documentation and controlled-data regression, reader and gallery-performance coverage.

Portable record `schemaVersion` remains 1. No bulk migration of user collections is performed by this version bump.

Known limitations: some embedded NW.js and unpacked/mixed WOLF RPG layouts remain unrecognized. Native macOS game launching is not implemented; app-bundle detection does not imply launch support. See `docs/WORK_ITEMS.md` for outstanding work.

## 0.5.0 — 2026-10-27

- Add CARD-only layout presets and display controls, with multi-level/all-depth and single-level browsing.
- Keep TREE branches visible when opening content; retain folder-by-folder navigation in TABLE.
- Add independent content panes, persistent visibility, a root-content default and separate folder settings.
- Refine sidebar drag ordering, hover actions, combined settings and a neutral bottom create command.
- Separate folder selection from project creation; order the form by name, category, folder and group.
- Check folder records and game boundaries before navigation; never create records as a navigation side effect.
- Restore the game cover, custom actions and field-table layout.
- Add Chromium thumbnail decoding fallback, coalesced requests, recoverable caches and original-image fallback; extend image recognition to BMP, AVIF and ICO.
- Normalize fractional resize values before validating and saving workspace preferences.
- Exclude case-renamed metadata directories from all-depth scans on Windows.
- Preserve legacy scan limits until explicitly expanded; add optional, backward-compatible project/display preferences without bulk migration.

## 0.4.0 — prior milestone, backfilled on 2026-10-27

This development milestone previously remained at version 0.3.0. These notes
document the implemented work; no historical release or Git tag is implied.

- Introduce the desktop shell, project groups, favorites and manual ordering.
- Add CARD/TABLE/TREE browsing, typed fields, SQLite substring search, saved searches and batch edits.
- Add album/manga viewers, game detection/actions, video playback and SRT/VTT subtitles.
- Add E-Hentai metadata preview/import and portable media-specific preferences.
- Split heavy viewers into lazy-loaded chunks and retain portable records as the source of truth.

## 0.3.0 — initial POC

- Electron + React + Vite folder viewer, portable folder metadata and custom CELL layouts.
- Recovery, reconnect, cleanup and controlled-data acceptance tests.
