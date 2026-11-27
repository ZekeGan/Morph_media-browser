import { Tooltip } from '@mantine/core'

import { Icon } from '../common/icons'
import { t as tr } from '../i18n'

// A game boundary is marked with a flag; the words live in the tooltip.
export function BoundaryFlag({ detail }: { detail?: string }) {
  const label = detail ? tr('受保護的遊戲') + ' · ' + detail : tr('受保護的遊戲')
  return (
    <Tooltip label={label} withArrow>
      <span className="boundary-flag" role="img" aria-label={label} tabIndex={0}>
        <Icon name="flag" size={14} />
      </span>
    </Tooltip>
  )
}

// R-516: why a folder looks like a game is stored with the folder as the detector's sentence. Older records hold the
// wording from before R-516; it is shown in the plain wording that replaced it.
const olderEvidence: Record<string, string> = {
  // i18n-ignore: a sentence older records still hold
  '.jar + EXE／.bat／jre 啟動方式（候選）': '.jar + EXE／.bat／jre 啟動方式（尚未確認）',
  // i18n-ignore: a sentence older records still hold
  '.swf + EXE（Flash Projector 候選）': '.swf + EXE（可能是 Flash Projector，尚未確認）',
  // i18n-ignore: a sentence older records still hold
  'Data.wolf + EXE（候選）': 'Data.wolf + EXE（尚未確認）',
  // i18n-ignore: a sentence older records still hold
  'EXE + NW.js 資源／執行環境組合：可能為內嵌或封裝應用；引擎未知，暫停深入，請確認 ROOT／非遊戲':
    'EXE + NW.js 資源：可能是包裝過的程式，認不出引擎；請確認是不是遊戲',
  // i18n-ignore: a sentence older records still hold
  'EXE + resources/app.asar：封裝應用候選，不解包或推定引擎；請確認遊戲 ROOT 或標記非遊戲':
    'EXE + resources/app.asar：像是包裝過的程式，不拆開判斷；請確認是不是遊戲',
  // i18n-ignore: a sentence older records still hold
  'EXE + steam_api*.dll：Steam 發行版候選；引擎未確認，請確認 ROOT／非遊戲':
    'EXE + steam_api*.dll：可能是 Steam 上的遊戲，認不出引擎；請確認是不是遊戲',
  // i18n-ignore: a sentence older records still hold
  'EXE + 同一 Data/BasicData 的 Game.dat／DataBase.dat（未封包或混合封包候選）':
    'EXE + 同一 Data/BasicData 的 Game.dat／DataBase.dat（未封包或混合封包，尚未確認）',
  // i18n-ignore: a sentence older records still hold
  'Player.exe + Resources：Pixel Game Maker MV 候選；公開資料不足，引擎未推定，請確認 ROOT':
    'Player.exe + Resources：可能是 Pixel Game Maker MV，資料不足無法確定；請確認是不是遊戲',
  // i18n-ignore: a sentence older records still hold
  'Unity 部署線索不完整或名稱不相符；先停止，請確認 ROOT／非遊戲':
    'Unity 的檔案不完整或名稱對不上；先停下，請確認是不是遊戲',
  // i18n-ignore: a sentence older records still hold
  'c2runtime.js + EXE（候選）': 'c2runtime.js + EXE（尚未確認）',
  // i18n-ignore: a sentence older records still hold
  'data.win + EXE（候選；YYC 需人工確認）': 'data.win + EXE（尚未確認；YYC 版要自己確認）',
  // i18n-ignore: a sentence older records still hold
  'resident.dll + EXE（候選）': 'resident.dll + EXE（尚未確認）',
  // i18n-ignore: a sentence older records still hold
  '外層 EXE + resources/app 解包應用候選；遊戲結構未完整確認，暫停深入':
    '外層 EXE + resources/app：像是拆開的包裝程式，結構還不確定，先停下',
  // i18n-ignore: a sentence older records still hold
  '外層 EXE + resources/app.asar 解包應用候選；遊戲結構未完整確認，暫停深入':
    '外層 EXE + resources/app.asar：像是拆開的包裝程式，結構還不確定，先停下',
  // i18n-ignore: a sentence older records still hold
  '外層 EXE + resources/app.asar：package.json／index.html + Tyrano／KAG 核心 + Config.tjs + 劇本；ROOT 停在外層':
    '外層 EXE + resources/app.asar：package.json／index.html + Tyrano／KAG 核心 + Config.tjs + 劇本；主資料夾是外層',
  // i18n-ignore: a sentence older records still hold
  '外層 EXE + resources/app：package.json／index.html + Tyrano／KAG 核心 + Config.tjs + 劇本；ROOT 停在外層':
    '外層 EXE + resources/app：package.json／index.html + Tyrano／KAG 核心 + Config.tjs + 劇本；主資料夾是外層',
  // i18n-ignore: a sentence older records still hold
  '程式在 bin/ 內；ROOT 停在外層': '程式在 bin/ 內；主資料夾是外層',
  // i18n-ignore: a sentence older records still hold
  '解包應用候選；遊戲結構未完整確認，暫停深入': '像是拆開的包裝程式，結構還不確定，先停下',
  // i18n-ignore: a sentence older records still hold
  '跨層 Unreal 部署與啟動器名稱不相符，可能為改名遊戲或集合；需人工確認 ROOT':
    'Unreal 的檔案和啟動程式名稱對不上，可能是改過名的遊戲或合集；請確認主資料夾',
  // i18n-ignore: a sentence older records still hold
  '：package.json／index.html + Tyrano／KAG 核心 + Config.tjs + 劇本；ROOT 停在外層':
    '：package.json／index.html + Tyrano／KAG 核心 + Config.tjs + 劇本；主資料夾是外層',
  // i18n-ignore: a sentence older records still hold
  '；需人工確認 ROOT': '；請確認主資料夾',
  // i18n-ignore: a sentence older records still hold
  '遊戲邊界探測超限，請人工確認 ROOT': '檔案太多，判斷不完；請確認主資料夾',
}
export const evidenceText = (item: string) => tr(olderEvidence[item] ?? item)
