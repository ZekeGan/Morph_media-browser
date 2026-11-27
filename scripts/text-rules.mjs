// Wording rules for interface text (R-515): words from the code and the specs that people do not understand, each
// with what to write instead. Mirrors the table in docs/specs/UI_RULES.md#介面文字; change both together.
// Used by scripts/check-i18n.mjs (commit check) and scripts/i18n.mjs (adding sentences).
export const banned = [
  { term: 'POC', use: '拿掉（開發用語）' },
  { term: '首輪', use: '拿掉（開發用語）' },
  { term: 'ROOT', use: '主資料夾' },
  { term: '邊界', use: '遊戲裡面（受保護）', except: /^邊界( \{0\}%)?$/ },
  { term: '綁定', use: '設定' },
  { term: '草稿', use: '還沒保存的修改' },
  { term: '型別', use: '格式' },
  { term: '原始媒體', use: '你的檔案' },
  { term: '方案', use: '外觀（卡片外觀）' },
  { term: '失效', use: '已過期／找不到' },
  { term: '候選', use: '可能是' },
  { term: '推定', use: '判斷' },
  { term: '私有覆寫', use: '只在這個專案的資訊' },
  { term: '私有值', use: '只在這個專案的資訊' },
  { term: '覆寫', use: '取代' },
  { term: '可攜', use: '資料夾資訊' },
  { term: '根記錄', use: '專案資訊' },
  { term: '引用', use: '用到' },
  { term: '資產', use: '圖片' },
  { term: '右側', use: '詳情（說實際位置時照寫）', except: /右側 ×/ },
]

// Help and tooltips stay within about two lines.
export const LONG = 40

// What is wrong with one zh-TW sentence: the banned words it uses, each with its replacement.
export function wordingProblems(text) {
  return banned
    .filter((rule) => text.includes(rule.term) && !(rule.except && rule.except.test(text)))
    .map((rule) => `「${rule.term}」→ ${rule.use}`)
}
