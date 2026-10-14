import assert from 'node:assert/strict';

// Only an expired, completely unused grant may be replaced. No budget reset.
export function assertUnusedExpiredGrant(grant,{relayer,budget,now,intentCount}){
 assert(grant,'Previous controlled grant is missing');
 assert.equal(grant.relayer,relayer);
 assert.equal(BigInt(grant.budget_wei),budget);
 assert.equal(BigInt(grant.reserved_wei),0n,'Previous grant has spending or exposure');
 assert(Number(grant.expires_at)<=now,'Previous grant is still live');
 assert.equal(Number(intentCount),0,'Previous grant has transaction history');
}
