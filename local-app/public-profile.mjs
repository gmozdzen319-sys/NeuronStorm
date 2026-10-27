import {allowed,requireProfile} from './threads.mjs';
import {isBlocked} from './contact-preferences.mjs';
import {fileMetadata} from './content-files.mjs';
import {verificationFields} from './verification.mjs';
import {reputation} from './reputation.mjs';
import {activityPoints} from './daily-activity.mjs';
const missing=()=>Object.assign(new Error('This profile is not available.'),{status:404});
export async function conversationProfile(db,account,questionId,params){
 await requireProfile(db,account);
 const question=await allowed(db,questionId,account);
 const reply=params.get('reply'),message=params.get('message');
 if((reply&&message)||[reply,message].some(v=>v!==null&&!/^[1-9][0-9]{0,14}$/.test(v)))throw missing();
 let address=question.author;
 if(reply||message){
  const row=await db.prepare(reply?'SELECT author FROM replies WHERE question_id=$1 AND id=$2 AND deleted_at IS NULL':'SELECT author FROM debate_messages WHERE question_id=$1 AND id=$2').get(questionId,Number(reply||message));
  if(!row)throw missing();address=row.author;
 }
 if(await isBlocked(db,account.address.toLowerCase(),address))throw missing();
 const profile=await db.prepare('SELECT nickname FROM profiles WHERE address=$1').get(address);if(!profile)throw missing();
 const topics=await db.prepare('SELECT c.id,c.kind,c.name FROM categories c JOIN profile_categories p ON p.category_id=c.id WHERE p.address=$1 ORDER BY lower(c.name),c.id').all(address);
 const score=await reputation(db,address),avatar=(await fileMetadata(db,'avatar',address))[0];
 // Explicit public field allowlist. No account, wallet or credential data.
 return {nickname:profile.nickname,avatar:avatar?{id:avatar.id}:null,work:topics.filter(t=>t.kind==='work').map(({id,name})=>({id,name})),hobbies:topics.filter(t=>t.kind==='hobbies').map(({id,name})=>({id,name})),points:score.units/100,activityPoints:await activityPoints(db,address),verification:(await verificationFields(db,address,Date.now())).map(({name,percent,verified})=>({name,percent,verified}))};
}
