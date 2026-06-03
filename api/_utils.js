const { kv } = require('@vercel/kv');
const fs = require('fs');
const path = require('path');
const { Connection, Keypair, PublicKey } = require('@solana/web3.js');
const bs58 = require('bs58').default || require('bs58');
require('dotenv').config();

// --- SOLANA SETUP ---
const connection = new Connection(process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com", "confirmed");

let creatorKeypair = null;
if (process.env.CREATOR_PRIVATE_KEY) {
    try {
        const keyStr = process.env.CREATOR_PRIVATE_KEY.trim();
        if (keyStr.startsWith('[')) {
            const bytes = JSON.parse(keyStr);
            creatorKeypair = Keypair.fromSecretKey(Uint8Array.from(bytes));
        } else {
            creatorKeypair = Keypair.fromSecretKey(bs58.decode(keyStr));
        }
    } catch (e) {
        console.error("Failed to parse CREATOR_PRIVATE_KEY", e);
    }
}

const MINT_ADDRESS = process.env.MINT_ADDRESS || "ComingSoon";
const PARTNER_ADDRESS = process.env.PARTNER_ADDRESS || "2HVQ3TWUyhgnpdmeEJnds5HsRuY5YbfGxUENmKnWaiCt";

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

// --- DATABASE (KV / LOCAL FALLBACK) ---
const DB_PATH = path.join(process.cwd(), 'db.json');

async function loadDb() {
    if (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) {
        try {
            const data = await kv.get('pump_beer_db');
            if (data) return data;
        } catch (e) {
            console.error("KV GET Error:", e.message);
        }
    } else {
        try {
            if (fs.existsSync(DB_PATH)) {
                return JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
            }
        } catch (e) {
            console.error("Local DB read error:", e.message);
        }
    }
    // Default schema
    return {
        vaultPool: 0.0,
        totalPoured: 0.0,
        recentWinners: [],
        lastDrawTime: 0,
        drawInProgress: false
    };
}

async function saveDb(data) {
    if (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) {
        try {
            await kv.set('pump_beer_db', data);
        } catch (e) {
            console.error("KV SET Error:", e.message);
        }
    } else {
        try {
            fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
        } catch (e) {
            console.error("Local DB write error:", e.message);
        }
    }
}

async function getCachedHolders() {
    if (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) {
        const data = await kv.get('pump_beer_holders');
        return data || BACKUP_HOLDERS;
    }
    // Very basic memory cache for local dev (won't persist across vercel serverless invocations, but ok locally)
    if (global.__cachedHolders) return global.__cachedHolders;
    return BACKUP_HOLDERS;
}

async function setCachedHolders(holders) {
    if (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) {
        await kv.set('pump_beer_holders', holders);
    } else {
        global.__cachedHolders = holders;
    }
}

module.exports = {
    connection,
    creatorKeypair,
    MINT_ADDRESS,
    PARTNER_ADDRESS,
    BACKUP_HOLDERS,
    withTimeout,
    loadDb,
    saveDb,
    getCachedHolders,
    setCachedHolders,
    PublicKey
};
