// Access only. Solar observations are fetched directly from NASA/NOAA by Desktop.
// No bearer grants, cached authorization or separate identity system.
export function createPulseAccess({account}) {
  return async function pulseAccess(req,res,path) {
    if (!(path==='/pulse'||path.startsWith('/pulse/')||path==='/api/pulse'||path.startsWith('/api/pulse/'))) return false;
    res.setHeader('Cache-Control','private, no-store');
    res.setHeader('Vary','Cookie');
    const current=await account(req);
    if(!current?.address&&!current?.id){
      if((req.method==='GET'||req.method==='HEAD')&&path.startsWith('/pulse')){
        res.writeHead(303,{Location:'/?login=pulse'});res.end();
      }else{res.writeHead(401,{'Content-Type':'application/json'});res.end(JSON.stringify({error:'Sign in to Neuron Storm to open NS Pulse.'}));}
      return true;
    }
    if(req.method==='GET'&&path==='/api/pulse/access'){
      res.writeHead(200,{'Content-Type':'application/json'});
      res.end(JSON.stringify({authorized:true,subject:String(current.id||current.address).toLowerCase()}));return true;
    }
    if((req.method==='GET'||req.method==='HEAD')&&(path==='/pulse'||path==='/pulse/')){
      res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});
      res.end(req.method==='HEAD'?'':'<!doctype html><html lang="en"><meta charset="utf-8"><title>NS Pulse</title><h1>NS Pulse</h1><p>You are signed in. Open NS Pulse from the Neuron Storm Desktop menu.</p><a href="/desktop.html">Neuron Storm Desktop</a></html>');return true;
    }
    res.writeHead(404,{'Content-Type':'application/json'});res.end('{"error":"Not found"}');return true;
  };
}
