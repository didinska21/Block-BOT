const fs = require('fs');
const puppeteer = require('puppeteer');
const { ethers } = require('ethers');
const axios = require('axios');
const readline = require('readline');
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
    console.log(`║  BlockStreet Auto Referral - VPS Ready   ║`);
    console.log(`╚═══════════════════════════════════════════╝${colors.reset}\n`);
  },
};

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
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
      if (attempts % 5 === 0) {
        logger.loading(`Waiting for captcha... (${attempts * 5}s)`);
      }
      continue;
    } else {
      throw new Error(`2Captcha failed: ${resRes.data.request}`);
    }
  }
  
  throw new Error('Captcha timeout');
}

async function autoReferral(inviteCode, apikey, count) {
  logger.info(`Starting Auto Referral - Creating ${count} wallet(s)\n`);
  
  const sitekey = '0x4AAAAAABpfyUqunlqwRBYN';
  const pageurl = 'https://blockstreet.money/dashboard';
  const wallets = [];
  
  for (let i = 1; i <= count; i++) {
    const wallet = ethers.Wallet.createRandom();
    const address = wallet.address;
    const privateKey = wallet.privateKey;
    
    logger.loading(`[${i}/${count}] Creating wallet: ${address.substring(0, 12)}...`);
    
    const browser = await puppeteer.launch({
      headless: 'new',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--disable-gpu',
        '--single-process'
      ]
    });

    try {
      const page = await browser.newPage();
      
      await page.setViewport({ width: 1280, height: 800 });
      await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
      
      // Inject Ethereum provider
      await page.evaluateOnNewDocument((privKey, addr) => {
        const createProvider = () => {
          let currentAddress = addr;
          
          return {
            isMetaMask: true,
            selectedAddress: currentAddress,
            chainId: '0x1',
            networkVersion: '1',
            _events: {},
            _eventsCount: 0,
            
            on: function(event, callback) {
              this._events[event] = this._events[event] || [];
              this._events[event].push(callback);
              return this;
            },
            
            removeListener: function(event, callback) {
              if (this._events[event]) {
                this._events[event] = this._events[event].filter(cb => cb !== callback);
              }
              return this;
            },
            
            request: async function({ method, params }) {
              console.log('ETH Request:', method, params);
              
              if (method === 'eth_requestAccounts' || method === 'eth_accounts') {
                return [currentAddress];
              }
              
              if (method === 'personal_sign') {
                const message = params[0];
                const hexMessage = message.startsWith('0x') ? message : message;
                
                // Simple signature simulation
                const msgHash = hexMessage;
                const signature = '0x' + privKey.substring(2, 66) + 'a'.repeat(64) + '1b';
                
                console.log('Signing message:', message);
                return signature;
              }
              
              if (method === 'eth_chainId') {
                return '0x1';
              }
              
              if (method === 'eth_sign') {
                const signature = '0x' + privKey.substring(2, 66) + 'a'.repeat(64) + '1b';
                return signature;
              }
              
              if (method === 'wallet_switchEthereumChain') {
                return null;
              }
              
              return null;
            },
            
            sendAsync: function(payload, callback) {
              this.request(payload).then(result => {
                callback(null, { result });
              }).catch(err => {
                callback(err);
              });
            },
            
            send: function(payload, callback) {
              if (typeof payload === 'string') {
                return this.request({ method: payload, params: callback || [] });
              }
              return this.sendAsync(payload, callback);
            }
          };
        };
        
        window.ethereum = createProvider();
        window.web3 = { currentProvider: window.ethereum };
      }, privateKey, address);
      
      logger.loading('Opening BlockStreet...');
      await page.goto(pageurl, {
        waitUntil: 'networkidle2',
        timeout: 60000
      });
      
      await sleep(3000);
      
      // Solve captcha with 2Captcha
      logger.loading('Solving captcha...');
      const captchaToken = await solve2Captcha(apikey, sitekey, pageurl);
      
      // Inject captcha token into page
      await page.evaluate((token) => {
        const inputs = document.querySelectorAll('input[name="cf-turnstile-response"]');
        inputs.forEach(input => {
          input.value = token;
        });
        
        // Also try to set in window
        window.turnstileToken = token;
        
        // Dispatch event
        const event = new Event('input', { bubbles: true });
        inputs.forEach(input => input.dispatchEvent(event));
      }, captchaToken);
      
      await sleep(2000);
      
      // Click Connect Wallet
      logger.loading('Connecting wallet...');
      const connected = await page.evaluate(() => {
        const buttons = Array.from(document.querySelectorAll('button, a, div[role="button"]'));
        const connectBtn = buttons.find(btn => {
          const text = btn.textContent.toLowerCase();
          return text.includes('connect') && (text.includes('wallet') || text.includes('metamask'));
        });
        
        if (connectBtn) {
          connectBtn.click();
          return true;
        }
        return false;
      });
      
      if (!connected) {
        logger.warn('Connect button not found, trying alternative method...');
      }
      
      await sleep(3000);
      
      // Select MetaMask
      logger.loading('Selecting MetaMask...');
      await page.evaluate(() => {
        const elements = Array.from(document.querySelectorAll('*'));
        const metaMaskBtn = elements.find(el => {
          const text = el.textContent.toLowerCase();
          return text.includes('metamask') || text.includes('browser wallet');
        });
        
        if (metaMaskBtn) metaMaskBtn.click();
      });
      
      await sleep(3000);
      
      // Enter invite code if field exists
      logger.loading('Entering invite code...');
      const inviteEntered = await page.evaluate((code) => {
        const inputs = Array.from(document.querySelectorAll('input'));
        const inviteInput = inputs.find(input => {
          const placeholder = (input.placeholder || '').toLowerCase();
          const name = (input.name || '').toLowerCase();
          return placeholder.includes('invite') || placeholder.includes('code') || 
                 placeholder.includes('referral') || name.includes('invite') || name.includes('code');
        });
        
        if (inviteInput) {
          inviteInput.value = code;
          inviteInput.dispatchEvent(new Event('input', { bubbles: true }));
          inviteInput.dispatchEvent(new Event('change', { bubbles: true }));
          return true;
        }
        return false;
      }, inviteCode);
      
      if (inviteEntered) {
        logger.success('Invite code entered');
      }
      
      await sleep(2000);
      
      // Click submit/sign button
      logger.loading('Submitting registration...');
      await page.evaluate(() => {
        const buttons = Array.from(document.querySelectorAll('button'));
        const submitBtn = buttons.find(btn => {
          const text = btn.textContent.toLowerCase();
          return text.includes('submit') || text.includes('register') || 
                 text.includes('sign') || text.includes('continue') || text.includes('confirm');
        });
        
        if (submitBtn && !submitBtn.disabled) {
          submitBtn.click();
        }
      });
      
      await sleep(5000);
      
      // Get session from cookies
      const cookies = await page.cookies();
      const sessionCookie = cookies.find(c => c.name === 'gfsessionid');
      const sessionId = sessionCookie ? sessionCookie.value : null;
      
      // Check for success
      const pageContent = await page.content();
      const isSuccess = pageContent.includes('dashboard') || 
                       pageContent.includes('success') || 
                       sessionId !== null;
      
      if (isSuccess) {
        logger.success(`✅ Wallet registered: ${address}`);
        if (sessionId) {
          logger.info(`Session ID: ${sessionId}`);
        }
        
        const walletData = { address, privateKey, sessionId };
        wallets.push(walletData);
        
        const existingWallets = fs.existsSync('wallets.json') 
          ? JSON.parse(fs.readFileSync('wallets.json', 'utf8')) 
          : [];
        existingWallets.push(walletData);
        fs.writeFileSync('wallets.json', JSON.stringify(existingWallets, null, 2));
      } else {
        logger.error('Registration may have failed - check manually');
      }
      
      await browser.close();
      logger.info('');
      
      if (i < count) {
        logger.info('Waiting 10 seconds before next wallet...\n');
        await sleep(10000);
      }
      
    } catch (err) {
      logger.error(`Error: ${err.message}`);
      await browser.close();
    }
  }
  
  logger.success(`\nCompleted! Created ${wallets.length}/${count} wallets`);
  logger.info(`Wallets saved to wallets.json\n`);
  return wallets;
}

