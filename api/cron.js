const { connection, creatorKeypair, MINT_ADDRESS, PARTNER_ADDRESS, BACKUP_HOLDERS, withTimeout, loadDb, saveDb, setCachedHolders, PublicKey } = require('./_utils');
const { VersionedTransaction, Transaction, SystemProgram, sendAndConfirmTransaction } = require('@solana/web3.js');

module.exports = async (req, res) => {
    // Vercel Cron Secret Protection (Optional but recommended)
    // if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    //    return res.status(401).end('Unauthorized');
    // }

    // --- 0. DEBOUNCE LOCK (For frontend triggering) ---
    const db = await loadDb();
    if (db.lastCronTime && Date.now() - db.lastCronTime < 50000) {
        return res.status(200).json({ success: true, message: "Cron already executed recently" });
    }
    db.lastCronTime = Date.now();
    await saveDb(db);

    let claimedSol = 0;
    
    // --- 1. FETCH HOLDERS ---
    try {
        if (MINT_ADDRESS.toLowerCase() !== 'comingsoon') {
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
                    await setCachedHolders(list);
                }
            }
        } else {
            await setCachedHolders(BACKUP_HOLDERS);
        }
    } catch (e) {
        console.error("Holder fetch failed in cron:", e.message);
    }

    // --- 2. CLAIM FEES ---
    if (creatorKeypair && MINT_ADDRESS.toLowerCase() !== 'comingsoon') {
        try {
            const creatorPublicKey = creatorKeypair.publicKey.toBase58();
            const balanceBefore = await withTimeout(connection.getBalance(creatorKeypair.publicKey), 4000);

            const response = await fetch("https://pumpdev.io/api/claim-account", {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    publicKey: creatorPublicKey,
                    mint: MINT_ADDRESS,
                    priorityFee: 0.0003
                })
            });

            if (response.ok) {
                const data = await response.json();
                if (data && data.transaction) {
                    const txBuffer = Buffer.from(data.transaction, 'base64');
                    const transaction = VersionedTransaction.deserialize(txBuffer);
                    transaction.sign([creatorKeypair]);

                    const claimSignature = await connection.sendTransaction(transaction);
                    await connection.confirmTransaction(claimSignature, "confirmed");

                    let claimedLamports = 0;
                    try {
                        const txReceipt = await withTimeout(
                            connection.getTransaction(claimSignature, { 
                                commitment: "confirmed",
                                maxSupportedTransactionVersion: 0 
                            }),
                            5000
                        );

                        if (txReceipt && txReceipt.meta && txReceipt.meta.postBalances && txReceipt.meta.preBalances) {
                            let accountIndex = 0;
                            const message = txReceipt.transaction.message;
                            if (message && message.staticAccountKeys) {
                                accountIndex = message.staticAccountKeys.findIndex(k => k.toString() === creatorPublicKey);
                            } else if (message && message.accountKeys) {
                                accountIndex = message.accountKeys.findIndex(k => k.toString() === creatorPublicKey);
                            }
                            if (accountIndex === -1) accountIndex = 0;

                            const preBalance = txReceipt.meta.preBalances[accountIndex];
                            const postBalance = txReceipt.meta.postBalances[accountIndex];
                            claimedLamports = postBalance - preBalance;
                        } else {
                            throw new Error("Receipt null or missing meta");
                        }
                    } catch (err) {
                        const balanceAfter = await withTimeout(connection.getBalance(creatorKeypair.publicKey), 4000);
                        claimedLamports = balanceAfter - balanceBefore;
                    }

                    if (claimedLamports > 0) {
                        claimedSol = claimedLamports / 1e9;
                        const shareToPartner = claimedSol * 0.70;
                        const shareToDistribute = claimedSol * 0.30;

                        // Transfer Partner Share
                        try {
                            const partnerPubkey = new PublicKey(PARTNER_ADDRESS);
                            const transferTx = new Transaction().add(
                                SystemProgram.transfer({
                                    fromPubkey: creatorKeypair.publicKey,
                                    toPubkey: partnerPubkey,
                                    lamports: Math.floor(shareToPartner * 1e9)
                                })
                            );
                            await sendAndConfirmTransaction(connection, transferTx, [creatorKeypair]);
                        } catch (e) {
                            console.error("Partner transfer failed:", e.message);
                        }

                        // Update DB
                        const db = await loadDb();
                        db.vaultPool += shareToDistribute;
                        await saveDb(db);
                    }
                }
            }
        } catch (e) {
            console.error("Auto claim fees failed in cron:", e.message);
        }
    }

    res.status(200).json({ success: true, claimedSol });
};
