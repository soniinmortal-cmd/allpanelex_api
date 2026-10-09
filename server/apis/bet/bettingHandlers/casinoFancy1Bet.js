const handleCasinoFancy1Bet = async (
    req,
    findSpotsData,
    expBal,
    partnerExpBal,
    id,
    section,
    getBets
) => {
    let spotsData = findSpotsData?.sdata ? [...findSpotsData.sdata] : [];
    let lRate = 0;
    let bRate = 0;

    const idx = spotsData.findIndex((s) => s.sid === req?.body?.sectionId);
    const oldAmt = idx > -1 ? spotsData[idx].amount : 0;
    if (idx > -1) {
        const maxExp = Math.max(
            0,
            ...spotsData[idx]?.calcTable
                .map((r) => r.profitLoss)
                .filter((v) => v > 0)
        );
        partnerExpBal -= maxExp;
    }
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
    let backOdds = section?.b;
    let layOdds = section?.l;

    lRate = layOdds;
    bRate = backOdds;

    // Combine old and new bets
    const allBets = [...(findOldBackBet || []), ...(findOldLayBet || [])];

    // Create object for current bet
    const currentBet = {
        amount: req.body.amount,
        betType: req.body.betType,
        odds: req.body.betType === "back" ? backOdds : layOdds,
    };
    allBets.push(currentBet);

    const targetRun = 1;

    const calcTable = [];
    let runCount = 1;

    for (let run = targetRun - runCount; run <= targetRun + runCount; run++) {
        let profitLoss = 0;
        let backPL = 0;
        let layPL = 0;

        allBets.forEach(bet => {
            let betPL = 0;
            const betAmt = Number(bet.amount);
            const betOdds = Number(bet.odds ?? bet.uRate ?? bet.rate);

            if (bet.betType === "back") {
                if (run >= targetRun) {
                    betPL = Number((parseFloat(betOdds - 1) * betAmt).toFixed(2));
                } else {
                    betPL = -betAmt;
                }
                backPL += betPL;
            } else if (bet.betType === "lay") {
                if (run < targetRun) {
                    betPL = betAmt;
                } else {
                    betPL = -Number((parseFloat(betOdds - 1) * betAmt).toFixed(2));
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

    if (idx > -1) expBal -= oldAmt;
    const newMinPL = Math.min(...calcTable.map((r) => r.profitLoss));
    
    // Safety Fallback: Ensure the new total exposure for this section is at least the stake of the current bet.
    const effectiveMinPL = Math.min(newMinPL, -Number(req.body.amount || 0));
    expBal += effectiveMinPL;
    
    newEntry = {
        sid: req?.body?.sectionId,
        amount: effectiveMinPL,
        calcTable,
    };

    const maxExp = Math.max(
        0,
        ...calcTable.map((r) => r.profitLoss).filter((v) => v > 0)
    );
    partnerExpBal += maxExp;
    if (idx > -1) {
        spotsData[idx] = newEntry;
    } else {
        spotsData.push(newEntry);
    }

    return { spotsData, expBal, partnerExpBal, lRate, bRate };
};

module.exports = { handleCasinoFancy1Bet };
