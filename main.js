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
  step: (msg) => console.log(`\n${colors.cyan}${colors.bold}[➤] ${msg}${colors.reset}`),
  banner: () => {
    console.log(`${colors.cyan}${colors.bold}`);
    console.log(`╔═══════════════════════════════════════════╗`);
    console.log(`║     BlockStreet Auto Bot - 2Captcha       ║`);
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
  
  const complexMatch = proxy.match(/^(.+?):(.+?)@([^:]+):(\d+)$/);
  if (complexMatch) {
    const [, user, pass, host, port] = complexMatch;
    return `http://${user}:${pass}@${host}:${port}`;
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
      'Priority': 'u=1, i',
      'Sec-Ch-Ua': '"Brave";v="141", "Not?A_Brand";v="8", "Chromium";v="141"',
      'Sec-Ch-Ua-Mobile': '?0',
      'Sec-Ch-Ua-Platform': '"Windows"',
      'Sec-Fetch-Dest': 'empty',
      'Sec-Fetch-Mode': 'cors',
      'Sec-Fetch-Site': 'same-site',
      'Sec-Gpc': '1',
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

// 2Captcha Turnstile Solver
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
    await new Promise(resolve => setTimeout(resolve, 5000));
    
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
      logger.loading(`Waiting for captcha solution... (${attempts}/60)`);
      continue;
    } else {
      throw new Error(`2Captcha solve failed: ${resRes.data.request}`);
    }
  }
  
  throw new Error('Captcha solving timeout');
}

function getRandomAmount(min = 0.01, max = 0.015) {
  return (Math.random() * (max - min) + min).toFixed(4);
}

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function countdown(hours) {
  let totalSeconds = hours * 3600;
  while (totalSeconds > 0) {
    const h = Math.floor(totalSeconds / 3600).toString().padStart(2, '0');
    const m = Math.floor((totalSeconds % 3600) / 60).toString().padStart(2, '0');
    const s = (totalSeconds % 60).toString().padStart(2, '0');
    process.stdout.write(`${colors.cyan}[⏳] Next run in: ${h}:${m}:${s}${colors.reset}\r`);
    totalSeconds--;
    await sleep(1000);
  }
  console.log('\n');
}

// Test Endpoint Function
async function testEndpoint() {
  logger.loading('Testing API endpoint...');
  const ua = randomUA();
  const api = createAxios(null, ua);
  
  try {
    const res = await api.get('https://api.blockstreet.money/api/account/signnonce', {
      headers: {
        'Origin': 'https://blockstreet.money',
        'Referer': 'https://blockstreet.money/',
        'Cookie': 'gfsessionid='
      }
    });
    
    logger.success('API Endpoint OK!');
    logger.info(`Response: ${JSON.stringify(res.data)}`);
    return true;
  } catch (err) {
    logger.error('API Endpoint Error: ' + err.message);
    if (err.response) {
      logger.error(`Status: ${err.response.status}`);
      logger.error(`Data: ${JSON.stringify(err.response.data)}`);
    }
    return false;
  }
}

