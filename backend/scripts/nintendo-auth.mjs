import { readFileSync, writeFileSync } from 'node:fs'
import crypto from 'node:crypto'
import axios from 'axios'
import MoonApi from 'nxapi/moon'

const TMP = new URL('./.nintendo-auth.json', import.meta.url)
const CLIENT_ID = '54789befb391a838'
const SCOPE = [
  'openid', 'user', 'user.mii',
  'moonUser:administration', 'moonDevice:create', 'moonOwnedDevice:administration',
  'moonParentalControlSetting', 'moonParentalControlSetting:update',
  'moonParentalControlSettingState', 'moonPairingState', 'moonSmartDevice:administration',
  'moonDailySummary', 'moonMonthlySummary',
].join(' ')

const arg = process.argv[2]

if (!arg) {
  const state = crypto.randomBytes(36).toString('base64url')
  const verifier = crypto.randomBytes(32).toString('base64url')
  const challenge = crypto.createHash('sha256').update(verifier).digest().toString('base64url')
  const params = new URLSearchParams({
    state,
    redirect_uri: `npf${CLIENT_ID}://auth`,
    client_id: CLIENT_ID,
    scope: SCOPE,
    response_type: 'session_token_code',
    session_token_code_challenge: challenge,
    session_token_code_challenge_method: 'S256',
  })
  writeFileSync(TMP, JSON.stringify({ verifier, state }))
  console.log('\n=== PASSO 1 ===')
  console.log('Abra este link e faça login na sua conta Nintendo:\n')
  console.log('https://accounts.nintendo.com/connect/1.0.0/authorize?' + params.toString())
  console.log('\nDepois de logar, na pagina de selecionar a conta, clique com o BOTAO DIREITO')
  console.log('em "Selecionar esta pessoa" / "Select this person" e COPIE O LINK (comeca com npf54789...).')
  console.log('Cole esse link no chat (ou rode: node scripts/nintendo-auth.mjs "<link>")\n')
} else {
  const { verifier } = JSON.parse(readFileSync(TMP, 'utf8'))
  const code = new URLSearchParams(new URL(arg).hash.slice(1)).get('session_token_code')
  if (!code) {
    console.error('Nao achei session_token_code no link. Copiou o link certo (npf54789...)?')
    process.exit(1)
  }
  const res = await axios.post(
    'https://accounts.nintendo.com/connect/1.0.0/api/session_token',
    new URLSearchParams({
      client_id: CLIENT_ID,
      session_token_code: code,
      session_token_code_verifier: verifier,
    }).toString(),
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'OnlineLounge/2.10.0 NASDKAPI Android' } },
  )
  const sessionToken = res.data.session_token
  console.log('\n=== SESSION TOKEN (coloque no .env em NINTENDO_SESSION_TOKEN) ===\n')
  console.log(sessionToken)
  console.log('\n=== VALIDANDO NO MOON (controle parental) ===')
  try {
    const result = await MoonApi.createWithSessionToken(sessionToken)
    const moon = result.moon ?? result
    const data = result.data
    console.log('Logado como:', data?.user?.nickname ?? JSON.stringify(Object.keys(result)))
    const devices = await moon.getDevices()
    const list = devices?.devices ?? devices?.json?.devices ?? []
    console.log('Dispositivos encontrados:', list.length)
    for (const d of list) console.log('  -', d.label, '| id:', d.deviceId)
  } catch (e) {
    console.error('Falha ao validar no Moon:', e?.response?.status, e?.message ?? e)
  }
}
