const mineflayer = require('mineflayer')
const cmd = require('mineflayer-cmd').plugin
const fs = require('fs');
const path = require('path');

let rawdata = fs.readFileSync('config.json');
let data = JSON.parse(rawdata);

const nightskip = data["auto-night-skip"];
const host = data["ip"];
const baseUsername = data["name"];

// Helper to generate a highly random username (to avoid patterns and bans)
function randomUsername() {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let suffix = '';
  for (let i = 0; i < 8; i++) suffix += chars[Math.floor(Math.random() * chars.length)];
  return baseUsername + '_' + suffix;
}

let bot = null;
let username = randomUsername();
let reconnectTimeout = null;
let usernameChangeTimeout = null;
let playerCheckInterval = null;
let lastUsernameChange = Date.now();
let lastPlayerCount = 0;
let lastAlive = Date.now();
let heartbeatInterval = null;
let watchdogInterval = null;
const logFile = 'bot.log';
let failureCount = 0;
const MAX_FAILURES = 10;

function logEvent(message) {
  const logMsg = `[${new Date().toLocaleTimeString()}] ${message}`;
  console.log(logMsg);
  fs.appendFileSync(logFile, logMsg + '\n');
}

function createBot() {
  // Always generate a new username for every attempt, infinitely
  if (bot) {
    try { bot.quit(); } catch (e) {}
    bot = null;
  }
  username = randomUsername();
  try {
    bot = mineflayer.createBot({
      host: host,
      username: username
    });
    bot.loadPlugin(cmd);
    setupBotEvents(bot);
    lastAlive = Date.now();
    failureCount = 0; // Reset on successful create
    logEvent(`Bot created with username: ${username}`);
  } catch (err) {
    failureCount++;
    logEvent(`Failed to create bot: ${err}`);
    if (failureCount >= MAX_FAILURES) {
      logEvent('ALERT: Bot failed to connect 10 times in a row!');
    }
    // Try again with a new username, infinitely
    setTimeout(() => createBot(), 5000);
  }
}

function setupBotEvents(bot) {
  bot.on('login', () => {
    logEvent(`Logged in as ${bot.username}`);
    bot.chat('hello');
    lastUsernameChange = Date.now();
    lastAlive = Date.now();
    failureCount = 0;
  });

  bot.on('time', function(time) {
    if (nightskip == "true" && bot.time.timeOfDay >= 13000) {
      bot.chat('/time set day');
    }
    // Human-like random movement
    if (Math.random() < 0.05) {
      const actions = ['forward', 'back', 'left', 'right', 'jump'];
      const action = actions[Math.floor(Math.random() * actions.length)];
      bot.setControlState(action, true);
      setTimeout(() => bot.setControlState(action, false), 500 + Math.random() * 1000);
    }
    // Randomly look around
    if (Math.random() < 0.03) {
      bot.look(Math.random() * Math.PI * 2, Math.random() * Math.PI / 2 - Math.PI / 4, true);
    }
    // Random chat
    if (Math.random() < 0.01) {
      const messages = ['hi', 'hello', 'afk', 'nice server', 'cool', 'o/', 'just chilling'];
      bot.chat(messages[Math.floor(Math.random() * messages.length)]);
    }
    lastAlive = Date.now();
  });

  bot.on('spawn', () => {
    logEvent('Spawned in the world.');
    lastAlive = Date.now();
  });

  bot.on('death', () => {
    logEvent('Bot died and will respawn.');
    bot.emit('respawn');
  });

  bot.on('kicked', (reason) => {
    failureCount++;
    logEvent(`Kicked: ${reason}`);
    if (failureCount >= MAX_FAILURES) {
      logEvent('ALERT: Bot failed to connect 10 times in a row!');
    }
    // In all event handlers (kicked, end, error), the bot will always call createBot(), which generates a new username and tries again, infinitely.
    setTimeout(() => createBot(), 2000);
  });

  bot.on('end', () => {
    failureCount++;
    logEvent('Disconnected. Reconnecting...');
    if (failureCount >= MAX_FAILURES) {
      logEvent('ALERT: Bot failed to connect 10 times in a row!');
    }
    setTimeout(() => createBot(), 2000);
  });

  bot.on('error', (err) => {
    failureCount++;
    logEvent(`Error: ${err}`);
    if (failureCount >= MAX_FAILURES) {
      logEvent('ALERT: Bot failed to connect 10 times in a row!');
    }
    setTimeout(() => createBot(), 2000);
  });
}

// Monitor players and handle smart connection
function monitorPlayers() {
  if (!bot || !bot.players) return;
  const playerNames = Object.keys(bot.players).filter(p => p !== bot.username);
  const realPlayers = playerNames.filter(p => !bot.players[p].isBot);
  lastPlayerCount = realPlayers.length;
  if (realPlayers.length > 0) {
    // Real player joined, disconnect bot
    console.log(`[${new Date().toLocaleTimeString()}] Real player detected (${realPlayers.join(', ')}). Disconnecting bot.`);
    if (bot) bot.quit();
  }
}

// Periodically check if server is empty and reconnect if needed
function periodicCheck() {
  if (!bot || !bot.players) return;
  const playerNames = Object.keys(bot.players).filter(p => p !== bot.username);
  const realPlayers = playerNames.filter(p => !bot.players[p].isBot);
  if (realPlayers.length === 0 && (!bot || !bot._client || bot._client.state !== 'play')) {
    // No real players and bot is not connected, reconnect
    console.log(`[${new Date().toLocaleTimeString()}] No real players. Ensuring bot is connected.`);
    createBot();
  }
}

// Username rotation every 1-2 hours
function scheduleUsernameChange() {
  const interval = 60 * 60 * 1000 + Math.random() * 60 * 60 * 1000; // 1-2 hours
  if (usernameChangeTimeout) clearTimeout(usernameChangeTimeout);
  usernameChangeTimeout = setTimeout(() => {
    console.log(`[${new Date().toLocaleTimeString()}] Rotating username...`);
    // Connect new bot, then disconnect old one
    const oldBot = bot;
    createBot();
    setTimeout(() => {
      if (oldBot) oldBot.quit();
    }, 5000 + Math.random() * 5000); // Wait 5-10 seconds before quitting old bot
    scheduleUsernameChange();
  }, interval);
}

// Start everything
createBot();
if (playerCheckInterval) clearInterval(playerCheckInterval);
playerCheckInterval = setInterval(() => {
  monitorPlayers();
  periodicCheck();
}, 5000);
scheduleUsernameChange();

// Heartbeat log every minute
if (heartbeatInterval) clearInterval(heartbeatInterval);
heartbeatInterval = setInterval(() => {
  logEvent(`Heartbeat: bot process is alive. Last bot activity: ${new Date(lastAlive).toLocaleTimeString()}`);
}, 60000);

// Watchdog: force reconnect if not alive for >10 seconds
if (watchdogInterval) clearInterval(watchdogInterval);
watchdogInterval = setInterval(() => {
  if (Date.now() - lastAlive > 10000) {
    console.log(`[${new Date().toLocaleTimeString()}] Watchdog: No activity for 10s, forcing reconnect.`);
    createBot();
  }
}, 5000);

// --- Express Web Server for Health Checks ---
const express = require('express');
const app = express();
const port = process.env.PORT || 8000;

// Main route
app.get('/', (req, res) => {
  res.send('Bot has arrived');
});

// ✅ Health check route for Render or UptimeRobot
app.get('/healthz', (req, res) => {
  res.status(200).send('OK');
});

// Start server
app.listen(port, () => {
  console.log(`Server started on port ${port}`);
});