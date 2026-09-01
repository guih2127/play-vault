import { readFileSync } from 'node:fs'
import {
  exchangeNpssoForCode,
  exchangeCodeForAccessToken,
  getUserPlayedGames,
  getUserTitles,
} from 'psn-api'

const env = readFileSync(new URL('../.env', import.meta.url), 'utf8')
const npsso = env.match(/PSN_NPSSO=(.*)/)[1].trim()
const code = await exchangeNpssoForCode(npsso)
const auth = await exchangeCodeForAccessToken(code)
const authorization = { accessToken: auth.accessToken }

const played = []
let offset = 0
for (;;) {
  const res = await getUserPlayedGames(authorization, 'me', { limit: 200, offset })
  const titles = res?.titles ?? []
  played.push(...titles)
  offset += titles.length
  if (titles.length === 0 || offset >= (res?.totalItemCount ?? 0)) break
}

const trophies = []
offset = 0
for (;;) {
  const res = await getUserTitles(authorization, 'me', { limit: 100, offset })
  const titles = res?.trophyTitles ?? []
  trophies.push(...titles)
  offset += titles.length
  if (titles.length === 0 || offset >= (res?.totalItemCount ?? 0)) break
}

console.log(`TOTAL played=${played.length} trophyTitles=${trophies.length}`)
const platCount = trophies.filter((t) => (t.earnedTrophies?.platinum ?? 0) > 0).length
const platSum = trophies.reduce((s, t) => s + (t.earnedTrophies?.platinum ?? 0), 0)
console.log(`PLATINAS: titulos com platina=${platCount} | soma platinum=${platSum}`)
console.log('=== TROPHY TITLES MAIS RECENTES ===')
for (const t of trophies.slice(0, 15)) {
  console.log(`  "${t.trophyTitleName}" | plat=${t.trophyTitlePlatform} | ${sum(t.earnedTrophies)}/${sum(t.definedTrophies)} | updated=${t.lastUpdatedDateTime}`)
}

console.log('=== CATEGORIA unknown/not_found (com titleId) ===')
for (const t of played.filter((t) => t.category === 'unknown' || t.category === 'not_found')) {
  console.log(`  "${t.name}" | cat=${t.category} | titleId=${t.titleId}`)
}

const search = /uncharted/i
console.log('=== PLAYED ===')
for (const t of played.filter((t) => search.test(t.name))) {
  console.log(`  "${t.name}" | cat=${t.category} | titleId=${t.titleId} | play=${t.playDuration ?? '-'}`)
}
console.log('=== TROPHY TITLES ===')
for (const t of trophies.filter((t) => search.test(t.trophyTitleName))) {
  console.log(
    `  "${t.trophyTitleName}" | plat=${t.trophyTitlePlatform} | svc=${t.npServiceName} | ${sum(t.earnedTrophies)}/${sum(t.definedTrophies)} | id=${t.npCommunicationId} | hasGroups=${t.hasTrophyGroups}`,
  )
}

function sum(x) {
  if (!x) return 0
  return (x.bronze ?? 0) + (x.silver ?? 0) + (x.gold ?? 0) + (x.platinum ?? 0)
}