async function main() {
  logger.banner();
  
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const question = (query) => new Promise(resolve => rl.question(query, resolve));

  try {
    const inviteCode = process.env.INVITE_CODE || 
      (fs.existsSync('code.txt') ? fs.readFileSync('code.txt', 'utf8').trim() : '');
    
    const apikey = process.env.CAPTCHA_API_KEY || 
      (fs.existsSync('key.txt') ? fs.readFileSync('key.txt', 'utf8').trim() : '');
    
    if (!inviteCode) {
      logger.error('Invite code not found!');
      logger.error('Add to code.txt or .env as INVITE_CODE');
      rl.close();
      return;
    }
    
    if (!apikey) {
      logger.error('2Captcha API key not found!');
      logger.error('Add to key.txt or .env as CAPTCHA_API_KEY');
      rl.close();
      return;
    }
    
    logger.info(`Invite Code: ${inviteCode}`);
    logger.info(`Running in VPS headless mode\n`);
    
    const count = await question(`${colors.cyan}How many wallets to create? ${colors.reset}`);
    const numCount = parseInt(count);
    
    if (isNaN(numCount) || numCount < 1) {
      logger.error('Invalid number!');
      rl.close();
      return;
    }
    
    logger.info('');
    await autoReferral(inviteCode, apikey, numCount);
    
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