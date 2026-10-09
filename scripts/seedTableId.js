const path = require("path");

require("dotenv").config({
  path: path.resolve(__dirname, "../.env"),
});

const mongoose = require("mongoose");
const tableIdResponse = require("./tableid.data.json");

const TableId = require(
  "../server/apis/front/casino/tableid.model"
);

const MONGODB_URL = process.env.MONGO_HOST;

const seedTableId = async () => {
  try {
    mongoose.set("strictQuery", false);

    if (!MONGODB_URL) {
      throw new Error("MONGO_HOST .env file me nahi mila");
    }

    console.log("Connecting MongoDB...");

    await mongoose.connect(MONGODB_URL);

    console.log("MongoDB connected");
    console.log("Database:", mongoose.connection.name);
    console.log("Collection:", TableId.collection.name);

    /*
     * JSON me complete API response hai:
     * {
     *   data: {
     *     t1: [...]
     *   }
     * }
     */
    const gamesData = tableIdResponse?.data?.t1;

    console.log(
      "JSON records found:",
      Array.isArray(gamesData) ? gamesData.length : 0
    );

    if (
      !Array.isArray(gamesData) ||
      gamesData.length === 0
    ) {
      throw new Error(
        "in tableid.data.json data.t1 array empty or invalid"
      );
    }

    const validData = gamesData.filter(
      (item) => item && item.gmid
    );

    console.log("Valid records:", validData.length);

    if (validData.length === 0) {
      throw new Error(
        "in tableid.data.json unable to get valid gmid records"
      );
    }

    const existingCount =
      await TableId.countDocuments();

    console.log("Existing records:", existingCount);

    if (existingCount > 0) {
      console.log(
        `tableid collection records is already ${existingCount} exits. Insert skipped.`
      );

      await mongoose.disconnect();
      return;
    }

    const result = await TableId.insertMany(
      validData,
      {
        ordered: false,
      }
    );

    console.log(
      `${result.length} records tableid collection saved`
    );

    const finalCount =
      await TableId.countDocuments();

    console.log(
      "Final tableid count:",
      finalCount
    );

    await mongoose.disconnect();
  } catch (error) {
    console.error(
      "TableId seed error:",
      error
    );

    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }

    process.exit(1);
  }
};

seedTableId();