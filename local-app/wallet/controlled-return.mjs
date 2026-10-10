// Temporary, strictly scoped sponsorship for the authorized Receive v2 test.
import assert from 'node:assert/strict';
export const RETURN=Object.freeze({
 grant:'receive-v2-return-20261010-1',account:'914c577f-226c-4f1e-a7bb-2a4235f4a1a3',
 wallet:'0x0065826010d6134DBf24a6028237a27EDD1169f6',
 recipient:'0x001893151cDcc11372f6dd067e3424f47ad8534a',
 amount:'7000000000000000',maximumWei:'57092229674443179997',relayerNonce:'11'
});
export function validateControlledReturn(row,op){
 assert.equal(row.account_id,RETURN.account);assert.equal(row.plan.address,RETURN.wallet);
 assert.equal(op.wallet,RETURN.wallet);assert.equal(op.recipient,RETURN.recipient);assert.equal(op.amount,RETURN.amount);
 assert.equal(op.chainId,9);assert.equal(op.action,5);assert.equal(op.walletNonce,'0');assert.equal(op.epoch,'0');
}
export function scopeControlledReturn(db,executor){
 const stop=()=>db.prepare('UPDATE passkey_relayer_grants SET enabled=FALSE WHERE id=$1').run(RETURN.grant);
 const prepare=executor.prepare,execute=executor.execute;
 return {...executor,
  async prepare(row,op,...rest){
   validateControlledReturn(row,op);
   // Permanent preparation lock: failure, timeout or restart cannot get a new attempt.
   // Schema requires a positive budget. This sentinel is disabled and expired;
   // its 1 wei is never a usable sponsorship or reserved expenditure.
   await db.prepare('INSERT INTO passkey_relayer_grants(id,relayer,budget_wei,expires_at,enabled) VALUES($1,$2,$3,$4,FALSE)').run(RETURN.grant+':used',RETURN.recipient,'1',0);
   try{const p=await prepare(row,op,...rest);assert.equal(p.relayerNonce,RETURN.relayerNonce);assert.equal(p.relayer,RETURN.recipient);
    assert(BigInt(p.maximumFeeWei)<=BigInt(RETURN.maximumWei));return p;
   }catch(error){await stop();throw error;}
  },
  async execute(input){
   try{validateControlledReturn(input.row,input.prepared.operation);assert.equal(input.accountId,RETURN.account);assert.equal(input.prepared.relayerNonce,RETURN.relayerNonce);
    assert(BigInt(input.prepared.maximumFeeWei)<=BigInt(RETURN.maximumWei));return await execute(input);
   }finally{await stop();}
  }
 };
}
