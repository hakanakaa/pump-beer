/* ==========================================================================
   Pump.beer Frontend Logic - Live Draw Engine with Express Backend Revisions
   ========================================================================== */

// --- Global Audio Engine (Web Audio API) ---
class SoundEngine {
    constructor() {
        this.ctx = null;
        this.enabled = true;
    }

    init() {
        if (!this.ctx) {
            this.ctx = new (window.AudioContext || window.webkitAudioContext)();
        }
        if (this.ctx.state === 'suspended') {
            this.ctx.resume();
        }
    }

    toggle(forceState = null) {
        this.enabled = forceState !== null ? forceState : !this.enabled;
        return this.enabled;
    }

    // Play a smooth pop sound (tactile click) for spinner card ticks
    playTick() {
        if (!this.enabled) return;
        this.init();
        
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        
        osc.type = 'sine';
        osc.frequency.setValueAtTime(950, this.ctx.currentTime);
        
        gain.gain.setValueAtTime(0.06, this.ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.02);
        
        osc.connect(gain);
        gain.connect(this.ctx.destination);
        
        osc.start();
        osc.stop(this.ctx.currentTime + 0.025);
    }

    // Play a smooth cheers clink sound (high metallic sine clink)
    playCheers() {
        if (!this.enabled) return;
        this.init();

        const time = this.ctx.currentTime;
        
        const osc1 = this.ctx.createOscillator();
        const osc2 = this.ctx.createOscillator();
        const gain = this.ctx.createGain();

        osc1.type = 'sine';
        osc1.frequency.setValueAtTime(1550, time);
        osc1.frequency.linearRampToValueAtTime(1600, time + 0.05);

        osc2.type = 'sine';
        osc2.frequency.setValueAtTime(2150, time);
        osc2.frequency.linearRampToValueAtTime(2180, time + 0.06);

        gain.gain.setValueAtTime(0.12, time);
        gain.gain.exponentialRampToValueAtTime(0.001, time + 0.35);

        osc1.connect(gain);
        osc2.connect(gain);
        gain.connect(this.ctx.destination);

        osc1.start(time);
        osc1.stop(time + 0.35);
        osc2.start(time);
        osc2.stop(time + 0.35);
    }

    // Play a low, smooth sweep sound (whoosh/cork-pop) for launch
    playSpinLaunch() {
        if (!this.enabled) return;
        this.init();

        const time = this.ctx.currentTime;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();

        osc.type = 'sine';
        osc.frequency.setValueAtTime(320, time);
        osc.frequency.exponentialRampToValueAtTime(80, time + 0.3);

        gain.gain.setValueAtTime(0.15, time);
        gain.gain.exponentialRampToValueAtTime(0.001, time + 0.3);

        osc.connect(gain);
        gain.connect(this.ctx.destination);

        osc.start(time);
        osc.stop(time + 0.3);
    }

    // Play a beautiful, warm harmonic major-9th chime cascade for victory
    playWin() {
        if (!this.enabled) return;
        this.init();

        const time = this.ctx.currentTime;
        // Warm C Major 9th chord arpeggio (C4, E4, G4, B4, D5)
        const notes = [261.63, 329.63, 392.00, 493.88, 587.33];
        
        notes.forEach((freq, i) => {
            const osc = this.ctx.createOscillator();
            const gain = this.ctx.createGain();
            
            osc.type = 'sine';
            osc.frequency.setValueAtTime(freq, time + i * 0.06);
            
            gain.gain.setValueAtTime(0.0, time + i * 0.06);
            gain.gain.linearRampToValueAtTime(0.08, time + i * 0.06 + 0.03);
            gain.gain.exponentialRampToValueAtTime(0.001, time + i * 0.06 + 0.6);
            
            osc.connect(gain);
            gain.connect(this.ctx.destination);
            
            osc.start(time + i * 0.06);
            osc.stop(time + i * 0.06 + 0.65);
        });
    }
}

const sounds = new SoundEngine();

// --- Real Token CA Details ---
let CONTRACT_ADDRESS = "FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump";

