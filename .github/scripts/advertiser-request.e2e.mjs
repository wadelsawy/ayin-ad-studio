import { readFile, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { chromium } from 'playwright';

const ROOT = process.cwd();
const TEMP = await mkdtemp(join(tmpdir(), 'ayin-e2e-'));
const EMAIL = 'qa-advertiser@example.test';
const PASSWORD = 'Qa-only-Password-123!';
const HOST = '127.0.0.1';
const PORT = 4179;
let server;
let browser;

async function jsonPost(url, body) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
  const data = await response.json();
  if (!response.ok) throw new Error(`Auth emulator setup failed (${response.status}): ${JSON.stringify(data)}`);
  return data;
}

try {
  const source = await readFile(join(ROOT, 'index.html'), 'utf8');
  if (!source.includes('projectId:"ayn-marketplace"') ||
      !source.includes('signInWithPopup(auth,new GoogleAuthProvider())') ||
      !source.includes('const app=initializeApp(firebaseConfig);') ||
      !source.includes('auth=getAuth(app);db=getFirestore(app)')) {
    throw new Error('Fail-closed: application Firebase/auth initialization changed; review the test adapter before running.');
  }

  const verificationGuard = "if(!email||!u.emailVerified){await signOut(auth);toast('لازم حساب قوقل بإيميل موثّق.');return null}";
  const testOnlyGuard = "if(!email){await signOut(auth);toast('Test account email is missing.');return null}";
  if (!source.includes(verificationGuard)) {
    throw new Error('Fail-closed: email verification guard changed; review the isolated test adapter.');
  }

  let html = source.replace(verificationGuard, testOnlyGuard)
    .replace('import {getAuth,GoogleAuthProvider,signInWithPopup,signInAnonymously,onAuthStateChanged,signOut} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";',
      'import {getAuth,GoogleAuthProvider,signInWithPopup,signInWithEmailAndPassword,signInAnonymously,onAuthStateChanged,signOut,connectAuthEmulator} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";')
    .replace('import {getFirestore,doc,getDoc,setDoc,addDoc,updateDoc,deleteDoc,collection,query,where,orderBy,limit,onSnapshot,serverTimestamp} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";',
      'import {getFirestore,doc,getDoc,setDoc,addDoc,updateDoc,deleteDoc,collection,query,where,orderBy,limit,onSnapshot,serverTimestamp,connectFirestoreEmulator} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";')
    .replace('const firebaseConfig={apiKey:"AIzaSyBIxmk6lu-xNJ1sOLAbCQipnvv5M_k1eXU",authDomain:"ayn-marketplace.firebaseapp.com",projectId:"ayn-marketplace",storageBucket:"ayn-marketplace.firebasestorage.app",messagingSenderId:"1053290254316",appId:"1:1053290254316:web:e6a35661a75a31615b3ac9"};',
      'const firebaseConfig={apiKey:"fake-api-key",authDomain:"127.0.0.1",projectId:"demo-ayn-marketplace",storageBucket:"demo-ayn-marketplace.appspot.com",messagingSenderId:"000000000000",appId:"1:000000000000:web:0000000000000000000000"};')
    .replace('auth=getAuth(app);db=getFirestore(app)',
      'auth=getAuth(app);db=getFirestore(app);connectAuthEmulator(auth,"http://127.0.0.1:9099",{disableWarnings:true});connectFirestoreEmulator(db,"127.0.0.1",8080)')
    .replace('signInWithPopup(auth,new GoogleAuthProvider())',
      `signInWithEmailAndPassword(auth,'${EMAIL}','${PASSWORD}').then(async result=>{await result.user.reload();await result.user.getIdToken(true);return result;})`);

  if (!html.includes(testOnlyGuard)) throw new Error('Fail-closed: test-only auth adapter did not replace the verification guard.');

  if (html.includes('ayn-marketplace.firebaseapp.com') || html.includes('projectId:"ayn-marketplace"')) {
    throw new Error('Fail-closed: production Firebase configuration remains in the temporary test page.');
  }

  await writeFile(join(TEMP, 'index.html'), html);
  const setupResponse = await fetch('http://127.0.0.1:9099/emulator/v1/projects/demo-ayn-marketplace/accounts', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD, emailVerified: true, displayName: 'QA Advertiser' })
  });
  const setupData = await setupResponse.json();
  if (!setupResponse.ok || setupData.emailVerified !== true) {
    throw new Error(`Auth Emulator verified-user setup failed: ${JSON.stringify(setupData)}`);
  }

  server = createServer(async (req, res) => {
    const path = req.url === '/' ? '/index.html' : req.url;
    try {
      const body = await readFile(join(TEMP, path.replace(/^\//, '')));
      res.writeHead(200, { 'content-type': path.endsWith('.html') ? 'text/html; charset=utf-8' : 'application/octet-stream' });
      res.end(body);
    } catch {
      res.writeHead(404); res.end('Not found');
    }
  });
  await new Promise(resolve => server.listen(PORT, HOST, resolve));

  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const blocked = [];
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    const local = ['127.0.0.1', 'localhost'].includes(url.hostname);
    const firebaseSdk = url.hostname === 'www.gstatic.com' && url.pathname.startsWith('/firebasejs/10.12.2/');
    if (local || firebaseSdk) return route.continue();
    blocked.push(url.origin);
    return route.abort();
  });
  const page = await context.newPage();
  const errors = [];
  const browserLogs = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', msg => { if (msg.type() === 'error') browserLogs.push(msg.text()); });
  await page.goto(`http://${HOST}:${PORT}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__ready === 1, null, { timeout: 20000 });

  await page.locator('#loginOpen').click();
  await page.locator('#loginModal').waitFor({ state: 'visible', timeout: 10000 });
  await page.locator('#gAdv').click();
  try {
    await page.locator('body.role-advertiser').waitFor({ state: 'attached', timeout: 20000 });
  } catch (error) {
    const diagnostics = await page.evaluate(() => ({ bodyClass: document.body.className, toast: document.querySelector('#toast')?.textContent, userName: document.querySelector('#userName')?.textContent }));
    throw new Error(`Advertiser profile did not load. Diagnostics: ${JSON.stringify(diagnostics)}; pageErrors=${JSON.stringify(errors)}; consoleErrors=${JSON.stringify(browserLogs)}; wait=${error.message}`);
  }
  await page.evaluate(() => window.AY.showPage('request'));
  await page.locator('#clientName').fill('معلن اختبار');
  await page.locator('#clientPhone').fill('0912345678');
  await page.locator('#serviceType').selectOption({ index: 1 });
  await page.locator('#clientBrief').fill('اختبار آلي معزول لإرسال طلب إعلان تجريبي');
  await page.locator('#requestForm button[type="submit"]').click();
  await page.locator('#requestResult').waitFor({ state: 'visible', timeout: 20000 });
  const resultText = await page.locator('#requestResult').innerText();
  if (!resultText.includes('وصل طلبك')) throw new Error(`Ad request confirmation missing: ${resultText}`);
  if (blocked.length) throw new Error(`External network requests were blocked: ${[...new Set(blocked)].join(', ')}`);
  if (errors.length) throw new Error(`Browser errors: ${errors.join(' | ')}`);

  console.log('PASS: test advertiser authenticated against Auth Emulator.');
  console.log('PASS: advertiser profile/email claim registered in Firestore Emulator.');
  console.log('PASS: ad request submitted and confirmation rendered.');
  console.log('PASS: browser made no requests outside local emulators and Firebase SDK CDN.');
} finally {
  await browser?.close();
  if (server) await new Promise(resolve => server.close(resolve));
  await rm(TEMP, { recursive: true, force: true });
}
