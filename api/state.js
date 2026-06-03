const { loadDb, MINT_ADDRESS } = require('./_utils');

module.exports = async (req, res) => {
    // Add CORS headers for Vercel
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');

    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    try {
        const db = await loadDb();
        res.status(200).json({
            vaultPool: db.vaultPool,
            totalPoured: db.totalPoured,
            recentWinners: db.recentWinners,
            lastDrawTime: db.lastDrawTime || 0,
            lastWinner: db.lastWinner || null,
            lastPrize: db.lastPrize || null,
            ca: MINT_ADDRESS
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
};
