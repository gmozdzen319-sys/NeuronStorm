// Shared by the existing profile form for all authentication methods.
// The server independently enforces these requirements in saveProfile().
export function profileErrors({nickname,work=[],hobbies=[]}){
 return {
  nickname:typeof nickname!=='string'||!nickname.trim()?'Please enter a nickname.':null,
  topics:![...work,...hobbies].some(name=>typeof name==='string'&&name.trim())?'Please select or enter at least one topic.':null
 };
}

export function onboardingState(account,profile,walletReady){
 const locked=!!account&&!profile;
 return {locked,waitingForWallet:locked&&account.method==='passkey'&&!walletReady};
}
