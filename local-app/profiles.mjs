const invalid = message => Object.assign(new Error(message), { status: 400 });
export const categoryKey = name => name.normalize('NFKC').replace(/\s/gu, '').toLowerCase();
function text(value, label, max, required = false) {
  if (value === undefined && !required) return '';
  if (typeof value !== 'string') throw invalid(`${label} must be text.`);
  const clean = value.trim().replace(/\s+/gu, ' ');
  if ((required && !clean) || clean.length > max) throw invalid(`${label} ${required ? 'is required and ' : ''}must be ${max} characters or fewer.`);
  if (/[\u0000-\u001f\u007f]/u.test(clean)) throw invalid(`${label} contains unsupported characters.`);
  return clean;
}
function categories(value, label) {
  if (!Array.isArray(value) || value.length > 4) throw invalid(`${label} must contain no more than 4 topics.`);
  const unique = new Map();
  for (const item of value) {
    const name = text(item, 'Topic', 60, true), key = categoryKey(name);
    if (!key) throw invalid('Enter a topic name.');
    if (!unique.has(key)) unique.set(key, name);
  }
  return [...unique].map(([key, name]) => ({ key, name }));
}
export function initProfiles(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS profiles(
    address TEXT PRIMARY KEY REFERENCES accounts(address), nickname TEXT NOT NULL,
    first_name TEXT NOT NULL DEFAULT '', last_name TEXT NOT NULL DEFAULT '', updated_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS categories(
      id INTEGER PRIMARY KEY, kind TEXT NOT NULL CHECK(kind IN ('work','hobbies')),
      name TEXT NOT NULL, normalized_name TEXT NOT NULL, UNIQUE(kind, normalized_name));
    CREATE TABLE IF NOT EXISTS profile_categories(
      address TEXT NOT NULL REFERENCES profiles(address) ON DELETE CASCADE,
      category_id INTEGER NOT NULL REFERENCES categories(id), PRIMARY KEY(address, category_id));`);
}
export function readProfile(db, address) {
  const profile = db.prepare('SELECT nickname, first_name AS firstName, last_name AS lastName FROM profiles WHERE address=?').get(address);
  if (!profile) return null;
  const selected = db.prepare(`SELECT c.id,c.kind,c.name FROM categories c JOIN profile_categories p ON p.category_id=c.id WHERE p.address=? ORDER BY c.name COLLATE NOCASE,c.id`).all(address);
  const points=db.prepare('SELECT count(*) AS n FROM reply_votes v JOIN replies r ON r.id=v.reply_id JOIN questions q ON q.id=r.question_id WHERE q.deleted_at IS NULL AND r.deleted_at IS NULL AND r.author=? AND v.value=1').get(address).n;
  return { ...profile, points, work: selected.filter(c => c.kind === 'work').map(({id,name})=>({id,name})), hobbies: selected.filter(c => c.kind === 'hobbies').map(({id,name})=>({id,name})) };
}
export function readCategories(db,availableOnly=false) {
  const rows = db.prepare(`SELECT id,kind,name FROM categories c ${availableOnly?'WHERE EXISTS(SELECT 1 FROM profile_categories pc WHERE pc.category_id=c.id)':''} ORDER BY name COLLATE NOCASE,id`).all();
  return { work: rows.filter(c=>c.kind==='work').map(({id,name})=>({id,name})), hobbies: rows.filter(c=>c.kind==='hobbies').map(({id,name})=>({id,name})) };
}
export function saveProfile(db, address, input, now) {
  const nickname = text(input.nickname, 'Nickname', 40, true);
  const firstName = text(input.firstName, 'First name', 80), lastName = text(input.lastName, 'Last name', 80);
  const work = categories(input.work, 'Work & Education'), hobbies = categories(input.hobbies, 'Hobbies & Interests');
  if (!work.length && !hobbies.length) throw invalid('Choose at least one topic across Work & Education or Hobbies & Interests.');
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare(`INSERT INTO profiles VALUES(?,?,?,?,?) ON CONFLICT(address) DO UPDATE SET nickname=excluded.nickname,first_name=excluded.first_name,last_name=excluded.last_name,updated_at=excluded.updated_at`).run(address,nickname,firstName,lastName,now);
    db.prepare('DELETE FROM profile_categories WHERE address=?').run(address);
    for (const [kind, values] of [['work',work],['hobbies',hobbies]]) {
      for (const {key,name} of values) {
        db.prepare('INSERT OR IGNORE INTO categories(kind,name,normalized_name) VALUES(?,?,?)').run(kind,name,key);
        const category = db.prepare('SELECT id FROM categories WHERE kind=? AND normalized_name=?').get(kind,key);
        db.prepare('INSERT INTO profile_categories VALUES(?,?)').run(address,category.id);
      }
    }
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
  return readProfile(db,address);
}
