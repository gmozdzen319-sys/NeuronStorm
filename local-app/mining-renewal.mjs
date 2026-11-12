// Mining identity only: retry discarded read-only snapshots, never transactions.
export function canonicalityChanged(error) {
  const e=error?.canonicalityEvidence;
  return error?.code==='ERR_ASSERTION' && !!e &&
    typeof e.expected?.hash==='string' && typeof e.observed?.hash==='string' &&
    e.expected.hash!==e.observed.hash &&
    e.expected.woHeader?.number===e.observed.woHeader?.number;
}
const same=(a,b)=>!!a&&!!b&&a.method===b.method&&a.id===b.id&&a.address===b.address;
export async function renewMiningIdentity({loadAccount,attest,challenge,observed,
  sleep=ms=>new Promise(r=>setTimeout(r,ms)),diagnostic=()=>{}}) {
  for(let attempt=0;attempt<3;attempt++) {
    const account=await loadAccount();
    try {
      // attest reloads the registry, approval and the entire fresh chain snapshot.
      const result=await attest(account,challenge,observed);
      if(!same(account,await loadAccount()))throw Object.assign(Error('SESSION_CHANGED'),{status:401});
      return result;
    } catch(error) {
      let code;
      if(canonicalityChanged(error))code='CANONICALITY_MISMATCH';
      else if(error?.code==='ERR_ASSERTION' && error.message==='incomplete canonical block')code='INCOMPLETE_CANONICAL_BLOCK';
      else throw error;
      diagnostic({stage:'MINING_IDENTITY_SNAPSHOT',code,attempt:attempt+1});
      if(attempt===2)throw Object.assign(Error('MINING_SNAPSHOT_RETRY'),{status:503});
      await sleep(attempt===0?100:250);
    }
  }
}