// --- Offline Backup Holders in case backend load is in progress or RPC rate-limits ---
const BACKUP_HOLDERS = [
    { name: "Haka77d...Mug", full: "Haka77d2Bnd7XsY8Bnd92XypQwsGulpMug" },
    { name: "FeMbDox...ump", full: "FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump" },
    { name: "Degen99...Keg", full: "Degen99XyPqR9sNcsd2B3vSpd8qTapsKeg" },
    { name: "Chur456...Bar", full: "Chur456XvBsD3XsnDbd892SpwNdKegBar" },
    { name: "Gulp888...Pub", full: "Gulp888BvCsN9vSdcbd771QpwsNMugPub" },
    { name: "Pint777...Tap", full: "Pint777PscR9xWsDbd292XzpWndFoamTap" },
    { name: "Sol420x...Sol", full: "Sol420xVnD892XsCsd991SdpwNDMoonSol" },
    { name: "Beer888...Fun", full: "Beer888Psc72BnsDbd228SnpwNDBeerFun" },
    { name: "Rug999x...Bye", full: "Rug999xNcd28BnsQws992XspwNdRugBye" },
    { name: "Pump222...win", full: "Pump222Psc99XsYbd112DgpwNDWinPump" }
];

// Active Holders Pool (fetched dynamically from backend SPL Token parser)
let liveHolders = [...BACKUP_HOLDERS];

// --- Live Stats & Configuration ---
const LIVE_STATS = {
    rewardableAmount: 0.0, // SOL (Synced via WS)
    totalPoured: 0.0,     // SOL (Synced via WS)
    rewards: [
        { emoji: '🍺', valueText: '0.01 SOL', valueNum: 0.01, rarity: 'common' },
        { emoji: '🍺🍺', valueText: '0.03 SOL', valueNum: 0.03, rarity: 'common' },
        { emoji: '🍺🍺🍺', valueText: '0.05 SOL', valueNum: 0.05, rarity: 'common' },
        { emoji: '🍺🍺🍺🍺', valueText: '0.07 SOL', valueNum: 0.07, rarity: 'uncommon' },
        { emoji: '🍺🍺🍺🍺🍺', valueText: '0.10 SOL', valueNum: 0.10, rarity: 'uncommon' },
        { emoji: '🍺🍺🍺🍺🍺🍺', valueText: '0.12 SOL', valueNum: 0.12, rarity: 'rare' },
        { emoji: '🍺🍺🍺🍺🍺🍺🍺', valueText: '0.15 SOL', valueNum: 0.15, rarity: 'jackpot' }
    ]
};

// --- App State ---
let isSpinning = false;
let loopState = "COOLDOWN"; // COOLDOWN | SPINNING | WINNER | PAUSED
let currentWinner = null;
let currentPrize = null;
let lastTxHash = null;

// Card Sizing (Matches style.css absolute size)
const CARD_WIDTH = 140; // px
const CARD_GAP = 12;    // px
const CARD_OUTER = CARD_WIDTH + CARD_GAP; // 152px

// --- DOM Elements ---
const btnSoundToggle = document.getElementById('btn-sound-toggle');
const btnCopyCaNav = document.getElementById('btn-copy-ca-nav');
const btnCopyCaHero = document.getElementById('btn-copy-ca-hero');
const spinnerTrack = document.getElementById('spinner-track');
const rewardableAmountDisplay = document.getElementById('rewardable-amount-display');
const navRewardableAmount = document.getElementById('stat-rewardable-amount');
const navTotalPoured = document.getElementById('stat-total-poured');
const consoleStatusText = document.getElementById('console-status-text');
const consoleProgressBar = document.getElementById('console-progress-bar');
const spinStatusBadge = document.getElementById('spin-status-badge');
const activityList = document.getElementById('activity-scroll-list');
const giantBeerContainer = document.querySelector('.giant-beer-container');
const giantBeerMug = document.querySelector('.giant-beer-mug');

// Toast Container
const toastContainer = document.getElementById('toast-container');

// --- Helper Functions ---

// Display a pop-art toast alert
function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    
    let emoji = 'ℹ️';
    if (type === 'success') emoji = '🍺';
    if (type === 'error') emoji = '💥';
    
    toast.innerHTML = `<span>${emoji}</span><span>${message}</span>`;
    toastContainer.appendChild(toast);
    
    // Animate in
    setTimeout(() => toast.classList.add('show'), 50);
    
    // Animate out
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 300);
    }, 2500);
}

