// Quoted-fee operation. No signing, network or broadcast capability.
import assert from 'node:assert/strict';
import {AbiCoder,getAddress,keccak256} from 'quais';
const abi=AbiCoder.defaultAbiCoder();
const UINT256=(1n<<256n)-1n;
export const QUOTED_ACTION=6;
export const QUOTE_TUPLE='tuple(address token,address recipient,uint256 amount,address relayer,uint256 networkFee,uint256 gasPrice,bytes32 requestId)';
export const ZERO_TOKEN='0x'+'0'.repeat(40);
export function feeAddress(value){const address=getAddress(value);assert(/^0x00[0-7][0-9a-f]{37}$/i.test(address)&&address!==ZERO_TOKEN,'Cyprus-1 Quai address required');return address;}
export function tokenAmount(text,decimals){
 assert(Number.isInteger(decimals)&&decimals>=0&&decimals<=255,'Invalid token precision');
 assert(typeof text==='string'&&text.length<=335&&/^(0|[1-9]\d*)(\.\d+)?$/.test(text),'Enter a decimal amount');
 const [whole,fraction='']=text.split('.');assert(fraction.length<=decimals,'Too many decimal places');
 const amount=BigInt(whole)*10n**BigInt(decimals)+BigInt(fraction.padEnd(decimals,'0')||'0');
 assert(amount>0n&&amount<=UINT256,'Amount outside token integer range');return amount.toString();
}
export function quotedFee(gas,gasPrice){
 gas=BigInt(gas);gasPrice=BigInt(gasPrice);assert(gas>0n&&gasPrice>0n);
 const networkFee=gas*gasPrice,serviceFee=networkFee/20n+(networkFee%20n?1n:0n),total=networkFee+serviceFee;
 assert(total<=UINT256,'Fee overflow');return {networkFee:String(networkFee),serviceFee:String(serviceFee),totalFee:String(total)};
}
export function feeDigest(op){
 assert.equal(op.chainId,9);assert.equal(op.action,QUOTED_ACTION);
 const q=op.quote;feeAddress(op.wallet);feeAddress(q.recipient);feeAddress(q.relayer);
 assert(q.recipient.toLowerCase()!==op.wallet.toLowerCase()&&q.relayer.toLowerCase()!==op.wallet.toLowerCase());
 if(q.token!==ZERO_TOKEN)feeAddress(q.token);
 assert(BigInt(q.amount)>0n&&BigInt(q.networkFee)>0n&&BigInt(q.gasPrice)>0n);
 assert(/^0x[0-9a-f]{64}$/i.test(q.requestId)&&BigInt(q.requestId)!==0n);
 const payload=keccak256(abi.encode(['string',QUOTE_TUPLE],['NS-SEND-QUOTE-v1',q]));
 return keccak256(abi.encode(['string','uint256','address','uint256','uint256','uint8','bytes32','uint256'],['NS-WALLET-v1',9,op.wallet,op.epoch,op.walletNonce,QUOTED_ACTION,payload,op.deadline]));
}
export function validateFeeExecution(op,{estimatedGas,gasLimit,gasPrice,walletQuai,tokenBalance}){
 assert.equal(feeDigest(op),op.digest,'Operation changed');
 assert.equal(BigInt(gasPrice),BigInt(op.quote.gasPrice),'Frozen price changed');
 assert(BigInt(estimatedGas)>0n&&BigInt(gasLimit)>=BigInt(estimatedGas),'Insufficient execution gas');
 // The signed price is an explicit quote. Never silently debit more to chase RPC.
 const fee=quotedFee(1,op.quote.networkFee);
 assert(BigInt(estimatedGas)*BigInt(gasPrice)<=BigInt(op.quote.networkFee),Object.assign(new Error('Actual preflight exceeds quoted network fee'),{code:'FEE_REQUOTE_REQUIRED'}));
 const native=op.quote.token===ZERO_TOKEN,amount=BigInt(op.quote.amount);
 assert(BigInt(walletQuai)>=BigInt(fee.totalFee)+(native?amount:0n),'Insufficient QUAI for quoted fee');
 if(!native)assert(BigInt(tokenBalance)>=amount,'Insufficient token balance');
 return fee;
}
