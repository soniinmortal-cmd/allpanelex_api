const { delCache } = require("../../helpers/cache");
const { deleteFile } = require("../../helpers/utils");
const Banner = require("./banner.model");
const httpStatus = require("http-status");
const APIError = require("../../helpers/APIError");

async function createOrUpdateBanner(data) {
  if (data._id) {
    const banner = await Banner.findById(data._id);
    if (!banner) throw new APIError("Banner not found.", httpStatus.NOT_FOUND, true);

    if (data.image_path && banner.image_path) {
      deleteFile(banner.image_path);
    }
    if (data.mobile_image_path && banner.mobile_image_path) {
      deleteFile(banner.mobile_image_path);
    }
    Object.assign(banner, data);
    const cacheKey = `welcomebanner:${banner.type}-${banner?.domain}`;
    await delCache(cacheKey);
    return banner.save();
  } else {
    const banner = new Banner(data);
    const cacheKey = `welcomebanner:${data.type}-${data?.domain}`;
    await delCache(cacheKey);
    return banner.save();
  }
}

async function getAllBanners(domain) {
  return Banner.find({ isActive: true, domain }).sort({ createdAt: -1 });
}

async function getBannerById(id) {
  return Banner.findById(id);
}
async function getBannerByType({ type, domain }) {
  return Banner.findOne({ isActive: true, type, domain }).sort({
    createdAt: -1,
  });
}
async function deleteBanner(id) {
  const banner = await Banner.findById(id);
  if (!banner) throw new APIError("Banner not found.", httpStatus.NOT_FOUND, true);

  if (banner.image_path) {
    deleteFile(banner.image_path);
  }
  if (banner.mobile_image_path) {
    deleteFile(banner.mobile_image_path);
  }
  const cacheKey = `welcomebanner:${banner.type}-${banner?.domain}`;
  await delCache(cacheKey);
  banner.isActive = false;
  return banner.save();
}

module.exports = {
  Banner,
  createOrUpdateBanner,
  getAllBanners,
  getBannerById,
  deleteBanner,
  getBannerByType,
};
