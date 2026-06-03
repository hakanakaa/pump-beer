const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const http = require('http');
const ws = require('ws');
const { Connection, PublicKey, Keypair, VersionedTransaction, SystemProgram, Transaction, sendAndConfirmTransaction } = require('@solana/web3.js');
const bs58 = require('bs58').default || require('bs58');
const dotenv = require('dotenv');
dotenv.config();

const app = express();
const server = http.createServer(app);
const wss = new ws.Server({ server });

const PORT = process.env.PORT || 8080;
const RPC_URL = process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com";
const connection = new Connection(RPC_URL, "confirmed");

let MINT_ADDRESS = process.env.MINT_ADDRESS || "ComingSoon";
const PARTNER_ADDRESS = process.env.PARTNER_ADDRESS || "2HVQ3TWUyhgnpdmeEJnds5HsRuY5YbfGxUENmKnWaiCt";

const REWARDS = [
    { emoji: '🍺', valueText: '0.01 SOL', valueNum: 0.01, rarity: 'common', weight: 40 },
    { emoji: '🍺🍺', valueText: '0.03 SOL', valueNum: 0.03, rarity: 'common', weight: 25 },
    { emoji: '🍺🍺🍺', valueText: '0.05 SOL', valueNum: 0.05, rarity: 'common', weight: 18 },
    { emoji: '🍺🍺🍺🍺', valueText: '0.07 SOL', valueNum: 0.07, rarity: 'uncommon', weight: 10 },
    { emoji: '🍺🍺🍺🍺🍺', valueText: '0.10 SOL', valueNum: 0.10, rarity: 'uncommon', weight: 5 },
    { emoji: '🍺🍺🍺🍺🍺🍺', valueText: '0.12 SOL', valueNum: 0.12, rarity: 'rare', weight: 1.5 },
    { emoji: '🍺🍺🍺🍺🍺🍺🍺', valueText: '0.15 SOL', valueNum: 0.15, rarity: 'jackpot', weight: 0.5 }
];

app.use(cors());
app.use(express.json());

let creatorKeypair = null;
let CREATOR_PUBKEY_STR = "None";
if (process.env.CREATOR_PRIVATE_KEY) {
    try {
        const keyStr = process.env.CREATOR_PRIVATE_KEY.trim();
        if (keyStr.startsWith('[')) {
            const bytes = JSON.parse(keyStr);
            creatorKeypair = Keypair.fromSecretKey(Uint8Array.from(bytes));
        } else {
            creatorKeypair = Keypair.fromSecretKey(bs58.decode(keyStr));
        }
        CREATOR_PUBKEY_STR = creatorKeypair.publicKey.toBase58();
        console.log(`[SECURE] Creator keypair loaded for address: ${CREATOR_PUBKEY_STR}`);
    } catch (e) {
        console.error("[CRITICAL] Failed to load creator private key:", e.message);
    }
}

const DB_FILE = path.join(__dirname, 'db.json');
let db = {
    vaultPool: 0.0,
    totalPoured: 0.0,
    recentWinners: []
};

function loadDb() {
    if (fs.existsSync(DB_FILE)) {
        try {
            db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
            console.log(`Database loaded: Vault Pool = ${db.vaultPool} SOL, Total Poured = ${db.totalPoured} SOL`);
        } catch (e) {
            console.error("Failed to load db.json, using defaults.");
        }
    } else {
        saveDb();
    }
}

function saveDb() {
    try {
        fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), 'utf8');
    } catch (e) {
        console.error("Failed to save db.json:", e.message);
    }
}
loadDb();

let cachedHolders = [];
const BACKUP_HOLDERS = [
    { name: "Haka77d...Mug", full: "Haka77d2Bnd7XsY8Bnd92XypQwsGulpMug" },
    { name: "FeMbDox...ump", full: "FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump" },
    { name: "Degen99...Keg", full: "Degen99XyPqR9sNcsd2B3vSpd8qTapsKeg" },
    { name: "Chur456...Bar", full: "Chur456XvBsD3XsnDbd892SpwNdKegBar" },
    { name: "Gulp888...Pub", full: "Gulp888BvCsN9vSdcbd771QpwsNMugPub" }
];

async function withTimeout(promise, ms) {
    let timeoutId;
    const timeoutPromise = new Promise((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error("RPC request timeout")), ms);
    });
    return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timeoutId));
}

function checkEnvUpdates() {
    try {
        if (fs.existsSync('.env')) {
            const envConfig = dotenv.parse(fs.readFileSync('.env'));
            const newMint = envConfig.MINT_ADDRESS;
            if (newMint && newMint !== MINT_ADDRESS) {
                console.log(`[CA UPDATE] Mint address changed from ${MINT_ADDRESS} to ${newMint}. Live-updating...`);
                MINT_ADDRESS = newMint;
                cachedHolders = [];
                broadcast({
                    type: "CA_UPDATE",
                    data: { ca: MINT_ADDRESS }
                });
            }
        }
    } catch (e) {}
}

