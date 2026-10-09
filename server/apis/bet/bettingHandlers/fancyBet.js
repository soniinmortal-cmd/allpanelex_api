const handleFancyBet = async (
    req,
    findSpotsData,
    expBal,
    partnerExpBal,
    id,
    section,
    odds,
    getBets
) => {
    let spotsData = findSpotsData?.sdata ? [...findSpotsData.sdata] : [];
    let lRate = 0;
    let bRate = 0;
    let lsize = 0;
    let bsize = 0;

    const targetSidStr = String(req?.body?.sectionId);
    const matchingEntries = spotsData.filter((s) => String(s.sid) === targetSidStr);
    const oldAmt = matchingEntries.reduce((sum, entry) => sum + (Number(entry.amount) || 0), 0);
    matchingEntries.forEach((entry) => {
        if (entry.calcTable) {
            const maxExp = Math.max(
                0,
                ...entry.calcTable
                    .map((r) => r.profitLoss)
                    .filter((v) => v > 0)
            );
            partnerExpBal -= maxExp;
        }
    });
    const findOldBackBet = await getBets({
        marketId: req?.body?.marketId,
        userId: id,
        sectionId: req?.body?.sectionId,
        betType: "back",
        isActive: true,
        status: "pending"
    });
    const findOldLayBet = await getBets({
        marketId: req?.body?.marketId,
        userId: id,
        sectionId: req?.body?.sectionId,
        betType: "lay",
        isActive: true,
        status: "pending"
    });
    const targetRun = Number(odds?.odds);
    let backOdds = section?.odds?.findLast((o) => o.otype === "back" && Number(o.odds) === targetRun);
    if (!backOdds) {
        backOdds = section?.odds?.findLast((o) => o.otype === "back");
    }
    let layOdds = section?.odds?.find((o) => o.otype === "lay" && Number(o.odds) === targetRun);
    if (!layOdds) {
        layOdds = section?.odds?.find((o) => o.otype === "lay");
    }

    lRate = layOdds?.l;
    bRate = backOdds?.b;
    lsize = layOdds?.size;
    bsize = backOdds?.size;
    let newEntry = {};

    // Combine old bets and current bet into a single array for calculation
    const currentBet = {
        amount: req.body.amount,
        betType: req.body.betType,
        odds: targetRun, // The line heavily depends on the odds at placement
        size: section?.odds?.find(o => o.otype === req.body.betType && Number(o.odds) === targetRun)?.size || req.body.size || 100 // Size at placement
    };

    // Note: Old bets from DB might have 'size' stored, or we default to 100. 
    // Usually DB bets have 'odds' (the line) and 'size'.
    const allBets = [];
    if (findOldBackBet) allBets.push(...findOldBackBet);
    if (findOldLayBet) allBets.push(...findOldLayBet);
    allBets.push(currentBet);

    const calcTable = [];

    // Find maximum rate to define the range
    let maxRate = 0;
    allBets.forEach(b => {
        const r = Number(b.odds ?? b.uRate ?? b.rate);
        if (r > maxRate) maxRate = r;
    });

    // Check from 0 to maxRate + 10 to ensure we catch all liabilities
    const startRun = 0;
    const endRun = maxRate + 10;

    for (let run = startRun; run <= endRun; run++) {
        let profitLoss = 0;
        let backPL = 0;
        let layPL = 0;

        // Calculate Max Back Run and Max Lay Run for Session Logic
        let maxBackRun = 0;
        let maxLayRun = 0;

        allBets.forEach(b => {
            // Only count actual bets (amount > 0) for Session Limits
            if (Number(b.amount) > 0) {
                const r = Number(b.odds ?? b.uRate ?? b.rate);
                if (b.betType === "back") {
                    if (r > maxBackRun) maxBackRun = r;
                } else if (b.betType === "lay") {
                    // LAY LOGIC UPDATE: We now look for the MAX Lay Run (e.g. 61)
                    if (r > maxLayRun) maxLayRun = r;
                }
            }
        });

        // Iterate through ALL bets individually
        allBets.forEach(bet => {
            let betPL = 0;
            const betAmt = Number(bet.amount);
            // Fix: DB bets might store line in uRate (or rate/odds). Prioritize odds/uRate which placeBet saves.
            const betRate = Number(bet.odds ?? bet.uRate ?? bet.rate);
            const betSize = Number(
                bet.size || 
                (bet.betType === 'back' ? (bet.bsize || bet.bRate) : (bet.lsize || bet.lRate)) || 
                100
            );
            if (bet.betType === "back") {
                if (run >= betRate) {
                    betPL = Number(((betAmt * betSize) / 100).toFixed(2));
                } else {
                    betPL = -betAmt;
                }
                backPL += betPL;
            } else if (bet.betType === "lay") {
                if (run < betRate) {
                    betPL = betAmt;
                } else {
                    betPL = -Number(((betAmt * betSize) / 100).toFixed(2));
                }
                layPL += betPL;
            }
            profitLoss += betPL;
        });

        calcTable.push({
            run,
            back: backPL,
            lay: layPL,
            profitLoss,
        });
    }

    // --- ACCURATE RISK DELTA CALCULATION ---
    const newMinPL = calcTable.length > 0 ? Math.min(0, ...calcTable.map((r) => r.profitLoss)) : 0;
    const calculatedDelta = Number((newMinPL - oldAmt).toFixed(2));
    const stakeDelta = -Number(req.body.amount || 0);

    // Use the worst-case of the calculated delta vs the current stake.
    // This ensures every bet has a financial weight of at least its stake UNLESS the bet reduces the user's risk (e.g. hedging).
    if (calculatedDelta >= 0) {
        expBal = calculatedDelta;
    } else {
        expBal = Math.min(calculatedDelta, stakeDelta);
    }

    const effectiveMinPL = oldAmt + expBal;

    // Dynamic Range Filter Logic
    let displayMinRun = Infinity;
    let displayMaxRun = -Infinity;

    allBets.forEach(b => {
        const r = Number(b.odds ?? b.uRate ?? b.rate);
        if (r < displayMinRun) displayMinRun = r;
        if (r > displayMaxRun) displayMaxRun = r;
    });

    // Fallback if no bets (shouldn't happen as currentBet is pushed)
    if (displayMinRun === Infinity) displayMinRun = targetRun;
    if (displayMaxRun === -Infinity) displayMaxRun = targetRun;

    newEntry = {
        sid: req?.body?.sectionId,
        amount: effectiveMinPL,
        calcTable: calcTable.filter(
            (r) => r.run >= displayMinRun - 2 && r.run <= displayMaxRun + 2
        ),
    };
    spotsData = spotsData.filter((s) => String(s.sid) !== targetSidStr);
    spotsData.push(newEntry);

    const pd = calcTable.map((r) => r.profitLoss).filter((v) => v > 0);
    const maxExp = pd.length > 0 ? Math.max(0, ...pd) : 0;
    // CRITICAL: This is hierarchy liability, must be negative when risk increases.
    partnerExpBal -= maxExp; 

    return { spotsData, expBal, partnerExpBal, lRate, bRate, lsize, bsize };
};

module.exports = { handleFancyBet };
