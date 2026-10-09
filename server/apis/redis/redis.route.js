const express = require("express");
const router = express.Router();
const { getRedis } = require("../../helpers/redis");


/**
 * GET /redis/all
 * Fetch all Redis keys and values
 */
// router.get("/all", async (req, res) => {
//   try {
//     const redis = await getRedis();

//     const keys = [];
//     // Use scan iterator (non-blocking, unlike KEYS *)
//     for await (const key of redis.scanIterator()) {
//       keys.push(key);
//     }

//     const data = {};
//     for (const key of keys) {
//       try {
//         const type = await redis.type(key);
//         let value;

//         switch (type) {
//           case "string":
//             value = await redis.get(key);
//             try {
//               data[key] = JSON.parse(value);
//             } catch {
//               data[key] = value;
//             }
//             break;
//           case "hash":
//             data[key] = await redis.hGetAll(key);
//             break;
//           case "list":
//             data[key] = await redis.lRange(key, 0, -1);
//             break;
//           case "set":
//             data[key] = await redis.sMembers(key);
//             break;
//           case "zset":
//             data[key] = await redis.zRange(key, 0, -1);
//             break;
//           default:
//             data[key] = `[Unsupported Type: ${type}]`;
//         }
//       } catch (err) {
//         console.error(`Error fetching key "${key}":`, err);
//         data[key] = `[Error: ${err.message}]`;
//       }
//     }

//     res.json({ success: true, count: keys.length, data });
//   } catch (error) {
//     console.error("Redis fetch error:", error);
//     res.status(500).json({ success: false, message: "Failed to fetch Redis data", error: error.message });
//   }
// });

router.get("/all", async (req, res) => {
  try {
    const redis = await getRedis();

    //  ONLY YOUR PROJECT KEYS (instead of excludeKeys)
    const allowedPrefixes = [
      "welcomebanner:",
      "user:",
      "tablelist:",
      "tablist:",
      "nodes",
      "highlighthomePrivate:",
      "userlogs:",
      "casinoalllist:",
      "domains:"
    ];

    const keys = [];

    // 🔁 SAME LOGIC (just filter changed)
    for await (const key of redis.scanIterator()) {
      const isAllowed = allowedPrefixes.some(prefix =>
        key.startsWith(prefix)
      );

      if (isAllowed) {
        keys.push(key);
      }
    }

    const data = {};

    // 🔁 SAME LOGIC (unchanged)
    for (const key of keys) {
      const type = await redis.type(key);
      let value;

      switch (type) {
        case "string":
          value = await redis.get(key);
          try {
            data[key] = JSON.parse(value);
          } catch {
            data[key] = value;
          }
          break;

        case "hash":
          data[key] = await redis.hGetAll(key);
          break;

        case "list":
          data[key] = await redis.lRange(key, 0, -1);
          break;

        case "set":
          data[key] = await redis.sMembers(key);
          break;

        case "zset":
          data[key] = await redis.zRange(key, 0, -1);
          break;

        default:
          data[key] = `[Unsupported Type: ${type}]`;
      }
    }

    res.json({
      success: true,
      count: keys.length,
      data
    });

  } catch (error) {
    console.error("Redis fetch error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch Redis data",
      error: error.message
    });
  }
});


/**
 * DELETE /redis/all
 * Delete all keys
 */
// router.delete("/all", async (req, res) => {
//   try {
//     const redis = await getRedis();
//     await redis.flushAll();
//     res.json({ success: true, message: "All Redis keys deleted successfully" });
//   } catch (error) {
//     console.error("Redis flush error:", error);
//     res.status(500).json({ success: false, message: "Failed to delete all keys", error: error.message });
//   }
// });


router.delete("/all", async (req, res) => {
  try {
    const redis = await getRedis();

    const allowedPrefixes = [
      "welcomebanner:",
      "user:",
      "tablelist:",
      "tablist:",
      "nodes",
      "highlighthomePrivate:",
      "userlogs:",
      "casinoalllist:",
      "domains:"
    ];

    let deletedCount = 0;

    for await (const key of redis.scanIterator()) {
      const isAllowed = allowedPrefixes.some(prefix =>
        key.startsWith(prefix)
      );

      if (!isAllowed) continue;

      await redis.del(key);
      deletedCount++;
    }

    res.json({
      success: true,
      message: "Only your Redis keys deleted successfully",
      deletedCount
    });

  } catch (error) {
    console.error("Redis delete error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to delete keys",
      error: error.message
    });
  }
});

/**
 * DELETE /redis/:key
 * Delete a specific key
 */
// router.delete("/:key", async (req, res) => {
//   try {
//     const redis = await getRedis();
//     const { key } = req.params;

//     const result = await redis.del(key);
//     if (result === 0) {
//       return res.status(404).json({ success: false, message: `Key '${key}' not found` });
//     }

//     res.json({ success: true, message: `Key '${key}' deleted successfully` });
//   } catch (error) {
//     console.error("Redis delete key error:", error);
//     res.status(500).json({ success: false, message: "Failed to delete key", error: error.message });
//   }
// });

router.delete("/:key", async (req, res) => {
  try {
    const redis = await getRedis();
    const { key } = req.params;

    const allowedPrefixes = [
      "welcomebanner:",
      "user:",
      "tablelist:",
      "tablist:",
      "nodes",
      "highlighthomePrivate:",
      "userlogs:",
      "casinoalllist:",
      "domains:"
    ];

    const isAllowed = allowedPrefixes.some(prefix =>
      key.startsWith(prefix)
    );

    if (!isAllowed) {
      return res.status(403).json({
        success: false,
        message: "This key belongs to another project"
      });
    }

    const result = await redis.del(key);

    if (result === 0) {
      return res.status(404).json({
        success: false,
        message: `Key '${key}' not found`
      });
    }

    res.json({
      success: true,
      message: `Key '${key}' deleted successfully`
    });

  } catch (error) {
    console.error("Redis delete key error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to delete key",
      error: error.message
    });
  }
});


module.exports = router;