let isFetchingHolders = false;
async function fetchHoldersBackground() {
    checkEnvUpdates();
    if (isFetchingHolders) return;
    isFetchingHolders = true;

    if (MINT_ADDRESS.toLowerCase() === 'comingsoon') {
        cachedHolders = BACKUP_HOLDERS;
        isFetchingHolders = false;
        return;
    }

    try {
        const tokenProgramId = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
        const accounts = await withTimeout(
            connection.getProgramAccounts(tokenProgramId, {
                filters: [
                    { dataSize: 165 },
                    { memcmp: { offset: 0, bytes: MINT_ADDRESS } }
                ]
            }),
            5000
        );

        if (accounts && accounts.length > 0) {
            const list = accounts.map(acc => {
                const data = acc.account.data;
                const owner = new PublicKey(data.slice(32, 64)).toBase58();
                const amount = data.readBigUInt64LE(64);
                const balance = Number(amount) / 1000000;
                return { name: owner.substring(0, 5) + "..." + owner.substring(owner.length - 4), full: owner, balance };
            }).filter(h => h.balance > 0 && h.full !== MINT_ADDRESS);
            
            if (list.length > 0) {
                cachedHolders = list;
            }
        }
    } catch (e) {
        // Fallback or ignore
    } finally {
        isFetchingHolders = false;
        if (cachedHolders.length === 0) cachedHolders = BACKUP_HOLDERS;
    }
}

let spinState = {
    loopState: "COOLDOWN", 
    countdownRemaining: 1.5,
    currentWinner: null,
    currentPrize: null,
    txHash: null
};

function broadcast(message) {
    const payload = JSON.stringify(message);
    wss.clients.forEach(client => {
        if (client.readyState === ws.OPEN) client.send(payload);
    });
}

wss.on('connection', (socket) => {
    socket.send(JSON.stringify({
        type: "INITIAL_STATE",
        data: {
            state: spinState,
            stats: { vaultPool: db.vaultPool, totalPoured: db.totalPoured, recentWinners: db.recentWinners },
            ca: MINT_ADDRESS
        }
    }));
});

function selectPrize() {
    const totalWeight = REWARDS.reduce((sum, r) => sum + r.weight, 0);
    let rand = Math.random() * totalWeight;
    for (let reward of REWARDS) {
        if (rand < reward.weight) return reward;
        rand -= reward.weight;
    }
    return REWARDS[0];
}

async function runLoop() {
    while (true) {
        try {
            const holders = cachedHolders.length > 0 ? cachedHolders : BACKUP_HOLDERS;

            let onChainBalance = 0;
            if (creatorKeypair) {
                try {
                    const balanceLamports = await withTimeout(connection.getBalance(creatorKeypair.publicKey), 4000);
                    onChainBalance = balanceLamports / 1e9;
                } catch (balanceErr) {
                    onChainBalance = db.vaultPool;
                }
            }

            const maxSpendable = Math.min(db.vaultPool, onChainBalance - 0.015);

            if (maxSpendable < 0.15 || !creatorKeypair) {
                spinState.loopState = "PAUSED";
                broadcast({ type: "STATE_CHANGE", data: spinState });
                await new Promise(resolve => setTimeout(resolve, 5000));
                continue;
            }

            // COOLDOWN
            spinState.loopState = "COOLDOWN";
            spinState.countdownRemaining = 1.5;
            broadcast({ type: "STATE_CHANGE", data: spinState });

            for (let i = 0; i < 15; i++) {
                await new Promise(resolve => setTimeout(resolve, 100));
                spinState.countdownRemaining = Math.max(0, 1.5 - ((i + 1) * 0.1));
                broadcast({ type: "COUNTDOWN_TICK", data: { countdownRemaining: spinState.countdownRemaining } });
            }

            // SPINNING
            spinState.loopState = "SPINNING";
            spinState.txHash = null;

            const rawWinner = holders[Math.floor(Math.random() * holders.length)];
            const rawPrize = selectPrize();
            
            let finalPrizeValue = rawPrize.valueNum;
            if (finalPrizeValue > maxSpendable) finalPrizeValue = Math.max(0.01, Math.floor(maxSpendable * 100) / 100);

            spinState.currentWinner = rawWinner;
            spinState.currentPrize = { emoji: rawPrize.emoji, valueText: `${finalPrizeValue.toFixed(2)} SOL`, valueNum: finalPrizeValue, rarity: rawPrize.rarity };

            broadcast({ type: "STATE_CHANGE", data: spinState });

            let signature = null;
            try {
                const winnerPubkey = new PublicKey(rawWinner.full);
                const lamportsToSend = Math.floor(finalPrizeValue * 1e9);

                const transferTx = new Transaction().add(
                    SystemProgram.transfer({
                        fromPubkey: creatorKeypair.publicKey,
                        toPubkey: winnerPubkey,
                        lamports: lamportsToSend
                    })
                );

                signature = await sendAndConfirmTransaction(connection, transferTx, [creatorKeypair], { commitment: "confirmed", preflightCommitment: "confirmed" });
            } catch (txErr) {
                console.error("[ERROR] Holder giveaway transaction failed:", txErr.message);
                spinState.loopState = "PAUSED";
                broadcast({ type: "STATE_CHANGE", data: spinState });
                await new Promise(resolve => setTimeout(resolve, 5000));
                continue;
            }

            // WINNER
            spinState.loopState = "WINNER";
            spinState.txHash = signature;

            db.vaultPool = Math.max(0, db.vaultPool - finalPrizeValue);
            db.totalPoured += finalPrizeValue;

            db.recentWinners.unshift({
                name: rawWinner.name, full: rawWinner.full, prizeText: spinState.currentPrize.valueText,
                rarity: rawPrize.rarity, txHash: signature, timestamp: Date.now()
            });
            if (db.recentWinners.length > 8) db.recentWinners.pop();
            saveDb();

            broadcast({
                type: "SPIN_COMPLETE",
                data: { state: spinState, stats: { vaultPool: db.vaultPool, totalPoured: db.totalPoured, recentWinners: db.recentWinners } }
            });

            await new Promise(resolve => setTimeout(resolve, 1800));

        } catch (loopErr) {
            await new Promise(resolve => setTimeout(resolve, 5000));
        }
    }
}