// Auto Referral Function - UPDATED
async function autoReferral(inviteCode, apikey, sitekey, pageurl, count) {
  logger.step(`Starting Auto Referral - Creating ${count} wallets`);
  
  const wallets = [];
  
  for (let i = 1; i <= count; i++) {
    const wallet = ethers.Wallet.createRandom();
    const address = wallet.address;
    const privateKey = wallet.privateKey;
    
    logger.loading(`[${i}/${count}] Creating wallet: ${address.substring(0, 10)}...`);
    
    const ua = randomUA();
    const proxy = getRandomProxy();
    const api = createAxios(proxy, ua);

    try {
      // Step 1: Get nonce dengan headers yang lebih lengkap
      let res = await api.get('https://api.blockstreet.money/api/account/signnonce', {
        headers: { 
          ...api.defaults.headers,
          'Origin': 'https://blockstreet.money',
          'Referer': 'https://blockstreet.money/',
          'Cookie': 'gfsessionid='
        }
      });
      
      const sessionId = extractSessionId(res);
      const nonce = res.data.data.signnonce;
      
      logger.info(`Got nonce: ${nonce.substring(0, 10)}...`);

      // Step 2: Buat signature
      const now = new Date();
      const issuedAt = now.toISOString();
      const expirationTime = new Date(now.getTime() + 120000).toISOString();
      
      const message = `blockstreet.money wants you to sign in with your Ethereum account:\n${address}\n\nWelcome to Block Street\n\nURI: https://blockstreet.money\nVersion: 1\nChain ID: 1\nNonce: ${nonce}\nIssued At: ${issuedAt}\nExpiration Time: ${expirationTime}`;
      const signature = await wallet.signMessage(message);
      
      logger.info(`Signature created`);

      // Step 3: Solve Captcha
      const token = await solve2Captcha(apikey, sitekey, pageurl);

      // Step 4: Register dengan token di body DAN header
      const body = {
        address,
        nonce,
        signature,
        chainId: 1,
        issuedAt,
        expirationTime,
        invite_code: inviteCode,
        'cf-turnstile-response': token  // Token di body
      };
      
      const postHeaders = {
        ...api.defaults.headers,
        'Content-Type': 'application/json',
        'Origin': 'https://blockstreet.money',
        'Referer': 'https://blockstreet.money/',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache',
        'Cf-Turnstile-Response': token,  // Token di header juga
        'Cookie': sessionId ? `gfsessionid=${sessionId}` : 'gfsessionid='
      };
      
      // Tambah delay sebelum request
      logger.info('Waiting 2 seconds before registration...');
      await sleep(2000);
      
      logger.loading('Sending registration request...');
      res = await axios.post('https://api.blockstreet.money/api/account/signverify', body, { 
        headers: postHeaders,
        timeout: 30000
      }).catch(err => {
        if (err.response) {
          logger.error(`Response Code: ${err.response.data.code}`);
          logger.error(`Response Message: ${err.response.data.message}`);
          logger.error(`Full Response: ${JSON.stringify(err.response.data)}`);
          logger.error(`Status: ${err.response.status}`);
        }
        throw err;
      });
      
      if (res.data.code !== 0) {
        logger.error(`Registration failed: ${JSON.stringify(res.data)}`);
        
        // Jika error 5020, coba ulang dengan session baru
        if (res.data.code === 5020) {
          logger.warn('Error 5020 - Retrying with fresh session...');
          await sleep(5000);
          
          // Get new nonce
          logger.loading('Getting new nonce...');
          res = await api.get('https://api.blockstreet.money/api/account/signnonce', {
            headers: { 
              ...api.defaults.headers,
              'Origin': 'https://blockstreet.money',
              'Referer': 'https://blockstreet.money/',
              'Cookie': 'gfsessionid='
            }
          });
          
          const newSessionId = extractSessionId(res);
          const newNonce = res.data.data.signnonce;
          
          logger.info(`New nonce: ${newNonce.substring(0, 10)}...`);
          
          // New signature
          const newMessage = `blockstreet.money wants you to sign in with your Ethereum account:\n${address}\n\nWelcome to Block Street\n\nURI: https://blockstreet.money\nVersion: 1\nChain ID: 1\nNonce: ${newNonce}\nIssued At: ${issuedAt}\nExpiration Time: ${expirationTime}`;
          const newSignature = await wallet.signMessage(newMessage);
          
          // New captcha
          const newToken = await solve2Captcha(apikey, sitekey, pageurl);
          
          body.nonce = newNonce;
          body.signature = newSignature;
          body['cf-turnstile-response'] = newToken;
          postHeaders['Cf-Turnstile-Response'] = newToken;
          postHeaders['Cookie'] = newSessionId ? `gfsessionid=${newSessionId}` : 'gfsessionid=';
          
          await sleep(2000);
          logger.loading('Retrying registration...');
          
          res = await axios.post('https://api.blockstreet.money/api/account/signverify', body, { 
            headers: postHeaders,
            timeout: 30000
          }).catch(err => {
            if (err.response) {
              logger.error(`Retry Response: ${JSON.stringify(err.response.data)}`);
            }
            throw err;
          });
          
          if (res.data.code !== 0) {
            logger.error(`Retry failed: ${JSON.stringify(res.data)}`);
            continue;
          }
        } else {
          continue;
        }
      }

      const newSessionId = extractSessionId(res);
      const finalSessionId = newSessionId || sessionId;

      logger.success(`[${i}/${count}] ✅ Registered: ${address}`);
      logger.info(`Session ID: ${finalSessionId}`);
      
      const walletData = { address, privateKey, sessionId: finalSessionId };
      wallets.push(walletData);
      
      const existingWallets = fs.existsSync('wallets.json') ? JSON.parse(fs.readFileSync('wallets.json', 'utf8')) : [];
      existingWallets.push(walletData);
      fs.writeFileSync('wallets.json', JSON.stringify(existingWallets, null, 2));
      
      if (i < count) {
        logger.info('Waiting 5 seconds before next wallet...');
        await sleep(5000);
      }
    } catch (err) {
      logger.error(`Error for wallet ${i}: ${err.message}`);
      if (err.response) {
        logger.error(`Details: ${JSON.stringify(err.response.data)}`);
      }
    }
  }
  
  logger.success(`Auto Referral completed! Created ${wallets.length}/${count} wallets`);
  return wallets;
}

