const { connection, creatorKeypair, withTimeout, loadDb, saveDb, getCachedHolders, PublicKey } = require('./_utils');
const { Transaction, SystemProgram, sendAndConfirmTransaction } = require('@solana/web3.js');

const REWARDS = [
    { emoji: '🍺', valueText: '0.01 SOL', valueNum: 0.01, rarity: 'common', weight: 40 },
    { emoji: '🍺🍺', valueText: '0.03 SOL', valueNum: 0.03, rarity: 'common', weight: 25 },
    { emoji: '🍺🍺🍺', valueText: '0.05 SOL', valueNum: 0.05, rarity: 'common', weight: 18 },
    { emoji: '🍺🍺🍺🍺', valueText: '0.07 SOL', valueNum: 0.07, rarity: 'uncommon', weight: 10 },
    { emoji: '🍺🍺🍺🍺🍺', valueText: '0.10 SOL', valueNum: 0.10, rarity: 'uncommon', weight: 5 },
    { emoji: '🍺🍺🍺🍺🍺🍺', valueText: '0.12 SOL', valueNum: 0.12, rarity: 'rare', weight: 1.5 },
    { emoji: '🍺🍺🍺🍺🍺🍺🍺', valueText: '0.15 SOL', valueNum: 0.15, rarity: 'jackpot', weight: 0.5 }
];

function selectPrize() {
    const totalWeight = REWARDS.reduce((sum, r) => sum + r.weight, 0);
    let rand = Math.random() * totalWeight;
    for (let reward of REWARDS) {
        if (rand < reward.weight) return reward;
        rand -= reward.weight;
    }
    return REWARDS[0];
}

module.exports = async (req, res) => {
    // Add CORS headers for Vercel
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');

    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    try {
        const db = await loadDb();

        // Prevent concurrent draws and respect cooldown (min 10s between draws)
        if (db.drawInProgress || Date.now() - (db.lastDrawTime || 0) < 10000) {
            return res.status(400).json({ success: false, error: "Draw locked or cooling down" });
        }

        // Safety limit validation
        let onChainBalance = 0;
        if (creatorKeypair) {
            try {
                const balanceLamports = await withTimeout(connection.getBalance(creatorKeypair.publicKey), 4000);
                onChainBalance = balanceLamports / 1e9;
            } catch (err) {
                onChainBalance = db.vaultPool; // fallback
            }
        }

        const maxSpendable = Math.min(db.vaultPool, onChainBalance - 0.015);

        if (maxSpendable < 0.15 || !creatorKeypair) {
            return res.status(400).json({ success: false, error: "Insufficient funds for draw" });
        }

        // Lock draw
        db.drawInProgress = true;
        await saveDb(db);

        const holders = await getCachedHolders();
        const rawWinner = holders[Math.floor(Math.random() * holders.length)];
        const rawPrize = selectPrize();

        let finalPrizeValue = rawPrize.valueNum;
        if (finalPrizeValue > maxSpendable) {
            finalPrizeValue = Math.max(0.01, Math.floor(maxSpendable * 100) / 100);
        }

        const prizeObj = {
            emoji: rawPrize.emoji,
            valueText: `${finalPrizeValue.toFixed(2)} SOL`,
            valueNum: finalPrizeValue,
            rarity: rawPrize.rarity
        };

        // Execute on-chain transaction
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

            signature = await sendAndConfirmTransaction(connection, transferTx, [creatorKeypair], {
                commitment: "confirmed",
                preflightCommitment: "confirmed"
            });
            
            // Post-draw state updates
            db.vaultPool = Math.max(0, db.vaultPool - finalPrizeValue);
            db.totalPoured += finalPrizeValue;
            db.lastDrawTime = Date.now();
            db.lastWinner = rawWinner;
            db.lastPrize = prizeObj;
            
            const logEntry = {
                name: rawWinner.name,
                full: rawWinner.full,
                prizeText: prizeObj.valueText,
                rarity: rawPrize.rarity,
                txHash: signature,
                timestamp: Date.now()
            };
            
            if (!db.recentWinners) db.recentWinners = [];
            db.recentWinners.unshift(logEntry);
            if (db.recentWinners.length > 8) db.recentWinners.pop();

        } catch (txErr) {
            console.error("Payout transaction failed:", txErr.message);
        } finally {
            // Unlock draw
            db.drawInProgress = false;
            await saveDb(db);
        }

        res.status(200).json({ success: !!signature, txHash: signature });

    } catch (e) {
        // Fallback unlock if fatal error
        try {
            const db = await loadDb();
            if (db.drawInProgress) {
                db.drawInProgress = false;
                await saveDb(db);
            }
        } catch (_) {}
        
        res.status(500).json({ success: false, error: e.message });
    }
};
