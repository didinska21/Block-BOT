const fs = require('fs');
const axios = require('axios');
const { ethers } = require('ethers');
const readline = require('readline');
const { HttpsProxyAgent } = require('https-proxy-agent');
const dotenv = require('dotenv');

dotenv.config();

const colors = {
  reset: '\x1b[0m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  white: '\x1b[37m',
  bold: '\x1b[1m',
};

const logger = {
  info: (msg) => console.log(`${colors.white}[➤] ${msg}${colors.reset}`),
  warn: (msg) => console.log(`${colors.yellow}[⚠] ${msg}${colors.reset}`),
  error: (msg) => console.log(`${colors.red}[✗] ${msg}${colors.reset}`),
  success: (msg) => console.log(`${colors.green}[✅] ${msg}${colors.reset}`),
  loading: (msg) => console.log(`${colors.cyan}[⟳] ${msg}${colors.reset}`),
  banner: () => {
    console.log(`${colors.cyan}${colors.bold}`);
    console.log(`╔═══════════════════════════════════════════╗`);
    console.log(`║     BlockStreet Auto Referral Bot        ║`);
    console.log(`╚═══════════════════════════════════════════╝${colors.reset}\n`);
  },
};

const userAgents = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/121.0',
];

function randomUA() {
  return userAgents[Math.floor(Math.random() * userAgents.length)];
}

let proxyList = [];
let usingProxy = false;

function initializeProxy() {
  try {
    const proxies = fs.readFileSync('proxies.txt', 'utf8').trim().split('\n').filter(Boolean);
    if (proxies.length > 0) {
      proxyList = proxies.map(p => parseProxy(p.trim()));
      usingProxy = true;
      logger.info(`Loaded ${proxyList.length} proxy(ies)`);
    } else {
      logger.warn('No proxies found, running without proxy');
    }
  } catch (err) {
    logger.warn('No proxies.txt found, running without proxy');
  }
}

function getRandomProxy() {
  if (!usingProxy || proxyList.length === 0) return null;
  return proxyList[Math.floor(Math.random() * proxyList.length)];
}

