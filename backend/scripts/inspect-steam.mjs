import axios from 'axios'
import { XMLParser } from 'fast-xml-parser'

const id = process.argv[2] || '76561197960287930'
const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' })

const gamesUrl = `https://steamcommunity.com/profiles/${id}/games?tab=all&xml=1`
const { data } = await axios.get(gamesUrl, { timeout: 20000, headers: { 'User-Agent': 'Mozilla/5.0' } })
console.log('--- RAW (500) ---')
console.log(String(data).slice(0, 500))

const parsed = parser.parse(data)
const games = parsed?.gamesList?.games?.game ?? []
console.log('\nTOTAL games:', Array.isArray(games) ? games.length : (games ? 1 : 0))
const sample = (Array.isArray(games) ? games : [games]).slice(0, 5)
for (const g of sample) {
  console.log(`  appID=${g.appID} | "${g.name}" | hours=${g.hoursOnRecord ?? '-'}`)
}

const first = sample.find((g) => g.hoursOnRecord)
if (first) {
  const achUrl = `https://steamcommunity.com/profiles/${id}/stats/${first.appID}/?xml=1`
  try {
    const { data: a } = await axios.get(achUrl, { timeout: 20000, headers: { 'User-Agent': 'Mozilla/5.0' } })
    const ap = parser.parse(a)
    const ach = ap?.playerstats?.achievements?.achievement ?? []
    const list = Array.isArray(ach) ? ach : [ach]
    const earned = list.filter((x) => String(x['@_closed']) === '1').length
    console.log(`\nAchievements p/ ${first.appID}: total=${list.length} earned=${earned}`)
    console.log('sample keys:', JSON.stringify(list[0] ?? {}).slice(0, 200))
  } catch (e) {
    console.log('achievements err:', e.message)
  }
}
