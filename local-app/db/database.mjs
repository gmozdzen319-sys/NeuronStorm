import pg from 'pg';
import {AsyncLocalStorage} from 'node:async_hooks';
import {readFile, readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {walletSQL,assertV1Settled} from './wallet-generation.mjs';
import {WALLET_GENERATION} from '../wallet-infrastructure.mjs';

// Millisecond timestamps, counts and IDs stay numbers in the public API.
// Token amounts are TEXT and never pass through floating-point arithmetic.
const types = new pg.TypeOverrides();
types.setTypeParser(20, value => {
  const number = Number(value);
  if (!Number.isSafeInteger(number)) throw new Error('Database integer exceeds the safe API range.');
  return number;
});

export async function openDatabase(connectionString, {max=5,walletGeneration=WALLET_GENERATION}={}) {
  walletSQL('',walletGeneration);
  if (!connectionString || !/^postgres(?:ql)?:\/\//.test(connectionString)) {
    throw new Error('DATABASE_URL must point to PostgreSQL. SQLite fallback is disabled.');
  }
  const pool = new pg.Pool({connectionString, types, max, connectionTimeoutMillis: 10000,
    idleTimeoutMillis: 30000, statement_timeout: 30000, application_name: 'neuron-storm'});
  pool.on('error', () => console.error('A PostgreSQL connection was interrupted.'));
  const context = new AsyncLocalStorage();
  let closing;
  const rawQuery = (sql, values = []) => (context.getStore() || pool).query(sql, values);
  let routeWalletTables=false;
  const query = (sql, values = []) => rawQuery(routeWalletTables?walletSQL(sql,walletGeneration):sql,values);
  const db = {
    query,
    exec: sql => query(sql),
    prepare(sql) {
      return {
        get: async (...values) => (await query(sql, values)).rows[0],
        all: async (...values) => (await query(sql, values)).rows,
        run: async (...values) => {
          const result = await query(sql, values);
          return {changes: result.rowCount, lastInsertRowid: result.rows[0]?.id};
        }
      };
    },
    async transaction(work) {
      if (context.getStore()) return work(db);
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await context.run(client, () => work(db));
        await client.query('COMMIT');
        return result;
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
      } finally { client.release(); }
    },
    async lock(key) {
      if (!context.getStore()) throw new Error('A database lock requires a transaction.');
      await query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [key]);
    },
    close: () => closing ??= pool.end()
  };
  try {
    await db.transaction(async () => {
      await db.lock('neuron-storm:schema');
      await db.exec('CREATE TABLE IF NOT EXISTS schema_migrations(version TEXT PRIMARY KEY, checksum TEXT NOT NULL, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())');
      const directory = new URL('./migrations/', import.meta.url);
      for (const name of (await readdir(directory)).filter(name => name.endsWith('.sql')).sort()) {
        const sql = await readFile(new URL(name, directory), 'utf8');
        const checksum = createHash('sha256').update(sql).digest('hex');
        const previous = await db.prepare('SELECT checksum FROM schema_migrations WHERE version=$1').get(name);
        if (previous) {
          if (previous.checksum !== checksum) throw new Error('An applied database migration was modified: ' + name);
          continue;
        }
        await db.exec(sql);
        await db.prepare('INSERT INTO schema_migrations(version,checksum) VALUES($1,$2)').run(name, checksum);
      }
    });
    if(walletGeneration===2)await assertV1Settled(rawQuery);
    routeWalletTables=true;
    return db;
  } catch (error) { await pool.end(); throw error; }
}