// CA copy to clipboard function
function copyCA() {
    navigator.clipboard.writeText(CONTRACT_ADDRESS).then(() => {
        showToast("Contract Address copied to clipboard!", "success");
        sounds.playCheers();
        
        // Add visual success styling to both CA buttons
        const copyBtns = [btnCopyCaNav, btnCopyCaHero];
        copyBtns.forEach(btn => {
            if (!btn) return;
            btn.classList.add('btn-ca-copied');
            const originalHTML = btn.innerHTML;
            btn.innerHTML = "COPIED! ✓";
            
            setTimeout(() => {
                btn.classList.remove('btn-ca-copied');
                btn.innerHTML = originalHTML;
            }, 1800);
        });
    }).catch(err => {
        showToast("Failed to copy address", "error");
    });
}

// Select random holder wallet for non-winning cards
function getRandomHolder() {
    return liveHolders[Math.floor(Math.random() * liveHolders.length)];
}

// Populate spinner track with cards
function initSpinnerTrack(winningHolder = null, winningPrize = null) {
    spinnerTrack.innerHTML = '';
    
    // Generating 45 cards in total.
    // Card index 30 is the WINNING card.
    const totalCards = 45;
    const winningIndex = 30;
    
    for (let i = 0; i < totalCards; i++) {
        let holder;
        let prize;
        
        if (i === winningIndex && winningHolder && winningPrize) {
            holder = winningHolder;
            prize = winningPrize;
        } else {
            holder = getRandomHolder();
            prize = LIVE_STATS.rewards[Math.floor(Math.random() * LIVE_STATS.rewards.length)];
        }
        
        const card = document.createElement('div');
        card.className = `reel-item tier-${prize.rarity}`;
        
        // Count number of emoji characters (dealing with emoji surrogate pairs properly)
        const emojiCount = [...prize.emoji].length;
        let emojiClass = "reel-item-emoji";
        if (emojiCount >= 6) {
            emojiClass += " emoji-long";
        } else if (emojiCount >= 4) {
            emojiClass += " emoji-medium";
        }

        card.innerHTML = `
            <div class="reel-item-address">${holder.name}</div>
            <div class="${emojiClass}">${prize.emoji}</div>
            <div class="reel-item-reward">${prize.valueText}</div>
        `;
        
        spinnerTrack.appendChild(card);
    }
    
    // Reset track position to 0
    spinnerTrack.style.transition = 'none';
    spinnerTrack.style.transform = 'translateX(0px)';
}

// Tick Audio tracker
function trackFastTicks(finalTranslation) {
    const startTime = performance.now();
    const duration = 800; // 0.8s spin
    let lastTickedCard = 0;
    
    function animateTicks(now) {
        if (loopState !== "SPINNING") return;
        
        const elapsed = now - startTime;
        const progress = Math.min(elapsed / duration, 1);
        
        const frameLeft = document.querySelector('.csgo-spinner-frame').getBoundingClientRect().left;
        const trackLeft = spinnerTrack.getBoundingClientRect().left;
        const frameCenter = frameLeft + (document.querySelector('.csgo-spinner-frame').offsetWidth / 2);
        
        const centerPosOnTrack = frameCenter - trackLeft;
        const currentCardIndex = Math.floor(centerPosOnTrack / CARD_OUTER);
        
        if (currentCardIndex !== lastTickedCard && currentCardIndex >= 0 && currentCardIndex < 45) {
            sounds.playTick();
            lastTickedCard = currentCardIndex;
        }
        
        if (progress < 1) {
            requestAnimationFrame(animateTicks);
        }
    }
    
    requestAnimationFrame(animateTicks);
}

// Reveal final drawing winner
function revealWinner(txHash) {
    if (!currentWinner || !currentPrize) return;
    
    // Set badge status
    spinStatusBadge.textContent = "STATUS: WINNER DRAWN!";
    spinStatusBadge.style.backgroundColor = "#10B981"; // Win green
    
    // Format truncated tx hash link
    const shortTx = txHash.substring(0, 6) + "..." + txHash.substring(txHash.length - 4);
    const txLinkHtml = `<a href="https://solscan.io/tx/${txHash}" target="_blank" class="tx-link">View Tx [${shortTx}] 🔗</a>`;
    
    consoleStatusText.innerHTML = `🍻 WINNER: ${currentWinner.name} WON ${currentPrize.valueText}! 🍻 ${txLinkHtml}`;
    document.querySelector('.spinner-status-console').classList.add('console-win-active');
}

