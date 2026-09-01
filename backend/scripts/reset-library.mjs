import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath } from 'node:url'

const dbPath = fileURLToPath(new URL('../playvault.db', import.meta.url))
const db = new DatabaseSync(dbPath)

const count = (table) => db.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get().c

const snapshots = count('snapshot')
const trophies = count('title_trophies')

db.exec('DELETE FROM snapshot; DELETE FROM title_trophies;')

console.log(`Deleted ${snapshots} snapshot(s) and ${trophies} stored trophy title(s).`)
console.log('Kept: users, connections, backlog, currently playing, manual (Switch) games, beaten flags, ratings.')

db.close()
