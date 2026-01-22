const fs = require('fs');
const puppeteer = require('puppeteer');
const { ethers } = require('ethers');
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
    console.log(`║  BlockStreet Auto Referral - Puppeteer   ║`);
    console.log(`╚═══════════════════════════════════════════╝${colors.reset}\n`);
  },
};

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function autoReferral(inviteCode, count, headless = false) {
  logger.info(`Starting Auto Referral - Creating ${count} wallet(s)\n`);
  
  const wallets = [];
  
  for (let i = 1; i <= count; i++) {
    const wallet = ethers.Wallet.createRandom();
    const address = wallet.address;
    const privateKey = wallet.privateKey;
    
    logger.loading(`[${i}/${count}] Creating wallet: ${address.substring(0, 12)}...`);
    
    const browser = await puppeteer.launch({
      headless: headless,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--disable-gpu'
      ]
    });

    try {
      const page = await browser.newPage();
      
      // Set viewport
      await page.setViewport({ width: 1280, height: 800 });
      
      // Block unnecessary resources
      await page.setRequestInterception(true);
      page.on('request', (req) => {
        if(['image', 'stylesheet', 'font'].includes(req.resourceType())){
          req.abort();
        } else {
          req.continue();
        }
      });
      
      logger.loading('Opening BlockStreet...');
      await page.goto('https://blockstreet.money/dashboard', {
        waitUntil: 'networkidle2',
        timeout: 60000
      });
      
      await sleep(3000);
      
      // Click Connect Wallet button
      logger.loading('Clicking Connect Wallet...');
      await page.waitForSelector('button:has-text("Connect Wallet"), button:has-text("Connect"), [class*="connect"]', { timeout: 10000 });
      await page.evaluate(() => {
        const buttons = Array.from(document.querySelectorAll('button'));
        const connectBtn = buttons.find(btn => 
          btn.textContent.includes('Connect') || 
          btn.textContent.includes('Wallet')
        );
        if (connectBtn) connectBtn.click();
      });
      
      await sleep(2000);
      
      // Select MetaMask or wallet option
      logger.loading('Selecting wallet type...');
      await page.evaluate(() => {
        const elements = Array.from(document.querySelectorAll('*'));
        const metaMaskBtn = elements.find(el => 
          el.textContent.includes('MetaMask') ||
          el.textContent.includes('Browser Wallet') ||
          el.textContent.includes('Injected')
        );
        if (metaMaskBtn) metaMaskBtn.click();
      });
      
      await sleep(2000);
      
      // Inject wallet
      logger.loading('Injecting wallet...');
      await page.evaluateOnNewDocument((privKey) => {
        window.ethereum = {
          isMetaMask: true,
          request: async ({ method, params }) => {
            if (method === 'eth_requestAccounts' || method === 'eth_accounts') {
              const ethers = require('ethers');
              const wallet = new ethers.Wallet(privKey);
              return [wallet.address];
            }
            if (method === 'personal_sign') {
              const ethers = require('ethers');
              const wallet = new ethers.Wallet(privKey);
              const message = params[0];
              return await wallet.signMessage(message);
            }
            if (method === 'eth_chainId') {
              return '0x1';
            }
            return null;
          },
          selectedAddress: null,
          chainId: '0x1',
        };
      }, privateKey);
      
      // Wait for page to process
      logger.loading('Processing authentication...');
      await sleep(5000);
      
      // Look for invite code input
      logger.loading('Looking for invite code field...');
      const inviteInputs = await page.$$('input[placeholder*="code"], input[placeholder*="invite"], input[placeholder*="referral"]');
      
      if (inviteInputs.length > 0) {
        logger.loading('Entering invite code...');
        await inviteInputs[0].type(inviteCode, { delay: 100 });
        await sleep(1000);
      }
      
      // Wait for Turnstile captcha to appear
      logger.loading('Waiting for captcha...');
      logger.warn('⚠️  PLEASE SOLVE THE CAPTCHA MANUALLY IN THE BROWSER!');
      logger.info('Waiting up to 120 seconds for captcha to be solved...');
      
      // Wait for captcha iframe
      await page.waitForSelector('iframe[src*="turnstile"]', { timeout: 30000 });
      
      // Wait for captcha to be solved (check if submit button becomes enabled or captcha disappears)
      let captchaSolved = false;
      let attempts = 0;
      while (!captchaSolved && attempts < 120) {
        await sleep(1000);
        attempts++;
        
        // Check if captcha iframe still exists
        const captchaExists = await page.$('iframe[src*="turnstile"]');
        if (!captchaExists) {
          captchaSolved = true;
          logger.success('Captcha solved!');
          break;
        }
        
        // Check if there's a success indicator
        const successIndicator = await page.evaluate(() => {
          const iframe = document.querySelector('iframe[src*="turnstile"]');
          if (iframe) {
            const parent = iframe.parentElement;
            return parent && parent.querySelector('[class*="success"]');
          }
          return false;
        });
        
        if (successIndicator) {
          captchaSolved = true;
          logger.success('Captcha solved!');
          break;
        }
        
        if (attempts % 10 === 0) {
          logger.loading(`Still waiting... (${attempts}s)`);
        }
      }
      
      if (!captchaSolved) {
        logger.error('Captcha timeout - please solve it faster next time');
        await browser.close();
        continue;
      }
      
      await sleep(2000);
      
      // Click submit/register button
      logger.loading('Submitting registration...');
      await page.evaluate(() => {
        const buttons = Array.from(document.querySelectorAll('button'));
        const submitBtn = buttons.find(btn => 
          btn.textContent.includes('Submit') ||
          btn.textContent.includes('Register') ||
          btn.textContent.includes('Sign') ||
          btn.textContent.includes('Continue')
        );
        if (submitBtn) submitBtn.click();
      });
      
      await sleep(5000);
      
      // Check if registration was successful
      const currentUrl = page.url();
      logger.info(`Current URL: ${currentUrl}`);
      
      // Try to get session from cookies
      const cookies = await page.cookies();
      const sessionCookie = cookies.find(c => c.name === 'gfsessionid');
      const sessionId = sessionCookie ? sessionCookie.value : null;
      
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
    
    if (!inviteCode) {
      logger.error('Invite code not found!');
      logger.error('Add to code.txt or .env as INVITE_CODE');
      rl.close();
      return;
    }
    
    logger.info(`Invite Code: ${inviteCode}\n`);
    
    const count = await question(`${colors.cyan}How many wallets to create? ${colors.reset}`);
    const numCount = parseInt(count);
    
    if (isNaN(numCount) || numCount < 1) {
      logger.error('Invalid number!');
      rl.close();
      return;
    }
    
    const mode = await question(`${colors.cyan}Run in headless mode? (y/n) [default: n] ${colors.reset}`);
    const headless = mode.toLowerCase() === 'y';
    
    logger.info('');
    await autoReferral(inviteCode, numCount, headless);
    
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
