const path = require("path");

require("dotenv").config({
  path: path.resolve(__dirname, "../../.env"),
});

const mongoose = require("mongoose");
const XLSX = require("xlsx");

const Game = require("./gameSchema.model");

const MONGODB_URL = process.env.MONGO_HOST;

const seedGames = async () => {
  try {
    mongoose.set("strictQuery", false);

    if (!MONGODB_URL) {
      throw new Error("MONGO_HOST not found");
    }

    console.log("Connecting MongoDB...");

    await mongoose.connect(MONGODB_URL);

    console.log("MongoDB connected");
    console.log("Database:", mongoose.connection.name);
    console.log("Collection:", Game.collection.name);

    // Excel file
    const excelPath = path.resolve(__dirname, "./redyanna.cascasinos.xlsx");

    console.log("Reading Excel file:", excelPath);

    const workbook = XLSX.readFile(excelPath);

    const sheetName = workbook.SheetNames[0];

    console.log("Excel sheet:", sheetName);

    const worksheet = workbook.Sheets[sheetName];

    const gamesData = XLSX.utils.sheet_to_json(worksheet, {
      defval: null,
    });

    console.log("Excel records found:", gamesData.length);

    if (!Array.isArray(gamesData) || gamesData.length === 0) {
      throw new Error("Excel file empty or invalid");
    }

    // Convert Excel data to DB format
    const validData = gamesData.map((item) => ({
      // IMPORTANT:
      // Excel ka game_status ignore karna hai
      game_status: "active",

      game_image:
        item.game_image === null ||
        item.game_image === undefined ||
        item.game_image === ""
          ? null
          : item.game_image,

      game_name:
        item.game_name === null ||
        item.game_name === undefined ||
        item.game_name === ""
          ? null
          : item.game_name,

      game_slot_status:
        item.game_slot_status === null ||
        item.game_slot_status === undefined ||
        item.game_slot_status === ""
          ? null
          : String(item.game_slot_status).toLowerCase() === "true",

      game_category:
        item.game_category === null ||
        item.game_category === undefined ||
        item.game_category === ""
          ? null
          : item.game_category,

      game_provider:
        item.game_provider === null ||
        item.game_provider === undefined ||
        item.game_provider === ""
          ? null
          : item.game_provider,

      game_identifier:
        item.game_identifier === null ||
        item.game_identifier === undefined ||
        item.game_identifier === ""
          ? null
          : String(item.game_identifier),

      trending_status:
        item.trending_status === null ||
        item.trending_status === undefined ||
        item.trending_status === ""
          ? null
          : item.trending_status,
    }));

    console.log("Records prepared:", validData.length);

    // Insert records
    const result = await Game.insertMany(validData, {
      ordered: false,
    });

    console.log(
      `${result.length} games saved successfully`
    );

    const finalCount = await Game.countDocuments();

    console.log("Final game count:", finalCount);

    await mongoose.disconnect();

    console.log("MongoDB disconnected");
  } catch (error) {
    console.error("Game seed error:", error);

    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }

    process.exit(1);
  }
};

seedGames();