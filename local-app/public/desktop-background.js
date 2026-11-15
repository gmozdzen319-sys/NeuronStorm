import {startNeuronBackground} from './neuron-background.js';
startNeuronBackground();

const downloads=document.getElementById('desktop-download-count');
if(downloads)fetch('/api/desktop-statistics',{cache:'no-store'}).then(r=>{if(!r.ok)throw Error();return r.json()}).then(s=>{downloads.textContent=Number(s.downloads).toLocaleString('en-US')+' downloads · counted since November 2026';}).catch(()=>{downloads.textContent='Download count temporarily unavailable';});
