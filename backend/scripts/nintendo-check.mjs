import { readFileSync } from 'node:fs'
import { addUserAgent } from 'nxapi'
import MoonApi from 'nxapi/moon'

addUserAgent('PlayVault/1.0.0 (personal)')

const env = readFileSync(new URL('../.env', import.meta.url), 'utf8')
const token = env.match(/NINTENDO_SESSION_TOKEN=(.*)/)[1].trim()

const data = await MoonApi.loginWithSessionToken(token)
data.znma_version = '9.9.9'
data.znma_build = '999'
data.znma_useragent = 'moon_ANDROID/9.9.9 (com.nintendo.znma; build:999; ANDROID 26)'
const moon = MoonApi.createWithSavedToken(data)

console.log('Logado como:', data?.user?.nickname ?? '(?)', '| id:', data?.user?.id)

try {
  const devices = await moon.getDevices()
  const list = devices?.devices ?? devices?.items ?? []
  console.log('OK! Dispositivos:', list.length)
  for (const d of list) console.log('  -', d.label, '| id:', d.deviceId)
  console.log(JSON.stringify(devices, null, 2).slice(0, 800))
} catch (e) {
  console.log('getDevices erro:', e?.response?.status, JSON.stringify(e?.data ?? e?.message)?.slice(0, 300))
}
