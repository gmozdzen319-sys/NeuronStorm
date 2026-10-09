// Explicit local browser smoke test. Uses only a disposable virtual authenticator.
// Run with PLAYWRIGHT_MODULE pointing to a local playwright-core ESM module.
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {createApp} from './database.mjs';
import {mockTokenFetch} from './token-fixture.mjs';
import {loadLegal} from '../legal.mjs';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright-core');
process.env.NEURON_TEST_PGLITE='1';
const origin='http://localhost:3338';
process.env.NS_PASSKEY_ENABLED='true';process.env.NS_PASSKEY_ORIGIN=origin;process.env.NS_PASSKEY_RP_ID='localhost';
const app=await createApp({database:':memory:',origin,legal:loadLegal({published:false,version:'QA'}),tokenFetch:mockTokenFetch,marketFetch:async()=>{throw Error('Local test');},geoLookup:async()=>null});
let browser;
try{
 await new Promise(resolve=>app.server.listen(3338,'127.0.0.1',resolve));
 browser=await chromium.launch({channel:'msedge',headless:true});
 const context=await browser.newContext(),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 const cdp=await context.newCDPSession(page);await cdp.send('WebAuthn.enable');await cdp.send('WebAuthn.addVirtualAuthenticator',{options:{protocol:'ctap2',transport:'internal',hasResidentKey:true,hasUserVerification:true,isUserVerified:true,automaticPresenceSimulation:true}});
 await page.goto(origin);await page.locator('#login:not([disabled])').waitFor();assert.equal(await page.locator('#login').textContent(),'Log in / Sign up');
 await page.locator('#login').click();await page.locator('#auth-passkey:not([disabled])').waitFor();
 assert.deepEqual(await page.locator('.auth-methods>button').allTextContents(),['Continue with Passkey Neuron Storm · Recommended when available','Continue with Pelagus','Continue with BillPay Opens BlipPay when needed']);
 await mkdir(new URL('../../outputs/',import.meta.url),{recursive:true});
 for(const width of [1440,390,320]){await page.setViewportSize({width,height:850});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);const box=await page.locator('#auth-dialog').boundingBox();assert.ok(box.width<=width);await page.screenshot({path:fileURLToPath(new URL('../../outputs/passkey-auth-'+width+'.png',import.meta.url)),fullPage:true});}
 await page.locator('#auth-passkey').click();await page.locator('#passkey-signup').click();await page.locator('#passkey-home:visible').waitFor();
 const id=await page.locator('#pk-id').textContent();assert.ok(id);assert.equal(await page.locator('#passkey-home button').filter({hasText:'Send'}).isDisabled(),true);
 await page.locator('#pk-manage').click();await page.locator('#pk-devices p').first().waitFor();
 await page.locator('#logout').click();await page.locator('#login:visible').waitFor();assert.equal(await page.locator('#pk-id').textContent(),'');
 await page.locator('#login').click();await page.locator('#auth-passkey:not([disabled])').waitFor();await page.locator('#auth-passkey').click();await page.locator('#passkey-signin').click();await page.locator('#passkey-home:visible').waitFor();assert.equal(await page.locator('#pk-id').textContent(),id);
 await page.reload();await page.locator('#passkey-home:visible').waitFor();assert.equal(await page.locator('#pk-id').textContent(),id);
 const denial=await page.evaluate(async()=>{const r=await fetch('/api/passkey/wallet/send',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({recipient:'0x0000000000000000000000000000000000000001',amount:'7',action:1})});return r.status;});assert.equal(denial,423);
 await page.locator('#logout').click();await page.locator('#login:visible').waitFor();
 // Actual unified button dispatch with a local wallet double: never opens a real wallet.
 await page.addInitScript(()=>{window.pelagus={request:async({method})=>{if(method==='quai_requestAccounts'){window.testPelagusCalled=true;return ['0x0000000000000000000000000000000000000001'];}return [];}};});
 await page.reload();await page.locator('#login:not([disabled])').waitFor();await page.locator('#login').click();await page.locator('#auth-pelagus').click();await page.waitForFunction(()=>window.testPelagusCalled===true);
 await page.addInitScript(()=>{window.quai={isBlip:true,request:async({method})=>{if(method==='quai_requestAccounts'){window.testBillPayCalled=true;return ['0x0000000000000000000000000000000000000001'];}return [];}};});
 await page.reload();await page.locator('#login:not([disabled])').waitFor();await page.locator('#login').click();await page.locator('#auth-billpay').click();await page.waitForFunction(()=>window.testBillPayCalled===true);
 await page.route('**/api/passkey/config',route=>route.fulfill({json:{enabled:false,walletEnabled:false}}));
 await page.reload();await page.locator('#login:not([disabled])').waitFor();await page.locator('#login').click();await page.waitForFunction(()=>document.querySelector('#auth-availability').textContent.includes('being prepared'));assert.equal(await page.locator('#auth-passkey').isDisabled(),true);assert.equal(await page.locator('#auth-pelagus').isEnabled(),true);assert.equal(await page.locator('#auth-billpay').isEnabled(),true);
 assert.deepEqual(errors,[]);
 console.log('PASS: desktop/mobile auth, registration, login, stable identity, session reload/logout, device list, send blocked, Pelagus and BillPay dispatch, disabled rollout, no browser errors.');
}finally{await browser?.close();await app.close();}