// Load Wallets from .env or wallets.json
function loadWallets() {
  let wallets = [];
  
  // Priority 1: Load from .env file
  const envKeys = Object.keys(process.env).filter(key => key.startsWith('PRIVATE_KEY_'));
  
  if (envKeys.length > 0) {
    wallets = envKeys.map(key => {
      try {
        const wallet = new ethers.Wallet(process.env[key]);
        return {
          address: wallet.address,
          privateKey: wallet.privateKey,
          sessionId: null,
          wallet: wallet
        };
      } catch (err) {
        logger.error(`Invalid private key in ${key}`);
        return null;
      }
    }).filter(Boolean);
    
    logger.info(`Loaded ${wallets.length} wallet(s) from .env file`);
    return wallets;
  }
  
  // Priority 2: Load from wallets.json
  if (fs.existsSync('wallets.json')) {
    const jsonWallets = JSON.parse(fs.readFileSync('wallets.json', 'utf8'));
    wallets = jsonWallets.map(w => {
      try {
        const wallet = new ethers.Wallet(w.privateKey);
        return {
          ...w,
          wallet: wallet
        };
      } catch (err) {
        logger.error(`Invalid wallet in wallets.json: ${w.address}`);
        return null;
      }
    }).filter(Boolean);
    
    logger.info(`Loaded ${wallets.length} wallet(s) from wallets.json`);
    return wallets;
  }
  
  return wallets;
}

// Login & Auto Swap Function
async function loginAndSwap(apikey, sitekey, pageurl) {
  logger.step('Starting Login & Auto Swap');
  
  const wallets = loadWallets();
  
  if (wallets.length === 0) {
    logger.error('No wallets found! Please:');
    logger.error('1. Run Auto Referral (Menu 1) to create new wallets, OR');
    logger.error('2. Add private keys to .env file (PRIVATE_KEY_1, PRIVATE_KEY_2, ...)');
    return;
  }
  
  logger.info(`Found ${wallets.length} wallet(s)`);
  
  for (let i = 0; i < wallets.length; i++) {
    const { address, privateKey, sessionId } = wallets[i];
    logger.loading(`[${i + 1}/${wallets.length}] Processing: ${address.substring(0, 10)}...`);
    
    const ua = randomUA();
    const proxy = getRandomProxy();
    const api = createAxios(proxy, ua);
    
    const baseHeaders = {
      ...api.defaults.headers,
      'Cookie': `gfsessionid=${sessionId}`,
    };

    try {
      // Get token list
      let res = await axios.get('https://api.blockstreet.money/api/swap/token_list', { headers: baseHeaders });
      const tokens = res.data.data || [];
      
      if (tokens.length < 2) {
        logger.warn('Not enough tokens to swap');
        continue;
      }
      
      // Get assets
      res = await axios.get('https://api.blockstreet.money/api/account/assets', { headers: baseHeaders });
      const assets = res.data.data || [];
      
      // Perform 3 random swaps
      for (let j = 0; j < 3; j++) {
        try {
          const fromToken = tokens[Math.floor(Math.random() * tokens.length)];
          let toToken;
          do {
            toToken = tokens[Math.floor(Math.random() * tokens.length)];
          } while (toToken.symbol === fromToken.symbol);
          
          const fromAmount = getRandomAmount();
          const toAmount = (parseFloat(fromAmount) * parseFloat(fromToken.price) / parseFloat(toToken.price)).toFixed(6);
          
          const swapData = {
            from_symbol: fromToken.symbol,
            to_symbol: toToken.symbol,
            from_amount: fromAmount,
            to_amount: toAmount
          };
          
          res = await axios.post('https://api.blockstreet.money/api/swap', swapData, {
            headers: { ...baseHeaders, 'Content-Type': 'application/json' }
          });
          
          if (res.data && res.data.code === 0) {
            logger.success(`Swap ${j + 1}: ${fromAmount} ${fromToken.symbol} → ${toAmount} ${toToken.symbol}`);
          } else {
            logger.warn(`Swap ${j + 1} failed`);
          }
          
          await sleep(2000);
        } catch (err) {
          logger.error(`Swap ${j + 1} error: ${err.message}`);
        }
      }
      
      await sleep(3000);
    } catch (err) {
      logger.error(`Error for ${address}: ${err.message}`);
    }
  }
  
  logger.success('Login & Auto Swap completed!');
}

