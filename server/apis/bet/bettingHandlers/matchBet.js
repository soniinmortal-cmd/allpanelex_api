const handleMatchBet = (
    req,
    findSpotsData,
    expBal,
    partnerExpBal,
    table,
    gameType,
    odds,
    existingMap
) => {
    let spotsData = [];
    let sections = [];

    if (findSpotsData?.sdata && findSpotsData.sdata.length > 0) {
        const oldMaxMinusAmt = Math.min(
            0,
            ...findSpotsData?.sdata.map((item) => item.amount)
        );
        expBal -= oldMaxMinusAmt;
    }

    spotsData = table?.section?.map((item) => {
        const isBookmaker = req?.body?.gType === "match1" || req?.body?.marketName === "Bookmaker";
        const newAmt = Number(
            (isBookmaker && gameType === "game"
                ? item?.sid === req?.body?.sectionId
                    ? (req?.body?.betType === "lay" ? -1 : 1) *
                    ((req?.body?.amount * parseFloat(odds?.odds)) / 100).toFixed(2)
                    : (req?.body?.betType === "lay" ? 1 : -1) * req?.body?.amount
                : item?.sid === req?.body?.sectionId
                    ? (req?.body?.betType === "lay" ? -1 : 1) *
                    ((parseFloat(odds?.odds) - 1) * req?.body?.amount).toFixed(2)
                    : (req?.body?.betType === "lay" ? 1 : -1) * req?.body?.amount
            ).toFixed(2)
        );

        const oldAmt = existingMap[item?.sid] || 0;

        return {
            sid: item?.sid,
            amount: oldAmt + newAmt,
        };
    });

    const maxMinusAmt = spotsData.length > 0 ? Math.min(0, ...spotsData.map((item) => item.amount)) : 0;
    expBal += maxMinusAmt;

    // Partner Exposure Logic (Bookie Risk)
    // We calculate the Delta of "Max Player Profit"
    // Old Max Profit
    const oldAmounts = Object.values(existingMap);
    const oldMaxProfit = oldAmounts.length > 0 ? Math.max(0, ...oldAmounts) : 0;

    // New Max Profit
    const newMaxProfit = spotsData.length > 0 ? Math.max(0, ...spotsData.map(item => item.amount)) : 0;

    // Partner Exposure Delta = New Inverted Risk - Old Inverted Risk
    // Delta = OldMaxProfit - NewMaxProfit
    partnerExpBal = oldMaxProfit - newMaxProfit;

    sections = table?.section?.map((item) => {
        return { sid: item?.sid, nat: item?.nat || item?.teamName };
    });

    return { spotsData, expBal, partnerExpBal, sections };
};

module.exports = { handleMatchBet };
