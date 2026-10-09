const handleCasinoMatchBet = (
    req,
    findSpotsData,
    expBal,
    partnerExpBal,
    eventType,
    sectionRecord,
    odds,
    existingMap
) => {
    let spotsData = [...(findSpotsData?.sdata || [])];
    let oldSportData = [];
    let newSportData = [];
    sectionRecord?.forEach((item) => {
        const newAmt = Number(
            (eventType === "match1"
                ? item?.sid === req?.body?.sectionId
                    ? (req?.body?.betType === "lay" ? -1 : 1) *
                    ((req?.body?.amount * parseFloat(odds)) / 100).toFixed(2)
                    : (req?.body?.betType === "lay" ? 1 : -1) * req?.body?.amount
                : item?.sid === req?.body?.sectionId
                    ? (req?.body?.betType === "lay" ? -1 : 1) *
                    ((parseFloat(odds) - 1) * req?.body?.amount).toFixed(2)
                    : (req?.body?.betType === "lay" ? 1 : -1) * req?.body?.amount
            ).toFixed(2)
        );
        const oldAmt = existingMap[item?.sid] || 0;
        const updatedAmt = oldAmt + newAmt;

        const index = spotsData.findIndex((s) => s.sid === item.sid);

        if (index > -1) {
            oldSportData.push({
                sid: item.sid,
                amount: oldAmt,
            });
            spotsData[index].amount = updatedAmt;
        } else {
            spotsData.push({
                sid: item.sid,
                amount: updatedAmt,
            });
        }
        newSportData.push({
            sid: item.sid,
            amount: updatedAmt,
        });
    });
    if (oldSportData?.length > 0) {
        const oldMaxMinusAmt = Math.min(...oldSportData.map((item) => item.amount));
        expBal -= oldMaxMinusAmt;

        const maxExp = Math.max(
            0,
            ...oldSportData.map((r) => r.amount).filter((v) => v > 0)
        );
        partnerExpBal -= maxExp;
    }
    const maxMinusAmt = Math.min(...newSportData.map((item) => item.amount));
    expBal += maxMinusAmt;

    const maxExp = Math.max(
        0,
        ...newSportData.map((r) => r.amount).filter((v) => v > 0)
    );
    partnerExpBal += maxExp;
    const sections = sectionRecord?.map((item) => {
        return { sid: item?.sid, nat: item?.nat };
    });

    return { spotsData, expBal, partnerExpBal, sections };
};

module.exports = { handleCasinoMatchBet };