async function autoClaimFees() {
    if (!creatorKeypair || MINT_ADDRESS.toLowerCase() === 'comingsoon') return;

    try {
        const creatorPublicKey = creatorKeypair.publicKey.toBase58();
        const balanceBefore = await withTimeout(connection.getBalance(creatorKeypair.publicKey), 4000);

        const response = await fetch("https://pumpdev.io/api/claim-account", {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ publicKey: creatorPublicKey, mint: MINT_ADDRESS, priorityFee: 0.0003 })
        });

        if (!response.ok) return;

        const data = await response.json();
        if (!data || !data.transaction) return;

        const txBuffer = Buffer.from(data.transaction, 'base64');
        const transaction = VersionedTransaction.deserialize(txBuffer);
        transaction.sign([creatorKeypair]);

        const claimSignature = await connection.sendTransaction(transaction);
        await connection.confirmTransaction(claimSignature, "confirmed");
        
        let claimedLamports = 0;
        try {
            const txReceipt = await withTimeout(
                connection.getTransaction(claimSignature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 }),
                5000
            );

            if (txReceipt && txReceipt.meta && txReceipt.meta.postBalances && txReceipt.meta.preBalances) {
                let accountIndex = 0;
                const message = txReceipt.transaction.message;
                if (message && message.staticAccountKeys) accountIndex = message.staticAccountKeys.findIndex(k => k.toString() === creatorPublicKey);
                else if (message && message.accountKeys) accountIndex = message.accountKeys.findIndex(k => k.toString() === creatorPublicKey);
                if (accountIndex === -1) accountIndex = 0;

                claimedLamports = txReceipt.meta.postBalances[accountIndex] - txReceipt.meta.preBalances[accountIndex];
            } else {
                throw new Error("No receipt");
            }
        } catch (receiptErr) {
            const balanceAfter = await withTimeout(connection.getBalance(creatorKeypair.publicKey), 4000);
            claimedLamports = balanceAfter - balanceBefore;
        }

        if (claimedLamports > 0) {
            const claimedSol = claimedLamports / 1e9;
            const shareToPartner = claimedSol * 0.70;
            const shareToDistribute = claimedSol * 0.30;

            try {
                const partnerPubkey = new PublicKey(PARTNER_ADDRESS);
                const transferTx = new Transaction().add(
                    SystemProgram.transfer({ fromPubkey: creatorKeypair.publicKey, toPubkey: partnerPubkey, lamports: Math.floor(shareToPartner * 1e9) })
                );
                await sendAndConfirmTransaction(connection, transferTx, [creatorKeypair]);
            } catch (err) {}

            db.vaultPool += shareToDistribute;
            saveDb();

            broadcast({ type: "STATS_UPDATE", data: { stats: { vaultPool: db.vaultPool, totalPoured: db.totalPoured, recentWinners: db.recentWinners } } });
            broadcast({ type: "TOAST", data: { message: `Claimed ${claimedSol.toFixed(3)} SOL fees! 30% added to draw taps.`, type: "success" } });
        }
    } catch (e) {}
}

app.get('/favicon.ico', (req, res) => res.sendFile(path.join(__dirname, 'logo.png')));
app.use(express.static(path.join(__dirname, './')));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, './index.html')));

server.listen(PORT, () => {
    console.log(`Pump.beer Backend running on port ${PORT}`);
    runLoop();
    setInterval(autoClaimFees, 60000);
    setInterval(fetchHoldersBackground, 1000);
    fetchHoldersBackground();
});
