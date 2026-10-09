const httpStatus = require("http-status");
const APIError = require("../../helpers/APIError");
const APIResponse = require("../../helpers/APIResponse");
const Settings = require("./settings.model");
const { getCache, setCache, delCache } = require("../../helpers/cache");

// const updateButtonSettings = async (category, values, domain) => {
//   if (!category) {
//     throw new APIError("Category is required", httpStatus.BAD_REQUEST);
//   }
//   if (!Array.isArray(values) || values.length === 0) {
//     throw new APIError("Values array is required", httpStatus.BAD_REQUEST);
//   }

//   const updated = await Settings.findOneAndUpdate(
//     { category },
//     { $set: { values } },
//     { new: true, upsert: true }
//   );

//   await delCache(`settings:${category}`);

//   return new APIResponse(
//     updated,
//     `Setting updated for category: ${category}`,
//     httpStatus.OK
//   );
// };
const updateButtonSettings = async (category, values, domain) => {
  if (!category) {
    throw new APIError(
      "Category is required",
      httpStatus.BAD_REQUEST
    );
  }

  if (!Array.isArray(values) || values.length === 0) {
    throw new APIError(
      "Values array is required",
      httpStatus.BAD_REQUEST
    );
  }

  // Default: old existing record update
  let filter = {
    category,
  };

  let updateData = {
    values,
  };

  // Only bet-delay + domain provided
  if (category === "bet-delay" && domain) {
    filter = {
      category,
      domain,
    };

    updateData = {
      values,
      domain,
    };
  }

  const updated = await Settings.findOneAndUpdate(
    filter,
    {
      $set: updateData,
    },
    {
      new: true,
      upsert: true,
    }
  );

  await delCache(`settings:${category}`);

  return new APIResponse(
    updated,
    `Setting updated for category: ${category}`,
    httpStatus.OK
  );
};

const getButtonSettings = async (category, domain) => {
  if (!category) {
    throw new APIError("Category is required", httpStatus.BAD_REQUEST);
  }

  const cacheKey = `settings:${category}`;
  const cachedData = await getCache(cacheKey);
  if (cachedData) {
    return new APIResponse(
      cachedData,
      `Setting fetched from cache for ${category}`,
      httpStatus.OK
    );
  }

  const settings = await Settings.findOne({ category });
  const data = settings?.values || [];

  await setCache(cacheKey, data);

  return new APIResponse(
    data,
    `Setting fetched for ${category}`,
    httpStatus.OK
  );
};

const getAllSettings = async () => {
  const settings = await Settings.find({});
  return new APIResponse(
    settings,
    `Settings fetched`,
    httpStatus.OK
  );
};

module.exports = {
  Settings,
  updateButtonSettings,
  getButtonSettings,
  getAllSettings,
};