// Append manual winner entries to feed (for active wins)
function appendWinnerToLog(winnerName, prize, txHash) {
    let rarityClass = 'win-common';
    if (prize.rarity === 'uncommon') rarityClass = 'win-uncommon';
    if (prize.rarity === 'rare' || prize.rarity === 'jackpot') rarityClass = 'win-rare';
    
    const shortTx = txHash ? (txHash.substring(0, 6) + "..." + txHash.substring(txHash.length - 4)) : '';
    const txLink = txHash ? `<a href="https://solscan.io/tx/${txHash}" target="_blank" class="tx-link">tx [${shortTx}] 🔗</a>` : '';

    const newItem = document.createElement('div');
    newItem.className = 'activity-item';
    newItem.innerHTML = `
        <span class="winner-addr">${winnerName}</span>
        received <span class="winner-reward ${rarityClass}">${prize.valueText}</span> rebate! 
        ${txLink} <span class="time-ago">just now</span>
    `;
    
    activityList.insertBefore(newItem, activityList.firstChild);
    
    if (activityList.children.length > 5) {
        activityList.removeChild(activityList.lastChild);
    }
}

// Sync stats counters and history log
function updateStats(stats) {
    LIVE_STATS.rewardableAmount = stats.vaultPool;
    LIVE_STATS.totalPoured = stats.totalPoured;

    rewardableAmountDisplay.textContent = `${LIVE_STATS.rewardableAmount.toFixed(2)} SOL`;
    navRewardableAmount.textContent = `${LIVE_STATS.rewardableAmount.toFixed(2)} SOL`;
    navTotalPoured.textContent = `${LIVE_STATS.totalPoured.toFixed(2)} SOL`;

    rebuildActivityLog(stats.recentWinners);
}

// Rebuild entire scroll activity log
function rebuildActivityLog(winners) {
    activityList.innerHTML = '';
    if (!winners || winners.length === 0) {
        activityList.innerHTML = '<div class="activity-item">No drawings recorded yet. Keep the taps open!</div>';
        return;
    }
    
    winners.forEach(w => {
        let rarityClass = 'win-common';
        if (w.rarity === 'uncommon') rarityClass = 'win-uncommon';
        if (w.rarity === 'rare' || w.rarity === 'jackpot') rarityClass = 'win-rare';
        
        const shortTx = w.txHash ? (w.txHash.substring(0, 6) + "..." + w.txHash.substring(w.txHash.length - 4)) : '';
        const txLink = w.txHash ? `<a href="https://solscan.io/tx/${w.txHash}" target="_blank" class="tx-link">tx [${shortTx}] 🔗</a>` : '';

        const timeDiff = Date.now() - w.timestamp;
        let timeAgoText = 'just now';
        if (timeDiff >= 5000) {
            const secs = Math.floor(timeDiff / 1000);
            if (secs < 60) timeAgoText = `${secs}s ago`;
            else timeAgoText = `${Math.floor(secs / 60)}m ago`;
        }

        const item = document.createElement('div');
        item.className = 'activity-item';
        item.innerHTML = `
            <span class="winner-addr">${w.name}</span>
            received <span class="winner-reward ${rarityClass}">${w.prizeText}</span> rebate! 
            ${txLink} <span class="time-ago">${timeAgoText}</span>
        `;
        activityList.appendChild(item);
    });
}