// Run All Features Function
async function runAllFeatures(apikey, sitekey, pageurl, loopMode = false) {
  logger.step('Starting Run All Features');
  
  do {
    const wallets = loadWallets();
    
    if (wallets.length === 0) {
      logger.error('No wallets found! Please:');
      logger.error('1. Run Auto Referral (Menu 1) to create new wallets, OR');
      logger.error('2. Add private keys to .env file (PRIVATE_KEY_1, PRIVATE_KEY_2, ...)');
      return;
    }
    
    logger.info(`Processing ${wallets.length} wallet(s)...`);
    
    for (let i = 0; i < wallets.length; i++) {
      const { address, privateKey, sessionId } = wallets[i];
      logger.loading(`\n[${i + 1}/${wallets.length}] Wallet: ${address.substring(0, 15)}...`);
      
      const ua = randomUA();
      const proxy = getRandomProxy();
      const api = createAxios(proxy, ua);
      
      const baseHeaders = {
        ...api.defaults.headers,
        'Cookie': `gfsessionid=${sessionId}`,
      };

      try {
        // Get token list
        let res = await axios.get('https://api.blockstreet.money/api/swap/token_list', { headers: baseHeaders });
        const tokens = res.data.data || [];
        
        // Get assets
        res = await axios.get('https://api.blockstreet.money/api/account/assets', { headers: baseHeaders });
        const assets = res.data.data || [];
        
        logger.info('Assets:');
        assets.forEach(asset => {
          logger.info(`  ${asset.symbol}: ${asset.available_amount}`);
        });

        // 1. Swap (3x)
        logger.loading('Performing 3 swaps...');
        for (let j = 0; j < 3; j++) {
          try {
            const fromToken = tokens[Math.floor(Math.random() * tokens.length)];
            let toToken;
            do {
              toToken = tokens[Math.floor(Math.random() * tokens.length)];
            } while (toToken.symbol === fromToken.symbol);
            
            const fromAmount = getRandomAmount();
            const toAmount = (parseFloat(fromAmount) * parseFloat(fromToken.price) / parseFloat(toToken.price)).toFixed(6);
            
            res = await axios.post('https://api.blockstreet.money/api/swap', {
              from_symbol: fromToken.symbol,
              to_symbol: toToken.symbol,
              from_amount: fromAmount,
              to_amount: toAmount
            }, { headers: { ...baseHeaders, 'Content-Type': 'application/json' }});
            
            if (res.data?.code === 0) {
              logger.success(`  Swap ${j + 1}: ${fromAmount} ${fromToken.symbol} → ${toAmount} ${toToken.symbol}`);
            }
            await sleep(2000);
          } catch (err) {
            logger.error(`  Swap ${j + 1} failed: ${err.message}`);
          }
        }

        // 2. Supply
        logger.loading('Performing supply...');
        const bsdAsset = assets.find(a => a.symbol === 'BSD');
        if (bsdAsset && parseFloat(bsdAsset.available_amount) >= 1) {
          try {
            res = await axios.post('https://api.blockstreet.money/api/supply', {
              symbol: 'BSD',
              amount: '1'
            }, { headers: { ...baseHeaders, 'Content-Type': 'application/json' }});
            
            if (res.data?.code === 0) {
              logger.success('  Supplied 1 BSD');
            }
          } catch (err) {
            logger.error(`  Supply failed: ${err.message}`);
          }
          await sleep(2000);
        } else {
          logger.warn('  Not enough BSD for supply');
        }

        // 3. Borrow
        logger.loading('Performing borrow...');
        try {
          res = await axios.get('https://api.blockstreet.money/api/market/borrow', { headers: baseHeaders });
          const borrowables = (res.data.data || []).filter(b => b.type === 'B');
          
          if (borrowables.length > 0) {
            const toBorrow = borrowables[Math.floor(Math.random() * borrowables.length)];
            const amount = getRandomAmount();
            
            res = await axios.post('https://api.blockstreet.money/api/borrow', {
              symbol: toBorrow.symbol,
              amount: amount
            }, { headers: { ...baseHeaders, 'Content-Type': 'application/json' }});
            
            if (res.data?.code === 0) {
              logger.success(`  Borrowed ${amount} ${toBorrow.symbol}`);
            }
          }
          await sleep(2000);
        } catch (err) {
          logger.error(`  Borrow failed: ${err.message}`);
        }

        // 4. Repay
        logger.loading('Performing repay...');
        try {
          res = await axios.get('https://api.blockstreet.money/api/my/borrow', { headers: baseHeaders });
          const myBorrows = (res.data.data || []).filter(b => b.symbol && parseFloat(b.amount) > 0);
          
          if (myBorrows.length > 0) {
            const toRepay = myBorrows[Math.floor(Math.random() * myBorrows.length)];
            const repayAmount = getRandomAmount(0.001, 0.005);
            
            if (parseFloat(toRepay.amount) >= parseFloat(repayAmount)) {
              res = await axios.post('https://api.blockstreet.money/api/repay', {
                symbol: toRepay.symbol,
                amount: repayAmount
              }, { headers: { ...baseHeaders, 'Content-Type': 'application/json' }});
              
              if (res.data?.code === 0) {
                logger.success(`  Repaid ${repayAmount} ${toRepay.symbol}`);
              }
            }
          }
          await sleep(2000);
        } catch (err) {
          logger.error(`  Repay failed: ${err.message}`);
        }

        // 5. Withdraw
        logger.loading('Performing withdraw...');
        try {
          res = await axios.get('https://api.blockstreet.money/api/my/supply', { headers: baseHeaders });
          const supplies = res.data.data || [];
          let bsdSupplied = 0;
          
          supplies.forEach(s => {
            if (s.symbol === 'BSD') {
              bsdSupplied += parseFloat(s.amount || 0);
            }
          });
          
          if (bsdSupplied >= 1) {
            res = await axios.post('https://api.blockstreet.money/api/withdraw', {
              symbol: 'BSD',
              amount: '1'
            }, { headers: { ...baseHeaders, 'Content-Type': 'application/json' }});
            
            if (res.data?.code === 0) {
              logger.success('  Withdrew 1 BSD');
            }
          }
        } catch (err) {
          logger.error(`  Withdraw failed: ${err.message}`);
        }

        logger.success(`Completed all features for ${address.substring(0, 15)}...`);
        await sleep(5000);
        
      } catch (err) {
        logger.error(`Error for ${address}: ${err.message}`);
      }
    }
    
    logger.success('All wallets processed!');
    
    if (loopMode) {
      logger.info('Loop mode enabled - waiting 12 hours before next run...');
      await countdown(12);
    }
    
  } while (loopMode);
}

// Main Menu
async function main() {
  logger.banner();
  initializeProxy();
  
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const question = (query) =>
