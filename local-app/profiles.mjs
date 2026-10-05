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

export async function readProfile(db, address) {
  const profile = (await db.prepare("SELECT nickname, first_name AS \"firstName\", last_name AS \"lastName\" FROM profiles WHERE address=$1").get(address));
  if (!profile) return null;
  const selected = (await db.prepare(`SELECT c.id,c.kind,c.name FROM categories c JOIN profile_categories p ON p.category_id=c.id WHERE p.address=$1 ORDER BY lower(c.name),c.id`).all(address));
  const points=(await db.prepare("SELECT count(*) AS n FROM reply_votes v JOIN replies r ON r.id=v.reply_id JOIN questions q ON q.id=r.question_id WHERE q.deleted_at IS NULL AND r.deleted_at IS NULL AND r.author=$1 AND v.value=1").get(address)).n;
  return { ...profile, points, work: selected.filter(c => c.kind === 'work').map(({id,name})=>({id,name})), hobbies: selected.filter(c => c.kind === 'hobbies').map(({id,name})=>({id,name})) };
}
export async function readCategories(db,availableOnly=false) {
  const rows=(await db.prepare(`SELECT c.id,c.kind,c.name,(SELECT count(*) FROM profile_categories pc WHERE pc.category_id=c.id) AS "memberCount" FROM categories c ${availableOnly?'WHERE EXISTS(SELECT 1 FROM profile_categories pc WHERE pc.category_id=c.id)':''} ORDER BY lower(c.name),c.id`).all());
  return {work:rows.filter(c=>c.kind==='work').map(({kind,...c})=>c),hobbies:rows.filter(c=>c.kind==='hobbies').map(({kind,...c})=>c)};
}
export async function saveProfile(db, address, input, now) {
 return db.transaction(async () => {
 await db.lock("profile:"+address);

  const nickname = text(input.nickname, 'Nickname', 40, true);
  const firstName = text(input.firstName, 'First name', 80), lastName = text(input.lastName, 'Last name', 80);
  const work = categories(input.work, 'Work & Education'), hobbies = categories(input.hobbies, 'Hobbies & Interests');
  if (!work.length && !hobbies.length) throw invalid('Choose at least one topic across Work & Education or Hobbies & Interests.');

  try {
    (await db.prepare(`INSERT INTO profiles VALUES($1,$2,$3,$4,$5) ON CONFLICT(address) DO UPDATE SET nickname=excluded.nickname,first_name=excluded.first_name,last_name=excluded.last_name,updated_at=excluded.updated_at`).run(address,nickname,firstName,lastName,now));
    (await db.prepare("DELETE FROM profile_categories WHERE address=$1").run(address));
    for (const [kind, values] of [['work',work],['hobbies',hobbies]]) {
      for (const {key,name} of [...values].sort((a,b)=>a.key.localeCompare(b.key))) {
        (await db.prepare("INSERT INTO categories(kind,name,normalized_name) VALUES($1,$2,$3) ON CONFLICT DO NOTHING").run(kind,name,key));
        const category = (await db.prepare("SELECT id FROM categories WHERE kind=$1 AND normalized_name=$2").get(kind,key));
        (await db.prepare("INSERT INTO profile_categories VALUES($1,$2)").run(address,category.id));
      }
    }

  } catch (error) {  throw error; }
  return (await readProfile(db,address));

 });
}