// Sync current loop state
function syncState(state) {
    loopState = state.loopState;
    currentWinner = state.currentWinner;
    currentPrize = state.currentPrize;
    lastTxHash = state.txHash;

    if (loopState === "COOLDOWN") {
        isSpinning = false;
        document.querySelector('.spinner-status-console').classList.remove('console-win-active');
        
        spinStatusBadge.textContent = "STATUS: SELECTING NEXT HOLDER...";
        spinStatusBadge.style.backgroundColor = "#F9A826";
        
        initSpinnerTrack();
        updateCountdown(state.countdownRemaining);
    } else if (loopState === "SPINNING") {
        if (!isSpinning) {
            isSpinning = true;
            spinStatusBadge.textContent = "STATUS: SPINNING TAP...";
            spinStatusBadge.style.backgroundColor = "#10B981";
            consoleStatusText.textContent = "STATUS: POURING COLD REBATE...";
            consoleProgressBar.style.width = "100%";
            consoleProgressBar.style.transition = "none";
            
            initSpinnerTrack(currentWinner, currentPrize);
            
            const winningIndex = 30;
            const frameWidth = document.querySelector('.csgo-spinner-frame').offsetWidth;
            const targetCardPosition = (winningIndex * CARD_OUTER) + (CARD_WIDTH / 2);
            const windowCenter = frameWidth / 2;
            const scrollAmount = targetCardPosition - windowCenter;
            const randomWiggle = (Math.random() - 0.5) * 45;
            const finalTranslation = -(scrollAmount + randomWiggle);
            
            sounds.playSpinLaunch();
            
            setTimeout(() => {
                spinnerTrack.style.transition = 'transform 0.8s cubic-bezier(0.1, 0.8, 0.2, 1.0)';
                spinnerTrack.style.transform = `translateX(${finalTranslation}px)`;
                trackFastTicks(finalTranslation);
            }, 50);
        }
    } else if (loopState === "WINNER") {
        isSpinning = false;
        
        initSpinnerTrack(currentWinner, currentPrize);
        const winningIndex = 30;
        const frameWidth = document.querySelector('.csgo-spinner-frame').offsetWidth;
        const targetCardPosition = (winningIndex * CARD_OUTER) + (CARD_WIDTH / 2);
        const windowCenter = frameWidth / 2;
        const finalTranslation = -(targetCardPosition - windowCenter);
        
        spinnerTrack.style.transition = 'none';
        spinnerTrack.style.transform = `translateX(${finalTranslation}px)`;
        
        const cards = spinnerTrack.querySelectorAll('.reel-item');
        if (cards[30]) {
            cards[30].classList.add('winning-card-highlight');
        }
        
        if (lastTxHash) {
            revealWinner(lastTxHash);
        }
    } else if (loopState === "PAUSED") {
        isSpinning = false;
        document.querySelector('.spinner-status-console').classList.remove('console-win-active');
        spinStatusBadge.textContent = "STATUS: PAUSED (REPLENISHING...)";
        spinStatusBadge.style.backgroundColor = "#6B7280";
        consoleProgressBar.style.width = "0%";
        consoleProgressBar.style.transition = "none";
        consoleStatusText.textContent = "Waiting for creator rewards to claim...";
        initSpinnerTrack();
    }
}

// Update countdown progress bar
function updateCountdown(remaining) {
    if (loopState !== "COOLDOWN") return;
    consoleStatusText.textContent = `Next automatic draw in ${remaining.toFixed(1)}s...`;
    
    const percentage = (remaining / 1.5) * 100;
    consoleProgressBar.style.transition = "none";
    consoleProgressBar.style.width = `${percentage}%`;
}

// Sync CA Badge text dynamically
function syncCA(ca) {
    CONTRACT_ADDRESS = ca;
    const caDisplay = document.getElementById('ca-text-val');
    if (caDisplay) caDisplay.textContent = ca;
    
    const navCaBtn = document.getElementById('btn-copy-ca-nav');
    if (navCaBtn) {
        if (ca.toLowerCase() === 'comingsoon') {
            navCaBtn.innerHTML = `CA: Coming Soon 📋`;
        } else {
            navCaBtn.innerHTML = `CA: ${ca.substring(0, 8)}...${ca.substring(ca.length - 5)} 📋`;
        }
    }

    // Update all buy/pump.fun links dynamically
    const pumpLinks = document.querySelectorAll('a[href*="pump.fun/coin/"]');
    pumpLinks.forEach(link => {
        link.href = `https://pump.fun/coin/${ca}`;
    });
}

