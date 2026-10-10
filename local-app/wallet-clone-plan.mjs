// Read-only deterministic planning. Never exposes an undeployed address as Receive.
// Used by persistent account assignment and the separately approved provisioner.
import {AbiCoder,getAddress,isQuaiAddress,keccak256} from 'quais';
const abi=AbiCoder.defaultAbiCoder();
const valid=a=>isQuaiAddress(a)&&/^0x00[0-7]/i.test(a)&&!/^0x0+$/i.test(a);
export function planWalletClone({chainId,factory,implementation,x,y,start=0,generation=1}) {
  if(![1,2].includes(generation))throw Error('Unsupported wallet generation.');
  if(chainId!==9)throw Error('Unsupported wallet network.');
  factory=getAddress(factory);implementation=getAddress(implementation);
  if(!valid(factory)||!valid(implementation))throw Error('Unsupported wallet infrastructure.');
  if(!/^0x[0-9a-f]{64}$/i.test(x)||!/^0x[0-9a-f]{64}$/i.test(y))throw Error('Invalid public key encoding.');
  if(!Number.isSafeInteger(start)||start<0||start>Number.MAX_SAFE_INTEGER-100000)throw Error('Invalid search range.');
  const runtime=generation===1
    ?'0x363d3d373d3d3d363d73'+implementation.slice(2).toLowerCase()+'5af43d82803e903d91602b57fd5bf3'
    :'0x3615603257363d3d373d3d3d363d73'+implementation.slice(2).toLowerCase()+'5af43d82803e903d91603057fd5bf35b00';
  const init=(generation===1?'0x3d602d80600a3d3981f3':'0x3d603480600a3d3981f3')+runtime.slice(2);
  const keyId=keccak256(abi.encode(['bytes32','bytes32'],[x,y]));
  for(let grind=start;grind<start+100000;grind++) {
    const salt=keccak256(abi.encode(['string','bytes32','bytes32','uint256'],[generation===1?'NS-CLONE-v1':'NS-RECEIVE-v2',x,y,grind]));
    const address=getAddress('0x'+keccak256('0xff'+factory.slice(2)+salt.slice(2)+keccak256(init).slice(2)).slice(-40));
    if(valid(address))return Object.freeze({chainId,factory,implementation,keyId,grind,salt,address,runtime,runtimeHash:keccak256(runtime),receiveAvailable:false});
  }
  throw Error('No supported wallet address found within the bounded search.');
}