function parseProxy(proxyLine) {
  let proxy = proxyLine.trim();
  proxy = proxy.replace(/^https?:\/\//, '');
  
  if (proxy.match(/^[^:]+:[^@]+@[^:]+:\d+$/)) {
    return `http://${proxy}`;
  }
  
  const parts = proxy.split(':');
  if (parts.length === 4) {
    const [host, port, user, pass] = parts;
    if (!isNaN(port)) {
      return `http://${user}:${pass}@${host}:${port}`;
    }
  }
  
  if (parts.length === 2 && !isNaN(parts[1])) {
    return `http://${proxy}`;
  }
  
  return `http://${proxy}`;
}

function createAxios(proxy = null, ua) {
  const config = {
    headers: {
      'User-Agent': ua,
      'Accept': 'application/json, text/plain, */*',
      'Accept-Language': 'en-US,en;q=0.9',
      'Referer': 'https://blockstreet.money/',
    },
  };
  if (proxy) {
    config.httpsAgent = new HttpsProxyAgent(proxy);
  }
  return axios.create(config);
}

function extractSessionId(response) {
  const setCookies = response.headers['set-cookie'];
  if (setCookies && setCookies.length > 0) {
    const cookieStr = setCookies[0].split(';')[0];
    const parts = cookieStr.split('=');
    if (parts[0].trim() === 'gfsessionid') {
      return parts[1];
    }
  }
  return null;
}

async function solve2Captcha(apikey, sitekey, pageurl) {
  logger.loading('Solving Turnstile with 2Captcha...');
  
  const submitUrl = 'https://2captcha.com/in.php';
  const params = new URLSearchParams({
    key: apikey,
    method: 'turnstile',
    sitekey: sitekey,
    pageurl: pageurl,
    json: 1
  });
  
  let submitRes = await axios.post(submitUrl, params);
  
  if (submitRes.data.status !== 1) {
    throw new Error(`2Captcha submit failed: ${submitRes.data.request}`);
  }
  
  const taskId = submitRes.data.request;
  logger.info(`Task ID: ${taskId}`);

  const resUrl = 'https://2captcha.com/res.php';
  let attempts = 0;
  
  while (attempts < 60) {
    await sleep(5000);
    
    const resParams = new URLSearchParams({
      key: apikey,
      action: 'get',
      id: taskId,
      json: 1
    });
    
    let resRes = await axios.get(resUrl + '?' + resParams.toString());
    
    if (resRes.data.status === 1) {
      logger.success('Captcha solved!');
      return resRes.data.request;
    } else if (resRes.data.request === 'CAPCHA_NOT_READY') {
      attempts++;
      logger.loading(`Waiting for captcha... (${attempts}/60)`);
      continue;
    } else {
      throw new Error(`2Captcha failed: ${resRes.data.request}`);
    }
  }
  
  throw new Error('Captcha timeout');
}

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function autoReferral(inviteCode, apikey, sitekey, pageurl, count) {
  logger.info(`Starting Auto Referral - Creating ${count} wallet(s)\n`);
  
  const wallets = [];
  
  for (let i = 1; i <= count; i++) {
    const wallet = ethers.Wallet.createRandom();
    const address = wallet.address;
    const privateKey = wallet.privateKey;
    
    logger.loading(`[${i}/${count}] Creating wallet: ${address.substring(0, 12)}...`);
    
    const ua = randomUA();
    const proxy = getRandomProxy();
    const api = createAxios(proxy, ua);

    try {
      // Step 1: Get nonce
      logger.loading('Getting nonce...');
      let res = await api.get('https://api.blockstreet.money/api/account/signnonce', {
        headers: { 
          'Origin': 'https://blockstreet.money',
          'Cookie': 'gfsessionid='
        }
      });
      
      let sessionId = extractSessionId(res);
      let nonce = res.data.data.signnonce;
      
      logger.info(`Nonce: ${nonce.substring(0, 15)}...`);

      // Step 2: Create signature
      const now = new Date();
      const issuedAt = now.toISOString();
      const expirationTime = new Date(now.getTime() + 120000).toISOString();
      
      const message = `blockstreet.money wants you to sign in with your Ethereum account:\n${address}\n\nWelcome to Block Street\n\nURI: https://blockstreet.money\nVersion: 1\nChain ID: 1\nNonce: ${nonce}\nIssued At: ${issuedAt}\nExpiration Time: ${expirationTime}`;
      let signature = await wallet.signMessage(message);

      // Step 3: Solve captcha
      let token = await solve2Captcha(apikey, sitekey, pageurl);

      // Step 4: Wait before registration
      logger.info('Waiting 5 seconds...');
      await sleep(5000);

      // Step 5: Registration with retry
      let registered = false;
      let maxRetries = 3;
      
      for (let attempt = 1; attempt <= maxRetries && !registered; attempt++) {
        try {
          logger.loading(`Registration attempt ${attempt}/${maxRetries}...`);
          
          const body = {
            address,
            nonce,
            signature,
            chainId: 1,
            issuedAt,
            expirationTime,
            invite_code: inviteCode,
            'cf-turnstile-response': token
          };
          
          res = await axios.post('https://api.blockstreet.money/api/account/signverify', body, { 
            headers: {
              'Content-Type': 'application/json',
              'Origin': 'https://blockstreet.money',
              'Referer': 'https://blockstreet.money/',
              'User-Agent': ua,
              'Cookie': sessionId ? `gfsessionid=${sessionId}` : 'gfsessionid='
            },
            timeout: 30000
          });
          
          if (res.data.code === 0) {
            registered = true;
            const newSessionId = extractSessionId(res);
            const finalSessionId = newSessionId || sessionId;

            logger.success(`✅ Wallet registered: ${address}`);
            
            const walletData = { address, privateKey, sessionId: finalSessionId };
            wallets.push(walletData);
            
            const existingWallets = fs.existsSync('wallets.json') 
              ? JSON.parse(fs.readFileSync('wallets.json', 'utf8')) 
              : [];
            existingWallets.push(walletData);
            fs.writeFileSync('wallets.json', JSON.stringify(existingWallets, null, 2));
            
          } else if (res.data.code === 5020 && attempt < maxRetries) {
            logger.warn(`Error 5020 - Refreshing session...`);
            await sleep(8000);
            
            // Get fresh nonce
            res = await api.get('https://api.blockstreet.money/api/account/signnonce', {
              headers: { 
                'Origin': 'https://blockstreet.money',
                'Cookie': 'gfsessionid='
              }
            });
            
            sessionId = extractSessionId(res);
            nonce = res.data.data.signnonce;
            
            // New signature
            const newMessage = `blockstreet.money wants you to sign in with your Ethereum account:\n${address}\n\nWelcome to Block Street\n\nURI: https://blockstreet.money\nVersion: 1\nChain ID: 1\nNonce: ${nonce}\nIssued At: ${issuedAt}\nExpiration Time: ${expirationTime}`;
            signature = await wallet.signMessage(newMessage);
            
            // New captcha
            token = await solve2Captcha(apikey, sitekey, pageurl);
            await sleep(5000);
            
          } else {
            logger.error(`Failed: ${res.data.message}`);
            break;
          }
          
        } catch (err) {
          logger.error(`Attempt ${attempt} error: ${err.message}`);
          if (attempt < maxRetries) {
            await sleep(10000);
          }
        }
      }
      
      if (!registered) {
        logger.error(`Failed to register after ${maxRetries} attempts\n`);
      } else {
        logger.info('');
      }
      
      if (i < count) {
        logger.info('Waiting 10 seconds before next wallet...\n');
        await sleep(10000);
      }
      
    } catch (err) {
      logger.error(`Error: ${err.message}\n`);
    }
  }
  
  logger.success(`\nCompleted! Created ${wallets.length}/${count} wallets`);
  logger.info(`Wallets saved to wallets.json\n`);
  return wallets;
}

async function main() {
  logger.banner();
  initializeProxy();
  
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const question = (query) => new Promise(resolve => rl.question(query, resolve));

  try {
    const inviteCode = process.env.INVITE_CODE || (fs.existsSync('code.txt') ? fs.readFileSync('code.txt', 'utf8').trim() : '');
    const apikey = process.env.CAPTCHA_API_KEY || (fs.existsSync('key.txt') ? fs.readFileSync('key.txt', 'utf8').trim() : '');
    
    if (!apikey) {
      logger.error('2Captcha API key not found!');
      logger.error('Add to key.txt or .env as CAPTCHA_API_KEY');
      rl.close();
      return;
    }
    
    if (!inviteCode) {
      logger.error('Invite code not found!');
      logger.error('Add to code.txt or .env as INVITE_CODE');
      rl.close();
      return;
    }
    
    const sitekey = '0x4AAAAAABpfyUqunlqwRBYN';
    const pageurl = 'https://blockstreet.money/dashboard';

    const count = await question(`${colors.cyan}How many wallets to create? ${colors.reset}`);
    const numCount = parseInt(count);
    
    if (isNaN(numCount) || numCount < 1) {
      logger.error('Invalid number!');
      rl.close();
      return;
    }
    
    await autoReferral(inviteCode, apikey, sitekey, pageurl, numCount);
    
    rl.close();
  } catch (err) {
    logger.error(`Fatal error: ${err.message}`);
    rl.close();
  }
}

main().catch(err => {
  logger.error(`Error: ${err.message}`);
  process.exit(1);
});