// Spawns bubble/emojis when Cheers happens
function spawnCheersEffects() {
    const emojis = ['🍻', '🍺', '🔥', '🥳', '💰', '👍'];
    const container = document.querySelector('.hero-right');
    
    for (let i = 0; i < 4; i++) {
        const span = document.createElement('span');
        span.textContent = emojis[Math.floor(Math.random() * emojis.length)];
        span.style.position = 'absolute';
        span.style.fontSize = '2rem';
        span.style.userSelect = 'none';
        span.style.pointerEvents = 'none';
        
        const offsetLeft = (Math.random() - 0.5) * 150;
        const offsetTop = (Math.random() - 0.5) * 150;
        
        span.style.left = `calc(50% + ${offsetLeft}px)`;
        span.style.top = `calc(50% + ${offsetTop}px)`;
        span.style.transition = 'transform 0.8s ease, opacity 0.8s ease';
        
        container.appendChild(span);
        
        setTimeout(() => {
            span.style.transform = `translate(${(Math.random() - 0.5) * 80}px, -100px) scale(1.5)`;
            span.style.opacity = '0';
        }, 30);
        
        setTimeout(() => {
            span.remove();
        }, 900);
    }
}

// --- WebSocket Connection ---
const wsProtocol = window.location.protocol === 'https:' ? 'wss://' : 'ws://';
const wsUrl = wsProtocol + window.location.host;
let ws;

function connectWs() {
    ws = new WebSocket(wsUrl);
    
    ws.onopen = () => {
        console.log("WebSocket connected to Pump.beer live feed!");
        showToast("Connected to live drawing feed!", "success");
    };
    
    ws.onmessage = (event) => {
        try {
            const packet = JSON.parse(event.data);
            const { type, data } = packet;
            
            switch (type) {
                case "INITIAL_STATE":
                    syncCA(data.ca);
                    updateStats(data.stats);
                    syncState(data.state);
                    break;
                case "COUNTDOWN_TICK":
                    updateCountdown(data.countdownRemaining);
                    break;
                case "STATE_CHANGE":
                    syncState(data);
                    break;
                case "SPIN_COMPLETE":
                    updateStats(data.stats);
                    lastTxHash = data.state.txHash;
                    if (!isSpinning) {
                        revealWinner(lastTxHash);
                    }
                    break;
                case "STATS_UPDATE":
                    updateStats(data.stats);
                    break;
                case "CA_UPDATE":
                    syncCA(data.ca);
                    showToast("Contract Address updated live!", "success");
                    break;
                case "TOAST":
                    showToast(data.message, data.type);
                    break;
            }
        } catch (e) {
            console.error("Failed to parse WebSocket message:", e);
        }
    };
    
    ws.onclose = () => {
        console.warn("WebSocket disconnected. Retrying in 3 seconds...");
        showToast("Live feed disconnected. Reconnecting...", "error");
        setTimeout(connectWs, 3000);
    };
    
    ws.onerror = (err) => {
        console.error("WebSocket error:", err);
    };
}

// --- Event Listeners ---

// Mute/Unmute sound toggle
btnSoundToggle.addEventListener('click', () => {
    const isEnabled = sounds.toggle();
    btnSoundToggle.textContent = isEnabled ? '🔊' : '🔇';
    btnSoundToggle.classList.toggle('btn-secondary', isEnabled);
    btnSoundToggle.classList.toggle('btn-primary', !isEnabled);
    showToast(isEnabled ? "Sound Effects ON" : "Sound Effects OFF", "info");
});

// Copy Contract Address Actions
if (btnCopyCaNav) btnCopyCaNav.addEventListener('click', copyCA);
if (btnCopyCaHero) btnCopyCaHero.addEventListener('click', copyCA);

// Transition ended handler
spinnerTrack.addEventListener('transitionend', (e) => {
    if (e.target === spinnerTrack && e.propertyName === 'transform') {
        isSpinning = false;
        sounds.playCheers();
        sounds.playWin();
        
        const cards = spinnerTrack.querySelectorAll('.reel-item');
        if (cards[30]) {
            cards[30].classList.add('winning-card-highlight');
        }

        if (lastTxHash) {
            revealWinner(lastTxHash);
        } else {
            consoleStatusText.textContent = "Confirming transaction on-chain...";
        }
    }
});

// Giant Beer Mug Cheers Interactive
giantBeerContainer.addEventListener('click', () => {
    sounds.playCheers();
    spawnCheersEffects();
    
    // Trigger CSS wobble
    giantBeerMug.classList.add('wobble-mug');
    setTimeout(() => {
        giantBeerMug.classList.remove('wobble-mug');
    }, 600);
});

// --- Initialization ---
initSpinnerTrack();
connectWs();

