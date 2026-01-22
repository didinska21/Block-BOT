const fs = require('fs');
const puppeteer = require('puppeteer');
const { ethers } = require('ethers');
const axios = require('axios');
const readline = require('readline');
const dotenv = require('dotenv');
const path = require('path');

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
  debug: (msg) => console.log(`${colors.yellow}[🔍] ${msg}${colors.reset}`),
  banner: () => {
    console.log(`${colors.cyan}${colors.bold}`);
    console.log(`╔═══════════════════════════════════════════╗`);
    console.log(`║  BlockStreet Auto Referral - VPS Ready   ║`);
    console.log(`║         With Debug & Screenshots         ║`);
    console.log(`╚═══════════════════════════════════════════╝${colors.reset}\n`);
  },
};

// Create screenshots directory
const screenshotDir = path.join(__dirname, 'screenshots');
if (!fs.existsSync(screenshotDir)) {
  fs.mkdirSync(screenshotDir);
}

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function takeDebugScreenshot(page, name, walletIndex) {
  try {
    const timestamp = Date.now();
    const filename = `wallet${walletIndex}_${name}_${timestamp}.png`;
    const filepath = path.join(screenshotDir, filename);
    await page.screenshot({ path: filepath, fullPage: true });
    logger.debug(`Screenshot saved: ${filename}`);
    return filepath;
  } catch (err) {
    logger.warn(`Screenshot failed: ${err.message}`);
  }
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
    logger.debug(`Full address: ${address}`);
    
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
      
      // Enable console logging from page
      page.on('console', msg => {
        const type = msg.type();
        if (type === 'error') {
          logger.error(`PAGE ERROR: ${msg.text()}`);
        } else if (type === 'warning') {
          logger.warn(`PAGE WARN: ${msg.text()}`);
        } else {
          logger.debug(`PAGE: ${msg.text()}`);
        }
      });
      
      // Log network requests
      page.on('response', async response => {
        const url = response.url();
        if (url.includes('api') || url.includes('register') || url.includes('auth')) {
          logger.debug(`API Response: ${response.status()} - ${url}`);
          try {
            const body = await response.text();
            if (body.length < 500) {
              logger.debug(`Response body: ${body}`);
            }
          } catch (e) {}
        }
      });
      
      await page.setViewport({ width: 1280, height: 800 });
      await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
      
      // Inject Ethereum provider with proper signing
      await page.evaluateOnNewDocument((privKey, addr) => {
        const { ethers } = require('ethers');
        
        const createProvider = () => {
          let currentAddress = addr;
          const wallet = new ethers.Wallet(privKey);
          
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
                try {
                  const message = params[0];
                  const signature = await wallet.signMessage(
                    typeof message === 'string' && message.startsWith('0x') 
                      ? ethers.utils.arrayify(message)
                      : message
                  );
                  console.log('Message signed successfully');
                  return signature;
                } catch (err) {
                  console.error('Signing error:', err);
                  throw err;
                }
              }
              
              if (method === 'eth_chainId') {
                return '0x1';
              }
              
              if (method === 'eth_sign') {
                try {
                  const message = params[1];
                  const signature = await wallet.signMessage(
                    typeof message === 'string' && message.startsWith('0x')
                      ? ethers.utils.arrayify(message)
                      : message
                  );
                  return signature;
                } catch (err) {
                  console.error('Signing error:', err);
                  throw err;
                }
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
      await takeDebugScreenshot(page, '01_initial_page', i);
      
      // Solve captcha with 2Captcha
      logger.loading('Solving captcha...');
      const captchaToken = await solve2Captcha(apikey, sitekey, pageurl);
      
      // Inject captcha token into page
      await page.evaluate((token) => {
        const inputs = document.querySelectorAll('input[name="cf-turnstile-response"]');
        inputs.forEach(input => {
          input.value = token;
        });
        
        window.turnstileToken = token;
        
        const event = new Event('input', { bubbles: true });
        inputs.forEach(input => input.dispatchEvent(event));
        
        console.log('Captcha token injected:', token.substring(0, 20) + '...');
      }, captchaToken);
      
      await sleep(2000);
      await takeDebugScreenshot(page, '02_after_captcha', i);
      
      // Click Connect Wallet with better detection
      logger.loading('Connecting wallet...');
      const connectResult = await page.evaluate(() => {
        const buttons = Array.from(document.querySelectorAll('button, a, div[role="button"], span[role="button"]'));
        console.log('Total buttons found:', buttons.length);
        
        for (let btn of buttons) {
          const text = btn.textContent.toLowerCase().trim();
          console.log('Button text:', text);
          
          if (text.includes('connect') || text.includes('wallet') || text.includes('metamask')) {
            console.log('Clicking connect button:', btn.textContent);
            btn.click();
            return { success: true, text: btn.textContent };
          }
        }
        
        return { success: false, text: null };
      });
      
      logger.debug(`Connect button result: ${JSON.stringify(connectResult)}`);
      
      if (!connectResult.success) {
        logger.warn('Connect button not found!');
        await takeDebugScreenshot(page, '03_connect_not_found', i);
      }
      
      await sleep(4000);
      await takeDebugScreenshot(page, '04_after_connect', i);
      
      // Wait for modal and select MetaMask
      logger.loading('Waiting for wallet modal...');
      await sleep(2000);
      
      const metaMaskResult = await page.evaluate(() => {
        // Look for MetaMask specifically in the modal
        const buttons = Array.from(document.querySelectorAll('button, div[role="button"], a'));
        
        for (let btn of buttons) {
          const text = btn.textContent.trim();
          console.log('Checking button:', text);
          
          // Check if this is the MetaMask button
          if (text === 'MetaMask' || (text.includes('MetaMask') && text.length < 20)) {
            console.log('Found MetaMask button, clicking...');
            btn.click();
            return { success: true, text: text };
          }
        }
        
        // Alternative: look for elements containing MetaMask logo/icon
        const allElements = Array.from(document.querySelectorAll('*'));
        for (let el of allElements) {
          const innerHTML = el.innerHTML || '';
          const text = el.textContent || '';
          
          if ((text.trim() === 'MetaMask' || innerHTML.includes('MetaMask')) && 
              el.offsetParent !== null && 
              el.clientHeight > 0) {
            console.log('Found MetaMask element (alternative method)');
            el.click();
            return { success: true, text: 'MetaMask (alternative)' };
          }
        }
        
        return { success: false };
      });
      
      logger.debug(`MetaMask selection: ${JSON.stringify(metaMaskResult)}`);
      
      if (!metaMaskResult.success) {
        logger.warn('MetaMask button not found in modal!');
      }
      
      await sleep(4000);
      await takeDebugScreenshot(page, '05_after_metamask', i);
      
      // Wait for registration form/page after connecting
      logger.loading('Waiting for registration form...');
      await sleep(3000);
      await takeDebugScreenshot(page, '06_registration_form', i);
      
      // Check if we need to enter invite code
      logger.loading('Looking for invite code field...');
      const inviteResult = await page.evaluate((code) => {
        const inputs = Array.from(document.querySelectorAll('input'));
        console.log('Total inputs found:', inputs.length);
        
        for (let input of inputs) {
          const placeholder = (input.placeholder || '').toLowerCase();
          const name = (input.name || '').toLowerCase();
          const id = (input.id || '').toLowerCase();
          const label = input.labels && input.labels[0] ? input.labels[0].textContent.toLowerCase() : '';
          
          console.log('Input:', { placeholder, name, id, label, type: input.type });
          
          if (placeholder.includes('invite') || placeholder.includes('code') || 
              placeholder.includes('referral') || name.includes('invite') || 
              name.includes('code') || name.includes('referral') ||
              id.includes('invite') || id.includes('code') ||
              label.includes('invite') || label.includes('referral')) {
            
            console.log('Found invite field, entering code:', code);
            input.focus();
            input.value = code;
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.dispatchEvent(new Event('change', { bubbles: true }));
            input.dispatchEvent(new Event('blur', { bubbles: true }));
            return { success: true, field: placeholder || name || id || label };
          }
        }
        
        return { success: false };
      }, inviteCode);
      
      logger.debug(`Invite code entry: ${JSON.stringify(inviteResult)}`);
      
      if (inviteResult.success) {
        logger.success(`Invite code entered in: ${inviteResult.field}`);
      } else {
        logger.warn('No invite code field found - might not be needed or already filled');
      }
      
      await sleep(2000);
      await takeDebugScreenshot(page, '07_after_invite', i);
      
      // Click submit/sign button - try multiple times if needed
      logger.loading('Looking for submit/sign button...');
      
      let submitClicked = false;
      for (let attempt = 1; attempt <= 3; attempt++) {
        const submitResult = await page.evaluate(() => {
          const buttons = Array.from(document.querySelectorAll('button, div[role="button"], a[role="button"]'));
          console.log('Buttons found for submit:', buttons.length);
          
          for (let btn of buttons) {
            const text = btn.textContent.toLowerCase().trim();
            const disabled = btn.disabled || btn.getAttribute('disabled') !== null;
            const ariaDisabled = btn.getAttribute('aria-disabled') === 'true';
            
            console.log('Submit button candidate:', { 
              text, 
              disabled, 
              ariaDisabled,
              classes: btn.className 
            });
            
            if (!disabled && !ariaDisabled && 
                (text.includes('submit') || text.includes('register') || 
                 text.includes('sign') || text.includes('continue') || 
                 text.includes('confirm') || text.includes('join') ||
                 text.includes('get started') || text === 'next')) {
              
              console.log('Clicking submit button:', btn.textContent);
              btn.click();
              return { success: true, text: btn.textContent.trim() };
            }
          }
          
          return { success: false };
        });
        
        logger.debug(`Submit attempt ${attempt}: ${JSON.stringify(submitResult)}`);
        
        if (submitResult.success) {
          logger.success(`Submit button clicked: ${submitResult.text}`);
          submitClicked = true;
          break;
        }
        
        if (attempt < 3) {
          logger.warn(`Submit button not found, waiting 2s and retrying...`);
          await sleep(2000);
        }
      }
      
      if (!submitClicked) {
        logger.warn('Could not find submit button after 3 attempts');
      }
      
      await sleep(5000);
      await takeDebugScreenshot(page, '08_after_submit', i);
      
      // Wait for potential signature request
      logger.loading('Waiting for signature/confirmation...');
      await sleep(3000);
      
      // Check if there's a signature popup or confirmation needed
      const signatureCheck = await page.evaluate(() => {
        const bodyText = document.body.textContent.toLowerCase();
        return {
          hasSignature: bodyText.includes('sign') && bodyText.includes('message'),
          hasConfirm: bodyText.includes('confirm'),
          hasApprove: bodyText.includes('approve')
        };
      });
      
      logger.debug(`Signature check: ${JSON.stringify(signatureCheck)}`);
      
      if (signatureCheck.hasSignature || signatureCheck.hasConfirm || signatureCheck.hasApprove) {
        logger.loading('Signature/confirmation detected, looking for button...');
        
        await page.evaluate(() => {
          const buttons = Array.from(document.querySelectorAll('button'));
          for (let btn of buttons) {
            const text = btn.textContent.toLowerCase();
            if ((text.includes('sign') || text.includes('confirm') || text.includes('approve')) &&
                !text.includes('cancel') && !text.includes('reject')) {
              console.log('Clicking signature button:', btn.textContent);
              btn.click();
              return;
            }
          }
        });
        
        await sleep(3000);
      }
      
      await takeDebugScreenshot(page, '09_after_signature', i);
      
      // Get session and check success
      const cookies = await page.cookies();
      logger.debug(`Cookies found: ${cookies.length}`);
      cookies.forEach(c => logger.debug(`Cookie: ${c.name} = ${c.value.substring(0, 20)}...`));
      
      const sessionCookie = cookies.find(c => c.name === 'gfsessionid');
      const sessionId = sessionCookie ? sessionCookie.value : null;
      
      // More comprehensive success check
      const successCheck = await page.evaluate(() => {
        const url = window.location.href;
        const body = document.body.textContent.toLowerCase();
        const title = document.title;
        
        // Check for success indicators
        const indicators = {
          url,
          title,
          pathname: window.location.pathname,
          hasDashboard: body.includes('dashboard') || url.includes('dashboard'),
          hasSuccess: body.includes('success') || body.includes('welcome') || body.includes('congratulations'),
          hasComplete: body.includes('complete') || body.includes('registered'),
          hasError: body.includes('error') || body.includes('failed') || body.includes('invalid'),
          hasWalletConnected: body.includes('connected') || body.includes('wallet connected'),
          // Check for task/reward elements that appear after successful registration
          hasTasks: body.includes('daily login') || body.includes('invite a friend'),
          hasTokens: body.includes('bsd token') || body.includes('earn'),
        };
        
        console.log('Success indicators:', indicators);
        return indicators;
      });
      
      logger.debug(`Success check: ${JSON.stringify(successCheck, null, 2)}`);
      logger.debug(`Session ID: ${sessionId || 'none'}`);
      
      // Consider it successful if:
      // 1. Has session ID AND no errors
      // 2. Is on dashboard page
      // 3. Has success/welcome message
      // 4. Has task elements (Daily Login, Invite Friend, etc)
      const isSuccess = (sessionId !== null && !successCheck.hasError) ||
                       successCheck.hasDashboard || 
                       successCheck.hasSuccess || 
                       successCheck.hasComplete ||
                       successCheck.hasTasks ||
                       (successCheck.hasWalletConnected && !successCheck.hasError);
      
      await takeDebugScreenshot(page, '10_final_state', i);
      
      if (isSuccess) {
        logger.success(`✅ Wallet registered successfully!`);
        logger.success(`Address: ${address}`);
        if (sessionId) {
          logger.info(`Session ID: ${sessionId}`);
        }
        
        const walletData = { 
          address, 
          privateKey, 
          sessionId,
          timestamp: new Date().toISOString(),
          inviteCode 
        };
        wallets.push(walletData);
        
        const existingWallets = fs.existsSync('wallets.json') 
          ? JSON.parse(fs.readFileSync('wallets.json', 'utf8')) 
          : [];
        existingWallets.push(walletData);
        fs.writeFileSync('wallets.json', JSON.stringify(existingWallets, null, 2));
      } else {
        logger.error('Registration failed!');
        logger.error(`URL: ${successCheck.url}`);
        logger.error(`Title: ${successCheck.title}`);
        logger.error('Check screenshots in ./screenshots/ folder');
        
        // Save failed attempt
        const failedData = {
          address,
          privateKey,
          timestamp: new Date().toISOString(),
          error: 'Registration failed',
          details: successCheck
        };
        
        const failedWallets = fs.existsSync('failed.json')
          ? JSON.parse(fs.readFileSync('failed.json', 'utf8'))
          : [];
        failedWallets.push(failedData);
        fs.writeFileSync('failed.json', JSON.stringify(failedWallets, null, 2));
      }
      
      await browser.close();
      logger.info('');
      
      if (i < count) {
        logger.info('Waiting 10 seconds before next wallet...\n');
        await sleep(10000);
      }
      
    } catch (err) {
      logger.error(`Error: ${err.message}`);
      logger.error(`Stack: ${err.stack}`);
      
      try {
        await takeDebugScreenshot(page, 'ERROR', i);
      } catch (e) {}
      
      await browser.close();
    }
  }
  
  logger.success(`\n${'='.repeat(50)}`);
  logger.success(`Completed! Created ${wallets.length}/${count} wallets`);
  logger.info(`Successful wallets saved to: wallets.json`);
  if (fs.existsSync('failed.json')) {
    logger.warn(`Failed attempts saved to: failed.json`);
  }
  logger.info(`Screenshots saved to: ./screenshots/`);
  logger.success(`${'='.repeat(50)}\n`);
  
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
    logger.info(`2Captcha API Key: ${apikey.substring(0, 8)}...`);
    logger.info(`Running in VPS headless mode with debug`);
    logger.info(`Screenshots will be saved to: ./screenshots/\n`);
    
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
    logger.error(`Stack: ${err.stack}`);
    rl.close();
  }
}

main().catch(err => {
  logger.error(`Error: ${err.message}`);
  process.exit(1);
});