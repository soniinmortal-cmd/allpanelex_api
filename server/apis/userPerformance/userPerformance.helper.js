const httpStatus = require("http-status");
const APIError = require("../../helpers/APIError");
const APIResponse = require("../../helpers/APIResponse");
const UserPerformance = require("./userPerformance.model");
const { getCache, setCache } = require("../../helpers/cache");
const { getButtonSettings } = require("../settings/settings.helper");

const initUserPerformance = async (userId, domain) => {
  const settingsResponse = await getButtonSettings("button", domain);
  let defaultValues = settingsResponse.data || [];

  defaultValues = defaultValues.map((btn) => ({
    value: Number(btn.value) || 0,
    type: btn.type || "game",
    label: btn.label || "",
  }));

  const created = await UserPerformance.create({
    userId,
    button: defaultValues,
    domain: domain,
  });

  await setCache(`userPerformance:${userId}`, defaultValues);

  const grouped = defaultValues.reduce((acc, btn) => {
    if (!acc[btn.type]) acc[btn.type] = [];
    acc[btn.type].push(btn);
    return acc;
  }, {});

  for (const [type, btnArray] of Object.entries(grouped)) {
    await setCache(`userPerformance:${userId}:${type}`, btnArray);
  }

  return created;
};

const getUserPerformance = async (userId, type, domain) => {
  if (!userId) {
    throw new APIError("User ID is required", httpStatus.BAD_REQUEST);
  }

  const cacheKey = `userPerformance:${userId}${type ? `:${type}` : ""}`;
  const cached = await getCache(cacheKey);

  if (cached) {
    return new APIResponse(
      cached,
      "User performance fetched from cache",
      httpStatus.OK
    );
  }

  let performance = await UserPerformance.findOne({ userId });

  if (!performance) {
    performance = await initUserPerformance(userId, domain);
  }

  let buttons = performance.button;
  if (type) {
    buttons = buttons.filter((b) => b.type === type);
  }

  await setCache(cacheKey, buttons);

  return new APIResponse(buttons, "User performance fetched", httpStatus.OK);
};

const updateUserPerformance = async (userId, buttonDataArray) => {
  if (!userId) {
    throw new APIError("User ID is required", httpStatus.BAD_REQUEST);
  }

  if (!Array.isArray(buttonDataArray) || buttonDataArray.length === 0) {
    throw new APIError("Button data array is required", httpStatus.BAD_REQUEST);
  }
  const typeToReplace = buttonDataArray[0]?.type;

  if (!typeToReplace) {
    throw new APIError("Button type is required", httpStatus.BAD_REQUEST);
  }
  let performance = await UserPerformance.findOne({ userId });

  if (!performance) {
    performance = new UserPerformance({
      userId,
      button: buttonDataArray,
    });
  } else {
    performance.button = performance.button.filter(
      (b) => b.type !== typeToReplace
    );

    performance.button.push(...buttonDataArray);
  }

  await performance.save();
  await setCache(`userPerformance:${userId}:${typeToReplace}`, buttonDataArray);

  await setCache(`userPerformance:${userId}`, performance.button);

  return new APIResponse(
    performance.button,
    "User performance updated",
    httpStatus.OK
  );
};

async function deleteManyUserPerformances(userId) {
  return UserPerformance.deleteMany({ userId: userId });
}
module.exports = {
  initUserPerformance,
  getUserPerformance,
  updateUserPerformance,
  deleteManyUserPerformances,
};
