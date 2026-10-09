const httpStatus = require("http-status");
const APIResponse = require("../../helpers/APIResponse");
const APIError = require("../../helpers/APIError");
const {
  createOrUpdateBanner,
  getAllBanners,
  getBannerById,
  deleteBanner,
  getBannerByType,
} = require("./banner.helper");
const { apiRequest } = require("../../helpers/utils");
const { setCache, getCache } = require("../../helpers/cache");

const createBanner = async (req, res, next) => {
  try {
    if (!req.files) return res.status(400).json({ message: "Image required" });

    const data = {
      status: req.body.status || "1",
      type: req.body.type,
      message: req.body.message,
      domain: req.body.domain,
    };

    if (req.files.image_path?.length > 0) {
      data.image_path = `/uploads/${req.body.domain}/${req.files.image_path[0].filename}`;
    }
    if (req.files.mobile_image_path?.length > 0) {
      data.mobile_image_path = `/uploads/${req.body.domain}/${req.files.mobile_image_path[0].filename}`;
    }
    const banner = await createOrUpdateBanner(data);

    res
      .status(httpStatus.OK)
      .send(
        new APIResponse(banner, "Banner created successfully", httpStatus.OK)
      );
  } catch (err) {
    next(err);
  }
};

const updateBanner = async (req, res, next) => {
  try {
    const banner = await getBannerById(req.params.id);
    if (!banner)
      return res
        .status(httpStatus.NOT_FOUND)
        .send(new APIError("Banner not found", httpStatus.NOT_FOUND));
    const data = {
      _id: req.params.id,

      type: req.body.type,
      message: req.body.message,
      status: req.body.status,
    };
    if (req.files.image_path) {
      data.image_path = req.files.image_path
        ? `/uploads/${req.body.domain}/${req.files.image_path[0].filename}`
        : banner.image_path;
    }
    if (req.files.mobile_image_path) {
      data.mobile_image_path = req.files.mobile_image_path
        ? `/uploads/${req.body.domain}/${req.files.mobile_image_path[0].filename}`
        : banner.mobile_image_path;
    }
    const updatedBanner = await createOrUpdateBanner(data);

    res
      .status(httpStatus.OK)
      .send(
        new APIResponse(
          updatedBanner,
          "Banner updated successfully",
          httpStatus.OK
        )
      );
  } catch (err) {
    next(err);
  }
};

const removeBanner = async (req, res, next) => {
  try {
    await deleteBanner(req.params.id);
    res
      .status(httpStatus.OK)
      .send(
        new APIResponse(null, "Banner deleted successfully", httpStatus.OK)
      );
  } catch (err) {
    next(err);
  }
};

const listBanners = async (req, res, next) => {
  try {
    const banners = await getAllBanners(req.params.domain);
    res
      .status(httpStatus.OK)
      .send(new APIResponse(banners, "Banners fetched", httpStatus.OK));
  } catch (err) {
    next(err);
  }
};
 

// const bannersByType = async (req, res, next) => {
//   try {
//     console.log("TYPE:", req.params.type);
//     console.log("DOMAIN:", req?.domainConfig?.domain);

//     const cacheKey = `welcomebanner:${req.params.type}-${req?.domainConfig?.domain}`;
//     console.log("CACHE KEY:", cacheKey);

//     let banner = await getCache(cacheKey);

//     console.log("CACHE DATA:", banner);

//     if (!banner) {
//       banner = await getBannerByType({
//         type: req.params.type,
//         domain: req?.domainConfig?.domain,
//       });

//       console.log("DB DATA:", banner);

//       if (!banner) {
//         banner = {
//           image_path: null,
//           mobile_image_path: null,
//           message: "Development Banner",
//           isThirdParty: false,
//         };
//       }

//       await setCache(cacheKey, banner, 86400);
//     }

//     res.status(200).send(banner);
//   } catch (err) {
//     next(err);
//   }
// };

const bannersByType = async (req, res, next) => {
  try {
    const cacheKey = `welcomebanner:${req.params.type}-${req?.domainConfig?.domain}`;

    let banner = await getCache(cacheKey);
    banner = null;
    if (!banner) {
      banner = await getBannerByType({
        type: req.params.type,
        domain: req?.domainConfig?.domain,
      });
      if (!banner) {
        const res = await apiRequest({
          url: `welcomebanners`,
          apiAction: "GET",
          data: { key:"V67JKNJKMM8BOKJLMKN"},
          host:"https://diamond-sports-api-demo-s2.avrkhub.in",
          noEncrypt:true
        });
        console.log("bannerresponse",res);
        if (res?.data?.data?.welcome_banner?.img_desktop) {
          banner = {
            image_path:
              "https://sitethemedata.com/common/wel-banner/" +
              res?.data?.data?.welcome_banner?.img_desktop,
            mobile_image_path:
              "https://sitethemedata.com/common/wel-banner/" +
              res?.data?.data?.welcome_banner?.img_mobile,
            message: res?.data?.data?.welcome_banner?.bdesc,
            isThirdParty: true,
          };
        } else {
          banner = {
            image_path: null,
            mobile_image_path: null,
            message: res?.data?.data?.welcome_banner?.bdesc,
            isThirdParty: true,
          };
        }
      }
      await setCache(cacheKey, banner, 86400);
    }
    res
      .status(httpStatus.OK)
      .send(new APIResponse(banner, "Banners fetched", httpStatus.OK));
  } catch (err) {
    next(err);
  }
};


module.exports = {
  listBanners,
  removeBanner,
  createBanner,
  updateBanner,
  bannersByType,
};
