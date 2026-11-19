// Route a protected-page visitor through the existing login dialog unchanged.
if(new URLSearchParams(location.search).get('login')==='pulse'){
 let opened=false;
 const observer=new MutationObserver(check);
 function check(){
  const login=document.getElementById('login'),logout=document.getElementById('logout');
  if(logout&&!logout.hidden){observer.disconnect();location.replace('/pulse');return;}
  if(!opened&&login&&!login.disabled&&!login.hidden){opened=true;login.click();}
 }
 observer.observe(document.body,{attributes:true,subtree:true,attributeFilter:['hidden','disabled']});check();
 setTimeout(()=>observer.disconnect(),300000);
}
