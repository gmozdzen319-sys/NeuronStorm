// Blip provider and deep links: https://www.blippay.me/docs
export const isBlip=provider=>!!(provider?.isBlip||provider?._isSwiftBlip);
export function getWalletProvider(scope=globalThis.window){
  const providers=[scope?.quai,scope?.pelagus,scope?.ethereum];
  return providers.find(p=>p?.request&&isBlip(p))|| (scope?.pelagus?.request?scope.pelagus:null);
}
export const walletName=(provider=getWalletProvider())=>isBlip(provider)?'Blip':'Pelagus';
export function blipLink(origin){
  const target=new URL(origin);if(target.protocol!=='https:'||target.username||target.password) return null;
  return 'https://blippay.me/browser?url='+encodeURIComponent(target.origin+'/');
}
