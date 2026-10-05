import {acceptanceCandidate,acceptAnswer,QUESTION_LIFETIME} from './lifecycle.mjs';
import {randomBytes} from 'node:crypto';
import {verifyMessage} from 'quais';
import {requireProfile,allowed,createQuestion,replyToThread} from './threads.mjs';
const fail=(status,message)=>Object.assign(new Error(message),{status});

export async function prepareAction(db,account,session,path,input,origin,now){
  (await requireProfile(db,account));
  if(typeof path!=='string')throw fail(400,'Choose a question or reply to sign.');
  const reply=path.match(/^\/api\/questions\/([a-f0-9-]{36})\/replies$/);
  const accepting=path.match(/^\/api\/questions\/([a-f0-9-]{36})\/accept$/);
  if(path!=='/api/questions'&&!reply&&!accepting)throw fail(400,'Choose a question or reply to sign.');
  const limit=reply?2000:4000;
  if(!accepting&&(typeof input?.body!=='string'||!input.body.trim()||input.body.trim().length>limit))throw fail(400,`Enter a message between 1 and ${limit} characters.`);
  const payload=accepting?{replyId:input?.replyId,version:input?.version}:{body:input.body.trim()};let context;
  if(accepting){const {q,r}=(await acceptanceCandidate(db,account,accepting[1],payload.replyId,payload.version,now));context=`Question ID: ${q.id}\nQuestion: ${q.body}\nAnswer ID: ${r.id}\nAnswer version: ${r.version}\nAnswer: ${r.body}\n\nI accept this as the best, satisfactory answer. Close this conversation and send the question and selected answer to the administrator for manual reward review. This cannot be undone. No payment is authorized.`;}
  else if(reply){const question=(await allowed(db,reply[1],account));if(question.created_at+QUESTION_LIFETIME<=now)throw fail(409,'This conversation has expired.');context=`Question ID: ${question.id}\nQuestion: ${question.body}`;}
  else{
    const raw=input.categoryIds??[input.categoryId];
    if(!Array.isArray(raw)||!raw.length||raw.length>100||raw.some(id=>!Number.isSafeInteger(id)))throw fail(400,'Choose at least one existing topic (up to 100).');
    payload.categoryIds=[...new Set(raw)].sort((a,b)=>a-b);
    const topics=(await Promise.all(payload.categoryIds.map(async id=>(await db.prepare("SELECT name,kind FROM categories WHERE id=$1").get(id)))));
    if(topics.some(topic=>!topic))throw fail(400,'Choose at least one existing topic (up to 100).');
    context='Topics: '+topics.map((topic,i)=>`${topic.name} (${topic.kind}, #${payload.categoryIds[i]})`).join(', ');
  }
  const id=randomBytes(32).toString('hex'),expires=now+300000;
  const message=`Neuron Storm — ${accepting?'accept best answer':reply?'post reply':'send question'}\n\nWebsite: ${origin}\nWallet: ${account.address}\n${context}\n\nMessage:\n${accepting?'Accept and close the conversation.':payload.body}\n\nThis signature authorizes only this message. No transaction or transfer of funds.\nOne-time code: ${id}\nExpires at: ${new Date(expires).toISOString()}`;
  (await db.prepare("DELETE FROM signed_actions WHERE expires<$1 AND (completed IS NULL OR completed<$2)").run(now,now-86400000));
  (await db.prepare("INSERT INTO signed_actions(id,address,session_hash,path,payload,message,expires) VALUES($1,$2,$3,$4,$5,$6,$7)").run(id,account.address.toLowerCase(),session,path,JSON.stringify(payload),message,expires));
  return {id,message};
}
export async function submitAction(db,account,session,path,input,now){
 return db.transaction(async () => {
 await db.lock("action:"+account?.address.toLowerCase());

  (await requireProfile(db,account));
  if(typeof input.actionId!=='string'||typeof input.signature!=='string'||input.signature.length>300)throw fail(400,'Confirm this message in Pelagus before sending.');
  const row=(await db.prepare("SELECT * FROM signed_actions WHERE id=$1 AND address=$2 AND session_hash=$3 AND path=$4").get(input.actionId,account.address.toLowerCase(),session,path));
  if(!row)throw fail(403,'This signed request does not belong to this session or conversation.');
  let recovered;try{recovered=verifyMessage(row.message,input.signature).toLowerCase();}catch{throw fail(403,'The message signature could not be verified.');}
  if(recovered!==row.address)throw fail(403,'The message signature does not match your account.');
  // A retry returns the original result, never writes a second message.
  if(row.result)return JSON.parse(row.result);
  if(row.expires<=now)throw fail(409,'This signing request expired. Please sign the message again.');
  const payload=JSON.parse(row.payload),reply=path.match(/^\/api\/questions\/([a-f0-9-]{36})\/replies$/);
  const accepting=path.match(/^\/api\/questions\/([a-f0-9-]{36})\/accept$/);
  if(reply)(await allowed(db,reply[1],account));

  try{
    // Also cover accidental repeat submissions from a second tab/new challenge.
    const previous=(await db.prepare("SELECT result FROM signed_actions WHERE address=$1 AND path=$2 AND payload=$3 AND completed>$4 AND result IS NOT NULL ORDER BY completed DESC LIMIT 1").get(row.address,path,row.payload,now-120000));
    const result=previous?JSON.parse(previous.result):accepting?(await acceptAnswer(db,account,accepting[1],payload,now)):reply?(await replyToThread(db,account,reply[1],payload,now)):(await createQuestion(db,account,payload,now));
    (await db.prepare("UPDATE signed_actions SET result=$1,completed=$2 WHERE id=$3").run(JSON.stringify(result),now,row.id));
    return result;
  }catch(error){throw error;}

 });
}
